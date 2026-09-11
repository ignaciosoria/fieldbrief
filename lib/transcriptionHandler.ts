import {checkAiAccess,type AiAccessDependencies} from './aiAccess'
import {audioUploadError,MAX_AUDIO_BYTES,AUDIO_TOO_LARGE} from './audioUpload'

type Dependencies=AiAccessDependencies & {transcribe:(file:File)=>Promise<string>}

/** Auth first, validate before reserving quota, and never expose provider errors. */
export async function handleTranscription(request:Request,deps:Dependencies):Promise<Response> {
  let email:string|null
  try {email=await deps.getEmail()} catch {
    return Response.json({error:'Unable to verify access. Please try again.',code:'ACCESS_UNAVAILABLE'},{status:503})
  }
  if (!email) return Response.json({error:'Sign in to process a note.',code:'AUTH_REQUIRED'},{status:401})
  if (Number(request.headers.get('content-length'))>MAX_AUDIO_BYTES+50_000) {
    return Response.json({error:AUDIO_TOO_LARGE},{status:413})
  }
  let file:FormDataEntryValue|null
  try {file=(await request.formData()).get('file')} catch {
    return Response.json({error:'Invalid audio upload.'},{status:400})
  }
  const invalid=audioUploadError(file)
  if (invalid) return Response.json({error:invalid},{status:file instanceof File && file.size>MAX_AUDIO_BYTES?413:400})
  const denied=await checkAiAccess('transcribe',{getEmail:async()=>email,reserve:deps.reserve})
  if (denied) return denied
  try {
    const transcript=await deps.transcribe(file as File)
    if (typeof transcript!=='string' || !transcript.trim()) return Response.json({error:'No speech was detected. Please review your audio and retry.',code:'NO_SPEECH'},{status:422})
    return Response.json({transcript},{headers:{'Cache-Control':'no-store'}})
  } catch (error:unknown) {
    const name=error instanceof Error?error.name:''
    const timedOut=name==='APIConnectionTimeoutError' || name==='TimeoutError' || name==='AbortError'
    return Response.json({
      error:timedOut?'Transcription took too long. Please try again.':'Unable to transcribe right now. Please try again.',
      code:timedOut?'TRANSCRIPTION_TIMEOUT':'TRANSCRIPTION_UNAVAILABLE',
    },{status:timedOut?504:502,headers:{'Cache-Control':'no-store'}})
  }
}
