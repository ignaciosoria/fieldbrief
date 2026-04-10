import OpenAI from 'openai'
import { DateTime } from 'luxon'
import { NextResponse } from 'next/server'
import {
  resolveRelativeDate,
  resolveRelativePhraseToMmdd,
  resolveCalendarTimeHint,
  toUserAnchorDateTime,
} from '../../../lib/calendarResolveDate'
import {
  isHighValuePrimaryCandidate,
  isSendOrEmailTier,
  kindScoreForPrimarySelection,
  normalizedTypeForRow,
  primaryBusinessTier,
} from '../../../lib/actionPrimarySelection'
import { resolveContactCompany } from '../../../lib/contactAffiliation'
import { dedupeConsecutiveRepeatedWords } from '../../../lib/stringDedupe'
import {
  stripDealerClosingFromCrmText,
  stripDealerLinesFromCrmFull,
} from '../../../lib/dealerField'
import { normalizeProductField, productFieldToList } from '../../../lib/productField'
import { detectNoteLanguage } from '../../../lib/detectNoteLanguage'
import { isNoClearFollowUpLine } from '../../../lib/noFollowUp'
import { enrichStructureWithExtractedActions } from '../../../lib/extractActionsFromStructure'
import {
  enrichAdditionalStepsList,
  type AdditionalStep,
  type SupportingStructuredType,
} from '../../../lib/additionalStepEnrichment'
import {
  buildNormalizedActionsFromResult,
  type NormalizedActionType,
} from '../../../lib/normalizedActions'
import { normalizeNextStepTitleStrict } from '../../../lib/normalizeNextStepTitle'
import { sanitizeAdditionalSteps } from '../../../lib/sanitizeAdditionalSteps'
import { STRUCTURED_AI_SYSTEM_PROMPT } from '../../../lib/structuredAiPrompt'
import {
  parseStructuredAiPayload,
  structuredPayloadToStructureBody,
} from '../../../lib/structuredAiMapper'

type MentionedEntity = { name: string; type: string }

type StructureBody = {
  customer: string
  contact: string
  contactCompany: string
  summary: string
  nextStep: string
  nextStepTitle: string
  nextStepAction: string
  nextStepTarget: string
  nextStepDate: string
  /** Relative time phrase only (tomorrow, next Friday, next week). Server resolves to MM/DD/YYYY. */
  nextStepTimeReference: string
  nextStepTimeHint: string
  nextStepConfidence: 'high' | 'medium' | 'low'
  ambiguityFlags: string[]
  mentionedEntities: MentionedEntity[]
  notes: string
  crop: string
  product: string
  location: string
  acreage: string
  crmText: string
  crmFull: string[]
  /** 3–5 scannable → lines for calendar event body; separate from crmFull and crmText. */
  calendarDescription: string
  additionalSteps: AdditionalStep[]
}

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

const STRUCTURE_PIPELINE_DEBUG_MAX_JSON = 150_000

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

/** Map nextStepTime strings to hints the client calendar layer understands. */
function normalizeTimeToHint(nextStepTime: string, existingHint: string): string {
  const hint = existingHint.trim()
  if (hint) return hint
  const t = nextStepTime.trim()
  if (!t) return ''
  const lower = t.toLowerCase()
  if (lower === '9:00am' || lower === '9:00 am' || /\bpor la mañana\b/.test(lower)) {
    return 'morning'
  }
  if (
    lower === '3:00pm' ||
    lower === '3:00 pm' ||
    /\bpor la tarde\b/.test(lower) ||
    lower.includes('afternoon')
  ) {
    return 'afternoon'
  }
  if (
    lower === '12:00pm' ||
    lower === '12:00 pm' ||
    /\bmediodía\b/.test(lower) ||
    lower.includes('noon')
  ) {
    return 'noon'
  }
  const m = t.match(/^(\d{1,2}):(\d{2})\s*(am|pm)\b/i)
  if (m) {
    let h = parseInt(m[1], 10)
    const min = m[2]
    const ap = m[3].toLowerCase()
    if (ap === 'pm' && h < 12) h += 12
    if (ap === 'am' && h === 12) h = 0
    return `${String(h).padStart(2, '0')}:${min}`
  }
  if (/^\d{1,2}:\d{2}$/.test(t.trim())) return t.trim()
  return t
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

/** Sort key: MM/DD/YYYY, ISO date, or missing (missing = last). */
function parseStepDateMs(dateStr: string): number {
  const t = (dateStr || '').trim()
  if (!t) return Number.POSITIVE_INFINITY
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(t)) {
    const [mm, dd, yyyy] = t.split('/').map((x) => parseInt(x, 10))
    if ([mm, dd, yyyy].some((n) => Number.isNaN(n))) return Number.POSITIVE_INFINITY
    return new Date(yyyy, mm - 1, dd).getTime()
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) {
    const d = new Date(t.slice(0, 10) + 'T12:00:00')
    return Number.isNaN(d.getTime()) ? Number.POSITIVE_INFINITY : d.getTime()
  }
  const d = new Date(t)
  return Number.isNaN(d.getTime()) ? Number.POSITIVE_INFINITY : d.getTime()
}

