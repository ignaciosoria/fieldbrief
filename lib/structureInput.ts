export const MAX_STRUCTURE_BYTES = 256_000

/** Bound decoded JSON even when Content-Length is absent or inaccurate. */
export async function readStructureInput(request: Request): Promise<{note:string;timezone?:unknown;clientNow?:unknown;existingNoteId?:string;trialNoteKey?:string} | Response> {
  const invalid = (status:number) => Response.json({error:status===413?'Note is too long':'Invalid or missing note'},{status,headers:{'Cache-Control':'no-store'}})
  if (Number(request.headers.get('content-length')) > MAX_STRUCTURE_BYTES) return invalid(413)
  try {
    const reader=request.body?.getReader()
    if (!reader) return invalid(400)
    const decoder=new TextDecoder()
    let size=0, text=''
    try {
      while (true) {
        const {done,value}=await reader.read()
        if (done) break
        size+=value.byteLength
        if(size>MAX_STRUCTURE_BYTES) {
          void reader.cancel().catch(()=>{})
          return invalid(413)
        }
        text+=decoder.decode(value,{stream:true})
      }
      const body=JSON.parse(text+decoder.decode())
      if (!body || typeof body!=='object' || Array.isArray(body) || typeof body.note!=='string' || !body.note.trim()) return invalid(400)
      if (body.note.length>20000) return invalid(413)
      if(body.existingNoteId!==undefined && (typeof body.existingNoteId!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.existingNoteId))) return invalid(400)
      if(body.trialNoteKey!==undefined && (typeof body.trialNoteKey!=='string' || !/^[a-f0-9]{64}$/.test(body.trialNoteKey))) return invalid(400)
      return {note:body.note,timezone:body.timezone,clientNow:body.clientNow,...(body.existingNoteId?{existingNoteId:body.existingNoteId}:{}),...(body.trialNoteKey?{trialNoteKey:body.trialNoteKey}:{})}
    } finally {reader.releaseLock()}
  } catch {return invalid(400)}
}
