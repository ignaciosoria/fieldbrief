import OpenAI from 'openai'
import { DateTime } from 'luxon'
import { NextResponse } from 'next/server'
import { toUserAnchorDateTime } from '../../../lib/calendarResolveDate'
import { resolveContactCompany } from '../../../lib/contactAffiliation'
import { dedupeConsecutiveRepeatedWords } from '../../../lib/stringDedupe'
import { stripExecutionBlocksFromCrmNarrative } from '../../../lib/crmNarrativeSanitize'
import {
  stripDealerClosingFromCrmText,
  stripDealerLinesFromCrmFull,
} from '../../../lib/dealerField'
import { normalizeProductField, productFieldToList } from '../../../lib/productField'
import { detectNoteLanguage } from '../../../lib/detectNoteLanguage'
import { type ActionStructuredFields } from '../../../lib/actionTitleContract'
import { buildNormalizedActionsFromResult } from '../../../lib/normalizedActions'
import {
  runStructurePipelineOnMappedBody,
  type MentionedEntity,
  type StructureBody,
} from '../../../lib/structurePipelineRun'
import { ensureMinimumCrmFullInsights } from '../../../lib/filterInsightLines'
import { STRUCTURED_AI_SYSTEM_PROMPT } from '../../../lib/structuredAiPrompt'
import {
  parseStructuredAiPayload,
  structuredPayloadToStructureBody,
} from '../../../lib/structuredAiMapper'

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})


/** Client instant for "now" (ISO or ms); falls back to server time only if missing/invalid. */
function parseUserLocalInstant(body: Record<string, unknown>): Date {
  const raw = body.clientNow ?? body.userLocalTimestamp ?? body.userLocalNow
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const d = new Date(raw)
    if (!Number.isNaN(d.getTime())) return d
  }
  if (typeof raw === 'string' && raw.trim()) {
    const d = new Date(raw)
    if (!Number.isNaN(d.getTime())) return d
  }
  return new Date()
}

/**
 * Rich calendar anchors (EN + ES) so the model can resolve "jueves", "próxima semana", etc.
 * Uses the **user's** request-time instant in their IANA zone (not server local clock).
 * Weekday offsets: **nearest** calendar occurrence of that weekday (0–6 days ahead), with
 * late-night / "next weekday" rules applied in post-processing, not here.
 */
function buildStructureUserDateContext(timeZone: string, userNow: Date): string {
  const z = timeZone.trim() || 'America/Los_Angeles'
  const now = toUserAnchorDateTime(userNow, z)
  const fmtPair = (dt: DateTime) => {
    const en = dt.setLocale('en').toFormat('EEEE, MMMM d, yyyy')
    const es = dt.setLocale('es').toFormat("EEEE, d 'de' MMMM 'de' yyyy")
    return `${en} / ${es}`
  }
  const todayEN = now.setLocale('en').toFormat('EEEE, MMMM d, yyyy')
  const todayES = now.setLocale('es').toFormat("EEEE, d 'de' MMMM 'de' yyyy")
  const tomorrow = now.plus({ days: 1 })
  const nextThursday = now.plus({ days: (4 - now.weekday + 7) % 7 })
  const nextFriday = now.plus({ days: (5 - now.weekday + 7) % 7 })
  const nextMonday = now.plus({ days: (1 - now.weekday + 7) % 7 })
  const upcomingMonday = now.plus({ days: (1 - now.weekday + 7) % 7 })
  const nextWeekMonday = upcomingMonday.plus({ days: 7 })

  return [
    `User calendar timezone for this request: ${z}. The user's local "now" for this note is anchored to their device clock at send time — all relative dates ("today", "tomorrow", weekdays) use that instant in this timezone (not server time or UTC date alone).`,
    'Calendar context (use for relative dates in the note):',
    `Today: ${todayEN} / ${todayES}`,
    `Tomorrow: ${fmtPair(tomorrow)}`,
    `This upcoming Thursday: ${fmtPair(nextThursday)}`,
    `This upcoming Friday: ${fmtPair(nextFriday)}`,
    `Upcoming Monday (next calendar Monday): ${fmtPair(nextMonday)}`,
    `Monday in the following week (+7 days after that — aligns with "la próxima semana" when the note means the week after): ${fmtPair(nextWeekMonday)}`,
  ].join('\n')
}