type ChronologicalRow = {
  idx: number
  source: 'primary' | 'additional'
  action: string
  title: string
  date: string
  time: string
  supportingType?: SupportingStructuredType
  label?: string
  structuredDate?: string
  structuredTime?: string
}

type ScoredRow = ChronologicalRow & {
  _dateRaw: string
  _timeRaw: string
  _normalizedType: NormalizedActionType
  _tier: 0 | 1 | 2
  _kindScore: number
}

/**
 * Phase 2 — deterministic primary/supporting:
 * - **Tier 0** (meeting, call, follow_up) always beats **tier 1** (send, email) and **tier 2** (other).
 * - send/email cannot be primary if any tier-0 action exists (sort + safety net).
 * - Within tier: meeting > call > follow_up > … by kind score, then **earlier date** breaks ties,
 *   then stable idx. **Every non-primary row is kept** in `additionalSteps` (sorted by original `idx`);
 *   send/email are never dropped when a tier-0 action is primary.
 */
function applyRankedNextStepSelection(
  result: StructureBody,
  timeZone: string,
  userNow: Date,
): StructureBody {
  const anchor = toUserAnchorDateTime(userNow, timeZone)
  const rows: ChronologicalRow[] = []
  let idx = 0
  const primaryAction = (result.nextStep || '').trim()
  if (primaryAction) {
    rows.push({
      idx: idx++,
      source: 'primary',
      action: result.nextStep.trim(),
      title: (result.nextStepTitle || result.nextStep).trim(),
      date: (result.nextStepDate || '').trim(),
      time: (result.nextStepTimeHint || '').trim(),
    })
  }
  for (const s of result.additionalSteps || []) {
    const a = (s.action || '').trim()
    if (!a) continue
    rows.push({
      idx: idx++,
      source: 'additional',
      action: s.action.trim(),
      title: s.action.trim(),
      date: (s.resolvedDate || '').trim(),
      time: (s.timeHint || '').trim(),
      supportingType: s.supportingType,
      label: s.label,
      structuredDate: s.structuredDate,
      structuredTime: s.structuredTime,
    })
  }
  if (rows.length === 0) return result

  console.log(
    '[structure] rank: actions BEFORE resolve (raw model dates)',
    rows.map((r) => ({
      source: r.source,
      action: r.action.slice(0, 120),
      dateRaw: r.date,
      timeRaw: r.time,
    })),
  )

  const resolved: ScoredRow[] = rows.map((r) => {
    const dateTrim = r.date.trim()
    const timeTrim = r.time.trim()
    const rawForResolve = dateTrim || timeTrim
    const mmdd = resolveRelativePhraseToMmdd(rawForResolve, timeZone, anchor)
    const dateForSort = mmdd ?? dateTrim

    const nt = normalizedTypeForRow(r.action, r.title)
    const tier = primaryBusinessTier(nt)
    const kindScore = kindScoreForPrimarySelection(r.action, r.title)

    return {
      ...r,
      date: dateForSort,
      _dateRaw: r.date,
      _timeRaw: r.time,
      _normalizedType: nt,
      _tier: tier,
      _kindScore: kindScore,
    }
  })

  console.log(
    '[structure] rank: tiers (0=call/meeting/follow_up, 1=send/email, 2=other)',
    resolved.map((r) => ({
      source: r.source,
      type: r._normalizedType,
      tier: r._tier,
      kindScore: r._kindScore,
      action: r.action.slice(0, 100),
      dateResolved: r.date,
    })),
  )

  resolved.sort((a, b) => {
    if (a._tier !== b._tier) return a._tier - b._tier
    if (b._kindScore !== a._kindScore) return b._kindScore - a._kindScore
    const da = parseStepDateMs(a.date)
    const db = parseStepDateMs(b.date)
    if (da !== db) return da - db
    return a.idx - b.idx
  })

  console.log(
    '[structure] rank: order (tier asc, kindScore desc, date asc, idx)',
    resolved.map((r) => ({
      source: r.source,
      type: r._normalizedType,
      tier: r._tier,
      action: r.action.slice(0, 120),
      dateResolved: r.date,
    })),
  )

  let primary = resolved[0]
  const anyHighTier = resolved.some((r) => isHighValuePrimaryCandidate(r._normalizedType))
  if (anyHighTier && isSendOrEmailTier(primary._normalizedType)) {
    const alt = resolved.find((r) => isHighValuePrimaryCandidate(r._normalizedType))
    if (alt) {
      console.log('[structure] rank: send/email blocked as primary — tier-0 action exists', {
        skipped: primary.action.slice(0, 100),
        chosenPrimary: alt.action.slice(0, 100),
      })
      primary = alt
    }
  }

  const rest = resolved
    .filter((r) => r.idx !== primary.idx)
    .sort((a, b) => a.idx - b.idx)

  if (resolved.length >= 2 && rest.length !== resolved.length - 1) {
    console.warn('[structure] rank: expected N-1 supporting rows', {
      resolvedCount: resolved.length,
      restCount: rest.length,
      primaryIdx: primary.idx,
    })
  }

  /**
   * Primary calendar event date/time must come only from the structured primary slot — never from a
   * supporting row. If ranking picks a supporting action as `nextStep`, `nextStepDate` / `nextStepTimeHint`
   * still use the `source === 'primary'` row (resolved primary.date / primary.time), not the winner's.
   */
  const primarySlot = resolved.find((r) => r.source === 'primary')

  let nextStepDate: string
  let nextStepTimeHint: string

  if (primary.source === 'primary') {
    const tRaw = primary.time.trim()
    nextStepDate = primary.date
    nextStepTimeHint = tRaw ? normalizeTimeToHint(tRaw, '') : ''
  } else if (primarySlot) {
    const tRaw = primarySlot._timeRaw.trim()
    nextStepDate = primarySlot.date
    nextStepTimeHint = tRaw ? normalizeTimeToHint(tRaw, '') || tRaw : ''
  } else {
    const tRaw = (result.nextStepTimeHint || '').trim()
    nextStepDate = (result.nextStepDate || '').trim()
    nextStepTimeHint = tRaw ? normalizeTimeToHint(tRaw, '') || tRaw : ''
  }

  const rankedSupporting: AdditionalStep[] = rest.map((r) => ({
    action: r.action,
    contact: '',
    company: '',
    resolvedDate: r.date,
    timeHint: r.time ? normalizeTimeToHint(r.time, '') || r.time : '',
    supportingType: r.supportingType,
    label: r.label,
    structuredDate: r.structuredDate,
    structuredTime: r.structuredTime,
  }))
  return {
    ...result,
    nextStep: primary.action,
    nextStepTitle: primary.title || result.nextStepTitle,
    nextStepDate,
    nextStepTimeHint,
    additionalSteps: enrichAdditionalStepsList(
      {
        contact: result.contact,
        contactCompany: result.contactCompany,
        customer: result.customer,
        additionalSteps: rankedSupporting,
      },
      timeZone,
      userNow,
    ),
  }
}

