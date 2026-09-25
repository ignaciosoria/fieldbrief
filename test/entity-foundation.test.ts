import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'

test('private entity foundation preserves evidence without guessing identity or affiliation',async()=>{
 const db=new PGlite()
 try{
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
   CREATE TABLE notes(id int);CREATE TABLE subscriptions(id int);
   CREATE FUNCTION public.bind_trial_note(text,text,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;`)
  for(const name of ['20260911000200_private_notes.sql','20260925000100_note_revisions.sql','20260925000200_stable_calendar_actions.sql','20260925000300_note_write_conflicts.sql'])
   await db.exec(await readFile('supabase/migrations/'+name,'utf8'))
  const visit=(contacts:string[],companies:string[],extra:object={})=>({extraction:{contacts,companies,summary:'David is the PCA. Helena offered lower prices.',actions:[],questions:[],...extra}})
  const save=async(id:string,version:number,output:object,owner='alice')=>(await db.query<{r:{version:number}}>(
   'SELECT save_folup_note($1,$2,$3,$4,$5,$6) r',[owner,id,crypto.randomUUID(),version,'Synthetic visit',JSON.stringify(output)])).rows[0].r.version
  const first=crypto.randomUUID(),second=crypto.randomUUID(),third=crypto.randomUUID()
  await save(first,0,visit(['Mike'],['Valley Growers']))
  const before=JSON.stringify((await db.query('SELECT * FROM folup_notes')).rows)
  await db.exec(await readFile('supabase/migrations/20260925000400_entity_foundation.sql','utf8'))
  assert.equal(JSON.stringify((await db.query('SELECT * FROM folup_notes')).rows),before,'backfill never rewrites original notes')
  await db.exec('SET ROLE service_role')
  type Mention={mention_id:string;entity_id:string|null;label:string;kind:string;source:string;company_context:string;uncertain:boolean;revision_id:string}
  const mentions=async(id:string,owner='alice')=>(await db.query<Mention>(
   'SELECT * FROM folup_entity_mentions WHERE user_id=$1 AND note_id=$2 ORDER BY label',[owner,id])).rows
  const confirm=async(mention:string,target:string|null=null,owner='alice')=>(await db.query<{r:{entityId?:string;error?:string}}>(
   'SELECT confirm_folup_entity($1,$2,$3) r',[owner,mention,target])).rows[0].r
  const candidates=async(mention:string,owner='alice')=>(await db.query<{entity_id:string;label:string}>(
   'SELECT * FROM folup_entity_candidates($1,$2)',[owner,mention])).rows
  const initial=await mentions(first)
  assert.equal(initial.length,2)
  assert.ok(initial.every(m=>m.entity_id===null))
  assert.ok(!initial.some(m=>['David','Helena'].includes(m.label)),'context-only names are not promoted')
  const mike=initial.find(m=>m.kind==='contact')!,valley=initial.find(m=>m.kind==='company')!
  const mikeId=(await confirm(mike.mention_id)).entityId!
  const valleyId=(await confirm(valley.mention_id)).entityId!
  assert.equal((await confirm(mike.mention_id)).entityId,mikeId,'confirmation retry keeps UUID')
  assert.equal((await confirm(mike.mention_id,null,'bob')).error,'missing')
  await save(second,0,visit(['Mike'],['Another Farm']))
  const otherMike=(await mentions(second)).find(m=>m.kind==='contact')!
  assert.equal(otherMike.entity_id,null,'even a unique exact name must not silently merge across companies')
  assert.equal((await candidates(otherMike.mention_id)).length,1)
  const otherId=(await confirm(otherMike.mention_id)).entityId!
  assert.notEqual(otherId,mikeId,'homonyms can have independent canonical IDs')
  await save(third,0,visit(['  MIKE  '],['Valley Growers Inc.']))
  const thirdMentions=await mentions(third),alias=thirdMentions.find(m=>m.kind==='company')!,again=thirdMentions.find(m=>m.kind==='contact')!
  assert.equal((await candidates(again.mention_id)).length,2,'multiple exact candidates remain ambiguous')
  assert.equal((await candidates(alias.mention_id)).length,0,'no automatic legal suffix stripping')
  assert.equal((await confirm(alias.mention_id,mikeId)).error,'invalid_target','cross-kind links forbidden')
  assert.equal((await confirm(alias.mention_id,valleyId)).entityId,valleyId,'explicit alias confirmation allowed')
  assert.equal((await confirm(again.mention_id,mikeId)).entityId,mikeId)
  const fourth=crypto.randomUUID()
  await save(fourth,0,visit([],['Valley Growers Inc.']))
  const aliasAgain=(await mentions(fourth))[0]
  assert.equal((await candidates(aliasAgain.mention_id))[0].entity_id,valleyId)
  assert.equal(aliasAgain.entity_id,null,'confirmed spelling is a candidate, not proof of this encounter identity')

  const uncertain=crypto.randomUUID()
  await save(uncertain,0,visit(['Mike'],['Valley'],{questions:[{field:'contact',action_index:-1,question:'Which Mike?'}],actions:[{contact:'David',company:'Valley',evidence:'Ask David about approval',origin:'recommendation'}]}))
  const unclear=(await mentions(uncertain)).find(m=>m.label==='Mike')!
  assert.equal((await confirm(unclear.mention_id,mikeId)).error,'uncertain')
  assert.deepEqual(await candidates(unclear.mention_id),[])
  const advisor=(await mentions(uncertain)).find(m=>m.label==='David')!
  assert.equal(advisor.source,'action');assert.equal(advisor.company_context,'Valley')
  assert.equal(advisor.entity_id,null,'action context never establishes employment or attendance')

  await save(first,1,visit(['Michael'],['Valley Growers']))
  const corrected=await mentions(first)
  assert.equal(corrected.length,4,'revision evidence retained')
  assert.equal(corrected.find(m=>m.label==='Michael')?.entity_id,null,'name correction is not an automatic merge')
  assert.equal((await confirm(mike.mention_id,mikeId)).error,'stale')
  const count=corrected.length
  await save(first,2,visit(['Michael'],['Valley Growers']))
  assert.equal((await mentions(first)).length,count,'unchanged output does not duplicate mention snapshots')
  await save(first,0,visit(['Mike'],['Valley Growers']),'bob')
  assert.deepEqual(await candidates((await mentions(first,'bob'))[0].mention_id,'bob'),[])
  const legacy=crypto.randomUUID()
  await save(legacy,0,{contact:'Legacy Mike',customer:'Valley',crmText:'Old format'})
  assert.deepEqual(await mentions(legacy),[],'legacy display strings do not become canonical evidence')
  const relational=crypto.randomUUID()
  await save(relational,0,visit(["Mike's father",'Mike'],['Valley','Another Farm']))
  assert.ok((await mentions(relational)).filter(m=>m.kind==='contact').every(m=>m.company_context==='' && m.entity_id===null),'parallel header lists are never zipped into affiliations')
  assert.deepEqual(await candidates((await mentions(relational)).find(m=>m.label==="Mike's father")!.mention_id),[],'father is never resolved to the named son')
  const malformed=crypto.randomUUID()
  await save(malformed,0,{extraction:{contacts:[null,{},'',42],companies:null,questions:{},actions:[]}})
  assert.deepEqual(await mentions(malformed),[],'malformed optional legacy fields do not block note saves')
  await assert.rejects(()=>db.exec("UPDATE folup_entity_mentions SET entity_id=NULL"),/permission denied/)
  await assert.rejects(()=>db.exec("INSERT INTO folup_entities(user_id,kind,label) VALUES('alice','contact','Fake')"),/permission denied/)
  await db.query("DELETE FROM folup_notes WHERE user_id='alice'")
  assert.equal((await db.query<{n:number}>("SELECT count(*)::int n FROM folup_entities WHERE user_id='alice'")).rows[0].n,0,'last supporting note deletion removes orphan identities')
  assert.equal((await mentions(first,'bob')).length,2)
  await db.exec('RESET ROLE')
  for(const role of ['anon','authenticated']){
   await db.exec('SET ROLE '+role)
   await assert.rejects(()=>db.exec('SELECT * FROM folup_entities'),/permission denied/)
   await assert.rejects(()=>db.exec('SELECT * FROM folup_entity_mentions'),/permission denied/)
   await assert.rejects(()=>confirm(mike.mention_id),/permission denied/)
   await assert.rejects(()=>candidates(mike.mention_id),/permission denied/)
   await db.exec('RESET ROLE')
  }
 }finally{await db.close()}
})
