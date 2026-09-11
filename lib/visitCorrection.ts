import { DateTime } from 'luxon'

/** Keep a separate temporal anchor for every appended correction. */
export function appendVisitCorrection(original: string, correction: string, now: string, timezone: string): string {
  const local = DateTime.fromISO(now).setZone(timezone)
  if (!local.isValid || !correction.trim()) throw Error('Invalid correction')
  return `${original}\n\nCORRECTION RECORDED ${local.toISO()} (${timezone}):\n${correction.trim()}`
}