function extractJson(text: string): string {
  // Strip markdown code fences if present
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenceMatch) return fenceMatch[1].trim()

  // Find first { to last } in case there's extra text
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end !== -1) return text.slice(start, end + 1)

  return text.trim()
}

/** Set STRUCTURE_PIPELINE_DEBUG=1 (server env) to log JSON snapshots at each pipeline stage. */
const STRUCTURE_PIPELINE_DEBUG =
  process.env.STRUCTURE_PIPELINE_DEBUG === '1' ||
  process.env.STRUCTURE_PIPELINE_DEBUG === 'true'

/** Set STRUCTURE_PRIMARY_CAL_DEBUG=1 to trace primary action vs date/time for calendar (temporary). */
const STRUCTURE_PRIMARY_CAL_DEBUG =
  process.env.STRUCTURE_PRIMARY_CAL_DEBUG === '1' ||
  process.env.STRUCTURE_PRIMARY_CAL_DEBUG === 'true'

const STRUCTURE_PIPELINE_DEBUG_MAX_JSON = 150_000

function logPrimaryCalendarDebug(label: string, data: Record<string, unknown>): void {
  if (!STRUCTURE_PRIMARY_CAL_DEBUG && !STRUCTURE_PIPELINE_DEBUG) return
  console.log(`[structure] primary_calendar ${label}`, data)
}

function logStructurePipelineStage(stage: string, data: unknown): void {
  if (!STRUCTURE_PIPELINE_DEBUG) return
  try {
    let s = JSON.stringify(data)
    if (s.length > STRUCTURE_PIPELINE_DEBUG_MAX_JSON) {
      s = `${s.slice(0, STRUCTURE_PIPELINE_DEBUG_MAX_JSON)}…[truncated]`
    }
    console.log(`[structure_pipeline] ${stage}`, s)
  } catch (err) {
    console.log(`[structure_pipeline] ${stage} <serialize_error>`, err)
  }
}

/** YYYY-MM-DD → MM/DD/YYYY for client calendar fields. */
function normalizeNextStepDate(d: string): string {
  const t = d.trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) {
    const [y, m, day] = t.slice(0, 10).split('-')
    return `${m}/${day}/${y}`
  }
  return t
}

/**
 * customer must be a real organization name. If the model returns only a relational
 * description ("their neighbor", "his client" with no company), treat as empty.
 */
function isRelationalCustomerOnly(value: string): boolean {
  const t = value.trim().replace(/\s+/g, ' ')
  if (!t) return false
  const lower = t.toLowerCase()

  const singleTokens = new Set([
    'cliente',
    'client',
    'clientes',
    'clients',
    'vecino',
    'vecina',
    'vecinos',
    'neighbor',
    'neighbors',
    'neighbour',
    'neighbours',
  ])
  if (singleTokens.has(lower)) return true

  const phraseRes = [
    /^su\s+cuñad[oa]$/i,
    /^su\s+cliente$/i,
    /^su\s+vecin[oa]$/i,
    /^un\s+vecin[oa]$/i,
    /^el\s+vecin[oa]$/i,
    /^la\s+vecina$/i,
    /^un\s+cliente$/i,
    /^el\s+cliente$/i,
    /^una\s+clienta$/i,
    /^su\s+herman[oa]$/i,
    /^su\s+primo$/i,
    /^su\s+prima$/i,
    /^su\s+contacto$/i,
    /^su\s+amig[oa]$/i,
    /^su\s+pariente$/i,
    /^su\s+familiar$/i,
    /^his\s+client$/i,
    /^her\s+client$/i,
    /^their\s+client$/i,
    /^a\s+neighbor$/i,
    /^the\s+neighbor$/i,
    /^his\s+brother/i,
    /^her\s+sister/i,
    /^their\s+neighbor$/i,
  ]
  if (phraseRes.some((re) => re.test(t))) return true

  const twoWord = new RegExp(
    `^(su|el|la|un|una|los|las|mi|tu|mis|tus|his|her|their|a|the|my|our)\\s+` +
      `(cuñado|cuñada|vecino|vecina|cliente|clientes|hermano|hermana|primo|prima|tío|tía|amigo|amiga|contacto|referido|referida|pariente|familiar|client|clients|neighbor|neighbours|brother|sister|cousin|friend)s?$`,
    'i',
  )
  if (twoWord.test(lower)) return true

  return false
}

