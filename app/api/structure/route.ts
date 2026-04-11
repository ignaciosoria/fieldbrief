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
  isSendOrEmailTier,
  kindScoreForPrimarySelection,
  linguisticUrgencyModifierForPrimaryRow,
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
import {
  enrichStructureWithExtractedActions,
  normalizeActionLineDedupeKey,
} from '../../../lib/extractActionsFromStructure'
import {
  enrichAdditionalStepsList,
  extractRoughTimeHint,
  type AdditionalStep,
  type SupportingStructuredType,
} from '../../../lib/additionalStepEnrichment'
import {
  buildPrimaryBaseTitle,
  buildSupportingBaseTitle,
  type ActionStructuredFields,
} from '../../../lib/actionTitleContract'
import {
  buildNormalizedActionsFromResult,
  type NormalizedActionType,
} from '../../../lib/normalizedActions'
import { normalizeNextStepTitleStrict } from '../../../lib/normalizeNextStepTitle'
import {
  mergePromotedInsightsIntoCrmFull,
  sanitizeAdditionalSteps,
} from '../../../lib/sanitizeAdditionalSteps'
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
  /** Present when titles came from structured AI fields (verb/object/contact), not free-form prose. */
  primaryActionStructured?: ActionStructuredFields
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

/** Calendar-day offset from anchor (0 = today in `zone`). */
function calendarDayDiffFromAnchor(mmdd: string, anchor: DateTime, zone: string): number | null {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(mmdd)) return null
  const [mm, dd, yyyy] = mmdd.split('/').map((x) => parseInt(x, 10))
  if ([mm, dd, yyyy].some((n) => Number.isNaN(n))) return null
  const d = DateTime.fromObject({ year: yyyy, month: mm, day: dd }, { zone })
  if (!d.isValid) return null
  const a = anchor.setZone(zone).startOf('day')
  return Math.round(d.startOf('day').diff(a, 'days').days)
}

/**
 * Lower = more urgent for primary selection.
 * 0 = send/email today (must win if any exist), 1 = other actions today, 2 = tomorrow,
 * 3 = dated future or past, 4 = no resolved date.
 */
function urgencyBandForPrimary(row: ScoredRow, anchor: DateTime, zone: string): number {
  const mmdd = (row.date || '').trim()
  const diff = calendarDayDiffFromAnchor(mmdd, anchor, zone)
  if (diff === null) return 4
  if (diff === 0) {
    if (isSendOrEmailTier(row._normalizedType)) return 0
    return 1
  }
  if (diff === 1) return 2
  return 3
}

/** Earlier wall-clock instant = more urgent; missing/invalid → last. */
function rowEventInstantMsForPrimarySort(
  row: ScoredRow,
  zone: string,
): number {
  const mmdd = (row.date || '').trim()
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(mmdd)) return Number.POSITIVE_INFINITY
  const hint = resolveCalendarTimeHint(
    (row._timeRaw || row.time || '').trim(),
    row.action,
    row.title,
    row.action,
  )
  const rough = extractRoughTimeHint(`${row.action} ${row.title}`)
  const hintMerged = hint.trim() || rough.trim()
  const hintForClock = hintMerged || (row._timeRaw || row.time || '').trim()
  const [mm, dd, yyyy] = mmdd.split('/').map((x) => parseInt(x, 10))
  let hour = 9
  let minute = 0
  const hm = hintForClock.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (hm) {
    hour = Math.min(23, Math.max(0, parseInt(hm[1], 10)))
    minute = Math.min(59, Math.max(0, parseInt(hm[2], 10)))
  }
  const dt = DateTime.fromObject({ year: yyyy, month: mm, day: dd, hour, minute }, { zone })
  return dt.isValid ? dt.toMillis() : Number.POSITIVE_INFINITY
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
  actionStructured?: ActionStructuredFields
}

type ScoredRow = ChronologicalRow & {
  _dateRaw: string
  _timeRaw: string
  _normalizedType: NormalizedActionType
  _tier: 0 | 1 | 2
  _kindScore: number
}

