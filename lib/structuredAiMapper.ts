import type { AdditionalStep } from './additionalStepEnrichment'
import { filterInsightsToContextOnly } from './filterInsightLines'
import { inferActionKind } from './nextStepActionKind'

/** Model response shape — no prose fields outside this tree. */
export type StructuredPrimaryType = 'call' | 'send' | 'meeting' | 'follow_up'
export type StructuredSupportingType = 'send' | 'email' | 'other'

export type StructuredPrimary = {
  type: StructuredPrimaryType
  contact: string
  company: string
  /** MM/DD/YYYY or "" */
  date: string
  /** HH:mm or "" */
  time: string
}

export type StructuredSupporting = {
  type: StructuredSupportingType
  /** Max 4–5 words; action label only */
  label: string
  date: string
  time: string
}

export type StructuredAiPayload = {
  primary: StructuredPrimary
  supporting: StructuredSupporting[]
  /** Short insight bullets — no action verbs, not full sentences */
  insights: string[]
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
    if (!label) continue
    supporting.push({
      type: st,
      label,
      date: str(s.date),
      time: str(s.time),
    })
  }

  const insightsIn = Array.isArray(o.insights) ? o.insights : []
  const insights = insightsIn
    .filter((x): x is string => typeof x === 'string')
    .map((x) => truncateWords(x.replace(/\s+/g, ' ').trim(), 14))
    .filter(Boolean)
    .slice(0, 4)

  return {
    primary: {
      type: pType,
      contact: str(pr.contact),
      company: str(pr.company),
      date: str(pr.date),
      time: str(pr.time),
    },
    supporting: supporting.slice(0, 2),
    insights,
  }
}

/**
 * When the transcript orders send/email before call, the model sometimes marks primary as call/follow_up.
 * Correct primary.type so buildNextStepLine does not emit "Call" for a same-day send.
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
    /\b(send|enviar|email|e-mail|share|deliver|forward|program|proposal|contract)\b/i,
  )
  const idxCall = n.search(/\b(call|I['']?ll\s+call|llamar|llamada|phone|tel[ée]fono|ring)\b/i)

  if (idxSend !== -1 && idxCall !== -1 && idxSend < idxCall) {
    if (primary.type === 'call' || primary.type === 'follow_up') {
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
        return 'Llamar'
      default:
        return 'Llamar'
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
      return 'Call'
    default:
      return 'Call'
  }
}

function buildNextStepLine(
  type: StructuredPrimaryType,
  contact: string,
  company: string,
  langEs: boolean,
): string {
  const v = verbForPrimary(type, langEs)
  const c = contact.trim()
  const co = company.trim()
  const em = '\u2014'
  if (c && co) return `${v} ${c} ${em} ${co}`
  if (co) return `${v} ${em} ${co}`
  if (c) return `${v} ${c}`
  return v
}

function supportingToAction(s: StructuredSupporting, langEs: boolean): string {
  const label = truncateWords(s.label, 5)
  const kind = inferActionKind(`${s.type} ${label}`)

  if (langEs) {
    if (s.type === 'email') return `Email ${label}`
    if (s.type === 'send') return `Enviar ${label}`
    if (kind === 'call' || kind === 'follow_up') return `Llamar ${label}`
    if (kind === 'meeting') return `Reunirse ${label}`
    if (kind === 'send') return `Enviar ${label}`
    return `Enviar ${label}`
  }
  if (s.type === 'email') return `Email ${label}`
  if (s.type === 'send') return `Send ${label}`
  if (kind === 'call' || kind === 'follow_up') return `Call ${label}`
  if (kind === 'meeting') return `Meet ${label}`
  if (kind === 'send') return `Send ${label}`
  return `Send ${label}`
}

/** Calendar title line from structured supporting type + label only (no primary contact/company). */
export function supportingStructuredActionLine(
  type: StructuredSupportingType,
  label: string,
  langEs: boolean,
): string {
  return supportingToAction({ type, label: truncateWords(label, 5), date: '', time: '' }, langEs)
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
  const { primary, supporting, insights } = aligned

  const company = primary.company.trim()
  const contact = primary.contact.trim()
  const nextStep = buildNextStepLine(primary.type, contact, company, langEs)
  const nextStepTitle = nextStep
  const verb = verbForPrimary(primary.type, langEs)
  const nextStepAction = verb
  const nextStepTarget = contact
  const nextStepDate = normalizeDateMmdd(primary.date)
  const nextStepTimeHint = normalizeTimeHint(primary.time)

  const ambiguityFlags: string[] = []
  if (!contact) ambiguityFlags.push('unclear_contact')
  if (!nextStepDate) ambiguityFlags.push('unclear_date')

  const additionalSteps: AdditionalStep[] = supporting.map((s) => {
    const sd = normalizeDateMmdd(s.date)
    const st = normalizeTimeHint(s.time)
    return {
      action: supportingToAction(s, langEs),
      contact: contact || '',
      company: company || '',
      resolvedDate: sd,
      timeHint: st,
      supportingType: s.type,
      label: truncateWords(s.label, 5),
      structuredDate: sd,
      structuredTime: st,
    }
  })

  const crmFull = filterInsightsToContextOnly(
    insights.map((line) => line.replace(/^[.!?]+\s*$/, '').trim()).filter(Boolean),
  ).slice(0, 4)

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
    nextStepTimeReference: '',
    nextStepTimeHint,
    nextStepConfidence: 'high',
    ambiguityFlags,
    mentionedEntities: [],
    notes: '',
    crop: '',
    product: '',
    location: '',
    acreage: '',
    crmText: '',
    crmFull,
    calendarDescription: '',
    additionalSteps,
  }
}
