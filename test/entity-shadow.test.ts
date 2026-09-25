import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'

test('shadow matching: conservative suggestions, provenance, abstention and no real links',async()=>{
 const db=new PGlite()
 try{
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
   CREATE TABLE notes(id int);CREATE TABLE subscriptions(id int);
   CREATE FUNCTION public.bind_trial_note(text,text,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;`)
  for(const name of ['20260911000200_private_notes.sql','20260925000100_note_revisions.sql','20260925000200_stable_calendar_actions.sql','20260925000300_note_write_conflicts.sql','20260925000400_entity_foundation.sql','20260925000500_entity_shadow.sql'])
   await db.exec(await readFile('supabase/migrations/'+name,'utf8'))
  let sequence=0
  type Input={name?:string;company?:string;owner?:string;raw?:string;uncertain?:boolean;origin?:string;headerOnly?:boolean;repeat?:boolean}
  const save=async({name='Mike',company='Valley',owner='alice',raw,uncertain=false,origin='commitment',headerOnly=false,repeat=false}:Input={})=>{
   const id=crypto.randomUUID(),action={contact:name,company,origin,evidence:`Call ${name}`,type:'call',description:'Discuss trial'}
   const result={extraction:{contacts:[name],companies:company?[company]:[],actions:headerOnly?[]:repeat?[action,action]:[action],questions:uncertain?[{field:'contact',action_index:-1,question:'Which person?'}]:[]}}
   await db.query('SELECT save_folup_note($1,$2,$3,0,$4,$5)',[owner,id,crypto.randomUUID(),raw??`Call ${name} about ${company}.`,JSON.stringify(result)])
   await db.query("UPDATE folup_notes SET created_at='2026-01-01'::timestamptz + $1::int * interval '1 second' WHERE user_id=$2 AND id=$3",[++sequence,owner,id])
   return {id,owner,result}
  }
  const run=async(n:{id:string;owner:string})=>(await db.query<{n:number}>('SELECT evaluate_folup_entity_shadow($1,$2) n',[n.owner,n.id])).rows[0].n
  const decisions=async(n:{id:string;owner:string})=>(await db.query<{decision:string;reason:string;candidate_count:number;source:string;kind:string}>(
   'SELECT s.*,m.source,m.kind FROM folup_entity_shadow s JOIN folup_entity_mentions m USING(user_id,mention_id) WHERE m.user_id=$1 AND m.note_id=$2',[n.owner,n.id])).rows
  const reason=async(n:{id:string;owner:string})=>{await run(n);return (await decisions(n)).find(r=>r.source==='action'&&r.kind==='contact')?.reason}
  await save({repeat:true})
  const next=await save({name:' MIKE ',company:'Valley'})
  const before=JSON.stringify((await db.query('SELECT * FROM folup_notes ORDER BY id')).rows)
  assert.equal(await reason(next),'exact_name_same_action_context')
  assert.equal((await decisions(next)).find(r=>r.source==='action'&&r.kind==='contact')?.candidate_count,1,'repeated tasks/header count as one prior visit')
  assert.equal(await run(next),0,'retry does not duplicate evaluations')
  assert.equal(JSON.stringify((await db.query('SELECT * FROM folup_notes ORDER BY id')).rows),before)
  assert.equal((await db.query<{n:number}>('SELECT count(*)::int n FROM folup_entities')).rows[0].n,0)
  assert.equal((await db.query<{n:number}>('SELECT count(*)::int n FROM folup_entity_mentions WHERE entity_id IS NOT NULL')).rows[0].n,0)
  assert.equal(await reason(await save({company:'Other Farm'})),'conflicting_or_missing_company_context','company change is not proof of same person')
  assert.equal(await reason(await save({company:''})),'name_without_company_context')
  assert.equal(await reason(await save({uncertain:true})),'uncertain_identity')
  assert.equal(await reason(await save({origin:'recommendation'})),'recommendation_not_identity_evidence')
  assert.equal(await reason(await save({name:'Ann',raw:'Call Joanne at Valley.'})),'name_not_literal_in_source','substring names are not source evidence')
  assert.equal(await reason(await save({name:"Mike's father"})),'relational_or_role_identity')
  assert.equal(await reason(await save({owner:'bob'})),'no_exact_history','never search another user')
  const only=await save({headerOnly:true});await run(only)
  assert.equal((await decisions(only)).find(r=>r.kind==='contact')?.reason,'name_without_company_context','parallel header lists do not establish affiliation')
  await save({name:'David',company:'Alba',raw:'David is an independent advisor. Ask David about Alba.'})
  assert.equal(await reason(await save({name:'David',company:'North',raw:'David advises multiple farms. Ask David about North.'})),'conflicting_or_missing_company_context','independent advisor is not bound to an employer')
  await save({name:'José'})
  assert.equal(await reason(await save({name:'Jose'})),'no_exact_history','no automatic accent stripping')
  await save({name:'Eva',raw:'Call Eva.',company:'Invented Corp'})
  assert.equal(await reason(await save({name:'Eva',raw:'Call Eva.',company:'Invented Corp'})),'name_without_company_context','model-only company context cannot justify suggestion')
  const old=await save({name:'Roberto'}),future=await save({name:'Roberto'})
  assert.equal(await reason(old),'no_exact_history','future visit cannot leak into historical evaluation')
  await db.query('SELECT save_folup_note($1,$2,$3,1,$4,$5)',[old.owner,old.id,crypto.randomUUID(),'Call Someone Else.',JSON.stringify({extraction:{contacts:['Someone Else'],companies:[],actions:[],questions:[]}})])
  assert.equal(await reason(future),'no_exact_history','superseded candidate names not reused')
  for(let i=0;i<21;i++)await save({name:'Common'})
  assert.equal(await reason(await save({name:'Common'})),'too_many_candidates')
  const empty=await save({name:'New person'});assert.equal(await run({id:empty.id,owner:'wrong-owner'}),0)
  const snapshots=(await db.query<{n:number}>('SELECT count(*)::int n FROM folup_entity_shadow')).rows[0].n
  assert.ok(snapshots>0)
  await db.exec('SET ROLE service_role')
  await assert.rejects(()=>db.exec('UPDATE folup_entity_shadow SET decision=\'review\''),/permission denied/)
  await db.exec("DELETE FROM folup_notes WHERE user_id='alice'")
  assert.equal((await db.query<{n:number}>("SELECT count(*)::int n FROM folup_entity_shadow WHERE user_id='alice'")).rows[0].n,0)
  assert.equal((await db.query<{n:number}>("SELECT count(*)::int n FROM folup_entity_shadow_candidates WHERE user_id='alice'")).rows[0].n,0)
  await db.exec('RESET ROLE')
  for(const role of ['anon','authenticated']){
   await db.exec('SET ROLE '+role)
   await assert.rejects(()=>db.exec('SELECT * FROM folup_entity_shadow'),/permission denied/)
   await assert.rejects(()=>run(next),/permission denied/)
   await db.exec('RESET ROLE')
  }
 }finally{await db.close()}
})
