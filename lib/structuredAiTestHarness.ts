/**
 * Regression harness: deterministic golden structured JSON → full pipeline → expectations.
 * Run: `npm run test:structured-ai`
 */

import { detectNoteLanguage } from './detectNoteLanguage'
import {
  runStructurePipelineFromParsedJson,
  type StructureBody,
} from './structurePipelineRun'

/** Fixed “now” for stable ranking / date resolution in tests. */
export const HARNESS_TIMEZONE = 'America/Los_Angeles'
export const HARNESS_USER_NOW = new Date('2026-04-09T18:00:00.000Z')

export type InsightKind = 'product' | 'problem' | 'barrier' | 'opportunity'

export type StructuredPrimaryType = 'call' | 'send' | 'meeting' | 'follow_up'

export type StructuredAiTestExpectation = {
  /** Primary action type after ranking + mapping (see `primaryActionStructured.type`). */
  primaryType: StructuredPrimaryType
  /** Supporting row types after pipeline, in any order (email/send/call/other). */
  secondaryTypes: string[]
  /** Each listed kind must be reflected in `crmFull` text (heuristic patterns). */
  requiredInsightTypes: InsightKind[]
}

export type StructuredAiTestCase = {
  id: string
  /** Representative field note (for language + context; pipeline uses golden JSON). */
  note: string
  /** Canonical model JSON (same shape as `/api/structure` after `JSON.parse`). */
  goldenModelJson: Record<string, unknown>
  expected: StructuredAiTestExpectation
}

/**
 * Heuristic: whether combined insight lines mention the commercial signal category.
 * Tune patterns when prompts change — goal is catch regressions, not perfect NLP.
 */
const INSIGHT_PATTERNS: Record<InsightKind, RegExp[]> = {
  product: [
    /\b(trial|program|product|foliar|nutrient|hybrid|seed|variety|grape|table\s+grape)\b/i,
    /\b(programa|producto|ensayo)\b/i,
  ],
  problem: [
    /\b(yield|size|pest|disease|quality|mildew|drought|deficit|baja|potassium|waste|layout|pain)\b/i,
    /\b(problema|calibre|rendimiento|agronomic)\b/i,
  ],
  barrier: [
    /\b(budget|approval|results|waiting|pending|partner|legal|riesgo|barrier|held)\b/i,
    /\b(presupuesto|aprobación|resultados|espera|walkthrough)\b/i,
  ],
  opportunity: [
    /\b(acres|hectares|hectáreas|expansion|referral|upsell|add-on|neighbor|vecino|potential|larger|order|second site)\b/i,
    /\b(oportunidad|expansión|hectáreas|pedido)\b/i,
  ],
}

export function insightTextReflectsKind(combinedInsights: string, kind: InsightKind): boolean {
  const t = combinedInsights.replace(/\s+/g, ' ').trim()
  if (!t) return false
  return INSIGHT_PATTERNS[kind].some((re) => re.test(t))
}

export type CaseDiff = {
  caseId: string
  field: string
  expected: unknown
  actual: unknown
}

export type HarnessCaseResult = {
  caseId: string
  ok: boolean
  diffs: CaseDiff[]
  actual: {
    primaryType: string | undefined
    secondaryTypes: string[]
    insightSample: string
  }
}

export type HarnessRunResult = {
  cases: HarnessCaseResult[]
  failures: HarnessCaseResult[]
}

function sortStrings(a: string[]): string[] {
  return [...a].map((x) => x || '').filter(Boolean).sort()
}

function compareSecondary(expected: string[], actual: string[]): boolean {
  return JSON.stringify(sortStrings(expected)) === JSON.stringify(sortStrings(actual))
}

