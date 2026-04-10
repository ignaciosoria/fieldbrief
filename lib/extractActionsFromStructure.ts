import { inferActionKind } from './nextStepActionKind'
import { extractRoughTimeHint, type AdditionalStep } from './additionalStepEnrichment'
import { inferNormalizedActionType } from './normalizedActions'
import { isNoClearFollowUpLine } from './noFollowUp'

/**
 * Split compound `nextStep` only — does not pull supporting actions from summary/CRM prose.
 */
/** Exported for ranking: supporting rows must not repeat the primary action line. */
export function normalizeActionLineDedupeKey(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeDedupeKey(s: string): string {
  return normalizeActionLineDedupeKey(s)
}

/**
 * Send/email lines must not be dropped just because a longer tier-0 `nextStep` contains them as a
 * substring — that was hiding secondary sends when primary became call/follow-up after ranking.
 */
function isDuplicateOfExisting(candidate: string, existing: string[]): boolean {
  const c = normalizeDedupeKey(candidate)
  if (c.length < 8) return true
  const nt = inferNormalizedActionType(candidate)
  const skipSubstringDedupe = nt === 'send' || nt === 'email'
  for (const e of existing) {
    const ec = normalizeDedupeKey(e)
    if (!ec || ec.length < 4) continue
    if (c === ec) return true
    if (skipSubstringDedupe) continue
    const shorter = c.length <= ec.length ? c : ec
    const longer = c.length > ec.length ? c : ec
    if (longer.includes(shorter) && shorter.length / longer.length >= 0.5) return true
  }
  return false
}

/** First calendar-like substring to help ranking / resolution (optional). */
function extractRoughDatePhrase(text: string): string {
  const patterns: RegExp[] = [
    /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/,
    /\bnext\s+week\b/i,
    /\bpr[oó]xima\s+semana\b/i,
    /\b(?:tomorrow|today|mañana|hoy)\b/i,
    /\b(?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
    /\b(?:lunes|martes|mi[eé]rcoles|miercoles|jueves|viernes|s[aá]bado|domingo)\b/i,
  ]
  for (const re of patterns) {
    const m = text.match(re)
    if (m) return m[0].trim()
  }
  return ''
}

/** Split on sentence boundaries for multi-action nextStep lines (short text). */
function splitIntoSentences(text: string): string[] {
  const t = text.trim()
  if (!t) return []
  const parts = t.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean)
  return parts.length > 0 ? parts : [t]
}

/**
 * Split a single nextStep that lists multiple actions (common model failure mode).
 */
export function splitCompoundNextStep(nextStep: string): string[] {
  const t = nextStep.trim()
  if (!t) return []
  const bySemi = t.split(/\s*;\s*/).map((s) => s.trim()).filter(Boolean)
  if (bySemi.length > 1) return bySemi
  const byNl = t.split(/\n+/).map((s) => s.trim()).filter(Boolean)
  if (byNl.length > 1) return byNl
  const andParts = t.split(/\s+and\s+/i)
  if (andParts.length === 2) {
    const a = andParts[0].trim()
    const b = andParts[1].trim()
    if (a.length >= 8 && b.length >= 8) return [a, b]
  }
  return [t]
}

export function enrichStructureWithExtractedActions<
  T extends {
    nextStep: string
    nextStepTitle: string
    summary: string
    crmText: string
    crmFull: string[]
    calendarDescription: string
    additionalSteps: AdditionalStep[]
  },
>(result: T): T {
  const line = (result.nextStepTitle || result.nextStep || '').trim()
  if (isNoClearFollowUpLine(line)) return result

  const seen: string[] = []
  const primary0 = (result.nextStep || '').trim()
  const title0 = (result.nextStepTitle || '').trim()
  if (primary0) seen.push(primary0)
  if (title0 && normalizeDedupeKey(title0) !== normalizeDedupeKey(primary0)) {
    seen.push(title0)
  }
  for (const s of result.additionalSteps || []) {
    const a = (s.action || '').trim()
    if (a) seen.push(a)
  }

  const extracted: AdditionalStep[] = []

  const pushCandidate = (raw: string) => {
    const action = raw.replace(/\s+/g, ' ').trim()
    if (action.length < 8 || action.length > 500) return
    if (inferActionKind(action) === 'other') return
    if (isDuplicateOfExisting(action, seen)) return
    seen.push(action)
    extracted.push({
      action,
      contact: '',
      company: '',
      resolvedDate: extractRoughDatePhrase(action),
      timeHint: extractRoughTimeHint(action),
    })
  }

  let nextStep = result.nextStep
  let nextStepTitle = result.nextStepTitle
  const fragments = splitCompoundNextStep(primary0)
  if (fragments.length > 1) {
    nextStep = fragments[0]
    nextStepTitle = fragments[0]
    for (let i = 1; i < fragments.length; i++) {
      pushCandidate(fragments[i])
    }
  } else if (primary0) {
    const sentences = splitIntoSentences(primary0)
    if (sentences.length > 1) {
      for (let i = 1; i < sentences.length; i++) {
        pushCandidate(sentences[i])
      }
    }
  }

  /** Do not mine summary / crmFull / crmText / calendar for supporting actions — only structured splits above. */

  if (extracted.length === 0) {
    if (nextStep === result.nextStep && nextStepTitle === result.nextStepTitle) return result
    return { ...result, nextStep, nextStepTitle }
  }

  console.log('[structure] extractActions: added', extracted.length, 'from compound nextStep split', {
    sample: extracted.slice(0, 3).map((e) => e.action.slice(0, 80)),
  })

  return {
    ...result,
    nextStep,
    nextStepTitle,
    additionalSteps: [...(result.additionalSteps || []), ...extracted],
  }
}
