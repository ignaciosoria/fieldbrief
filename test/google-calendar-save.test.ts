import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
import {sealCalendarToken,openCalendarToken} from '../lib/calendarTokenCrypto'
import {GOOGLE_CALENDAR_SCOPE,hasCalendarScope} from '../lib/googleCalendarScope'
import {CalendarConnectionRequired} from '../lib/googleCalendarConnection'
import {googleEventPayload,parseCalendarSaveInput,saveGoogleCalendarEvent,type CalendarSaveInput} from '../lib/googleCalendarEvent'
import {handleCalendarSave} from '../lib/calendarSaveHandler'
import {saveCalendarFromClient,calendarEventLink} from '../lib/calendarSaveClient'

const email='owner@example.test'
const input:CalendarSaveInput={noteId:'12345678-1234-4123-8123-123456789abc',actionIndex:0,
  draft:{title:'Enviar oferta a Jeremy',details:'Farmers Fertilizer\n\nEnviar la oferta de Promars Ferro a Jeremy para revisión, sin precios nuevos.',date:'2026-09-25',time:'09:00',timezone:'America/Los_Angeles',language:'Spanish'}}
const url='https://calendar.google.com/calendar/event?eid=test'
const json=(value:unknown,status=200)=>Response.json(value,{status})
const confirmed=()=>({...googleEventPayload(email,input),status:'confirmed',htmlLink:url})