function sanitizeCustomerField(value: string): string {
  const t = value.trim()
  if (!t) return ''
  return isRelationalCustomerOnly(t) ? '' : t
}

/** Legacy prompts used 🌱/🌾; normalize to industry-agnostic 📦/📊 for key insights. */
function normalizeInsightEmojis(lines: string[]): string[] {
  return lines.map((line) =>
    line
      .replace(/^(\s*)🌱/u, '$1📦')
      .replace(/^(\s*)🌾/u, '$1📊'),
  )
}

function mergeCropIntoProduct(crop: string, product: string): { crop: string; product: string } {
  const c = crop.trim()
  const normalized = normalizeProductField(product)
  if (!c) return { crop: '', product: normalized }
  const parts = productFieldToList(normalized)
  if (parts.some((p) => p.toLowerCase() === c.toLowerCase())) {
    return { crop: '', product: normalized }
  }
  return { crop: '', product: normalizeProductField([c, ...parts].join(', ')) }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>
    const note = body?.note
    const timeZoneRaw = typeof body?.timezone === 'string' ? body.timezone.trim() : ''
    const tzCandidate = timeZoneRaw || 'America/Los_Angeles'
    const timeZoneProbe = DateTime.now().setZone(tzCandidate)
    const timeZone = timeZoneProbe.isValid ? tzCandidate : 'America/Los_Angeles'
    const userLocalNow = parseUserLocalInstant(body)

    if (!note || typeof note !== 'string') {
      return NextResponse.json({ error: 'Missing note' }, { status: 400 })
    }

    const dateContext = buildStructureUserDateContext(timeZone, userLocalNow)

    const detectedLanguage = detectNoteLanguage(note)
    const languageEnforcement =
      `The input note is in ${detectedLanguage}. ` +
      `ALL string values in the JSON (primary, supporting, crm_summary, insights) MUST be in ${detectedLanguage} — the same language as the input note — with no exceptions.`
    const systemContent = `${languageEnforcement}\n\n${STRUCTURED_AI_SYSTEM_PROMPT}`

    console.log('[structure] detected language:', detectedLanguage)
    console.log('[structure] system prompt prefix (200 chars):', systemContent.slice(0, 200))

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      messages: [
        { role: 'system', content: systemContent },
        {
          role: 'user',
          content: `${dateContext}\n\n---\n\n${note}`,
        },
      ],
    })

    const text = response.choices[0]?.message?.content ?? ''

    if (STRUCTURE_PIPELINE_DEBUG) {
      console.log(
        '[structure_pipeline] STRUCTURE_PIPELINE_DEBUG on — tracing: raw → extracted JSON → parse → payload → mapped → pipeline → final',
      )
    }

    let result: StructureBody

    try {
      const clean = extractJson(text)
      logStructurePipelineStage('01_raw_model_message', text)
      logStructurePipelineStage('02_extracted_json_string', clean)

      const parsed = JSON.parse(clean) as Record<string, unknown>
      logStructurePipelineStage('03_json_parse_object', parsed)

      const payload = parseStructuredAiPayload(parsed)
      logStructurePipelineStage('04_parsed_structured_payload', payload)
      if (!payload) {
        return NextResponse.json(
          { error: 'Model did not return valid structured JSON', raw: text },
          { status: 500 },
        )
      }
      result = structuredPayloadToStructureBody(payload, detectedLanguage, note) as StructureBody
      logStructurePipelineStage('05_mapped_structure_body', result)
    } catch {
      return NextResponse.json(
        { error: 'Model did not return valid JSON', raw: text },
        { status: 500 },
      )
    }

    result = runStructurePipelineOnMappedBody(
      result,
      typeof note === 'string' ? note : '',
      detectedLanguage,
      timeZone,
      userLocalNow,
    )
    logStructurePipelineStage('06_09_after_structure_pipeline', result)

    const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '')

    /** Trim leading/trailing space; uppercase the first character of the text (title line must not start lowercase). */
    const capitalizeFirstLetter = (s: string) => {
      const t = String(s ?? '').trim()
      if (!t) return ''
      return t.charAt(0).toUpperCase() + t.slice(1)
    }

    const titleCaseWords = (s: string) =>
      s
        .split(' ')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')

    const capitalized = {
      ...result,
      contact: dedupeConsecutiveRepeatedWords(titleCaseWords(result.contact)),
      customer: dedupeConsecutiveRepeatedWords(
        sanitizeCustomerField(titleCaseWords(result.customer)),
      ),
      summary: result.summary.trim(),
      nextStep: dedupeConsecutiveRepeatedWords(capitalize(result.nextStep)),
      nextStepTitle: dedupeConsecutiveRepeatedWords(capitalizeFirstLetter(result.nextStepTitle)),
      nextStepAction: result.nextStepAction.trim(),
      nextStepTarget: dedupeConsecutiveRepeatedWords(titleCaseWords(result.nextStepTarget)),
      nextStepDate: result.nextStepDate.trim(),
      nextStepSoftTiming: (result.nextStepSoftTiming || '').trim(),
      followUpStrength: (result.followUpStrength || '').trim(),
      nextStepTimeReference: (result.nextStepTimeReference || '').trim(),
      nextStepTimeHint: result.nextStepTimeHint.trim(),
      nextStepConfidence: result.nextStepConfidence,
      ...(result.primaryActionStructured
        ? { primaryActionStructured: result.primaryActionStructured }
        : {}),
      ambiguityFlags: result.ambiguityFlags,
      mentionedEntities: result.mentionedEntities.map((e) => ({
        name: dedupeConsecutiveRepeatedWords(titleCaseWords(e.name)),
        type: e.type,
      })),
      notes: capitalize(result.notes),
      crop: titleCaseWords(result.crop),
      product: normalizeProductField(result.product),
      location: titleCaseWords(result.location),
      acreage: result.acreage,
      crmText: capitalize(result.crmText),
      calendarDescription: result.calendarDescription.trim(),
      additionalSteps: result.additionalSteps.map((s) => ({
        action: capitalize(s.action.trim()),
        contact: dedupeConsecutiveRepeatedWords(titleCaseWords(s.contact.trim())),
        company: dedupeConsecutiveRepeatedWords(titleCaseWords(s.company.trim())),
        resolvedDate: s.resolvedDate.trim(),
        timeHint: s.timeHint.trim(),
        ...(s.supportingType ? { supportingType: s.supportingType } : {}),
        ...(s.label?.trim() ? { label: s.label.trim() } : {}),
        ...(s.structuredDate?.trim() ? { structuredDate: s.structuredDate.trim() } : {}),
        ...(s.structuredTime?.trim() ? { structuredTime: s.structuredTime.trim() } : {}),
        ...(s.actionStructured ? { actionStructured: s.actionStructured } : {}),
      })),
    }

    logStructurePipelineStage('10_after_capitalize_titlecase_block', capitalized)

    const { crop: mergedCrop, product: mergedProduct } = mergeCropIntoProduct(
      capitalized.crop,
      capitalized.product,
    )
    const afterProduct = { ...capitalized, crop: mergedCrop, product: mergedProduct }
    logStructurePipelineStage('11_after_merge_crop_product', afterProduct)

    const resolvedContactCompany = dedupeConsecutiveRepeatedWords(
      resolveContactCompany(
        afterProduct.customer,
        afterProduct.contact,
        afterProduct.nextStepTarget,
        titleCaseWords(result.contactCompany),
      ),
    )

    const langEsInsights = /spanish/i.test(detectedLanguage)
    let crmFullFinal = stripDealerLinesFromCrmFull(
      normalizeInsightEmojis(afterProduct.crmFull),
    ).slice(0, 4)
    if (crmFullFinal.length === 0) {
      crmFullFinal = ensureMinimumCrmFullInsights({
        crmFull: [],
        rawInsightLines: [],
        crmSummary: afterProduct.crmText,
        note: typeof note === 'string' ? note : '',
        maxLines: 4,
        langEs: langEsInsights,
      })
    }

    const enriched = {
      ...afterProduct,
      contactCompany: resolvedContactCompany,
      crmFull: crmFullFinal,
      crmText: stripExecutionBlocksFromCrmNarrative(
        stripDealerClosingFromCrmText(afterProduct.crmText),
      ),
      /** Backend-derived ordered actions (primary/supporting); ranking + extraction, not model order. */
      actions: buildNormalizedActionsFromResult(afterProduct),
    }

    logStructurePipelineStage('12_final_response_payload', enriched)

    return NextResponse.json(enriched)
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Something went wrong' },
      { status: 500 }
    )
  }
}