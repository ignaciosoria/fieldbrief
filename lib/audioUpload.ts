// Leave room for multipart headers beneath Vercel's 4.5 MB request limit.
export const MAX_AUDIO_BYTES=4_000_000
export const AUDIO_TOO_LARGE='Audio must be 4 MB or smaller. Download a copy before discarding this recording.'

export function audioUploadError(file:FormDataEntryValue|null):string|null {
  if (!(file instanceof File) || file.size===0) return 'A non-empty audio file is required.'
  if (file.size>MAX_AUDIO_BYTES) return AUDIO_TOO_LARGE
  return null
}