function runOneCase(tc: StructuredAiTestCase): HarnessCaseResult {
  const lang = detectNoteLanguage(tc.note)
  let body: StructureBody
  try {
    body = runStructurePipelineFromParsedJson(
      tc.goldenModelJson,
      tc.note,
      lang,
      HARNESS_TIMEZONE,
      HARNESS_USER_NOW,
    )
  } catch (e) {
    return {
      caseId: tc.id,
      ok: false,
      diffs: [
        {
          caseId: tc.id,
          field: 'pipeline',
          expected: 'successful parse + run',
          actual: e instanceof Error ? e.message : String(e),
        },
      ],
      actual: { primaryType: undefined, secondaryTypes: [], insightSample: '' },
    }
  }

  const primaryType = body.primaryActionStructured?.type as string | undefined
  const secondaryTypes = (body.additionalSteps || [])
    .map((s) => s.supportingType || '')
    .filter(Boolean)
  const insightText = [...(body.crmFull || []), body.crmText || ''].join('\n')

  const diffs: CaseDiff[] = []

  if (primaryType !== tc.expected.primaryType) {
    diffs.push({
      caseId: tc.id,
      field: 'primaryType',
      expected: tc.expected.primaryType,
      actual: primaryType,
    })
  }

  if (!compareSecondary(tc.expected.secondaryTypes, secondaryTypes)) {
    diffs.push({
      caseId: tc.id,
      field: 'secondaryTypes',
      expected: tc.expected.secondaryTypes,
      actual: secondaryTypes,
    })
  }

  for (const kind of tc.expected.requiredInsightTypes) {
    if (!insightTextReflectsKind(insightText, kind)) {
      diffs.push({
        caseId: tc.id,
        field: `insight:${kind}`,
        expected: 'pattern match in crmFull/crmText',
        actual: insightText.slice(0, 200),
      })
    }
  }

  return {
    caseId: tc.id,
    ok: diffs.length === 0,
    diffs,
    actual: {
      primaryType,
      secondaryTypes,
      insightSample: insightText.slice(0, 280),
    },
  }
}

/** Five fixed scenarios: golden JSON is hand-authored to be valid for `parseStructuredAiPayload`. */
export const STRUCTURED_AI_TEST_CASES: StructuredAiTestCase[] = [
  {
    id: 'send_today_call_next_week',
    note:
      'Met Sarah at Sunrise Growers. Fruit size is off this season on table grapes. She wants the yield comparison PDF today before 5pm. Follow up call with Mike next Thursday on trial results and budget.',
    goldenModelJson: {
      primary: {
        type: 'send',
        contact: 'Sarah',
        object: 'yield comparison PDF',
        company: 'Sunrise Growers',
        date: '04/09/2026',
        time: '17:00',
        soft_timing: '',
        follow_up_strength: '',
      },
      supporting: [
        {
          type: 'call',
          label: '',
          object: '',
          contact: 'Mike',
          date: '04/16/2026',
          time: '',
        },
      ],
      crm_summary:
        'Sarah is the buyer. Table grape block showing smaller fruit vs last year. She asked for the yield comparison PDF today. Mike handles trials — need his read before budget.',
      calendar_description:
        'Sarah at Sunrise Growers is evaluating programs on table grapes.\n\nFruit calibre is down versus last season.\n\nSend the yield comparison PDF today; call Mike next week to align on trial results and budget.',
      insights: [
        'Evaluating foliar and nutrition program fit on table grapes — product interest.',
        'Fruit size and yield below last season — main agronomic pressure.',
        'Budget approval waiting on trial results — decision barrier.',
        'Neighbor operation may expand acreage if trial works — expansion angle.',
      ],
    },
    expected: {
      primaryType: 'send',
      secondaryTypes: ['call'],
      requiredInsightTypes: ['product', 'problem', 'barrier', 'opportunity'],
    },
  },
  {
    id: 'follow_up_relationship',
    note:
      'Quick stop at Hillside Co-op. Good rapport with Ana. No urgent deadline. Revisit next season when they replant.',
    goldenModelJson: {
      primary: {
        type: 'follow_up',
        contact: 'Ana',
        object: '',
        company: 'Hillside Co-op',
        date: '',
        time: '',
        soft_timing: 'next_week',
        follow_up_strength: 'soft',
      },
      supporting: [],
      crm_summary:
        'Relationship visit. Ana is open to ideas but replanting decision is next season. No immediate SKU discussion.',
      calendar_description:
        'Ana at Hillside Co-op — relationship check after a short visit.\n\nStay in touch ahead of replanting conversation next season.',
      insights: [
        'General interest in programs for next replant — product angle for later.',
        'Timing tied to replant cycle — no acute agronomic firefight.',
        'No budget line this quarter — barrier to near-term PO.',
        'Potential larger order when replant plan firms — upside.',
      ],
    },
    expected: {
      primaryType: 'follow_up',
      secondaryTypes: [],
      requiredInsightTypes: ['product', 'barrier', 'opportunity'],
    },
  },
  {
    id: 'spanish_send_and_call',
    note:
      'Visita en Los Pinos. Enviar propuesta técnica mañana. Llamar a Carlos el jueves para cerrar el pedido.',
    goldenModelJson: {
      primary: {
        type: 'send',
        contact: 'Laura',
        object: 'propuesta técnica',
        company: 'Los Pinos',
        date: '04/10/2026',
        time: '',
        soft_timing: '',
        follow_up_strength: '',
      },
      supporting: [
        {
          type: 'call',
          label: '',
          object: '',
          contact: 'Carlos',
          date: '04/10/2026',
          time: '',
        },
      ],
      crm_summary:
        'Laura pidió la propuesta técnica para el bloque norte. Carlos decide el pedido; hay presión de competidor.',
      calendar_description:
        'Laura en Los Pinos necesita la propuesta técnica para el bloque norte.\n\nLlamar a Carlos para avanzar el pedido.',
      insights: [
        'Interés en programa para bloque norte — producto.',
        'Competidor ya cotizó — problema de presión.',
        'Pedido sujeto a aprobación de Carlos — barrera.',
        'Posible ampliación al bloque sur si cierra — oportunidad.',
      ],
    },
    expected: {
      primaryType: 'send',
      secondaryTypes: ['call'],
      requiredInsightTypes: ['product', 'problem', 'barrier', 'opportunity'],
    },
  },
  {
    id: 'meeting_site_visit',
    note:
      'Schedule a site visit with Priya at Riverbend next Tuesday 9am to review irrigation layout before quote.',
    goldenModelJson: {
      primary: {
        type: 'meeting',
        contact: 'Priya',
        object: '',
        company: 'Riverbend Farms',
        date: '04/14/2026',
        time: '09:00',
        soft_timing: '',
        follow_up_strength: '',
      },
      supporting: [],
      crm_summary:
        'Priya wants a joint walk of irrigation zones before final quote. Competitive bid in play.',
      calendar_description:
        'Priya at Riverbend — site visit to review irrigation layout before quoting.\n\nFocus on zones that drive the quote.',
      insights: [
        'Irrigation upgrade project — product scope discussion.',
        'Layout issues driving water waste — operational pain.',
        'Quote held until walkthrough — decision barrier.',
        'Additional acres may join if pilot zone wins — expansion.',
      ],
    },
    expected: {
      primaryType: 'meeting',
      secondaryTypes: [],
      requiredInsightTypes: ['product', 'problem', 'barrier', 'opportunity'],
    },
  },
  {
    id: 'multi_supporting_actions',
    note:
      'Email the contract to James today. Call warehouse manager about delivery window. Send soil lab results to Emma.',
    goldenModelJson: {
      primary: {
        type: 'send',
        contact: 'James',
        object: 'contract',
        company: 'Coastal Ag',
        date: '04/09/2026',
        time: '',
        soft_timing: '',
        follow_up_strength: '',
      },
      supporting: [
        {
          type: 'call',
          label: '',
          object: '',
          contact: 'warehouse manager',
          date: '04/09/2026',
          time: '',
        },
        {
          type: 'email',
          label: '',
          object: 'soil lab results',
          contact: 'Emma',
          date: '04/09/2026',
          time: '',
        },
      ],
      crm_summary:
        'James needs the contract today. Warehouse timing is tight. Emma is waiting on lab results for the south field.',
      calendar_description:
        'James at Coastal Ag needs the contract today.\n\nWarehouse slot and Emma’s lab readouts are blocking execution.',
      insights: [
        'Contract and soil data package — product deliverables.',
        'South field showing low potassium — agronomic issue.',
        'Delivery window not confirmed — operational barrier.',
        'Second site may onboard if south field improves — growth opportunity.',
      ],
    },
    expected: {
      primaryType: 'send',
      secondaryTypes: ['call', 'email'],
      requiredInsightTypes: ['product', 'problem', 'barrier', 'opportunity'],
    },
  },
]

