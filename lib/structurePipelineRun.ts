/**
 * Server-side structure pipeline after the model JSON is parsed and mapped to `StructureBody`.
 * Shared by `app/api/structure/route.ts` and `structuredAiTestHarness`.
 */

import { DateTime } from 'luxon'
import {
  resolveRelativeDate,
  resolveRelativePhraseToMmdd,
  resolveCalendarTimeHint,
  toUserAnchorDateTime,
} from './calendarResolveDate'
import {
  isSendOrEmailTier,
  kindScoreForPrimarySelection,
  linguisticUrgencyModifierForPrimaryRow,
  normalizedTypeForRow,
  primaryBusinessTier,
} from './actionPrimarySelection'
import {
  enrichStructureWithExtractedActions,
  normalizeActionLineDedupeKey,
} from './extractActionsFromStructure'
import {
  enrichAdditionalStepsList,
  extractRoughTimeHint,
  type AdditionalStep,
  type SupportingStructuredType,
} from './additionalStepEnrichment'
import {
  buildPrimaryBaseTitle,
  buildSupportingBaseTitle,
  type ActionStructuredFields,
} from './actionTitleContract'
import { type NormalizedActionType } from './normalizedActions'
import { normalizeNextStepTitleStrict } from './normalizeNextStepTitle'
import { mergePromotedInsightsIntoCrmFull, sanitizeAdditionalSteps } from './sanitizeAdditionalSteps'
import { isNoClearFollowUpLine } from './noFollowUp'
import { normalizeProductField } from './productField'
import {
  parseStructuredAiPayload,
  structuredPayloadToStructureBody,
} from './structuredAiMapper'

export type MentionedEntity = { name: string; type: string }

export type StructureBody = {
  customer: string
  contact: string
  contactCompany: string
  summary: string
  nextStep: string
  nextStepTitle: string
  nextStepAction: string
  nextStepTarget: string
  nextStepDate: string
  nextStepSoftTiming: string
  followUpStrength: string
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
  calendarDescription: string
  additionalSteps: AdditionalStep[]
  primaryActionStructured?: ActionStructuredFields
}

const STRUCTURE_PIPELINE_DEBUG =
  process.env.STRUCTURE_PIPELINE_DEBUG === '1' ||
  process.env.STRUCTURE_PIPELINE_DEBUG === 'true'

const STRUCTURE_PRIMARY_CAL_DEBUG =
  process.env.STRUCTURE_PRIMARY_CAL_DEBUG === '1' ||
  process.env.STRUCTURE_PRIMARY_CAL_DEBUG === 'true'

function logPrimaryCalendarDebug(label: string, data: Record<string, unknown>): void {
  if (!STRUCTURE_PRIMARY_CAL_DEBUG && !STRUCTURE_PIPELINE_DEBUG) return
  console.log(`[structure] primary_calendar ${label}`, data)
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

function rowEventInstantMsForPrimarySort(row: ScoredRow, zone: string): number {
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
  const merged = [dateTrim, timeTrim, prose].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()

  for (const candidate of [merged, dateTrim, `${dateTrim} ${timeTrim}`.trim(), prose, timeTrim]) {
    const c = candidate.replace(/\s+/g, ' ').trim()
    if (!c) continue
    const m = tryP(c)
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
    nextStepSoftTiming: '',
    followUpStrength: '',
    nextStepTimeReference: '',
    nextStepTimeHint: '',
    additionalSteps: [],
    nextStepConfidence: 'low',
    primaryActionStructured: undefined,
  }
}

function applyServerCalendarResolution(
  result: StructureBody,
  timeZone: string,
  userNow: Date,
): StructureBody {
  const line = (result.nextStepTitle || result.nextStep || '').trim()
  if (isNoClearFollowUpLine(line)) return result

  const ref = (result.nextStepTimeReference || '').trim()
  let nextDate = (result.nextStepDate || '').trim()
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

  const canonical = /^\d{2}\/\d{2}\/\d{4}$/.test((nextDate || '').trim())
  return {
    ...result,
    nextStepDate: nextDate,
    nextStepTimeHint: hint,
    nextStepSoftTiming: canonical ? '' : (result.nextStepSoftTiming || '').trim(),
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

/**
 * Enrich, rank, resolve calendar hints, and sanitize additional steps — same as `/api/structure` after map.
 */
export function runStructurePipelineOnMappedBody(
  result: StructureBody,
  rawNote: string,
  detectedLanguage: string,
  timeZone: string,
  userNow: Date,
): StructureBody {
  let r = enrichStructureWithExtractedActions(result)
  r = applyStructureResponsePostProcessing(r, timeZone, userNow, detectedLanguage, rawNote)
  r = applyServerCalendarResolution(r, timeZone, userNow)
  const sanitizeResult = sanitizeAdditionalSteps(r.additionalSteps, { noteLanguage: detectedLanguage })
  return {
    ...r,
    additionalSteps: sanitizeResult.steps,
    crmFull: mergePromotedInsightsIntoCrmFull(r.crmFull, sanitizeResult.promotedInsights),
  }
}

/**
 * Parse structured JSON → map → full pipeline (for fixtures / harness).
 */
export function runStructurePipelineFromParsedJson(
  parsedJson: Record<string, unknown>,
  note: string,
  detectedLanguage: string,
  timeZone: string,
  userNow: Date,
): StructureBody {
  const payload = parseStructuredAiPayload(parsedJson)
  if (!payload) {
    throw new Error('parseStructuredAiPayload returned null — invalid structured JSON')
  }
  const mapped = structuredPayloadToStructureBody(payload, detectedLanguage, note) as StructureBody
  return runStructurePipelineOnMappedBody(mapped, note, detectedLanguage, timeZone, userNow)
}
