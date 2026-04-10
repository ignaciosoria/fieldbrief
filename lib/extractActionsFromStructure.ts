import { inferActionKind } from './nextStepActionKind'
import { inferNormalizedActionType } from './normalizedActions'
import { isNoClearFollowUpLine } from './noFollowUp'

export type AdditionalStepInput = { action: string; date: string; time: string }

/**
 * Heuristic extraction of send / call / follow-up / meeting phrases from structured fields
 * when the model omits additionalSteps. Does not use an LLM.
 */
function stripLeadingInsightNoise(line: string): string {
  return line
    .replace(/^[\s\uFE0F\p{Extended_Pictographic}]+/u, '')
    .replace(/^[📦📊⚔️📅✅🔍💡🌱🌾📧📞]\s*/u, '')
    .trim()
}

function normalizeDedupeKey(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
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
 * Split narrative text into segments for action mining. Always splits on sentence boundaries
 * first so short paragraphs with multiple actions (e.g. "Call Friday. Send deck Monday.") are
 * not kept as a single blob when `additionalSteps` was empty.
 */
function segmentLongText(text: string): string[] {
  const t = text.trim()
  if (!t) return []
  let sentences = t.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length >= 8)
  if (sentences.length === 0 && t.length >= 8) sentences = [t]
  const out: string[] = []
  for (const chunk of sentences) {
    if (chunk.length > 220) {
      const sub = chunk
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 10)
      out.push(...(sub.length > 0 ? sub : [chunk]))
    } else {
      out.push(chunk)
    }
  }
  return out
}

/** Bullets / em-dash list items often hide a second action on one line. */
function splitLineByListMarkers(line: string): string[] {
  const t = line.trim()
  if (!t) return []
  const byBullet = t
    .split(/\s*(?:^|\n)\s*[-•–—]\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8)
  if (byBullet.length > 1) return byBullet
  return [t]
}

/**
 * Last-resort when `additionalSteps` was empty: pull sentences that clearly mention
 * send / call / meeting / follow-up verbs (EN/ES cues aligned with inferActionKind).
 */
function extractVerbLedFallbackSegments(text: string): string[] {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length < 8) return []
  const verbHint =
    /\b(?:send|enviar|e-?mail|email|mail|forward|call|llamar|llamada|phone|tel[ée]fono|meeting|reuni[oó]n|reunion|demo|cita|appointment|follow[-\s]?up|seguimiento|check[-\s]?in|touch\s*base|visita\b|site\s+visit|presentaci[oó]n|pitch|webinar|entrevista)\b/i
  const sentences = t
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8)
  const out: string[] = []
  for (const s of sentences) {
    if (!verbHint.test(s)) continue
    if (inferActionKind(s) === 'other') continue
    out.push(s)
  }
  return out
}

function segmentsFromLine(line: string): string[] {
  const cleaned = stripLeadingInsightNoise(line)
  if (!cleaned) return []
  const parts: string[] = []
  for (const chunk of splitLineByListMarkers(cleaned)) {
    parts.push(...segmentLongText(chunk))
  }
  return parts
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
    additionalSteps: AdditionalStepInput[]
  },
>(result: T): T {
  const line = (result.nextStepTitle || result.nextStep || '').trim()
  if (isNoClearFollowUpLine(line)) return result

  const modelAdditionalEmpty = !(result.additionalSteps || []).length

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

  const extracted: AdditionalStepInput[] = []

  const pushCandidate = (raw: string) => {
    const action = raw.replace(/\s+/g, ' ').trim()
    if (action.length < 8 || action.length > 500) return
    if (inferActionKind(action) === 'other') return
    if (isDuplicateOfExisting(action, seen)) return
    seen.push(action)
    extracted.push({
      action,
      date: extractRoughDatePhrase(action),
      time: '',
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

  if (result.summary?.trim()) {
    for (const seg of segmentLongText(result.summary.trim())) {
      pushCandidate(seg)
    }
  }

  for (const line of result.crmFull || []) {
    for (const seg of segmentsFromLine(line)) {
      pushCandidate(seg)
    }
  }

  if (result.crmText?.trim()) {
    for (const seg of segmentLongText(result.crmText.trim())) {
      pushCandidate(seg)
    }
  }

  if (result.calendarDescription?.trim()) {
    for (const block of result.calendarDescription.split(/\n+/)) {
      for (const seg of segmentsFromLine(block)) {
        pushCandidate(seg)
      }
    }
  }

  if (title0 && normalizeDedupeKey(title0) !== normalizeDedupeKey(primary0)) {
    for (const seg of segmentLongText(title0)) {
      pushCandidate(seg)
    }
  }

  if (modelAdditionalEmpty) {
    const combined = [
      primary0,
      result.summary,
      ...(result.crmFull || []),
      result.crmText,
      result.calendarDescription,
      title0,
    ]
      .filter((x) => typeof x === 'string' && x.trim())
      .join('\n')
    for (const seg of extractVerbLedFallbackSegments(combined)) {
      pushCandidate(seg)
    }
  }

  if (extracted.length === 0) {
    if (nextStep === result.nextStep && nextStepTitle === result.nextStepTitle) return result
    return { ...result, nextStep, nextStepTitle }
  }

  console.log('[structure] extractActions: added', extracted.length, 'from summary/crmFull/crmText', {
    sample: extracted.slice(0, 3).map((e) => e.action.slice(0, 80)),
  })

  return {
    ...result,
    nextStep,
    nextStepTitle,
    additionalSteps: [...(result.additionalSteps || []), ...extracted],
  }
}
