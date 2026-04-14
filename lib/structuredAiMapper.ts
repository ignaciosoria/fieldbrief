import type { AdditionalStep } from './additionalStepEnrichment'
import {
  buildPrimaryBaseTitle,
  buildSupportingBaseTitle,
  normalizePrimarySendObjectField,
  verbForSupportingStructuredType,
  type ActionStructuredFields,
} from './actionTitleContract'
import { hasExplicitMeetScheduleIntent, isNarrativeMeetingDiscussionContext } from './actionIntentGuard'
import { filterInsightsToContextOnly, normalizePendingInsightTense } from './filterInsightLines'
import {
  normalizeFollowUpStrength,
  normalizeSoftFollowUpTiming,
} from './calendarSoftTiming'

/** Model response shape — no prose fields outside this tree. */
export type StructuredPrimaryType = 'call' | 'send' | 'meeting' | 'follow_up'
export type StructuredSupportingType = 'send' | 'email' | 'call' | 'other'

export type StructuredPrimary = {
  type: StructuredPrimaryType
  /** Person (rep’s counterparty); never used as the send “object” in titles. */
  contact: string
  /** What to send/share for type send (e.g. “updated program”); "" for call/meeting. */
  object: string
  company: string
  /** MM/DD/YYYY or "" */
  date: string
  /** HH:mm or "" */
  time: string
  /**
   * When type is follow_up and date is empty: relative intent (no fixed calendar date until user adds to calendar).
   */
  softTiming: string
  /** soft | medium | hard when type is follow_up */
  followUpStrength: string
}

export type StructuredSupporting = {
  type: StructuredSupportingType
  /** Short object (send/email) or contact name (call) when object/contact omitted. */
  label: string
  /** Explicit object for send/email (preferred over label). */
  object: string
  /** Explicit contact for type other / calls (preferred over label). */
  contact: string
  date: string
  time: string
}

export type StructuredAiPayload = {
  primary: StructuredPrimary
  supporting: StructuredSupporting[]
  /** Multi-line CRM narrative (maps to StructureBody.crmText). */
  crmSummary: string
  /** Short insight bullets — no action verbs, not full sentences */
  insights: string[]
}

const CRM_SUMMARY_MAX_LINES = 8
const CRM_SUMMARY_MAX_CHARS = 4500

/**
 * Normalize model output: cap lines, preserve paragraph breaks where possible.
 */
function normalizeCrmSummaryLines(raw: string): string {
  const t = typeof raw === 'string' ? raw.replace(/\r\n/g, '\n').trim() : ''
  if (!t) return ''

  let lines = t
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  if (lines.length === 1 && lines[0].length > 280) {
    const one = lines[0]
    const sentences = one
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (sentences.length > 1) {
      lines = sentences
    }
  }

  const capped = lines.slice(0, CRM_SUMMARY_MAX_LINES).join('\n\n')
  if (capped.length <= CRM_SUMMARY_MAX_CHARS) return capped
  return capped.slice(0, CRM_SUMMARY_MAX_CHARS).trim()
}

function normPrimaryType(raw: string): StructuredPrimaryType | null {
  const t = raw.trim().toLowerCase().replace(/\s+/g, '_')
  if (t === 'call') return 'call'
  if (t === 'send' || t === 'share' || t === 'deliver') return 'send'
  if (t === 'meeting' || t === 'meet') return 'meeting'
  if (t === 'follow_up' || t === 'followup' || t === 'follow-up') return 'follow_up'
  return null
}

