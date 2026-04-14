import type { AdditionalStep } from './additionalStepEnrichment'
import {
  buildSupportingBaseTitle,
  type ActionStructuredFields,
} from './actionTitleContract'

/**
 * Max supporting rows after sanitize (primary is separate).
 * Keep in sync with structured model output cap in `structuredAiMapper` / STRUCTURED_AI_SYSTEM_PROMPT.
 */
export const MAX_SUPPORTING_ACTIONS = 6
const MAX_ACTION_WORDS = 8
const EM = '\u2014'

const LEADING_VERB_RE =
  /^(Call|Send|Email|Llamar|Enviar|Follow\s+up(?:\s+with)?|Seguimiento\s+con|Meet|Reuni[oó]n|Dar\s+seguimiento)\s*$/i

/** Verb-only titles with no who/what — not executable. */
const GENERIC_VERB_ONLY_LINE = new RegExp(
  '^(' +
    [
      'follow\\s+up',
      'check',
      'review',
      'confirm',
      'prepare',
      'touch\\s+base',
      'check\\s+in',
      'call',
      'send',
      'email',
      'meet',
      'llamar',
      'enviar',
      'seguimiento',
      'dar\\s+seguimiento',
      'reuni[oó]n',
      'reunirse',
      'revisar',
      'revisión',
      'comprobar',
      'verificar',
      'confirmar',
      'preparar',
    ].join('|') +
    ')$',
  'i',
)

const TRAILING_AFTER_VERB_RE = new RegExp(
  '^(' +
    [
      'Call',
      'Send',
      'Email',
      'Llamar',
      'Enviar',
      'Follow\\s+up(?:\\s+with)?',
      'Seguimiento\\s+con',
      'Meet',
      'Check',
      'Review',
      'Prepare',
      'Confirm',
      'Reuni[oó]n',
      'Dar\\s+seguimiento',
    ].join('|') +
    ')\\s+(.+)$',
  'i',
)

const FLUFF_TARGET_PHRASE =
  /^(later|soon|tbd|asap|next\s+week|next\s+month|this\s+week|next\s+quarter|mañana|pronto|hoy|next\s+year)$/i

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
 * "Follow up with" / "Seguimiento con" (and legacy "Follow up" / "Dar seguimiento") count as action opens.
 */