test('exact reviewed fields, time zone, 30-minute duration and stable per-user id; no guests',()=>{
  const p=googleEventPayload(email,input)
  assert.equal(p.summary,input.draft.title);assert.equal(p.description,input.draft.details)
  assert.equal(p.start.dateTime,'2026-09-25T09:00:00.000-07:00')
  assert.equal(p.end.dateTime,'2026-09-25T09:30:00.000-07:00')
  assert.equal(p.start.timeZone,input.draft.timezone)
  assert.match(p.id,/^[a-v0-9]{65}$/)
  assert.equal(googleEventPayload(email,{...input,draft:{...input.draft,date:'2026-09-26'}}).id,p.id)
  assert.notEqual(googleEventPayload('another@example.test',input).id,p.id)
  assert.notEqual(googleEventPayload(email,{...input,actionIndex:1}).id,p.id)
  assert.ok(!('attendees' in p));assert.ok(!('conferenceData' in p))
})
test('strict input rejects malformed timing, DST gaps/ambiguity and arbitrary client fields',()=>{
  assert.deepEqual(parseCalendarSaveInput({...input,attendees:['outsider'],calendarId:'someone-else',user_id:'other'}),input)
  for(const patch of [{date:''},{time:''},{date:'2026-02-30'},{time:'25:00'},{timezone:'bad-zone'},{date:'2026-03-08',time:'02:30'},{date:'2026-11-01',time:'01:30'},{title:''},{details:'x'.repeat(8001)}])
    assert.equal(parseCalendarSaveInput({...input,draft:{...input.draft,...patch}}),null)
  for(const actionIndex of [-1,30,1.5,'0'])assert.equal(parseCalendarSaveInput({...input,actionIndex}),null)
})
test('provider gets exact payload and success requires a verified response',async()=>{
  const fetcher:typeof fetch=async(endpoint,options)=>{
    assert.equal(String(endpoint),'https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=none')
    assert.equal(options?.method,'POST');assert.deepEqual(JSON.parse(String(options?.body)),googleEventPayload(email,input))
    return json(confirmed())
  }
  assert.deepEqual(await saveGoogleCalendarEvent(email,input,'test-token',fetcher),{saved:true,id:confirmed().id,url})
})
test('retry after uncertain save uses same id and reads existing event on 409, never a new id',async()=>{
  const calls:string[]=[]
  const fetcher:typeof fetch=async(endpoint,options)=>{
    calls.push(`${options?.method || 'GET'} ${endpoint}`)
    return options?.method==='POST'?json({},409):json(confirmed())
  }
  assert.equal((await saveGoogleCalendarEvent(email,input,'test-token',fetcher)).saved,true)
  assert.equal(calls.length,2);assert.match(calls[1],new RegExp(`/events/${confirmed().id}$`))
})
for(const [name,patch] of [
  ['title',{summary:'Wrong contact'}],['description',{description:'Wrong product'}],
  ['time',{start:{dateTime:'2026-09-25T10:00:00-07:00',timeZone:input.draft.timezone}}],
  ['timezone',{start:{dateTime:confirmed().start.dateTime,timeZone:'UTC'}}],
  ['guests',{attendees:[{email:'unwanted@example.test'}]}],['cancelled',{status:'cancelled'}],
  ['foreign id',{id:'other'}],['missing marker',{extendedProperties:{}}],
] as const)test(`mismatched ${name} is never reported as Added`,async()=>{
  await assert.rejects(()=>saveGoogleCalendarEvent(email,input,'test-token',async()=>json({...confirmed(),...patch})),/different details|mismatch/)
})
test('connection and provider failures do not claim success or silently retry writes',async()=>{
  for(const status of [401,403,429,500]){
    let calls=0
    await assert.rejects(()=>saveGoogleCalendarEvent(email,input,'test-token',async()=>{calls++;return json({},status)}))
    assert.equal(calls,1)
  }
})
test('browser only accepts confirmed saves and safe Google links',async()=>{
  assert.deepEqual(await saveCalendarFromClient(input,async()=>json({saved:true,id:'event',url})),{kind:'saved',url})
  assert.deepEqual(await saveCalendarFromClient(input,async()=>json({code:'CONNECT_CALENDAR'},428)),{kind:'connect'})
  for(const data of [{saved:false,id:'event',url},{saved:true,id:'event',url:'javascript:alert(1)'},{saved:true,url}])
    await assert.rejects(()=>saveCalendarFromClient(input,async()=>json(data)))
  for(const link of ['https://calendar.google.com.attacker.test/calendar','https://evil.test','javascript:alert(1)'])assert.equal(calendarEventLink(link),undefined)
})
const request=(body:unknown=input,origin='https://www.folup.app')=>new Request('https://www.folup.app/api/calendar/events',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)})
test('save endpoint authenticates, binds note ownership and rejects cross-site requests before Google',async()=>{
  let tokenCalls=0,writeCalls=0
  const deps={getEmail:async()=>email,ownsNote:async(owner:string,id:string)=>owner===email&&id===input.noteId,
    getToken:async()=>{tokenCalls++;return 'server-only'},save:async()=>{writeCalls++;return {saved:true}}}
  assert.equal((await handleCalendarSave(request(),{...deps,getEmail:async()=>null})).status,401)
  assert.equal((await handleCalendarSave(request({},'https://attacker.test'),deps)).status,403)
  assert.equal((await handleCalendarSave(request({}),deps)).status,400)
  assert.equal((await handleCalendarSave(request(),{...deps,ownsNote:async()=>false})).status,404)
  assert.equal(tokenCalls,0);assert.equal(writeCalls,0)
  assert.equal((await handleCalendarSave(request(),{...deps,getToken:async()=>{throw new CalendarConnectionRequired()}})).status,428)
  assert.equal((await handleCalendarSave(request(),deps)).status,200)
  assert.equal(tokenCalls,1);assert.equal(writeCalls,1)
})
test('secrets never leak on errors and oversized request bodies never reach Google',async()=>{
  const deps={getEmail:async()=>email,ownsNote:async()=>true,getToken:async()=>{throw Error('secret-token-value')},save:async()=>{throw Error('Must not write')}}
  const response=await handleCalendarSave(request(),deps)
  assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/secret-token-value/)
  assert.equal((await handleCalendarSave(request({big:'x'.repeat(33000)}),deps)).status,413)
})
test('Google tokens are authenticated-encrypted, randomized and identity-bound',()=>{
  const secret='a-secret-only-on-the-server',identity='google:owner@example.test:subject1'
  const encrypted=sealCalendarToken('refresh-token',identity,secret)
  assert.doesNotMatch(encrypted,/refresh-token/)
  assert.equal(openCalendarToken(encrypted,identity,secret),'refresh-token')
  assert.notEqual(sealCalendarToken('refresh-token',identity,secret),encrypted)
  assert.throws(()=>openCalendarToken(encrypted,'google:other@example.test:subject1',secret))
  assert.throws(()=>openCalendarToken(encrypted,identity,'a-different-secret-key'))
  assert.throws(()=>openCalendarToken(encrypted.slice(0,-4)+'aaaa',identity,secret))
  assert.equal(hasCalendarScope('openid email profile'),false)
  assert.equal(hasCalendarScope(`openid ${GOOGLE_CALENDAR_SCOPE}`),true)
})
test('calendar connections are completely private to the server role',async()=>{
  const db=new PGlite()
  try{
    await db.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;')
    await db.exec(await readFile('supabase/migrations/20260924000200_google_calendar_connections.sql','utf8'))
    for(const role of ['anon','authenticated']){
      await db.exec(`SET ROLE ${role}`)
      await assert.rejects(()=>db.query('SELECT * FROM google_calendar_connections'),/permission denied/)
      await assert.rejects(()=>db.query("INSERT INTO google_calendar_connections(user_id,google_subject,access_encrypted,scope,expires_at) VALUES ('attacker@example.test','s','cipher','scope',now())"),/permission denied/)
      await db.exec('RESET ROLE')
    }
    await db.exec('SET ROLE service_role')
    await db.exec("INSERT INTO google_calendar_connections(user_id,google_subject,access_encrypted,scope,expires_at) VALUES ('owner@example.test','s','cipher','scope',now())")
    assert.equal((await db.query('SELECT * FROM google_calendar_connections')).rows.length,1)
  }finally{await db.close()}
})
