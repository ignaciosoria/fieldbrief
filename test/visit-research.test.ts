import {test} from 'node:test'
import assert from 'node:assert/strict'
import type OpenAI from 'openai'
import {mayRequestResearch,researchCrmText,researchSegments,researchPresentationSegments,type ResearchResult} from '../lib/visitResearch'
import {investigateVisit,configuredResearchModel} from '../lib/visitResearchServer'
import {PGlite} from '@electric-sql/pglite'
import {readFile} from 'node:fs/promises'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import VisitResearch from '../app/components/VisitResearch'

test('English and Spanish research requests pass prefilter; ordinary notes do not',()=>{
 for(const note of ['Investiga sobre eso.','Please research reversion in blackberries','Look up the technical label','Busca información sobre cuajado','Investígame la reversión de color','Averigua por qué','Consulta fuentes sobre eso','Search for university sources'])assert.ok(mayRequestResearch(note))
 for(const note of ['Send the label to Mike','Llamar a Roberto mañana','Blackberry trial was not approved'])assert.equal(mayRequestResearch(note),false)
})
const result:ResearchResult={status:'ready',text:'A finding [1].',citations:[{start:10,end:13,url:'https://extension.example.edu/fruit',title:'Fruit research'}],completedAt:'2026-10-06T00:00:00Z'}
test('presentation removes provider Markdown and duplicate URLs without changing findings',()=>{
 const url='https://extension.example.edu/fruit'
 const marker=`([extension.example.edu](${url}))`
 const source:ResearchResult={...result,text:`A finding ${marker}.`,citations:[{start:10,end:10+marker.length,url,title:'Fruit research'}]}
 assert.equal(researchPresentationSegments(source).map(s=>s.text).join(''),'A finding extension.example.edu.')
 assert.equal(researchCrmText(source,false).split(url).length-1,0)
 assert.equal(source.text,`A finding ${marker}.`)
 assert.equal(researchCrmText(source,false),'\n\nAdditional information\nA finding.')
})
test('CRM research is separate and clean, with evidence preserved internally',()=>{
 assert.equal(researchCrmText(result,true),'\n\nInformación adicional\nA finding.')
 assert.equal(researchCrmText(result,false),'\n\nAdditional information\nA finding.')
 assert.equal(result.citations.length,1)
 assert.equal(researchCrmText(null,false),'')
 assert.equal(researchCrmText({...result,status:'none'},false),'')
})
test('research card uses compact citations and clarification does not pretend to answer',()=>{
 const html=renderToStaticMarkup(createElement(VisitResearch,{research:{eligible:true,state:'ready',result,retry:()=>{}}}))
 assert.match(html,/Additional information/)
 assert.match(html,/href="https:\/\/extension.example.edu\/fruit"/)
 assert.match(html,/>\[1\]<\/a>/)
 assert.doesNotMatch(html,/Research &amp; sources|External research|2026-10-06/)
 assert.equal(researchCrmText({...result,status:'clarify',text:'Which product?',citations:[]},false),'\n\nResearch clarification\nWhich product?')
})
test('citation removal preserves linked factual prose and never mutates stored evidence',()=>{
 const source={...result,text:'Keep this important qualification.',citations:[{...result.citations[0],start:0,end:32}]}
 const before=structuredClone(source)
 assert.match(researchCrmText(source,false),/Keep this important qualification/)
 assert.deepEqual(source,before)
})
test('CRM hides source domain labels even when the citation URL uses a different host',()=>{
 const label='uaex.uada.edu'
 const source={...result,text:`A finding ${label}.`,citations:[{...result.citations[0],start:10,end:10+label.length,url:'https://www.uaex.uada.edu/publications/fruit.pdf'}]}
 assert.equal(researchCrmText(source,false),'\n\nAdditional information\nA finding.')
})
test('home screen installation banner is absent',async()=>{
 assert.doesNotMatch(await readFile('app/page.tsx','utf8'),/Add to home screen:|homeScreenBannerVisible|homeBannerOfferDoneRef/)
})
test('citation rendering ignores script URLs, invalid and overlapping ranges',()=>{
 const segments=researchSegments({...result,citations:[{...result.citations[0],url:'javascript:alert(1)'},{...result.citations[0],start:-1},result.citations[0],result.citations[0]]})
 assert.equal(segments.filter(s=>s.url).length,1)
 assert.equal(segments.map(s=>s.text).join(''),result.text)
})
function fakeClient(plan:unknown,search:unknown){
 const calls:unknown[]=[]
 const client={chat:{completions:{create:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(plan)}}]})}},responses:{create:async(args:unknown)=>{calls.push(args);return search}}} as unknown as OpenAI
 return {client,calls}
}
test('research model selection is restricted and candidate uses reasoning with web search',async()=>{
 assert.equal(configuredResearchModel(''), 'gpt-5.4-mini')
 assert.equal(configuredResearchModel('gpt-4.1-mini'), 'gpt-4.1-mini')
 assert.equal(configuredResearchModel('gpt-6.1-sol'), 'gpt-6.1-sol')
 assert.throws(()=>configuredResearchModel('unknown'),/Unsupported/)
 const f=fakeClient({intent:'research',topic:'blackberry red drupelet reversion',question:''},sourced)
 await investigateVisit('research that','English',f.client,[],'gpt-6.1-sol')
 const args=f.calls[0] as {model:string;reasoning:{effort:string};temperature?:number;max_output_tokens:number;max_tool_calls:number}
 assert.equal(args.model,'gpt-6.1-sol');assert.equal(args.reasoning.effort,'medium')
 assert.equal(args.temperature,undefined);assert.equal(args.max_output_tokens,4000)
 assert.equal(args.max_tool_calls,2)
})
test('instant research uses no reasoning and resolves the visit language before search',async()=>{
 const f=fakeClient({intent:'research',topic:'blackberry red drupelet reversion',question:''},sourced)
 await investigateVisit('research that',Promise.resolve('Spanish'),f.client,Promise.resolve([]),'gpt-5.4-mini')
 const args=f.calls[0] as {reasoning:{effort:string};instructions:string}
 assert.equal(args.reasoning.effort,'none')
 assert.match(args.instructions,/Respond in Spanish/)
 assert.doesNotMatch(args.instructions,/\[object Promise\]/)
})
const sourced={status:'completed',output:[{type:'web_search_call',status:'completed'},{type:'message',content:[{type:'output_text',text:result.text,annotations:[{type:'url_citation',start_index:10,end_index:13,url:result.citations[0].url,title:'Fruit research'}]}]}]}
test('none or ambiguity never invokes web search',async()=>{
 for(const intent of ['none','clarify']){
  const f=fakeClient({intent,topic:'',question:'Is Reversion a symptom or a product?'},null)
  const output=await investigateVisit('Investiga reversion','Spanish',f.client)
  assert.equal(output.status,intent);assert.equal(f.calls.length,0)
 }
})
test('search receives only public topic and must actually execute with citations',async()=>{
 const f=fakeClient({intent:'research',topic:'blackberry red drupelet reversion',question:''},sourced)
 const output=await investigateVisit('Private Customer, credit 9000. Investigate reversion.','English',f.client)
 assert.equal(output.status,'ready')
 assert.doesNotMatch(JSON.stringify(f.calls),/Private Customer|9000/)
 assert.equal((f.calls[0] as {tool_choice:string}).tool_choice,'required')
 for(const bad of [{...sourced,status:'incomplete'},{status:'completed',output:[]},{status:'completed',output:[sourced.output[1]]}]){
  const f=fakeClient({intent:'research',topic:'reversion in blackberries',question:''},bad)
  await assert.rejects(()=>investigateVisit('research that','English',f.client))
 }
})
test('invalid public query is not sent to web',async()=>{
 for(const topic of ['', 'https://private.example.com','customer@email.com','x'.repeat(401)]){
  const f=fakeClient({intent:'research',topic,question:''},sourced)
  await assert.rejects(()=>investigateVisit('research','English',f.client));assert.equal(f.calls.length,0)
 }
})
test('known customer identity in proposed query requires clarification, not search',async()=>{
 const f=fakeClient({intent:'research',topic:'reversion at Private Customer',question:''},sourced)
 assert.equal((await investigateVisit('research that','English',f.client,['Private Customer'])).status,'clarify')
 assert.equal(f.calls.length,0)
})
test('research claim is private, versioned, idempotent, bounded and does not edit notes',async()=>{
 const db=new PGlite()
 try{
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE folup_notes(user_id text,id uuid,version integer,raw_text text,PRIMARY KEY(user_id,id));`)
  await db.exec(await readFile('supabase/migrations/20261006000100_visit_research.sql','utf8'))
  const id=crypto.randomUUID(),token=crypto.randomUUID()
  await db.query('INSERT INTO folup_notes VALUES($1,$2,1,$3)',['alice',id,'original'])
  const claim=async(owner='alice',version=1)=>(await db.query<{ok:boolean}>('SELECT claim_folup_research($1,$2,$3,$4) ok',[owner,id,version,token])).rows[0].ok
  assert.equal(await claim('bob'),false);assert.equal(await claim('alice',2),false)
  assert.equal(await claim(),true);assert.equal(await claim(),false)
  for(let i=0;i<2;i++){await db.exec("UPDATE folup_visit_research SET state='failed'");assert.equal(await claim(),true)}
  await db.exec("UPDATE folup_visit_research SET state='failed'");assert.equal(await claim(),false)
  assert.equal((await db.query<{raw_text:string}>('SELECT raw_text FROM folup_notes')).rows[0].raw_text,'original')
  for(const role of ['anon','authenticated']){
   await db.exec('SET ROLE '+role)
   await assert.rejects(()=>db.exec('SELECT * FROM folup_visit_research'),/permission denied/)
   await assert.rejects(()=>claim(),/permission denied/)
   await db.exec('RESET ROLE')
  }
  await db.exec('DELETE FROM folup_notes')
  assert.equal((await db.query('SELECT * FROM folup_visit_research')).rows.length,0)
 }finally{await db.close()}
})
