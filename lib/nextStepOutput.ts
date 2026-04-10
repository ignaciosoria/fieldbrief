/**
 * OUTPUT LAYER — Final user-facing next-step bundle (after extraction + deterministic logic).
 *
 * One primary line, zero or one supporting line, and short insight bullets.
 * This is the contract for copy, CRM export, and UI — not raw model JSON.
 *
 * ## Design goals (trust without editing)
 * - Scannable in **under ~3 seconds**: short lines, few bullets, high signal.
 * - **Clarity over completeness**: omit nice-to-haves; one idea per bullet.
 * - **No duplication** across primary, supporting, and bullets (normalized dedupe).
 * - **No fluff** (“Discussed various topics”, “Good meeting”) — drop or never emit.
 *
 * ## Edge cases (policies for upstream deterministic + extraction layers)
 *
 * **Messy speech** — filler, restarts, false starts: extraction should attach **low confidence**;
 * deterministic step picks **one** verb + object + optional time token; output layer **truncates** only
 * for length, never invents clarity.
 *
 * **Multiple actions** — many candidates: deterministic layer ranks and emits **one primary** +
 * **at most one supporting**; rest stay out of this object (or only in CRM pipeline elsewhere), never
 * a third line here.
 *
 * **No action** — no commitment: `primary` is the canonical no-follow-up line (e.g. from
 * `lib/noFollowUp.ts`); `supporting` omitted; `keyInsights` only factual lines from the note (can be
 * empty if nothing to say without hallucinating).
 *
 * **Conflicting timing** — e.g. “call Monday” vs “send Tuesday” for two tasks: **primary** gets the
 * earlier resolved calendar anchor; **supporting** gets the other **only if** both survive
 * extraction as distinct commitments; if conflict is unresolved, drop supporting and keep **one**
 * primary with **unclear_date**-style handling upstream (not in this file).
 *
 * ## Reliability over time (operational)
 * - Log **structured extraction + deterministic inputs** (redacted) to tune ranking weights.
 * - **Per-user corrections** (“always prefer call over email”) as light preferences **after** core rules.
 * - **Golden-set tests**: fixed transcripts → expected `NextStepOutput` for regression on prompt/rule changes.
 * - **Confidence calibration**: track when users edit primary; correlate with extraction `confidence`.
 * - **Version** the deterministic rule set and store `rulesVersion` on saved notes when you add persistence.
 */

export interface NextStepOutput {
  /** Single line; imperative; same language as the note. */
  primary: string
  /** Optional second commitment; omit or empty when none. */
  supporting?: string
  /** Short bullets only; no paragraphs. */
  keyInsights: string[]
}

/** Tunable limits — keep output visually scannable on mobile. */
export const OUTPUT_SCANNABILITY_LIMITS = {
  /** Primary / supporting: one glance on a narrow screen. */
  maxStepChars: 88,
  maxInsightBullets: 5,
  maxInsightCharsPerLine: 72,
} as const

/** Example matching product spec (English). */
export const NEXT_STEP_OUTPUT_EXAMPLE: NextStepOutput = {
  primary: 'Call John — next week',
  supporting: 'Send info — tomorrow',
  keyInsights: [
    'Interested in product',
    'Using competitor',
    'Mentioned potential referral',
  ],
}

/** No supporting task; insights only. */
export const NEXT_STEP_OUTPUT_MINIMAL_EXAMPLE: NextStepOutput = {
  primary: 'Send proposal — Friday',
  keyInsights: ['Asked for volume pricing'],
}

function normalizeForDedupe(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function truncateWithEllipsis(s: string, max: number): string {
  const t = s.trim()
  if (t.length <= max) return t
  if (max <= 1) return '…'
  return `${t.slice(0, max - 1).trim()}…`
}

/**
 * Enforces length caps, dedupes primary / supporting / bullets, drops empty fluff.
 * Call this once when assembling output from deterministic + extraction results.
 */
export function normalizeNextStepOutput(
  o: NextStepOutput,
  limits: typeof OUTPUT_SCANNABILITY_LIMITS = OUTPUT_SCANNABILITY_LIMITS,
): NextStepOutput {
  const primaryRaw = (o.primary || '').trim()
  const supportingRaw = (o.supporting || '').trim()

  let primary = truncateWithEllipsis(primaryRaw, limits.maxStepChars)
  let supporting = supportingRaw
    ? truncateWithEllipsis(supportingRaw, limits.maxStepChars)
    : ''

  const pKey = normalizeForDedupe(primary)
  const sKey = normalizeForDedupe(supporting)
  if (supporting && (!pKey || sKey === pKey)) {
    supporting = ''
  }

  const seen = new Set<string>()
  if (pKey) seen.add(pKey)
  if (supporting) seen.add(sKey)

  const keyInsights: string[] = []
  for (const raw of o.keyInsights || []) {
    if (keyInsights.length >= limits.maxInsightBullets) break
    const line = truncateWithEllipsis(raw.trim(), limits.maxInsightCharsPerLine)
    if (!line) continue
    const k = normalizeForDedupe(line)
    if (seen.has(k)) continue
    seen.add(k)
    keyInsights.push(line)
  }

  const out: NextStepOutput = {
    primary,
    keyInsights,
  }
  if (supporting) out.supporting = supporting
  return out
}

/**
 * Human-readable block: labels + bullets (for clipboard, previews, LLM-free display).
 * Omits empty sections.
 */
export function formatNextStepOutputPlainText(o: NextStepOutput): string {
  const n = normalizeNextStepOutput(o)
  const lines: string[] = []
  const primary = (n.primary || '').trim()
  const supporting = (n.supporting || '').trim()

  if (primary) {
    lines.push('Primary next step:')
    lines.push(primary)
  }

  if (supporting) {
    if (lines.length) lines.push('')
    lines.push('Supporting:')
    lines.push(supporting)
  }

  const bullets = (n.keyInsights || []).map((s) => s.trim()).filter(Boolean)
  if (bullets.length) {
    if (lines.length) lines.push('')
    lines.push('Key insights:')
    for (const b of bullets) {
      lines.push(`- ${b}`)
    }
  }

  return lines.join('\n').trim()
}

/** Product/engineering checklist for improving trust and consistency (non-exhaustive). */
export const RELIABILITY_IMPROVEMENT_LEVERS = [
  'Separate extraction JSON from deterministic code paths; unit-test the latter without the LLM.',
  'Maintain a regression set: transcript → expected primary/supporting/insights after rule version N.',
  'Measure edit rate: user changes primary within 30s → weak signal for ranking or extraction quality.',
  'Optional user/org preferences (e.g. default send vs call) applied only after base rules.',
  'Log ambiguity (missing date, two contacts) separately from “wrong next step” to fix the right layer.',
  'Version prompts and rule packs; attach version to analytics for drift detection.',
] as const
