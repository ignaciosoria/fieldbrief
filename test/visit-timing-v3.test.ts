import {test} from 'node:test'
import assert from 'node:assert/strict'
import {calendarDraftFromAction,googleCalendarUrl} from '../lib/calendarDraft'
import {parseVisitExtraction,visitExtractionResult,visitActionFields,confirmVisitField,calendarActionNeedsClarification,type VisitExtraction} from '../lib/visitExtraction'
const base=()=>({language:'Spanish',contractVersion:3,contacts:['Ana'],companies:['Acme'],location:'',summary:'Visita con Ana.',insights:[],questions:[],actions:[{type:'call',contact:'Ana',company:'Acme',object:'',description:'Llamar',subject:'',date:'2026-09-16',time:'',daypart:'morning',evidence:'Mañana por la tarde llamaré a Ana.'}]})
const source='Mañana por la tarde llamaré a Ana. Mejor por la mañana.'
test('resolved morning correction wins even when action evidence retains old afternoon',()=>{
 const v=parseVisitExtraction(base(),source),draft=calendarDraftFromAction(visitActionFields(v.actions[0],v.language),v.language,'America/Los_Angeles')
 assert.equal(draft.time,'09:00');assert.equal(draft.timeSuggested,true)
 assert.equal(new URL(googleCalendarUrl(draft)!).searchParams.get('dates'),'20260916T160000Z/20260916T163000Z')
})
test('daypart does not depend on quote size or borrow another action timing',()=>{
 for(const [daypart,expected] of [['morning','09:00'],['afternoon','15:00'],['night','19:00'],['unspecified','09:00']] as const){
  const raw=base();raw.actions[0].daypart=daypart;raw.actions[0].evidence='llamaré a Ana'
  const v=parseVisitExtraction(raw,source),draft=calendarDraftFromAction(visitActionFields(v.actions[0],v.language),v.language,'America/Los_Angeles')
  assert.equal(draft.time,expected)
 }
})
test('ambiguous time remains blank and gated until explicit confirmation',()=>{
 const raw={...base(),questions:[{action_index:0,field:'time',question:'¿A las nueve o a las diez?'}]};raw.actions[0].daypart='ambiguous'
 const v=parseVisitExtraction(raw,source);const draft=calendarDraftFromAction(visitActionFields(v.actions[0],v.language),v.language,'America/Los_Angeles')
 assert.equal(draft.time,'');assert.equal(googleCalendarUrl(draft),null);assert.equal(calendarActionNeedsClarification(v,0),true)
 const confirmed=confirmVisitField(v,v.questions[0],'10:00')
 assert.equal(calendarActionNeedsClarification(confirmed,0),false)
 assert.equal(calendarDraftFromAction(visitActionFields(confirmed.actions[0],v.language),v.language,'America/Los_Angeles').time,'10:00')
})
test('new contract rejects missing/invalid daypart and unasked ambiguity; old notes still parse',()=>{
 for(const daypart of [undefined,'midday','ambiguous']){const raw=base();Object.assign(raw.actions[0],{daypart});assert.throws(()=>parseVisitExtraction(raw,source))}
 const legacy=base() as unknown as VisitExtraction;delete (legacy as {contractVersion?:number}).contractVersion;delete (legacy.actions[0] as {daypart?:string}).daypart
 const v=parseVisitExtraction(legacy,source);assert.equal(calendarDraftFromAction(visitActionFields(v.actions[0],v.language),v.language,'America/Los_Angeles').time,'15:00')
})
test('v3 does not describe absence of questions as verified high confidence',()=>{
 const v=parseVisitExtraction(base(),source)
 assert.equal(visitExtractionResult(v,'2026-09-15T18:00:00Z').nextStepConfidence,'')
 const legacy={...v};delete legacy.contractVersion
 assert.equal(visitExtractionResult(legacy,'2026-09-15T18:00:00Z').nextStepConfidence,'high','Legacy adapter contract stays compatible')
})
