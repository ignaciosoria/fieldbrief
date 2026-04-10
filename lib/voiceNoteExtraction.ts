/**
 * EXTRACTION LAYER — AI output contract (step 1 of the next-step pipeline).
 *
 * The model **extracts** candidate actions and supporting context from the transcript.
 * It does **not** choose a primary next step, rank actions, or merge steps — that is
 * handled by deterministic code in a later layer.
 *
 * Rules for the AI (embed in system prompt):
 * - Extract only what the note explicitly states or strongly implies; never invent commitments.
 * - If ambiguous or absent, use lower confidence or omit the action — do not guess to fill the array.
 * - `actions` may be empty when there is no forward motion.
 * - Do not label any action as "primary" or "secondary"; ordering is arbitrary.
 */

/** Normalized action kinds for downstream prioritization rules. */
export type ExtractedActionType = 'call' | 'send' | 'meeting' | 'follow_up' | 'other'

export type ExtractionConfidence = 'high' | 'medium' | 'low'

/**
 * One candidate forward action mentioned or clearly implied in the note.
 * Multiple rows are allowed; the prioritization layer picks at most one primary (+ optional secondaries).
 */
export interface ExtractedAction {
  type: ExtractedActionType
  /** Short clause grounded in the note (same language as input). */
  description: string
  /**
   * Time language exactly as expressed or a normalized relative ref, e.g. "tomorrow", "next Friday".
   * Use `null` when no time is stated for this action.
   */
  time_reference: string | null
  confidence: ExtractionConfidence
}

/**
 * Non-action insight for CRM / UI / calendar context — not used to pick the next step directly.
 */
export interface ExtractedContextItem {
  /**
   * Optional bucket for deterministic filtering (keep values stable).
   * Examples: interest, objection, competitor, stakeholder, product, risk, pricing, timing
   */
  category?: string
  text: string
}

/**
 * Structured output the extraction model must return (JSON only, no markdown).
 */
export interface VoiceNoteExtraction {
  actions: ExtractedAction[]
  context: ExtractedContextItem[]
}

// --- Example: English visit note (illustrative only) --------------------------------------------

/**
 * Example JSON the extraction model should emit for a typical note.
 * (Use as few-shot example or schema documentation — not runtime data.)
 */
export const EXTRACTION_SCHEMA_EXAMPLE: VoiceNoteExtraction = {
  actions: [
    {
      type: 'send',
      description: 'Email revised quote for the enterprise tier',
      time_reference: 'tomorrow morning',
      confidence: 'high',
    },
    {
      type: 'call',
      description: 'Check whether they received the ROI deck',
      time_reference: 'Thursday',
      confidence: 'medium',
    },
  ],
  context: [
    { category: 'interest', text: 'Wants to expand to two additional sites next quarter.' },
    { category: 'objection', text: 'Concerned about implementation timeline vs. their fiscal year-end.' },
    { category: 'competitor', text: 'Currently evaluating Vendor X for the pilot.' },
  ],
}

/**
 * No forward actions — `actions` may be empty; `context` only for facts explicitly in the note
 * (otherwise empty; do not fabricate filler).
 */
export const EXTRACTION_SCHEMA_EMPTY_EXAMPLE: VoiceNoteExtraction = {
  actions: [],
  context: [],
}
