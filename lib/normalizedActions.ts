import { inferActionKind, type ActionKind } from './nextStepActionKind'

/**
 * Backend-normalized action labels (Phase 1). `email` is split out from generic `send`
 * when the text clearly refers to email/mail/correo.
 */
export type NormalizedActionType =
  | 'call'
  | 'follow_up'
  | 'meeting'
  | 'send'
  | 'email'
  | 'other'

export type NormalizedAction = {
  /** Action line (primary first, then supporting, same order as ranking output). */
  action: string
  type: NormalizedActionType
  date: string
  time: string
  /** Exactly one action is primary — chosen by backend ranking, not the model slot alone. */
  primary: boolean
}

/** Map internal ActionKind to normalized type (email handled separately). */
function actionKindToNormalized(kind: ActionKind): Exclude<NormalizedActionType, 'email'> {
  return kind
}

/**
 * Classify a phrase into normalized types. Uses the same verb lists as ranking, then
 * refines `send` → `email` when the wording is clearly email-specific.
 */
export function inferNormalizedActionType(text: string): NormalizedActionType {
  const t = (text || '').trim()
  if (!t) return 'other'
  const kind = inferActionKind(t)
  if (kind !== 'send') return actionKindToNormalized(kind)

  const lower = t.toLowerCase()
  if (
    /\b(email|e-mail|e\s?mail|correo(\s+electr[oó]nico)?|mandar\s+un\s+mail|enviar\s+un\s+correo)\b/i.test(
      lower,
    )
  ) {
    return 'email'
  }
  if (/\bmail\s+(it|them|him|her|the|this|that|quote|deck|proposal|doc|pdf)\b/i.test(lower)) {
    return 'email'
  }
  if (/\bforward\s+(this\s+)?(email|message|note)\b/i.test(lower)) {
    return 'email'
  }
  return 'send'
}

/**
 * Build the canonical ordered `actions[]` after enrichment + ranking + calendar resolution.
 * Primary/supporting roles come from backend fields (`nextStep` + `additionalSteps`), not raw model slots.
 */
export function buildNormalizedActionsFromResult(r: {
  nextStep: string
  nextStepTitle?: string
  nextStepDate: string
  nextStepTimeHint: string
  additionalSteps: { action: string; date: string; time: string }[]
}): NormalizedAction[] {
  const primary = (r.nextStep || '').trim()
  if (!primary) {
    const steps = r.additionalSteps || []
    return steps.map((s, i) => ({
      action: (s.action || '').trim(),
      type: inferNormalizedActionType(s.action),
      date: (s.date || '').trim(),
      time: (s.time || '').trim(),
      primary: i === 0,
    }))
  }

  const out: NormalizedAction[] = [
    {
      action: primary,
      type: inferNormalizedActionType(`${primary} ${r.nextStepTitle || ''}`),
      date: (r.nextStepDate || '').trim(),
      time: (r.nextStepTimeHint || '').trim(),
      primary: true,
    },
  ]

  for (const s of r.additionalSteps || []) {
    const a = (s.action || '').trim()
    if (!a) continue
    out.push({
      action: a,
      type: inferNormalizedActionType(a),
      date: (s.date || '').trim(),
      time: (s.time || '').trim(),
      primary: false,
    })
  }

  return out
}
