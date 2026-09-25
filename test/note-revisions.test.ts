import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'

const id='12345678-1234-1234-1234-123456789abc'
test('revision migration preserves history, atomicity, ownership and deletion semantics',async()=>{
  const db=new PGlite()
  try {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE TABLE notes(id int); CREATE TABLE subscriptions(id int);')
    await db.exec(await readFile('supabase/migrations/20260911000200_private_notes.sql','utf8'))
    const save=async(owner:string,text:string,result:object={})=>db.query(`INSERT INTO folup_notes(user_id,id,raw_text,structured_output)
      VALUES($1,$2,$3,$4) ON CONFLICT(user_id,id) DO UPDATE SET raw_text=excluded.raw_text,structured_output=excluded.structured_output`,[owner,id,text,JSON.stringify(result)])
    const revisions=async(owner='alice')=>(await db.query<{revision_id:string;parent_revision_id:string|null;revision_number:number;source:string;raw_text:string;structured_output:object}>(
      'SELECT * FROM folup_note_revisions WHERE user_id=$1 AND note_id=$2 ORDER BY revision_number',[owner,id])).rows
    const initial={capturedAt:'2026-09-24T18:00:00Z',noteTimezone:'America/Los_Angeles',summary:'Original'}
    await save('alice','Original',initial)
    await db.exec(await readFile('supabase/migrations/20260925000100_note_revisions.sql','utf8'))
    const baseline=(await revisions())[0]
    assert.equal(baseline.source,'baseline')
    assert.deepEqual(baseline.structured_output,initial)
    assert.equal(baseline.parent_revision_id,null)
    await db.exec('SET ROLE service_role')
    await save('alice','Correction',{...initial,summary:'Corrected'})
    await save('alice','Correction',{summary:'Corrected',noteTimezone:initial.noteTimezone,capturedAt:initial.capturedAt})
    let rows=await revisions()
    assert.equal(rows.length,2,'identical retry and JSON key order do not duplicate')
    assert.equal(rows[1].parent_revision_id,baseline.revision_id)
    assert.equal(rows[1].revision_number,2)
    assert.equal(rows[0].raw_text,'Original')
    await save('bob','Bob')
    assert.equal((await revisions('bob'))[0].source,'created')
    assert.equal((await revisions('bob'))[0].parent_revision_id,null)
    await assert.rejects(()=>db.exec("UPDATE folup_note_revisions SET raw_text='tampered'"),/permission denied/)
    await assert.rejects(()=>db.exec('DELETE FROM folup_note_revisions'),/permission denied/)
    await db.exec('BEGIN')
    await save('alice','Rolled back')
    await db.exec('ROLLBACK')
    assert.equal((await revisions()).length,2)
    assert.equal((await db.query<{raw_text:string}>('SELECT raw_text FROM folup_notes WHERE user_id=$1',['alice'])).rows[0].raw_text,'Correction')
    await save('alice','Original',initial)
    rows=await revisions()
    assert.equal(rows.length,3,'returning to old content is a new change, not a retry')
    assert.equal(rows[2].parent_revision_id,rows[1].revision_id)
    await db.exec('RESET ROLE')
    for(const role of ['anon','authenticated']){
      await db.exec(`SET ROLE ${role}`)
      await assert.rejects(()=>db.exec('SELECT * FROM folup_note_revisions'),/permission denied/)
      await assert.rejects(()=>db.exec('SELECT capture_folup_note_revision()'),/permission denied/)
      await db.exec('RESET ROLE')
    }
    // A revision failure must roll back the visible snapshot as well.
    await db.exec(`ALTER TABLE folup_note_revisions ADD CONSTRAINT test_failure CHECK(raw_text <> 'Fail')`)
    await assert.rejects(()=>save('alice','Fail'),/test_failure/)
    assert.equal((await revisions()).length,3)
    assert.equal((await db.query<{raw_text:string}>("SELECT raw_text FROM folup_notes WHERE user_id='alice'")).rows[0].raw_text,'Original')
    await db.exec('SET ROLE service_role')
    await db.query('DELETE FROM folup_notes WHERE user_id=$1',['alice'])
    assert.equal((await revisions()).length,0,'deleting a note also deletes its private history')
    assert.equal((await revisions('bob')).length,1,'another owner is unaffected')
    await db.exec('RESET ROLE')
  } finally {await db.close()}
})
