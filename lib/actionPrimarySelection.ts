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

/**
 * Tie-breaker after calendar urgency bands (lower = more urgent).
 * Surfaces same-day / deadline language and demotes soft future phrasing — does not override day-level bands.
 */
export function linguisticUrgencyModifierForPrimaryRow(action: string, title: string): number {
  const t = `${action} ${title}`.toLowerCase()
  let s = 0
  if (/\btoday\b|\bhoy\b/.test(t)) s -= 3
  if (/\bbefore\b/.test(t) && /(\d|noon|midnight|pm|am|:\d)/i.test(t)) s -= 2
  if (/\burgent\b|\burgente\b/.test(t)) s -= 2
  if (/\btomorrow\b|\bmañana\b/.test(t)) s -= 1
  if (/\bnext\s+week\b|\bpr[oó]xima\s+semana\b|\bla\s+pr[oó]xima\s+semana\b/.test(t)) s += 3
  if (/\bno\s+rush\b|\bsin\s+prisa\b|\bno\s+hay\s+prisa\b/.test(t)) s += 2
  if (/\bearly\s+next\s+week\b/.test(t)) s += 2
  return s
}
