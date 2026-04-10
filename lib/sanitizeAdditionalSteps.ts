import type { AdditionalStep } from './additionalStepEnrichment'
import {
  buildSupportingBaseTitle,
  type ActionStructuredFields,
} from './actionTitleContract'

const MAX_SUPPORTING_STEPS = 2
const MAX_ACTION_WORDS = 8
const EM = '\u2014'

const LEADING_VERB_RE =
  /^(Call|Send|Email|Llamar|Enviar|Follow\s+up|Meet|Reuni[oó]n|Dar\s+seguimiento)\s*$/i

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

function isSpanishLanguage(noteLanguage: string): boolean {
  return noteLanguage.trim().toLowerCase() === 'spanish'
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

function stripOuterParens(s: string): string {
  const t = s.trim()
  const m = t.match(/^\(([^)]+)\)$/)
  if (m) return m[1].trim()
  return t
}

function structuredHasContactOrObject(as: ActionStructuredFields): boolean {
  return Boolean(stripOuterParens(as.contact.trim()) || stripOuterParens(as.object.trim()))
}

/**
 * `Verb — Contact (Company)` → `Verb Contact — Company` (never `Verb — Contact (Company)`).
 */
function repairLegacySupportingTitle(raw: string): string {
  let s = raw.replace(/\s+/g, ' ').trim()
  const fix = s.match(
    /^(Call|Llamar|Enviar|Send|Email|Follow up|Meet|Reuni[oó]n|Dar seguimiento)\s*[—\-]\s*([^—(]+?)\s*\(([^)]+)\)\s*$/i,
  )
  if (fix) {
    const verb = fix[1].trim()
    const mid = fix[2].trim()
    const co = fix[3].trim()
    if (mid && co) return `${verb} ${mid} ${EM} ${co}`
  }
  return s
}

/**
 * Legacy line: must have a real target (contact/object), not only `Verb — Company`.
 */
function legacyHasContactOrObject(step: AdditionalStep): boolean {
  const action = (step.action || '').replace(/\s+/g, ' ').trim()
  if (!action) return false
  const segs = action.split(/\s*[—\-]\s*/).map((s) => s.trim())
  if (segs.length >= 3) return true
  if (segs.length === 2) {
    const [left, right] = segs
    const leftWords = left.split(/\s+/).filter(Boolean)
    if (leftWords.length >= 2) return true
    if (!LEADING_VERB_RE.test(left)) return true
    if (/^[^()]+\([^)]+\)$/.test(right)) return true
    if ((step.supportingType === 'send' || step.supportingType === 'email') && right.length >= 2)
      return true
    if (right.split(/\s+/).length >= 2) return true
    return false
  }
  const m = action.match(
    /^(Call|Send|Email|Llamar|Enviar|Follow\s+up|Meet|Reuni[oó]n|Dar\s+seguimiento)\s+(.+)$/i,
  )
  return Boolean(m && m[2].trim().length >= 2)
}

function stepHasContactOrObject(step: AdditionalStep): boolean {
  if (step.actionStructured) return structuredHasContactOrObject(step.actionStructured)
  return legacyHasContactOrObject(step)
}

function finalizeSupportingStep(step: AdditionalStep, noteLanguage: string): AdditionalStep {
  const as = step.actionStructured
  if (as) {
    const cleaned: ActionStructuredFields = {
      ...as,
      verb: as.verb.trim(),
      contact: stripOuterParens(as.contact.trim()),
      object: stripOuterParens(as.object.trim()),
      company: stripOuterParens(as.company.trim()),
      date: as.date,
      time: as.time,
    }
    const rebuilt = buildSupportingBaseTitle(cleaned, noteLanguage)
    return { ...step, action: rebuilt, actionStructured: cleaned }
  }
  let action = repairLegacySupportingTitle((step.action || '').replace(/\s+/g, ' ').trim())
  return { ...step, action }
}

function verbFamily(step: AdditionalStep): string {
  const st = step.supportingType
  if (st === 'send') return 'send'
  if (st === 'email') return 'email'
  if (st === 'call' || st === 'other') return 'call'
  const a = (step.action || '').toLowerCase()
  if (/^(send|enviar)\b/.test(a)) return 'send'
  if (/^email\b/.test(a)) return 'email'
  if (/^(call|llamar|follow|meet|reuni|seguimiento|dar\s+seguimiento)\b/.test(a)) return 'call'
  return 'other'
}

function companyKeyFromStep(step: AdditionalStep): string {
  let c = (step.company || step.actionStructured?.company || '').trim()
  c = stripOuterParens(c)
  if (c) return normalizeDedupeKey(c)
  const segs = (step.action || '').split(/\s*[—\-]\s*/).map((s) => s.trim())
  if (segs.length >= 2) {
    const last = segs[segs.length - 1].replace(/\s*\([^)]*\)\s*$/, '').trim()
    if (last) return normalizeDedupeKey(last)
  }
  return '_'
}

function dateKey(step: AdditionalStep): string {
  return (step.resolvedDate || '').trim()
}

function completenessScore(step: AdditionalStep): number {
  const as = step.actionStructured
  if (as) {
    let n = 0
    const c = stripOuterParens(as.contact.trim())
    const o = stripOuterParens(as.object.trim())
    const co = stripOuterParens(as.company.trim())
    if (c) n += 20 + Math.min(c.length, 40)
    if (o) n += 20 + Math.min(o.length, 40)
    if (co) n += 2
    return n
  }
  return Math.min((step.action || '').length, 200)
}

type IndexedStep = { step: AdditionalStep; idx: number }

function pickBestPerDuplicateGroup(rows: IndexedStep[]): AdditionalStep[] {
  const best = new Map<string, IndexedStep>()
  for (const row of rows) {
    const key = `${verbFamily(row.step)}|${companyKeyFromStep(row.step)}|${dateKey(row.step)}`
    const prev = best.get(key)
    if (!prev) {
      best.set(key, row)
      continue
    }
    const s0 = completenessScore(row.step)
    const s1 = completenessScore(prev.step)
    if (s0 > s1) best.set(key, row)
    else if (s0 === s1 && row.idx < prev.idx) best.set(key, row)
  }
  return [...best.values()]
    .sort((a, b) => a.idx - b.idx)
    .map((r) => r.step)
}

export type SanitizeAdditionalStepsOptions = {
  noteLanguage: string
}

/**
 * Short, verb-led actions; drop incomplete/vague rows; dedupe same verb+company+date;
 * titles normalized to `Verb target — Company`. Structured dates preserved.
 */
export function sanitizeAdditionalSteps(
  steps: AdditionalStep[],
  options: SanitizeAdditionalStepsOptions,
): AdditionalStep[] {
  const spanish = isSpanishLanguage(options.noteLanguage)
  const noteLanguage = options.noteLanguage
  const indexed: IndexedStep[] = (steps || []).map((step, idx) => ({ step, idx }))

  const filtered: IndexedStep[] = []
  for (const { step, idx } of indexed) {
    if (!stepHasContactOrObject(step)) continue
    filtered.push({ step: finalizeSupportingStep(step, noteLanguage), idx })
  }

  const deduped = pickBestPerDuplicateGroup(filtered)

  const seen = new Set<string>()
  const out: AdditionalStep[] = []

  for (const step of deduped) {
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