export function runStructuredAiHarness(cases: StructuredAiTestCase[] = STRUCTURED_AI_TEST_CASES): HarnessRunResult {
  const results = cases.map(runOneCase)
  const failures = results.filter((r) => !r.ok)
  return { cases: results, failures }
}

export function formatHarnessDiffs(result: HarnessRunResult): string {
  const lines: string[] = []
  for (const c of result.cases) {
    lines.push(`\n━━ ${c.caseId} ${c.ok ? '✓' : '✗'} ━━`)
    if (c.ok) {
      lines.push(`  primary: ${c.actual.primaryType} | secondary: [${c.actual.secondaryTypes.join(', ')}]`)
      continue
    }
    for (const d of c.diffs) {
      lines.push(`  [${d.field}]`)
      lines.push(`    expected: ${JSON.stringify(d.expected)}`)
      lines.push(`    actual:   ${JSON.stringify(d.actual)}`)
    }
    lines.push(`  snapshot: ${c.actual.insightSample.slice(0, 120)}…`)
  }
  return lines.join('\n')
}

export function printHarnessReport(result: HarnessRunResult): void {
  const { cases, failures } = result
  console.log(`[structured-ai-harness] ${cases.length} cases, ${failures.length} failed`)
  console.log(formatHarnessDiffs(result))
}