const DOCUMENT_KEYWORDS_FOR_PRODUCT = [
  'report',
  'analysis',
  'template',
  'proposal',
  'presentation',
  'brochure',
  'document',
  'study',
  'comparison',
  'plantilla',
  'informe',
  'análisis',
  'estudio',
]

function filterProductDocumentKeywords(product: string): string {
  if (!product?.trim()) return ''
  const products = product.split(',').map((p) => p.trim()).filter(Boolean)
  const filtered = products.filter(
    (p) =>
      !DOCUMENT_KEYWORDS_FOR_PRODUCT.some((keyword) => p.toLowerCase().includes(keyword.toLowerCase())),
  )
  return normalizeProductField(filtered.join(', '))
}

function removeDuplicateWords(str: string): string {
  let s = String(str ?? '').trim()
  let prev = ''
  while (s !== prev) {
    prev = s
    s = s.replace(/\b(\w+)\s+\1\b/gi, '$1').trim()
  }
  return s
}

/** Em dash (U+2014) before company; capitalize first character. */
function formatNextStepTitleEmDash(title: string): string {
  let t = String(title ?? '').trim()
  if (!t) return ''
  t = t.replace(/\(([^)]+)\)/g, ' — $1')
  t = t.replace(/^./, (c) => c.toUpperCase())
  return t
}

