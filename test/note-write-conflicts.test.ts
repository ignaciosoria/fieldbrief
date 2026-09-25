import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
import {NoteWrites} from '../lib/noteWrites'

test('atomic note writes reject stale edits, deduplicate retries and isolate owners',async()=>{
 const db=new PGlite()
 try{
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
   CREATE TABLE notes(id int);CREATE TABLE subscriptions(id int);
   CREATE FUNCTION public.bind_trial_note(text,text,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;`)
  for(const file of ['20260911000200_private_notes.sql','20260925000100_note_revisions.sql','20260925000200_stable_calendar_actions.sql','20260925000300_note_write_conflicts.sql'])
   await db.exec(await readFile('supabase/migrations/'+file,'utf8'))
  await db.exec('SET ROLE service_role')
  const id=crypto.randomUUID(),create=crypto.randomUUID(),edit=crypto.randomUUID()
  const output={extraction:{actions:[{type:'call',description:'Check trial',date:'2026-10-01'}]}}
  const save=async(request:string,version:number,text='original',owner='alice')=>(await db.query<{r:{saved?:boolean;version?:number;error?:string}}>(
   'SELECT save_folup_note($1,$2,$3,$4,$5,$6) r',[owner,id,request,version,text,JSON.stringify(output)])).rows[0].r
  assert.equal((await save(create,0)).version,1)
  assert.equal((await save(create,0)).version,1)
  assert.equal((await save(crypto.randomUUID(),0)).error,'conflict','competing create cannot replace note')
  const action=(await db.query<{action_id:string}>('SELECT action_id FROM folup_actions')).rows[0].action_id
  assert.equal((await save(edit,1,'corrected')).version,2)
  assert.equal((await save(edit,1,'corrected')).version,2,'lost response retry')
  assert.equal((await save(crypto.randomUUID(),1,'stale tab')).error,'conflict')
  assert.equal((await save(create,0)).error,'conflict','delayed old retry cannot publish stale content')
  assert.equal((await save(edit,1,'different payload')).error,'request_reused')
  assert.equal((await save(crypto.randomUUID(),2,'foreign','bob')).error,'conflict')
  assert.equal((await save(create,0,'bob note','bob')).version,1)
  assert.equal((await db.query<{raw_text:string}>("SELECT raw_text FROM folup_notes WHERE user_id='alice'")).rows[0].raw_text,'corrected')
  assert.equal((await db.query<{n:number}>("SELECT count(*)::int n FROM folup_note_revisions WHERE user_id='alice'")).rows[0].n,2)
  assert.equal((await db.query<{action_id:string}>("SELECT action_id FROM folup_actions WHERE user_id='alice' AND active")).rows[0].action_id,action)
  await assert.rejects(()=>db.exec("UPDATE folup_notes SET raw_text='bypass'"),/permission denied/)
  await assert.rejects(()=>db.exec('SELECT * FROM folup_note_writes'),/permission denied/)
  await db.query("DELETE FROM folup_notes WHERE user_id='alice' AND id=$1",[id])
  assert.equal((await save(edit,1,'corrected')).error,'conflict','correction cannot resurrect deleted note')
  await db.exec('RESET ROLE')
  assert.equal((await db.query<{n:number}>("SELECT count(*)::int n FROM folup_note_writes WHERE user_id='alice'")).rows[0].n,0)
  for(const role of ['anon','authenticated']){
   await db.exec('SET ROLE '+role)
   await assert.rejects(()=>save(crypto.randomUUID(),0),/permission denied/)
   await db.exec('RESET ROLE')
  }
 }finally{await db.close()}
})

test('pending writes retain payload and request ID across timeout, and coalesce double clicks',async()=>{
 const writes=new NoteWrites<{text:string}>(), id=crypto.randomUUID()
 let attempts=0;const requests:string[]=[]
 const send=async(note:{requestId:string})=>{requests.push(note.requestId);if(++attempts===1)throw Error('timeout');return {version:2}}
 await assert.rejects(()=>writes.save('alice',id,{text:'correction'},'corrected transcript',1,send),/timeout/)
 assert.equal(writes.get('alice',id)?.transcript,'corrected transcript')
 assert.equal(writes.get('bob',id),undefined)
 await assert.rejects(()=>writes.save('alice',id,{text:'different'},'other',2,send),/still waiting/)
 const first=writes.save('alice',id,{text:'correction'},'corrected transcript',99,send)
 const second=writes.save('alice',id,{text:'correction'},'corrected transcript',99,send)
 assert.equal(first,second)
 assert.equal((await first).note.expectedVersion,1,'retry never rebases automatically')
 assert.equal(requests[0],requests[1]);assert.equal(attempts,2)
 assert.equal(writes.get('alice',id),undefined)
})

test('conflicts and unreadable success retain the correction, not the visible old note',async()=>{
 const writes=new NoteWrites<object>(),id=crypto.randomUUID()
 await assert.rejects(()=>writes.save('alice',id,{corrected:true},'new transcript',1,async()=>{throw Error('conflict')}),/conflict/)
 const pending=writes.get('alice',id)!
 assert.equal(pending.transcript,'new transcript')
 await assert.rejects(()=>writes.save('alice',id,pending.result,pending.transcript,pending.expectedVersion,async()=>({version:NaN})),/confirmed/)
 assert.equal(writes.get('alice',id)?.requestId,pending.requestId)
})
