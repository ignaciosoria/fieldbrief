import type { AdditionalStep } from './additionalStepEnrichment'

const MAX_SUPPORTING_STEPS = 2
const MAX_ACTION_WORDS = 8

function isSpanishLanguage(noteLanguage: string): boolean {
  return noteLanguage.trim().toLowerCase() === 'spanish'
}

/** Narrative / context — never a standalone supporting action line. */
const NARRATIVE_SNIPPETS: RegExp[] = [
  /\bi\s+just\s+/i,
  /\bwe\s+just\s+/i,
  /\bhe\s+is\s+/i,
  /\bshe\s+is\s+/i,
  /\bthey\s+are\s+/i,
  /\bwe\s+agreed\b/i,
  /\bi\s+will\b/i,
  /\bwe\s+will\b/i,
  /\bplan\s+to\b/i,
  /\bagreed\s+to\b/i,
  /\bfinished\s+a\s+call\b/i,
  /\bexpecting\s+the\b/i,
  /\binterested\s+in\b/i,
  /\bhe\s+was\s+/i,
  /\bshe\s+was\s+/i,
  /\bacabamos\s+de\b/i,
  /\bestá\s+esperando\b/i,
  /\bestamos\s+de\s+acuerdo\b/i,
]

function normalizeDedupeKey(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function truncateActionWords(action: string, maxWords: number): string {
  const w = action.trim().split(/\s+/).filter(Boolean)
  if (w.length <= maxWords) return w.join(' ')
  return w.slice(0, maxWords).join(' ')
}

function looksLikeNarrative(action: string): boolean {
  const t = action.trim()
  if (!t) return true
  if (/[.!?]\s/.test(t)) return true
  if (t.length > 120) return true
  return NARRATIVE_SNIPPETS.some((re) => re.test(t))
}

/**
 * Allowed leading verbs only (English or Spanish notes).
 * "Follow up" and "Seguimiento" / "Dar seguimiento" count as action opens.
 */
export function actionStartsWithAllowedVerb(action: string, spanish: boolean): boolean {
  const t = action.trim()
  if (!t) return false
  if (spanish) {
    return (
      /^enviar\b/i.test(t) ||
      /^email\b/i.test(t) ||
      /^llamar\b/i.test(t) ||
      /^seguimiento\b/i.test(t) ||
      /^dar\s+seguimiento\b/i.test(t) ||
      /^reunirse\b/i.test(t) ||
      /^reuni[oó]n\b/i.test(t) ||
      /^meet\b/i.test(t) ||
      /^follow\s+up\b/i.test(t)
    )
  }
  return (
    /^send\b/i.test(t) ||
    /^email\b/i.test(t) ||
    /^call\b/i.test(t) ||
    /^follow\s+up\b/i.test(t) ||
    /^meet\b/i.test(t)
  )
}

export type SanitizeAdditionalStepsOptions = {
  noteLanguage: string
}

/**
 * Keep only short, verb-led real actions; dedupe; max 2 items. Structured fields (dates) preserved.
 */
export function sanitizeAdditionalSteps(
  steps: AdditionalStep[],
  options: SanitizeAdditionalStepsOptions,
): AdditionalStep[] {
  const spanish = isSpanishLanguage(options.noteLanguage)
  const seen = new Set<string>()
  const out: AdditionalStep[] = []

  for (const step of steps || []) {
    if (out.length >= MAX_SUPPORTING_STEPS) break

    let action = (step.action || '').replace(/\s+/g, ' ').trim()
    if (!action) continue

    if (looksLikeNarrative(action)) continue
    if (!actionStartsWithAllowedVerb(action, spanish)) continue

    action = truncateActionWords(action, MAX_ACTION_WORDS)
    if (!actionStartsWithAllowedVerb(action, spanish)) continue

    const key = normalizeDedupeKey(action)
    if (!key || key.length < 6) continue
    if (seen.has(key)) continue
    seen.add(key)

    out.push({
      ...step,
      action,
    })
  }

  return out
}