/**
 * Resolve MM/DD/YYYY for ranking. Previously only `date || time` was passed to
 * `resolveRelativePhraseToMmdd` — a bare time ("17:00") does not parse as a date, so a same-day send
 * with "today" only in the action line stayed in band 4 and lost to a future call (band 3).
 * Tries: date field, date+time, full action+title prose, time-only; then note-assisted today for send/email.
 */
function resolveMmddForPrimaryRanking(
  r: ChronologicalRow,
  anchor: DateTime,
  timeZone: string,
  noteText: string,
  nt: NormalizedActionType,
): string {
  const weekdayOpts = r.source === 'primary' ? { weekdaySkipAnchorDay: true } : undefined
  const tryP = (phrase: string): string | null => {
    const p = phrase.replace(/\s+/g, ' ').trim()
    if (!p) return null
    return resolveRelativePhraseToMmdd(p, timeZone, anchor, weekdayOpts)
  }

  const dateTrim = r.date.trim()
  const timeTrim = r.time.trim()
  const prose = `${r.action} ${r.title}`.replace(/\s+/g, ' ').trim()

  for (const candidate of [dateTrim, `${dateTrim} ${timeTrim}`.trim(), prose, timeTrim]) {
    const m = tryP(candidate)
    if (m) return m
  }

  if (
    isSendOrEmailTier(nt) &&
    noteText.trim() &&
    (/\btoday\b/i.test(noteText) || /\bhoy\b/i.test(noteText))
  ) {
    const lower = prose.toLowerCase()
    if (
      /\b(send|enviar|email|mail|forward)\b/.test(lower) ||
      /\b(before|antes)\s*\d/.test(lower) ||
      /\bprogram|contract|proposal|pdf|deck|quote|updated\b/.test(lower)
    ) {
      return anchor.setZone(timeZone).toFormat('MM/dd/yyyy')
    }
  }

  /** Same-day deadline often lives only in action prose; anchor today when unambiguous. */
  const pl = prose.toLowerCase()
  if (/\btoday\b|\bhoy\b/.test(pl)) {
    if (
      /\b(before|antes)\b/.test(pl) ||
      /\b(send|enviar|email|mail|forward|program|contract|proposal|quote|pdf|deck|updated)\b/.test(pl)
    ) {
      return anchor.setZone(timeZone).toFormat('MM/dd/yyyy')
    }
  }

  return dateTrim
}

/**
 * Phase 2 — deterministic primary/supporting:
 * - Primary is chosen by **urgency**, not call-vs-send tier: send/email **today** outrank calls/meetings
 *   on later days; **linguistic cues** (today / before [time] / urgent vs next week / no rush) break ties
 *   within a band; **earlier wall-clock instant** breaks ties after that.
 * - Bands (ascending = more urgent): (0) send/email today, (1) other actions today, (2) tomorrow,
 *   (3) other resolved calendar dates, (4) undated.
 * - **Every non-primary row is kept** in `additionalSteps` (stable `idx` order among supporting).
 */
