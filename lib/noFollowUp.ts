/** Canonical copy when the note has no real follow-up action. */
export const NO_FOLLOW_UP_NEEDED_EN = 'No follow-up needed'
export const NO_FOLLOW_UP_NEEDED_ES = 'No se requiere seguimiento'

/** Older model / saved notes — still recognized by matchers. */
export const NO_CLEAR_FOLLOW_UP_EN = 'No clear follow-up needed'
export const NO_CLEAR_FOLLOW_UP_ES = 'No se requiere un seguimiento claro'

const NO_FOLLOW_UP_LINES = [
  NO_FOLLOW_UP_NEEDED_EN,
  NO_FOLLOW_UP_NEEDED_ES,
  NO_CLEAR_FOLLOW_UP_EN,
  NO_CLEAR_FOLLOW_UP_ES,
] as const

export function isNoClearFollowUpLine(line: string): boolean {
  const t = line.trim().toLowerCase()
  return NO_FOLLOW_UP_LINES.some((s) => t === s.toLowerCase())
}

export function isNoClearFollowUpResult(r: {
  nextStep?: string
  nextStepTitle?: string
}): boolean {
  return (
    isNoClearFollowUpLine(r.nextStepTitle || '') ||
    isNoClearFollowUpLine(r.nextStep || '')
  )
}
