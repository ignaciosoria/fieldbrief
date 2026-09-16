import assert from 'node:assert/strict'
import { test } from 'node:test'
import { confirmVisitField, parseVisitExtraction, visitExtractionResult, calendarActionNeedsClarification, prioritizeVisitQuestions, type VisitExtraction } from '../lib/visitExtraction'
import { calendarDraftFromAction, googleCalendarUrl } from '../lib/calendarDraft'
const base = ():VisitExtraction => ({language:'English',contacts:['Ana','Bob'],companies:['Acme','Beta'],location:'Fair',summary:'Met Ana and Bob at the fair.',insights:[],questions:[],actions:[
  {type:'send',contact:'Ana',company:'Acme',object:'catalog',description:'Send the complete catalog.',date:'2026-09-11',time:'',evidence:'Send Ana the catalog'},
  {type:'meeting',contact:'Bob',company:'Beta',object:'',description:'Discuss the trial results.',date:'2026-09-12',time:'10:00',evidence:'Meet Bob Saturday'},
]})
test('confirming deliverable retains restrictions in both languages',()=>{
 for(const language of ['English','Spanish'] as const){
  const v=base();v.language=language;v.actions[0].object=''
  v.actions[0].description=language==='Spanish'?'No incluir precios ni presupuesto.':'Do not include prices or a quote.'
  v.questions=[{action_index:0,field:'object',question:'Which document?'}]
  const updated=confirmVisitField(v,v.questions[0],'Q7')
  assert.match(updated.actions[0].description,/Q7/)
  assert.ok(updated.actions[0].description.includes(v.actions[0].description))
  assert.deepEqual(updated.actions[1],v.actions[1])
 }
})
test('known deliverable replacement preserves its original restriction',()=>{
 const v=base();v.actions[0].description='Send catalog without prices.'
 const updated=confirmVisitField(v,{action_index:0,field:'object',question:'Which?'},'technical sheet')
 assert.equal(updated.actions[0].description,'Send technical sheet without prices.')
})
test('unclear action gates only itself; absent date does not become identity uncertainty',()=>{
 const v=base();v.actions[1].date=''
 v.questions=[{action_index:0,field:'contact',question:'Who?'}]
 assert.equal(calendarActionNeedsClarification(v,0),true)
 assert.equal(calendarActionNeedsClarification(v,1),false)
 v.questions.push({action_index:1,field:'time',question:'Ten or eleven?'})
 assert.equal(calendarActionNeedsClarification(v,1),true)
 const reordered=prioritizeVisitQuestions(v,1)
 assert.equal(reordered.questions[0].field,'time')
 assert.equal(reordered.questions.length,2)
 assert.equal(v.questions[0].field,'contact')
})
test('Q02/Q03: meeting and its own company/description survive adapter and calendar', () => {
  const v = parseVisitExtraction(base(),'Send Ana the catalog. Meet Bob Saturday.')
  const r = visitExtractionResult(v,'2026-09-10T18:00:00Z')
  assert.equal(r.additionalSteps.length,1)
  assert.equal(r.additionalSteps[0].supportingType,'meeting')
  const draft = calendarDraftFromAction(r.additionalSteps[0].actionStructured,'English','America/Los_Angeles')
  assert.equal(draft.title,'Meeting with Bob — Beta')
  assert.equal(draft.details,'Discuss the trial results.')
  assert.equal(draft.date,'2026-09-12')
  assert.equal(draft.time,'10:00')
})
test('Q06: empty actions are valid and do not manufacture a follow-up', () => {
  const v = {...base(),actions:[]}
  const r = visitExtractionResult(parseVisitExtraction(v,'Met Ana.'),'2026-09-10T18:00:00Z')
  assert.equal(r.nextStep,'No follow-up needed')
  assert.equal(r.primaryActionStructured,undefined)
  assert.deepEqual(r.additionalSteps,[])
})
test('each action restriction survives the adapter and Calendar URL without leaking to another contact', () => {
  const v = base()
  v.actions[0].description = 'Send the complete catalog without prices for now.'
  const r = visitExtractionResult(v,'2026-09-10T18:00:00Z')
  const primary = calendarDraftFromAction(r.primaryActionStructured!,'English','America/Los_Angeles')
  const secondary = calendarDraftFromAction(r.additionalSteps[0].actionStructured,'English','America/Los_Angeles')
  assert.equal(new URL(googleCalendarUrl(primary)!).searchParams.get('details'),v.actions[0].description)
  assert.equal(new URL(googleCalendarUrl(secondary)!).searchParams.get('details'),'Discuss the trial results.')
  assert.doesNotMatch(secondary.details,/prices|catalog|Ana|Acme/)
})
test('field confirmation changes only the requested action', () => {
  const v = base()
  v.actions[1].date=''
  v.questions=[{action_index:1,field:'date',question:'Which day?'}]
  const confirmed = confirmVisitField(v,v.questions[0],'2026-09-14')
  assert.deepEqual(confirmed.actions[0],v.actions[0])
  assert.equal(confirmed.actions[1].date,'2026-09-14')
  assert.equal(v.actions[1].date,'')
  assert.deepEqual(confirmed.questions,[])
})
test('missing timing stays absent through the adapter', () => {
  const v = base();v.actions[0].date='';v.actions[0].time=''
  const r = visitExtractionResult(v,'2026-09-10T18:00:00Z')
  const send = [r.primaryActionStructured,...r.additionalSteps.map(s=>s.actionStructured)].find(a=>a?.type==='send')!
  assert.equal(send.date,'');assert.equal(send.time,'')
})
test('invalid evidence/date/question targets are rejected', () => {
  for (const mutate of [
    (v:VisitExtraction)=>{v.actions[0].evidence='Invented sentence'},
    (v:VisitExtraction)=>{v.actions[0].date='2026-02-31'},
    (v:VisitExtraction)=>{v.questions=[{action_index:99,field:'contact',question:'Who?'}]},
  ]) {const v=base();mutate(v);assert.throws(()=>parseVisitExtraction(v,'Send Ana the catalog. Meet Bob Saturday.'))}
})
test('case-only evidence drift is anchored back to a unique verbatim source span',()=>{
  const v=base();v.actions[0].evidence='send ana the catalog'
  const parsed=parseVisitExtraction(v,'Send Ana the catalog. Meet Bob Saturday.')
  assert.equal(parsed.actions[0].evidence,'Send Ana the catalog')
  assert.equal(v.actions[0].evidence,'send ana the catalog','Validation must not mutate caller data')
})
test('evidence repair rejects changed words, accents, punctuation and non-unique spans',()=>{
  for(const [evidence,source] of [
    ['send Ana a catalog','Send Ana the catalog.'],
    ['Llamare a Ana','Llamaré a Ana'],
    ['Send Ana the catalog!','Send Ana the catalog.'],
    ['SEND ANA THE CATALOG','Send Ana the catalog. Later send Ana the catalog.'],
    ['Send Ana.*catalog','Send Ana the catalog.'],
    ['send Ana the catalog tomorrow','Send Ana the catalog. Call tomorrow.'],
  ]){
    const v=base();v.actions=v.actions.slice(0,1);v.actions[0].evidence=evidence
    assert.throws(()=>parseVisitExtraction(v,source),/evidence/,evidence)
  }
})
