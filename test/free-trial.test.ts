import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {PGlite} from '@electric-sql/pglite'
import {runTrialStructure} from '../lib/trialStructure'
import {trialMessage} from '../lib/trialPresentation'

test('14-day trial starts only on completion, caps at 100, is isolated and preserves paid access',async()=>{
  const db=new PGlite()
  try {
    await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
      CREATE TABLE subscriptions(user_id text PRIMARY KEY,stripe_customer_id text,stripe_subscription_id text,status text);`)
    for(const file of ['20260911000100_ai_usage_limits.sql','20260911000300_subscription_sync.sql','20260924000100_complimentary_access.sql','20260924000300_first_note_trial.sql']) await db.exec(await readFile(`supabase/migrations/${file}`,'utf8'))
    const status=async(email='free@test.invalid')=>(await db.query<{s:{active:boolean;startedAt:string|null;endsAt:string|null;ended:boolean}}>('SELECT get_trial_status($1) AS s',[email])).rows[0].s
    const reserve=async(email='free@test.invalid',operation='structure')=>(await db.query<{s:string}>('SELECT reserve_ai_usage($1,$2) AS s',[email,operation])).rows[0].s
    const begin=async(key:string,token:string,email='free@test.invalid')=>(await db.query<{s:string}>('SELECT begin_trial_note($1,$2,$3) AS s',[email,key.padStart(64,'0'),token])).rows[0].s
    const finish=async(key:string,token:string,success:boolean,email='free@test.invalid')=>(await db.query<{s:boolean}>('SELECT finish_trial_note($1,$2,$3,$4) AS s',[email,key.padStart(64,'0'),token,success])).rows[0].s
    assert.equal((await status()).startedAt,null)
    assert.equal(await reserve(undefined,'transcribe'),'allowed')
    assert.equal((await status()).startedAt,null,'ASR does not start trial')
    const failed=randomUUID();assert.equal(await begin('failed',failed),'reserved')
    assert.equal(await finish('failed',failed,false),true)
    assert.equal((await status()).startedAt,null,'failed extraction does not start trial')
    const token=randomUUID();assert.equal(await begin('one',token),'reserved')
    assert.equal(await begin('one',randomUUID()),'busy')
    assert.equal(await finish('one',randomUUID(),true),false,'another request cannot complete the lease')
    assert.equal(await finish('one',token,true),true)
    const first=await status();assert.ok(first.startedAt)
    assert.equal(Date.parse(first.endsAt!)-Date.parse(first.startedAt!),14*86400000)
    assert.equal(await finish('one',token,true),true,'completion is idempotent')
    assert.equal(await begin('one',randomUUID()),'completed')
    const savedId=randomUUID()
    const bind=async(key:string,id:string,email='free@test.invalid')=>(await db.query<{s:boolean}>('SELECT bind_trial_note($1,$2,$3) AS s',[email,key.padStart(64,'0'),id])).rows[0].s
    assert.equal(await bind('one',savedId),true)
    assert.equal(await bind('one',savedId),true)
    assert.equal(await bind('one',randomUUID()),false,'cannot reuse one completion to save another note')
    assert.equal(await bind('one',savedId,'attacker@test.invalid'),false)
    assert.equal(await bind('invented',randomUUID()),false)
    assert.equal((await db.query<{s:string}>('SELECT trial_key_for_saved_note($1,$2) AS s',['free@test.invalid',savedId])).rows[0].s,'one'.padStart(64,'0'))
    for(let n=2;n<=99;n++){const token=randomUUID();assert.equal(await begin(String(n),token),'reserved');assert.equal(await finish(String(n),token,true),true)}
    const last=randomUUID();assert.equal(await begin('last',last),'reserved')
    assert.equal(await begin('overflow',randomUUID()),'busy','in-flight notes reserve capacity')
    assert.equal(await finish('last',last,true),true)
    assert.equal(await begin('101',randomUUID()),'quota_exceeded')
    assert.equal(await reserve(),'quota_exceeded')
    assert.equal(await reserve(undefined,'transcribe'),'quota_exceeded')
    assert.equal((await status()).ended,true)
    assert.equal((await status()).startedAt,first.startedAt)
    assert.equal((await status('other@test.invalid')).ended,false)
    assert.equal((await status('other@test.invalid')).startedAt,null)
    await db.exec("INSERT INTO ai_usage(user_id,trial_started_at,trial_notes) VALUES('expired@test.invalid',now()-interval '14 days',1)")
    assert.equal(await reserve('expired@test.invalid'),'quota_exceeded')
    await db.exec("INSERT INTO complimentary_access(user_id) VALUES('free@test.invalid')")
    assert.equal(await reserve(),'allowed');assert.equal(await begin('owner',randomUUID()),'unlimited')
    assert.equal((await status()).active,true)
    await db.exec("INSERT INTO subscriptions(user_id,status,paid_until) VALUES('expired@test.invalid','active',now()+interval '1 day')")
    assert.equal(await reserve('expired@test.invalid'),'allowed')
    await db.exec("UPDATE subscriptions SET paid_until=now()-interval '1 second'")
    assert.equal(await reserve('expired@test.invalid'),'quota_exceeded','expired payment is not Pro')
    await db.exec("INSERT INTO ai_usage(user_id,day_count) VALUES('abuse@test.invalid',600)")
    assert.equal(await reserve('abuse@test.invalid','transcribe'),'rate_limited')
    for(const role of ['anon','authenticated']){
      await db.exec(`SET ROLE ${role}`)
      await assert.rejects(()=>begin('attack',randomUUID()),/permission denied/)
      await assert.rejects(()=>finish('one',token,true),/permission denied/)
      await assert.rejects(()=>status(),/permission denied/)
      await assert.rejects(()=>bind('one',savedId),/permission denied/)
      await assert.rejects(()=>db.query('SELECT * FROM trial_note_reservations'),/permission denied/)
      await db.exec('RESET ROLE')
    }
  }finally{await db.close()}
})

test('failed models release reservations; blocked requests never call a paid API',async()=>{
  let calls=0;const finishes:boolean[]=[]
  for(const state of ['quota_exceeded','busy'] as const){
    const result=await runTrialStructure({begin:async()=>state,finish:async()=>true,extract:async()=>{calls++;return 'output'}})
    assert.ok(result instanceof Response);assert.equal(result.status,state==='busy'?429:403)
  }
  assert.equal(calls,0)
  await assert.rejects(()=>runTrialStructure({begin:async()=>'reserved',finish:async success=>{finishes.push(success);return true},extract:async()=>{throw Error('provider failed')}}))
  assert.deepEqual(finishes,[false])
  const result=await runTrialStructure({begin:async()=>'reserved',finish:async success=>{finishes.push(success);return true},extract:async()=>({note:'valid'})})
  assert.deepEqual(result,{note:'valid'});assert.deepEqual(finishes,[false,true])
  await assert.rejects(()=>runTrialStructure({begin:async()=>'reserved',finish:async()=>false,extract:async()=>({note:'not released'})}))
})

test('trial messages are quiet until day 12, never show credits, and preserve export messaging',()=>{
  const start=Date.parse('2026-09-01T12:00:00Z'),end=start+14*86400000
  const trial={startedAt:new Date(start).toISOString(),endsAt:new Date(end).toISOString(),ended:false}
  assert.match(trialMessage({startedAt:null,endsAt:null,ended:false})!,/No card needed/)
  assert.equal(trialMessage(trial,start+10*86400000),null)
  assert.match(trialMessage(trial,start+11*86400000)!,/3 days/)
  assert.match(trialMessage(trial,start+12*86400000)!,/2 days/)
  assert.match(trialMessage(trial,end)!,/saved notes and exports/)
  assert.match(trialMessage({...trial,ended:true},start)!,/ended/)
})