function normSupportingType(raw: string): StructuredSupportingType | null {
  const t = raw.trim().toLowerCase()
  if (t === 'send') return 'send'
  if (t === 'email' || t === 'e-mail') return 'email'
  if (t === 'call' || t === 'phone' || t === 'follow_up' || t === 'follow-up') return 'call'
  if (t === 'other') return 'other'
  return null
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function truncateWords(s: string, maxWords: number): string {
  const w = s.trim().split(/\s+/).filter(Boolean)
  if (w.length <= maxWords) return w.join(' ')
  return w.slice(0, maxWords).join(' ')
}

/** Validate and parse top-level JSON from the model. */
export function parseStructuredAiPayload(raw: unknown): StructuredAiPayload | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const p = o.primary
  if (!p || typeof p !== 'object') return null
  const pr = p as Record<string, unknown>
  const pType = normPrimaryType(str(pr.type))
  if (!pType) return null

  const supportingIn = Array.isArray(o.supporting) ? o.supporting : []
  const supporting: StructuredSupporting[] = []
  for (const item of supportingIn.slice(0, 4)) {
    if (!item || typeof item !== 'object') continue
    const s = item as Record<string, unknown>
    const st = normSupportingType(str(s.type))
    if (!st) continue
    const label = truncateWords(str(s.label), 5)
    const object = truncateWords(str(s.object), 5)
    const contact = str(s.contact).trim()
    if (!label && !object && !contact) continue
    supporting.push({
      type: st,
      label,
      object,
      contact,
      date: str(s.date),
      time: str(s.time),
    })
  }

  const crmRaw = str(o.crm_summary || o.crmSummary)
  const crmSummary = normalizeCrmSummaryLines(crmRaw)

  const insightsIn = Array.isArray(o.insights) ? o.insights : []
  const insights = insightsIn
    .filter((x): x is string => typeof x === 'string')
    .map((x) => truncateWords(x.replace(/\s+/g, ' ').trim(), 18))
    .filter(Boolean)
    .slice(0, 5)

  const softTiming = normalizeSoftFollowUpTiming(pr.soft_timing ?? pr.softTiming)
  const followUpStrength = normalizeFollowUpStrength(
    pr.follow_up_strength ?? pr.followUpStrength,
  )

  return {
    primary: {
      type: pType,
      contact: str(pr.contact),
      object: truncateWords(str(pr.object), 8),
      company: str(pr.company),
      date: str(pr.date),
      time: str(pr.time),
      softTiming,
      followUpStrength,
    },
    supporting: supporting.slice(0, 2),
    crmSummary,
    insights,
  }
}

/** True when the note explicitly mentions sending/sharing (never use primary follow_up alone for these). */
export function noteHasExplicitSendIntent(note: string): boolean {
  const n = note.trim()
  if (!n) return false
  if (
    /\b(send|enviar|env[íi]a|mandar|manda|compartir|forward|deliver|email|e-mail)\b/i.test(n)
  ) {
    return true
  }
  if (/\bshare\s+/i.test(n)) return true
  if (/\bshare\b/i.test(n) && !/\bmarket\s+share\b/i.test(n)) return true
  return false
}

/**
 * When the transcript orders send/email before call, the model sometimes marks primary as call/follow_up.
 * Correct primary.type so the title builder does not emit "Call" for a same-day send.
 */
export function alignStructuredPayloadWithNote(
  note: string,
  payload: StructuredAiPayload,
): StructuredAiPayload {
  const n = note.trim()
  if (!n) return payload

  const primary = { ...payload.primary }
  const supporting = payload.supporting.map((s) => ({ ...s }))

  const idxSend = n.search(
    /\b(send|enviar|env[íi]a|mandar|manda|compartir|email|e-mail|share\s+|deliver|forward|program|proposal|contract)\b/i,
  )
  const idxCall = n.search(/\b(call|I['']?ll\s+call|llamar|llamada|phone|tel[ée]fono|ring)\b/i)

  if (idxSend !== -1 && idxCall !== -1 && idxSend < idxCall) {
    if (primary.type === 'call' || primary.type === 'follow_up') {
      primary.type = 'send'
    }
    /** Second action is a call — prefer explicit supporting type `call` over `other`. */
    const first = supporting[0]
    if (first && first.type === 'other') {
      supporting[0] = { ...first, type: 'call' }
    }
  }

  if (
    primary.type === 'meeting' &&
    (isNarrativeMeetingDiscussionContext(n) || !hasExplicitMeetScheduleIntent(n))
  ) {
    primary.type = 'follow_up'
  }

  if (noteHasExplicitSendIntent(n)) {
    if (primary.type === 'follow_up' || primary.type === 'meeting') {
      primary.type = 'send'
    }
  }

  return { ...payload, primary, supporting }
}

