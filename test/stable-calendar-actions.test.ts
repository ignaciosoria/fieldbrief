import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
import {sameActionSnapshot} from '../lib/calendarActionState'
import {googleEventPayload,parseCalendarSaveInput,saveGoogleCalendarEvent,type CalendarSaveInput} from '../lib/googleCalendarEvent'

const note='12345678-1234-4123-8123-123456789abc'
const a={type:'call',contact:'Mike',company:'Valley',description:'Check Q7 trial',object:'',subject:'Q7 trial',date:'2026-09-29',time:'09:00'}
const b={...a,contact:'Laura',company:'Alba'}
test('stable action registry, migration, reservations and owner isolation',async()=>{
 const db=new PGlite()
 try {
  await db.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE TABLE notes(id int);CREATE TABLE subscriptions(id int);')
  await db.exec(await readFile('supabase/migrations/20260911000200_private_notes.sql','utf8'))
  const save=async(actions:unknown[],owner='alice')=>db.query(`INSERT INTO folup_notes(user_id,id,raw_text,structured_output) VALUES($1,$2,'test',$3)
    ON CONFLICT(user_id,id) DO UPDATE SET structured_output=excluded.structured_output`,[owner,note,JSON.stringify({extraction:{actions}})])
  await save([a,b])
  await db.exec(await readFile('supabase/migrations/20260925000100_note_revisions.sql','utf8'))
  await db.exec(await readFile('supabase/migrations/20260925000200_stable_calendar_actions.sql','utf8'))
  const rows=async(owner='alice')=>(await db.query<{action_id:string;action_index:number;legacy_index:number|null;snapshot:unknown;needs_review:boolean}>(
    'SELECT * FROM folup_actions WHERE user_id=$1 AND note_id=$2 AND active ORDER BY action_index',[owner,note])).rows
  const first=await rows();assert.equal(first.length,2);assert.equal(first[0].legacy_index,0)
  await save([b,a]);const reordered=await rows()
  assert.equal(reordered[0].action_id,first[1].action_id)
  assert.equal(reordered[1].action_id,first[0].action_id)
  assert.equal(reordered[1].legacy_index,0,'legacy Google addressing survives reorder')
  const updated={...a,date:'2026-10-01',time:'15:00'}
  await save([b,updated]);assert.equal((await rows())[1].action_id,first[0].action_id)
  const reserve=async(id:string,snapshot:unknown,draft:unknown,owner='alice')=>(await db.query<{r:Record<string,unknown>}>(
    'SELECT reserve_folup_calendar($1,$2,$3,$4,$5,$6) r',[owner,note,id,JSON.stringify(snapshot),JSON.stringify(draft),'f'+id.replaceAll('-','')])).rows[0].r
  await db.exec('SET ROLE service_role')
  assert.equal((await reserve(first[0].action_id,a,{})).error,'stale')
  const r=await reserve(first[0].action_id,updated,{time:'15:00'})
  assert.equal(r.status,'pending')
  assert.equal((await reserve(first[0].action_id,updated,{time:'15:00'})).event_id,r.event_id)
  assert.equal((await reserve(first[0].action_id,updated,{time:'16:00'})).error,'changed')
  assert.equal((await reserve(first[0].action_id,updated,{},'bob')).error,'stale')
  assert.equal((await db.query<{ok:boolean}>('SELECT confirm_folup_calendar($1,$2,$3,$4,$5) ok',
    ['alice',note,first[0].action_id,r.event_id,'https://calendar.google.com/calendar/event?eid=test'])).rows[0].ok,true)
  const saved=await reserve(first[0].action_id,updated,{time:'15:00'});assert.equal(saved.status,'saved')
  await save([b,{...updated,date:'2026-10-02'}])
  assert.equal((await reserve(first[0].action_id,{...updated,date:'2026-10-02'},{time:'15:00'})).error,'changed')
  await save([b,{...updated,description:'Discuss a different product'}])
  const uncertain=(await rows())[1];assert.notEqual(uncertain.action_id,first[0].action_id)
  assert.equal(uncertain.needs_review,true)
  assert.equal((await reserve(uncertain.action_id,uncertain.snapshot,{})).error,'review')
  await save([a,b],'bob');const fresh=await rows('bob')
  assert.equal(fresh[0].legacy_index,null)
  assert.notEqual(fresh[0].action_id,first[0].action_id)
  await save([a,b],'bob');assert.equal((await rows('bob'))[0].action_id,fresh[0].action_id)
  await save([a,a],'duplicate');const dup=await rows('duplicate')
  assert.notEqual(dup[0].action_id,dup[1].action_id)
  await save([a,a],'duplicate');assert.deepEqual((await rows('duplicate')).map(x=>x.action_id),dup.map(x=>x.action_id))
  await assert.rejects(()=>db.exec('DELETE FROM folup_calendar_links'),/permission denied/)
  await db.query('DELETE FROM folup_notes WHERE user_id=$1',['alice'])
  assert.equal((await db.query("SELECT * FROM folup_calendar_links WHERE user_id='alice'")).rows.length,0)
  assert.equal((await rows('bob')).length,2)
  await db.exec('RESET ROLE')
  for(const role of ['anon','authenticated']){
   await db.exec(`SET ROLE ${role}`)
   await assert.rejects(()=>db.exec('SELECT * FROM folup_actions'),/permission denied/)
   await assert.rejects(()=>db.exec('SELECT * FROM folup_calendar_links'),/permission denied/)
   await assert.rejects(()=>reserve(first[0].action_id,a,{}),/permission denied/)
   await db.exec('RESET ROLE')
  }
 }finally{await db.close()}
})

const input:CalendarSaveInput={noteId:note,actionIndex:0,actionId:'abcdefab-1234-4123-8123-123456789abc',sourceAction:a,
 draft:{title:'Call Mike',details:'Check Q7 trial',date:'2026-09-29',time:'09:00',timezone:'America/Los_Angeles',language:'English'}}
test('event UUID identity is independent of action index; legacy override is server-only',()=>{
 assert.equal(googleEventPayload('alice',input).id,googleEventPayload('alice',{...input,actionIndex:3}).id)
 assert.notEqual(googleEventPayload('alice',input).id,googleEventPayload('bob',input).id)
 const legacy=googleEventPayload('alice',{...input,actionId:undefined}).id
 assert.equal(googleEventPayload('alice',{...input,serverEventId:legacy}).id,legacy)
 assert.equal(parseCalendarSaveInput({...input,serverEventId:'attacker'})?.serverEventId,undefined)
 assert.equal(parseCalendarSaveInput({...input,actionId:'bad'}),null)
 assert.ok(sameActionSnapshot({a:1,b:2},{b:2,a:1}))
 assert.ok(!sameActionSnapshot(a,{...a,date:'2026-10-01'}))
})
test('Google success followed by retry still targets the same UUID event',async()=>{
 const payload=googleEventPayload('alice',input);let calls=0
 const provider:typeof fetch=async(_url,options)=>{
  calls++
  return options?.method==='POST'?Response.json({}, {status:409}):Response.json({...payload,htmlLink:'https://calendar.google.com/calendar/event?eid=test'})
 }
 const r=await saveGoogleCalendarEvent('alice',{...input,actionIndex:7},'mock',provider)
 assert.equal(r.id,payload.id);assert.equal(calls,2)
})
