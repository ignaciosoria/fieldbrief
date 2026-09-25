import { DateTime } from 'luxon'

/** Never expose a corrected result/transcript as accepted before durable storage. */
export async function persistThenPublishCorrection(persist:()=>Promise<void>, publish:()=>void):Promise<void> {
  await persist()
  publish()
}

/** Keep a separate temporal anchor for every appended correction. */
export function appendVisitCorrection(original: string, correction: string, now: string, timezone: string): string {
  const local = DateTime.fromISO(now).setZone(timezone)
  if (!local.isValid || !correction.trim()) throw Error('Invalid correction')
  return `${original}\n\nCORRECTION RECORDED ${local.toISO()} (${timezone}):\n${correction.trim()}`
}
