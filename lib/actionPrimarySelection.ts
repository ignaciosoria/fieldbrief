import { ACTION_KIND_SCORE, inferActionKind } from './nextStepActionKind'
import { inferNormalizedActionType, type NormalizedActionType } from './normalizedActions'

/**
 * Helpers for primary ranking (`applyRankedNextStepSelection` in structure route):
 * - `primaryBusinessTier` / `kindScoreForPrimarySelection` are retained for logging and typing.
 * - **Primary winner** is chosen by urgency (date + send/email-today rule), not by tier alone — see route.
 */

export function primaryBusinessTier(t: NormalizedActionType): 0 | 1 | 2 {
  if (t === 'meeting' || t === 'call' || t === 'follow_up') return 0
  if (t === 'send' || t === 'email') return 1
  return 2
}

/** Uses inferActionKind so scoring stays aligned with verb lists (send vs email share send score). */
export function kindScoreForPrimarySelection(action: string, title: string): number {
  return ACTION_KIND_SCORE[inferActionKind(`${action} ${title}`)]
}

export function normalizedTypeForRow(action: string, title: string): NormalizedActionType {
  return inferNormalizedActionType(`${action} ${title}`)
}

/** True when this action may be primary over any send/email/other row. */
export function isHighValuePrimaryCandidate(t: NormalizedActionType): boolean {
  return primaryBusinessTier(t) === 0
}

/** True when send/email must not win if a high-value candidate exists. */
export function isSendOrEmailTier(t: NormalizedActionType): boolean {
  return t === 'send' || t === 'email'
}