function applyRankedNextStepSelection(
  result: StructureBody,
  timeZone: string,
  userNow: Date,
  rawNote: string,
  noteLanguage: string,
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
      actionStructured: result.primaryActionStructured,
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
      date: (s.resolvedDate || s.structuredDate || '').trim(),
      time: (s.timeHint || s.structuredTime || '').trim(),
      supportingType: s.supportingType,
      label: s.label,
      structuredDate: s.structuredDate,
      structuredTime: s.structuredTime,
      actionStructured: s.actionStructured,
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
    const nt = normalizedTypeForRow(r.action, r.title)
    const mmdd = resolveMmddForPrimaryRanking(r, anchor, timeZone, rawNote, nt)
    const dateForSort = (mmdd || r.date.trim()).trim()

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
    '[structure] rank: types + legacy tier/kind (urgency sort below)',
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
    const za = urgencyBandForPrimary(a, anchor, timeZone)
    const zb = urgencyBandForPrimary(b, anchor, timeZone)
    if (za !== zb) return za - zb
    const la = linguisticUrgencyModifierForPrimaryRow(a.action, a.title)
    const lb = linguisticUrgencyModifierForPrimaryRow(b.action, b.title)
    if (la !== lb) return la - lb
    const ia = rowEventInstantMsForPrimarySort(a, timeZone)
    const ib = rowEventInstantMsForPrimarySort(b, timeZone)
    if (ia !== ib) return ia - ib
    return a.idx - b.idx
  })

  console.log(
    '[structure] rank: order (urgency band asc, linguistic asc, instant asc, idx)',
    resolved.map((r) => ({
      source: r.source,
      type: r._normalizedType,
      urgency: urgencyBandForPrimary(r, anchor, timeZone),
      linguistic: linguisticUrgencyModifierForPrimaryRow(r.action, r.title),
      action: r.action.slice(0, 120),
      dateResolved: r.date,
    })),
  )

  const primary = resolved[0]

  const rest = resolved
    .filter((r) => r.idx !== primary.idx)
    .sort((a, b) => a.idx - b.idx)

  /** Drop supporting rows that echo the primary line or duplicate another supporting row (same action+date+time). */
  const primaryActionKey = normalizeActionLineDedupeKey(primary.action)
  const restDeduped: ScoredRow[] = []
  const seenSupportingComposite = new Set<string>()
  for (const r of rest) {
    const ak = normalizeActionLineDedupeKey(r.action)
    if (ak.length >= 4 && ak === primaryActionKey) continue
    const composite = `${ak}|${r.date.trim()}|${r._timeRaw.trim()}`
    if (seenSupportingComposite.has(composite)) continue
    seenSupportingComposite.add(composite)
    restDeduped.push(r)
  }

  if (resolved.length >= 2 && rest.length !== resolved.length - 1) {
    console.warn('[structure] rank: expected N-1 supporting rows', {
      resolvedCount: resolved.length,
      restCount: rest.length,
      primaryIdx: primary.idx,
    })
  }

  /** Winning row drives `nextStep` calendar fields so e.g. a promoted send-today keeps today + deadline time. */
  let nextStepDate = primary.date
  let hintRaw = primary._timeRaw.trim()
  if (!hintRaw) {
    hintRaw = extractRoughTimeHint(`${primary.action} ${primary.title}`)
  }
  if (!hintRaw) {
    hintRaw = (primary.time || '').trim()
  }
  const nextStepTimeHint = hintRaw ? normalizeTimeToHint(hintRaw, '') || hintRaw : ''

  const winnerStructured = primary.actionStructured
    ? {
        ...primary.actionStructured,
        date: nextStepDate,
        time: nextStepTimeHint,
      }
    : undefined
  const primaryLine = winnerStructured
    ? primary.source === 'primary'
      ? buildPrimaryBaseTitle(winnerStructured, noteLanguage)
      : buildSupportingBaseTitle(winnerStructured, noteLanguage)
    : primary.action

  logPrimaryCalendarDebug('ranking:after_selection', {
    candidatesBeforeSort: rows.map((r) => ({
      idx: r.idx,
      source: r.source,
      action: r.action.slice(0, 100),
      dateRaw: r.date,
      timeRaw: r.time,
    })),
    selectedPrimary: {
      source: primary.source,
      action: primaryLine.slice(0, 160),
      nextStepDate,
      nextStepTimeHint,
      timeRawUsed: hintRaw || '(empty)',
    },
    supportingActions: restDeduped.map((r) => ({
      idx: r.idx,
      action: r.action.slice(0, 100),
      resolvedDate: r.date,
      timeHint: r.time,
    })),
  })

  const rankedSupporting: AdditionalStep[] = restDeduped.map((r) => {
    const th = r.time ? normalizeTimeToHint(r.time, '') || r.time : ''
    const rowStructured = r.actionStructured
      ? {
          ...r.actionStructured,
          date: r.date,
          time: th,
        }
      : undefined
    const actionLine = rowStructured
      ? r.source === 'primary'
        ? buildPrimaryBaseTitle(rowStructured, noteLanguage)
        : buildSupportingBaseTitle(rowStructured, noteLanguage)
      : r.action
    return {
      action: actionLine,
      contact: '',
      company: '',
      resolvedDate: r.date,
      timeHint: th,
      supportingType: r.supportingType,
      label: r.label,
      structuredDate: r.structuredDate,
      structuredTime: r.structuredTime,
      ...(rowStructured ? { actionStructured: rowStructured } : {}),
    }
  })
  return {
    ...result,
    nextStep: primaryLine,
    nextStepTitle: primaryLine,
    nextStepDate,
    nextStepTimeHint,
    primaryActionStructured: winnerStructured,
    /** Cleared so `applyServerCalendarResolution` cannot apply a pre-rank time reference to the ranked winner. */
    nextStepTimeReference: '',
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
    primaryActionStructured: undefined,
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
  /** Ranking already resolved the winner to MM/DD/YYYY; must not overwrite with stale model `ref`. */
  const hasCanonicalPrimaryDate = /^\d{2}\/\d{2}\/\d{4}$/.test(nextDate)

  const primaryDateResolve = { weekdaySkipAnchorDay: true } as const

  if (!hasCanonicalPrimaryDate) {
    if (ref) {
      const resolved = resolveRelativeDate(ref, userNow, timeZone, primaryDateResolve)
      if (resolved) nextDate = resolved
    } else if (nextDate && !/^\d{2}\/\d{2}\/\d{4}$/.test(nextDate)) {
      const anchor = toUserAnchorDateTime(userNow, timeZone)
      const resolved = resolveRelativePhraseToMmdd(nextDate, timeZone, anchor, primaryDateResolve)
      if (resolved) nextDate = resolved
    }
  }

  const hint = resolveCalendarTimeHint(
    result.nextStepTimeHint,
    result.nextStep,
    result.nextStepTitle,
    result.nextStepAction,
  )

  logPrimaryCalendarDebug('applyServerCalendarResolution', {
    nextStep: result.nextStep,
    nextStepTimeReference: ref || '(empty)',
    skippedRefOverwrite: hasCanonicalPrimaryDate && !!ref,
    nextStepDateIn: result.nextStepDate,
    nextStepDateOut: nextDate,
    nextStepTimeHintIn: result.nextStepTimeHint,
    nextStepTimeHintOut: hint,
  })

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
  rawNote: string,
): StructureBody {
  let r = normalizeNoFollowUpStructure(result)
  r = applyRankedNextStepSelection(r, timeZone, userNow, rawNote, noteLanguage)
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
      primaryActionStructured: r.primaryActionStructured,
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
      result = structuredPayloadToStructureBody(payload, detectedLanguage, note) as StructureBody
      logStructurePipelineStage('05_mapped_structure_body', result)
    } catch {
      return NextResponse.json(
        { error: 'Model did not return valid JSON', raw: text },
        { status: 500 },
      )
    }

    result = enrichStructureWithExtractedActions(result)
    logStructurePipelineStage('06_after_enrichStructureWithExtractedActions', result)

    result = applyStructureResponsePostProcessing(
      result,
      timeZone,
      userLocalNow,
      detectedLanguage,
      typeof note === 'string' ? note : '',
    )
    logStructurePipelineStage('07_after_applyStructureResponsePostProcessing', result)

    result = applyServerCalendarResolution(result, timeZone, userLocalNow)
    logStructurePipelineStage('08_after_applyServerCalendarResolution', result)

    const sanitizeResult = sanitizeAdditionalSteps(result.additionalSteps, {
      noteLanguage: detectedLanguage,
    })
    result = {
      ...result,
      additionalSteps: sanitizeResult.steps,
      crmFull: mergePromotedInsightsIntoCrmFull(result.crmFull, sanitizeResult.promotedInsights),
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