import {test} from 'node:test'
import assert from 'node:assert/strict'
import {extractVisitWithResearch} from '../lib/parallelVisit'
import {visitExtractionResult,type VisitExtraction} from '../lib/visitExtraction'
import type {extractVisit} from '../lib/extractVisitServer'
import type {investigateVisit} from '../lib/visitResearchServer'

const extraction:VisitExtraction={language:'English',contacts:['Clara'],companies:['Demo Berry'],location:'',summary:'No order approved.',insights:[],actions:[],questions:[]}
const output=()=>({result:visitExtractionResult(structuredClone(extraction),'2026-10-06T16:00:00Z'),usage:undefined})
test('research starts before extraction completes and receives confirmed identity guard',async()=>{
 let finish!: (value:ReturnType<typeof output>)=>void
 let researchStarted=false
 const extract=(async()=>new Promise(resolve=>{finish=resolve})) as typeof extractVisit
 const research:typeof investigateVisit=async(_note,language,_client,names)=>{
  researchStarted=true
  assert.deepEqual(await names,['Clara','Demo Berry'])
  assert.equal(await language,'English')
  return {status:'ready',text:'Answer',citations:[],completedAt:'2026-10-06'}
 }
 const pending=extractVisitWithResearch('Folup, research this','2026-10-06','UTC',async()=>true,extract,research)
 await new Promise(resolve=>setImmediate(resolve))
 assert.ok(researchStarted)
 finish(output())
 const result=await pending
 assert.equal(result.result.extraction.research?.result?.text,'Answer')
 assert.equal(result.result.extraction.research?.source,'Folup, research this')
})
test('ordinary notes and denied research do not invoke research',async()=>{
 for(const note of ['Call Clara tomorrow','Research this']){
  const result=await extractVisitWithResearch(note,'2026-10-06','UTC',async()=>false,async()=>output(),async()=>{throw Error('must not run')})
  assert.equal(result.result.extraction.summary,'No order approved.')
 }
})
test('research failure preserves the visit and marks the attempt to prevent automatic duplicate spend',async()=>{
 const result=await extractVisitWithResearch('Research this','2026-10-06','UTC',async()=>true,async()=>output(),async()=>{throw Error('timeout')})
 assert.equal(result.result.extraction.summary,'No order approved.')
 assert.deepEqual(result.result.extraction.research,{source:'Research this',result:null})
})
test('failed visit never proceeds past research identity guard',async()=>{
 let searched=false
 await assert.rejects(()=>extractVisitWithResearch('Research this','2026-10-06','UTC',async()=>true,async()=>{throw Error('bad visit')},async(_n,_l,_c,names)=>{
  await names;searched=true;throw Error('must not search')
 }))
 assert.equal(searched,false)
})
