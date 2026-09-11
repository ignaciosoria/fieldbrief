import assert from 'node:assert/strict'
import { test } from 'node:test'
import { confirmVisitField, parseVisitExtraction, visitExtractionResult, type VisitExtraction } from '../lib/visitExtraction'
import { calendarDraftFromAction, googleCalendarUrl } from '../lib/calendarDraft'
const base = ():VisitExtraction => ({language:'English',contacts:['Ana','Bob'],companies:['Acme','Beta'],location:'Fair',summary:'Met Ana and Bob at the fair.',insights:[],questions:[],actions:[
  {type:'send',contact:'Ana',company:'Acme',object:'catalog',description:'Send the complete catalog.',date:'2026-09-11',time:'',evidence:'Send Ana the catalog'},
  {type:'meeting',contact:'Bob',company:'Beta',object:'',description:'Discuss the trial results.',date:'2026-09-12',time:'10:00',evidence:'Meet Bob Saturday'},
]})
test('Q02/Q03: meeting and its own company/description survive adapter and calendar', () => {
  const v = parseVisitExtraction(base(),'Send Ana the catalog. Meet Bob Saturday.')
  const r = visitExtractionResult(v,'2026-09-10T18:00:00Z')
  assert.equal(r.additionalSteps.length,1)
  assert.equal(r.additionalSteps[0].supportingType,'meeting')
  const draft = calendarDraftFromAction(r.additionalSteps[0].actionStructured,'English','America/Los_Angeles')
  assert.equal(draft.title,'Meeting · Bob · Beta')
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
