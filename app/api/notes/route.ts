import { auth } from '../../../auth'
import { serverDb } from '../../../lib/serverDb'
import { parseNoteInput } from '../../../lib/noteInput'

export async function GET(request: Request) {
  const email = (await auth())?.user?.email?.trim()
  if (!email) return Response.json({ error: 'Sign in to view notes.' }, { status: 401 })
  const offset = Number(new URL(request.url).searchParams.get('offset') || 0)
  if (!Number.isSafeInteger(offset) || offset < 0) return Response.json({ error: 'Invalid page.' }, { status: 400 })
  try {
    const { data, error } = await serverDb().from('folup_notes')
      .select('id,created_at,raw_text,structured_output,version').eq('user_id', email)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + 49)
    if (error) throw error
    return Response.json({ notes: data, hasMore: data.length === 50 }, { headers: { 'Cache-Control': 'no-store' } })
  } catch { return Response.json({ error: 'Unable to load notes.' }, { status: 503 }) }
}

export async function PUT(request: Request) {
  const email = (await auth())?.user?.email?.trim()
  if (!email) return Response.json({ error: 'Sign in to save notes.' }, { status: 401 })
  let row, body
  try { body = await request.json(); row = parseNoteInput(body) } catch { /* malformed JSON */ }
  if (!row) return Response.json({ error: 'Invalid note.' }, { status: 400 })
  if (!Number.isSafeInteger(body.expectedVersion) || body.expectedVersion<0 || body.expectedVersion>2147483646 ||
    typeof body.requestId!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.requestId))
    return Response.json({error:'Refresh Folup before saving. Keep a copy of your unsaved correction.',code:'WRITE_VERSION_REQUIRED'},{status:428})
  try {
    const trialKey=(row.structured_output as {trialNoteKey?:unknown}).trialNoteKey
    if(trialKey!==undefined){
      if(typeof trialKey!=='string' || !/^[a-f0-9]{64}$/.test(trialKey)) return Response.json({error:'Invalid trial note.'},{status:400})
    }
    const { data,error } = await serverDb().rpc('save_folup_note',{
      p_user_id:email,p_note_id:row.id,p_request_id:body.requestId,p_expected_version:body.expectedVersion,
      p_raw_text:row.raw_text,p_output:row.structured_output,
    })
    if (error) throw error
    if(data?.error) return Response.json({code:'NOTE_CONFLICT',error:data.error==='trial_bound'
      ?'This processing result is already linked to another note.'
      :'This note has changed. Your correction has not overwritten it. Copy your pending correction before reloading the latest note.'},{status:409})
    return Response.json(data)
  } catch { return Response.json({ error: 'Note was not saved. Please retry.' }, { status: 503 }) }
}

export async function DELETE(request: Request) {
  const email = (await auth())?.user?.email?.trim()
  if (!email) return Response.json({ error: 'Sign in to delete notes.' }, { status: 401 })
  const params = new URL(request.url).searchParams
  const id = params.get('id')
  if (!id && params.get('all') !== 'true') return Response.json({ error: 'Specify a note.' }, { status: 400 })
  try {
    let query = serverDb().from('folup_notes').delete().eq('user_id', email)
    if (id) query = query.eq('id', id)
    const { error } = await query
    if (error) throw error
    return Response.json({ deleted: true })
  } catch { return Response.json({ error: 'Notes were not deleted. Please retry.' }, { status: 503 }) }
}