function normalizeNoFollowUpStructure(result: StructureBody): StructureBody {
  const line = (result.nextStepTitle || result.nextStep || '').trim()
  if (!isNoClearFollowUpLine(line)) return result
  return {
    ...result,
    nextStep: line,
    nextStepTitle: line,
    nextStepAction: '',
    nextStepTarget: '',
    nextStepDate: '',
    nextStepTimeReference: '',
    nextStepTimeHint: '',
    additionalSteps: [],
    nextStepConfidence: 'low',
  }
}

/** Post-parse fixes before title-case / merge (chronology, product, duplicates, title shape). */
function applyServerCalendarResolution(
  result: StructureBody,
  timeZone: string,
  userNow: Date,
): StructureBody {
  const line = (result.nextStepTitle || result.nextStep || '').trim()
  if (isNoClearFollowUpLine(line)) return result

  const ref = (result.nextStepTimeReference || '').trim()
  let nextDate = (result.nextStepDate || '').trim()

  if (ref) {
    const resolved = resolveRelativeDate(ref, userNow, timeZone)
    if (resolved) nextDate = resolved
  } else if (nextDate && !/^\d{2}\/\d{2}\/\d{4}$/.test(nextDate)) {
    const anchor = toUserAnchorDateTime(userNow, timeZone)
    const resolved = resolveRelativePhraseToMmdd(nextDate, timeZone, anchor)
    if (resolved) nextDate = resolved
  }

  const hint = resolveCalendarTimeHint(
    result.nextStepTimeHint,
    result.nextStep,
    result.nextStepTitle,
    result.nextStepAction,
  )

  return {
    ...result,
    nextStepDate: nextDate,
    nextStepTimeHint: hint,
  }
}

function applyStructureResponsePostProcessing(
  result: StructureBody,
  timeZone: string,
  userNow: Date,
  noteLanguage: string,
): StructureBody {
  let r = normalizeNoFollowUpStructure(result)
  r = applyRankedNextStepSelection(r, timeZone, userNow)
  r = { ...r, product: filterProductDocumentKeywords(r.product) }
  const titleRaw = formatNextStepTitleEmDash(removeDuplicateWords(r.nextStepTitle))
  r = {
    ...r,
    contact: removeDuplicateWords(r.contact),
    nextStepTitle: normalizeNextStepTitleStrict(titleRaw, {
      noteLanguage,
      contact: r.contact,
      contactCompany: r.contactCompany,
      customer: r.customer,
      nextStep: r.nextStep,
    }),
  }
  return r
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
      `ALL string values in the JSON (primary, supporting, insights) MUST be in ${detectedLanguage} — the same language as the input note — with no exceptions.`
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
      result = structuredPayloadToStructureBody(payload, detectedLanguage) as StructureBody
      logStructurePipelineStage('05_mapped_structure_body', result)
    } catch {
      return NextResponse.json(
        { error: 'Model did not return valid JSON', raw: text },
        { status: 500 },
      )
    }

    result = enrichStructureWithExtractedActions(result)
    logStructurePipelineStage('06_after_enrichStructureWithExtractedActions', result)

    result = applyStructureResponsePostProcessing(result, timeZone, userLocalNow, detectedLanguage)
    logStructurePipelineStage('07_after_applyStructureResponsePostProcessing', result)

    result = applyServerCalendarResolution(result, timeZone, userLocalNow)
    logStructurePipelineStage('08_after_applyServerCalendarResolution', result)

    result = {
      ...result,
      additionalSteps: sanitizeAdditionalSteps(result.additionalSteps, {
        noteLanguage: detectedLanguage,
      }),
    }
    logStructurePipelineStage('09_after_sanitizeAdditionalSteps', result)

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
      nextStepTimeReference: (result.nextStepTimeReference || '').trim(),
      nextStepTimeHint: result.nextStepTimeHint.trim(),
      nextStepConfidence: result.nextStepConfidence,
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

    const enriched = {
      ...afterProduct,
      contactCompany: resolvedContactCompany,
      crmFull: stripDealerLinesFromCrmFull(normalizeInsightEmojis(afterProduct.crmFull)).slice(
        0,
        4,
      ),
      crmText: stripDealerClosingFromCrmText(afterProduct.crmText),
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