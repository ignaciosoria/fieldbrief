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
      .select('id,created_at,raw_text,structured_output').eq('user_id', email)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + 49)
    if (error) throw error
    return Response.json({ notes: data, hasMore: data.length === 50 }, { headers: { 'Cache-Control': 'no-store' } })
  } catch { return Response.json({ error: 'Unable to load notes.' }, { status: 503 }) }
}

export async function PUT(request: Request) {
  const email = (await auth())?.user?.email?.trim()
  if (!email) return Response.json({ error: 'Sign in to save notes.' }, { status: 401 })
  let row
  try { row = parseNoteInput(await request.json()) } catch { /* malformed JSON */ }
  if (!row) return Response.json({ error: 'Invalid note.' }, { status: 400 })
  try {
    // Composite primary key prevents an id belonging to another account from being overwritten.
    const { error } = await serverDb().from('folup_notes').upsert({ ...row, user_id: email }, { onConflict: 'user_id,id' })
    if (error) throw error
    return Response.json({ saved: true })
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
