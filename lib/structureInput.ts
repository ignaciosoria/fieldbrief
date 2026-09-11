export const MAX_STRUCTURE_BYTES = 256_000

/** Bound decoded JSON even when Content-Length is absent or inaccurate. */
export async function readStructureInput(request: Request): Promise<{note:string;timezone?:unknown;clientNow?:unknown} | Response> {
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
      return {note:body.note,timezone:body.timezone,clientNow:body.clientNow}
    } finally {reader.releaseLock()}
  } catch {return invalid(400)}
}
