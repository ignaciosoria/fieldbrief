import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { parseNoteInput } from '../lib/noteInput'

test('note validation never accepts client ownership', () => {
  const row = parseNoteInput({id:'12345678-1234-1234-1234-123456789abc',transcript:'Hi',result:{},user_id:'victim'})
  assert.ok(row)
  assert.equal('user_id' in row, false)
  assert.equal(parseNoteInput({id:'bad',transcript:'Hi',result:{}}),null)
})

test('notes tables are private and ids cannot collide across owners', async () => {
  const db = new PGlite()
  try {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE TABLE notes(id int); CREATE TABLE subscriptions(id int);')
    await db.exec(await readFile('supabase/migrations/20260911000200_private_notes.sql','utf8'))
    await db.exec(`INSERT INTO folup_notes(user_id,id,raw_text,structured_output) VALUES
      ('alice','12345678-1234-1234-1234-123456789abc','Alice','{}'),
      ('bob','12345678-1234-1234-1234-123456789abc','Bob','{}');`)
    const {rows} = await db.query("SELECT raw_text FROM folup_notes WHERE user_id='alice'")
    assert.deepEqual(rows,[{raw_text:'Alice'}])
    for(const role of ['anon','authenticated']) {
      await db.exec(`SET ROLE ${role}`)
      for(const table of ['notes','subscriptions','folup_notes']) await assert.rejects(()=>db.query(`SELECT * FROM ${table}`),/permission denied/)
      await db.exec('RESET ROLE')
    }
  } finally { await db.close() }
})