function normalizeDateMmdd(d: string): string {
  const t = d.trim()
  if (!t) return ''
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) {
    const [y, m, day] = t.slice(0, 10).split('-')
    return `${m}/${day}/${y}`
  }
  return t
}

function normalizeTimeHint(raw: string): string {
  const t = raw.trim()
  if (!t) return ''
  if (/^\d{1,2}:\d{2}$/.test(t)) return t
  return t
}

function isSpanish(language: string): boolean {
  return language.trim().toLowerCase() === 'spanish'
}

function verbForPrimary(type: StructuredPrimaryType, langEs: boolean): string {
  if (langEs) {
    switch (type) {
      case 'call':
        return 'Llamar'
      case 'send':
        return 'Enviar'
      case 'meeting':
        return 'Reunirse'
      case 'follow_up':
        return 'Seguimiento con'
      default:
        return 'Seguimiento con'
    }
  }
  switch (type) {
    case 'call':
      return 'Call'
    case 'send':
      return 'Send'
    case 'meeting':
      return 'Meet'
    case 'follow_up':
      return 'Follow up with'
    default:
      return 'Follow up with'
  }
}

/** Calendar title line from structured supporting fields only (no suffix; app may add contact/company). */
export function supportingStructuredActionLine(
  type: StructuredSupportingType,
  _label: string,
  langEs: boolean,
  contact?: string,
  object?: string,
): string {
  const verb = verbForSupportingStructuredType(type, langEs)
  const noteLanguage = langEs ? 'spanish' : 'english'
  const obj = (object || '').trim()
  const con = (contact || '').trim()
  const fields: ActionStructuredFields = {
    type,
    verb,
    object: obj,
    contact: con,
    company: '',
    date: '',
    time: '',
  }
  return buildSupportingBaseTitle(fields, noteLanguage)
}

