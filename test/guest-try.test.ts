import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
import {boundedGuestRequest,guestCookieOptions,guestToken,newGuestToken,sameOrigin,tokenHash} from '../lib/guestTryPolicy'

test('guest cookie is opaque, shared only across Folup hosts, and requests are same-origin',async()=>{
 const token=newGuestToken();assert.equal(token.length,64);assert.notEqual(tokenHash(token),token)
 const request=new Request('https://www.folup.app/api/try',{headers:{cookie:'folup_try='+token,origin:'https://www.folup.app'}})
 assert.equal(guestToken(request),token);assert.equal(sameOrigin(request),true)
 assert.equal(sameOrigin(new Request(request.url,{headers:{origin:'https://evil.test'}})),false)
 assert.equal(sameOrigin(new Request(request.url)),false)
 assert.deepEqual(guestCookieOptions(request),{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:2592000,domain:'folup.app'})
 assert.equal(guestCookieOptions(new Request('http://localhost/api/try')).domain,undefined)
 assert.equal(guestToken(new Request(request.url,{headers:{cookie:'folup_try=forged'}})),null)
 const safe=await boundedGuestRequest(new Request(request.url,{method:'POST',body:'{"note":"hello"}'}))
 assert.equal(await safe.text(),'{"note":"hello"}')
 await assert.rejects(()=>boundedGuestRequest(new Request(request.url,{method:'POST',body:'x'.repeat(4_050_001)})),/SIZE/)
})

test('guest SQL enforces quotas, private output, expiry and idempotent owner-only claim',async()=>{
 const db=new PGlite()
 try{
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
   CREATE TABLE notes(id int);CREATE TABLE subscriptions(id int);
   CREATE FUNCTION public.bind_trial_note(text,text,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;`)
  for(const file of ['20260911000200_private_notes.sql','20260925000100_note_revisions.sql','20260925000200_stable_calendar_actions.sql','20260925000300_note_write_conflicts.sql','20261007000100_guest_try.sql'])
   await db.exec(await readFile('supabase/migrations/'+file,'utf8'))
  const token='a'.repeat(64),network='network-a'
  const reserve=async(t=token,n=network)=>(await db.query<{r:string}>('SELECT reserve_guest_visit($1,$2) r',[t,n])).rows[0].r
  const claim=async(email='alice')=>(await db.query<{r:{error?:string;noteId?:string;version?:number}}>('SELECT claim_guest_visit($1,$2) r',[token,email])).rows[0].r
  await db.exec('SET ROLE service_role')
  assert.equal(await reserve(),'allowed')
  assert.equal(await reserve(),'running','concurrent requests must not spend twice')
  await db.query("UPDATE folup_guest_visits SET state='failed' WHERE token_hash=$1",[token])
  assert.equal(await reserve(),'allowed','one failed attempt may retry')
  await db.query("UPDATE folup_guest_visits SET state='failed' WHERE token_hash=$1",[token])
  assert.equal(await reserve(),'used','repeated failures bounded')
  assert.equal(await reserve('b'.repeat(64)),'allowed')
  assert.equal(await reserve('c'.repeat(64)),'limited','IP budget survives cookie resets')
  const output={extraction:{actions:[{type:'call',description:'Check trial',date:'2026-10-12'}]}}
  await db.query("UPDATE folup_guest_visits SET state='ready',raw_text='original recap',output=$2 WHERE token_hash=$1",[token,JSON.stringify(output)])
  assert.equal(await reserve(),'ready','ready result never calls the model again')
  const saved=await claim();assert.ok(saved.noteId);assert.equal(saved.version,1)
  assert.deepEqual(await claim(),saved,'OAuth return/retry must not duplicate note')
  assert.equal((await claim('bob')).error,'unavailable','another account cannot claim it')
  assert.equal((await db.query<{raw_text:string}>("SELECT raw_text FROM folup_notes WHERE user_id='alice'")).rows[0].raw_text,'original recap')
  await db.query("UPDATE folup_guest_visits SET expires_at=now()-interval '1 second' WHERE token_hash=$1",[token])
  assert.equal((await claim()).error,'unavailable')
  assert.equal(await reserve(),'used')
  assert.equal((await db.query<{output:unknown}>('SELECT output FROM folup_guest_visits WHERE token_hash=$1',[token])).rows[0].output,null)
  await db.exec('RESET ROLE')
  await db.exec('UPDATE folup_guest_budget SET attempts=100')
  assert.equal(await reserve('d'.repeat(64),'another-network'),'limited','global cost circuit breaker')
  for(const role of ['anon','authenticated']){
   await db.exec('SET ROLE '+role)
   await assert.rejects(()=>db.exec('SELECT * FROM folup_guest_visits'),/permission denied/)
   await assert.rejects(()=>reserve(),/permission denied/)
   await assert.rejects(()=>claim(),/permission denied/)
   await db.exec('RESET ROLE')
  }
 }finally{await db.close()}
})

test('guest path uses the paid pipeline and real result component, without overriding models',async()=>{
 const route=await readFile('app/api/try/route.ts','utf8')
 assert.match(route,/extractVisitWithResearch\(note,new Date\(\).toISOString\(\),timezone,async\(\)=>true\)/)
 assert.match(route,/transcribeVisitAudio\(client,file,process.env.TRANSCRIPTION_MODEL\)/)
 assert.doesNotMatch(route,/model:|SALES_PROMPT|demoSamples/)
 const page=await readFile('app/try/page.tsx','utf8')
 assert.match(page,/components\/LiveTry/)
 const ui=await readFile('app/components/LiveTry.tsx','utf8')
 assert.match(ui,/<CompactVisitResult/)
 assert.match(ui,/formatProfessionalCrmNote/)
 assert.match(ui,/callbackUrl:'\/try'/)
 assert.doesNotMatch(ui,/track\([^\n]*(?:preview\.note|preview\.result|text\s*[,}])/)
})