export function actionStartsWithAllowedVerb(action: string, spanish: boolean): boolean {
  const t = action.trim()
  if (!t) return false
  if (spanish) {
    return (
      /^enviar\b/i.test(t) ||
      /^email\b/i.test(t) ||
      /^llamar\b/i.test(t) ||
      /^seguimiento\s+con\b/i.test(t) ||
      /^seguimiento\b/i.test(t) ||
      /^dar\s+seguimiento\b/i.test(t) ||
      /^reunirse\b/i.test(t) ||
      /^reuni[oó]n\b/i.test(t) ||
      /^meet\b/i.test(t) ||
      /^follow\s+up(?:\s+with)?\b/i.test(t)
    )
  }
  return (
    /^send\b/i.test(t) ||
    /^email\b/i.test(t) ||
    /^call\b/i.test(t) ||
    /^follow\s+up(?:\s+with)?\b/i.test(t) ||
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

function targetPhraseLooksSubstantive(s: string): boolean {
  const t = s.replace(/\s+/g, ' ').trim()
  if (!t || t.length < 2) return false
  if (FLUFF_TARGET_PHRASE.test(t)) return false
  if (/\b(next|this)\s+(week|month|quarter|year)\b/i.test(t)) return false
  const words = t.split(/\s+/).filter(Boolean)
  if (words.length === 1 && /^(it|them|this|that|there|here)$/i.test(words[0])) return false
  if (words.length >= 2) return true
  return t.length >= 4 || /\d/.test(t)
}

function isGenericVerbOnlySegment(left: string): boolean {
  return GENERIC_VERB_ONLY_LINE.test(left.trim())
}

/** Structured rows must name a real deliverable or person, not pronouns alone. */
function structuredFieldsAreExecutable(as: ActionStructuredFields): boolean {
  const c = stripOuterParens(as.contact.trim())
  const o = stripOuterParens(as.object.trim())
  const t = (as.type || '').trim().toLowerCase()
  if (t === 'send' || t === 'email') {
    if (!o || o.length < 2) return false
    if (/^(it|this|that|them|there)$/i.test(o)) return false
    return true
  }
  if (t === 'call' || t === 'other') {
    if (c.length >= 2 && !/^(it|him|her|them)$/i.test(c)) return true
    if (o.length >= 2 && !/^(it|this|that)$/i.test(o)) return true
    return false
  }
  return structuredHasContactOrObject(as)
}

/**
 * Legacy free-form line: verb + substantive target (contact, object, or specific phrase).
 * Replaces the old check that treated any two-word opener (e.g. "Follow up") + anything as valid.
 */
function legacyHasExecutableTarget(action: string): boolean {
  const actionNorm = action.replace(/\s+/g, ' ').trim()
  if (!actionNorm) return false
  if (GENERIC_VERB_ONLY_LINE.test(actionNorm)) return false

  const segs = actionNorm.split(/\s*[—\-]\s*/).map((s) => s.trim())

  if (segs.length >= 3) return true

  if (segs.length === 2) {
    const [left, right] = segs
    if (!right) return false
    if (isGenericVerbOnlySegment(left) && !targetPhraseLooksSubstantive(right)) return false
    if (!LEADING_VERB_RE.test(left) && !isGenericVerbOnlySegment(left)) {
      if (targetPhraseLooksSubstantive(right)) return true
    }
    if (targetPhraseLooksSubstantive(right)) return true
    const leftWords = left.split(/\s+/).filter(Boolean)
    if (leftWords.length >= 3) return true
    const mv = left.match(TRAILING_AFTER_VERB_RE)
    if (mv && targetPhraseLooksSubstantive(mv[2].trim())) return true
    if ((leftWords.length === 2 || leftWords.length === 1) && !isGenericVerbOnlySegment(left)) {
      const m2 = left.match(TRAILING_AFTER_VERB_RE)
      if (m2 && targetPhraseLooksSubstantive(m2[2].trim())) return true
    }
    return false
  }

  const m = actionNorm.match(TRAILING_AFTER_VERB_RE)
  if (m) {
    const rest = m[2].trim()
    if (targetPhraseLooksSubstantive(rest)) return true
    if (FLUFF_TARGET_PHRASE.test(rest)) return false
    if (rest.length <= 4 && /\b(later|soon|asap)\b/i.test(rest)) return false
    return false
  }

  const mLegacy = actionNorm.match(
    /^(Call|Send|Email|Llamar|Enviar|Follow\s+up(?:\s+with)?|Seguimiento\s+con|Meet|Reuni[oó]n|Dar\s+seguimiento)\s+(.+)$/i,
  )
  if (mLegacy) {
    const rest = mLegacy[2].trim()
    return targetPhraseLooksSubstantive(rest)
  }
  return false
}

function stepHasExecutableTarget(step: AdditionalStep): boolean {
  if (step.actionStructured) {
    if (!structuredHasContactOrObject(step.actionStructured)) return false
    return structuredFieldsAreExecutable(step.actionStructured)
  }
  return legacyHasExecutableTarget((step.action || '').replace(/\s+/g, ' ').trim())
}

/** True when a dropped weak action should become a crmFull insight line (wording avoids action-token filter). */
function shouldPromoteWeakActionToInsight(step: AdditionalStep): boolean {
  const a = (step.action || '').replace(/\s+/g, ' ').trim()
  if (!a || looksLikeNarrative(a)) return false
  return /\b(follow\s+up|check|review|confirm|prepare|seguimiento|revisar|revisión|comprobar|verificar|confirmar|preparar)\b/i.test(
    a,
  )
}

function weakActionToPromotedInsight(step: AdditionalStep, spanish: boolean): string {
  const a = (step.action || '').toLowerCase()
  if (spanish) {
    if (/\bfollow\s+up\b|seguimiento|dar\s+seguimiento/.test(a)) {
      return 'Acción pendiente sin detalle concreto'
    }
    if (/\bcheck\b|comprobar|verificar/.test(a)) return 'Comprobación pendiente sin objetivo claro'
    if (/\breview\b|revisar|revisión/.test(a)) return 'Revisión pendiente sin tema acotado'
    if (/\bconfirm|confirmar|prepare|preparar/.test(a)) return 'Pendiente definir entregable o responsable'
    return 'Pendiente definir siguiente paso concreto'
  }
  if (/\bfollow\s+up\b/.test(a)) return 'Open relationship loop — no concrete task named'
  if (/\bcheck\b/.test(a)) return 'Verification still needed — no target named'
  if (/\breview\b/.test(a)) return 'Open review item — subject not specified'
  if (/\bconfirm\b/.test(a) || /\bprepare\b/.test(a)) {
    return 'Outstanding prep or confirmation — detail not specified'
  }
  return 'Open loop — no named contact or deliverable'
}

/**
 * `Verb — Contact (Company)` → `Verb Contact — Company` (never `Verb — Contact (Company)`).
 */
function repairLegacySupportingTitle(raw: string): string {
  let s = raw.replace(/\s+/g, ' ').trim()
  const fix = s.match(
    /^(Call|Llamar|Enviar|Send|Email|Follow up(?: with)?|Seguimiento con|Meet|Reuni[oó]n|Dar seguimiento)\s*[—\-]\s*([^—(]+?)\s*\(([^)]+)\)\s*$/i,
  )
  if (fix) {
    const verb = fix[1].trim()
    const mid = fix[2].trim()
    const co = fix[3].trim()
    if (mid && co) return `${verb} ${mid} ${EM} ${co}`
  }
  return s
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

export type SanitizeAdditionalStepsResult = {
  steps: AdditionalStep[]
  /** Safe for crmFull — phrased to pass filterInsightsToContextOnly (no bare action tokens). */
  promotedInsights: string[]
}

/** Prepend promoted insight lines from dropped weak actions; dedupe; cap length. */
export function mergePromotedInsightsIntoCrmFull(
  crmFull: string[],
  promoted: string[],
  maxLines = 5,
): string[] {
  const p = promoted.map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean)
  if (!p.length) return crmFull.slice(0, maxLines)
  const seen = new Set<string>()
  const out: string[] = []
  for (const line of [...p, ...crmFull]) {
    const k = line.trim().toLowerCase()
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(line.trim())
    if (out.length >= maxLines) break
  }
  return out
}

/**
 * Short, verb-led actions; drop incomplete/vague rows; dedupe same verb+company+date;
 * titles normalized to `Verb target — Company`. Structured dates preserved.
 * Weak generic actions (e.g. "Follow up" alone) become insight lines instead.
 */
export function sanitizeAdditionalSteps(
  steps: AdditionalStep[],
  options: SanitizeAdditionalStepsOptions,
): SanitizeAdditionalStepsResult {
  const spanish = isSpanishLanguage(options.noteLanguage)
  const noteLanguage = options.noteLanguage
  const indexed: IndexedStep[] = (steps || []).map((step, idx) => ({ step, idx }))

  const promotedInsights: string[] = []
  const promotedSeen = new Set<string>()

  const filtered: IndexedStep[] = []
  for (const { step, idx } of indexed) {
    const finalized = finalizeSupportingStep(step, noteLanguage)
    if (!stepHasExecutableTarget(finalized)) {
      if (shouldPromoteWeakActionToInsight(finalized)) {
        const line = weakActionToPromotedInsight(finalized, spanish)
        const lk = line.trim().toLowerCase()
        if (lk && !promotedSeen.has(lk)) {
          promotedSeen.add(lk)
          promotedInsights.push(line)
        }
      }
      continue
    }
    filtered.push({ step: finalized, idx })
  }

  const deduped = pickBestPerDuplicateGroup(filtered)

  const seen = new Set<string>()
  const out: AdditionalStep[] = []

  for (const step of deduped) {
    if (out.length >= MAX_SUPPORTING_ACTIONS) break

    let action = (step.action || '').replace(/\s+/g, ' ').trim()
    if (!action) continue

    if (looksLikeNarrative(action)) continue
    if (!actionStartsWithAllowedVerb(action, spanish)) continue

    action = truncateActionWords(action, MAX_ACTION_WORDS)
    if (!actionStartsWithAllowedVerb(action, spanish)) continue

    const stepAfterTruncate = { ...step, action }
    if (!stepHasExecutableTarget(stepAfterTruncate)) continue

    const key = normalizeDedupeKey(action)
    if (!key || key.length < 6) continue
    if (seen.has(key)) continue
    seen.add(key)

    out.push({
      ...step,
      action,
    })
  }

  return { steps: out, promotedInsights }
}