export type StructureBodyLike = {
  customer: string
  contact: string
  contactCompany: string
  summary: string
  nextStep: string
  nextStepTitle: string
  nextStepAction: string
  nextStepTarget: string
  nextStepDate: string
  /** Soft follow-up window when primary is follow_up with no fixed MM/DD/YYYY. */
  nextStepSoftTiming: string
  /** soft | medium | hard when primary follow_up */
  followUpStrength: string
  nextStepTimeReference: string
  nextStepTimeHint: string
  nextStepConfidence: 'high' | 'medium' | 'low'
  ambiguityFlags: string[]
  mentionedEntities: { name: string; type: string }[]
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

/**
 * Maps the new structured AI JSON into the legacy `StructureBody` consumed by the pipeline.
 */
export function structuredPayloadToStructureBody(
  payload: StructuredAiPayload,
  noteLanguage: string,
  rawNote?: string,
): StructureBodyLike {
  const aligned = rawNote?.trim()
    ? alignStructuredPayloadWithNote(rawNote, payload)
    : payload
  const langEs = isSpanish(noteLanguage)
  const { primary, supporting, insights, crmSummary } = aligned

  const company = primary.company.trim()
  const contact = primary.contact.trim()
  const objectRaw = primary.object.trim()
  const verb = verbForPrimary(primary.type, langEs)
  const nextStepDate = normalizeDateMmdd(primary.date)
  const nextStepTimeHint = normalizeTimeHint(primary.time)
  const softTimingRaw = normalizeSoftFollowUpTiming(primary.softTiming)
  const followUpStrengthRaw = normalizeFollowUpStrength(primary.followUpStrength)

  const object =
    primary.type === 'send'
      ? normalizePrimarySendObjectField(objectRaw, contact, verb, noteLanguage)
      : objectRaw

  const primaryStructured: ActionStructuredFields = {
    type: primary.type,
    verb,
    object,
    contact,
    company,
    date: nextStepDate,
    time: nextStepTimeHint,
    ...(primary.type === 'follow_up' && followUpStrengthRaw
      ? { followUpStrength: followUpStrengthRaw }
      : {}),
  }
  const nextStep = buildPrimaryBaseTitle(primaryStructured, noteLanguage)
  const nextStepTitle = nextStep
  const nextStepAction = verb
  const nextStepTarget = contact
  const ambiguityFlags: string[] = []
  if (primary.type === 'send' && !object) ambiguityFlags.push('unclear_object')
  if (
    (primary.type === 'call' ||
      primary.type === 'follow_up' ||
      primary.type === 'meeting') &&
    !contact
  ) {
    ambiguityFlags.push('unclear_contact')
  }
  if (!nextStepDate && primary.type !== 'follow_up') {
    ambiguityFlags.push('unclear_date')
  }

  const additionalSteps: AdditionalStep[] = supporting.map((s) => {
    const sd = normalizeDateMmdd(s.date)
    const st = normalizeTimeHint(s.time)
    const lab = truncateWords(s.label, 5)
    const sv = verbForSupportingStructuredType(s.type, langEs)
    const rawObj = s.type === 'call' ? '' : truncateWords(s.object, 5)
    const objectPart =
      s.type === 'send' || s.type === 'email'
        ? normalizePrimarySendObjectField(rawObj, s.contact.trim(), sv, noteLanguage)
        : rawObj
    const contactPart = s.type === 'call' || s.type === 'other' ? s.contact.trim() : ''
    const actionStructured: ActionStructuredFields = {
      type: s.type,
      verb: sv,
      object: objectPart,
      contact: contactPart,
      company,
      date: sd,
      time: st,
    }
    return {
      action: buildSupportingBaseTitle(actionStructured, noteLanguage),
      contact: contact || '',
      company: company || '',
      resolvedDate: sd,
      timeHint: st,
      supportingType: s.type,
      label: lab || objectPart || contactPart,
      structuredDate: sd,
      structuredTime: st,
      actionStructured,
    }
  })

  const crmFull = filterInsightsToContextOnly(
    insights
      .map((line) => line.replace(/^[.!?]+\s*$/, '').trim())
      .filter(Boolean)
      .map((line) => normalizePendingInsightTense(line, langEs))
      .map((line) =>
        langEs ? line.replace(/\bde el\b/gi, 'del').replace(/\s+/g, ' ').trim() : line,
      ),
  ).slice(0, 5)

  /** More ambiguity flags → lower confidence; prompts only when low + critical gaps (see app/page.tsx). */
  const nextStepConfidence: 'high' | 'medium' | 'low' =
    ambiguityFlags.length >= 2 ? 'low' : ambiguityFlags.length === 1 ? 'medium' : 'high'

  return {
    customer: company,
    contact,
    contactCompany: company,
    summary: '',
    nextStep,
    nextStepTitle,
    nextStepAction,
    nextStepTarget,
    nextStepDate,
    nextStepSoftTiming:
      primary.type === 'follow_up' && !nextStepDate.trim() ? softTimingRaw : '',
    followUpStrength: primary.type === 'follow_up' ? followUpStrengthRaw : '',
    nextStepTimeReference: '',
    nextStepTimeHint,
    nextStepConfidence,
    ambiguityFlags,
    mentionedEntities: [],
    notes: '',
    crop: '',
    product: '',
    location: '',
    acreage: '',
    crmText: crmSummary,
    crmFull,
    calendarDescription: '',
    additionalSteps,
    primaryActionStructured: primaryStructured,
  }
}
