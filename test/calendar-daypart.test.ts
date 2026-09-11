import assert from 'node:assert/strict'
import {test} from 'node:test'
import {calendarDraftFromAction} from '../lib/calendarDraft'
import {visitExtractionResult,type VisitExtraction} from '../lib/visitExtraction'
const action={type:'call',verb:'Llamar',object:'',contact:'Pedro',company:'Acme',date:'09/12/2026',time:''}
test('Spanish and English dayparts suggest consistent hours without confusing tomorrow',()=>{
  for(const [evidence,time] of [
    ['Llamar a Pedro mañana por la tarde','15:00'],['Llamar a Pedro por la mañana','09:00'],
    ['Llamar a Pedro mañana por la noche','19:00'],['Llamar a Pedro mañana','09:00'],
    ['Call Pedro tomorrow afternoon','15:00'],['Call Pedro tomorrow morning','09:00'],
    ['Call Pedro tomorrow evening','19:00'],['Call Pedro tonight','19:00'],['Call Pedro tomorrow','09:00'],
  ]) {
    const draft=calendarDraftFromAction({...action,evidence},'Spanish','America/Los_Angeles')
    assert.equal(draft.time,time,evidence);assert.equal(draft.timeSuggested,true);assert.equal(draft.date,'2026-09-12')
  }
})
test('explicit clock wins over daypart and is not a suggestion',()=>{
  const draft=calendarDraftFromAction({...action,time:'16:30',evidence:'Llamar a Pedro mañana por la tarde a las 16:30'},'Spanish','America/Los_Angeles')
  assert.equal(draft.time,'16:30');assert.equal(draft.timeSuggested,false)
})
test('adapter carries each action evidence without borrowing another recipient time window',()=>{
  const base={type:'call' as const,contact:'Pedro',company:'Acme',object:'',description:'Llamar',date:'2026-09-12',time:'',evidence:'Llamar a Pedro por la tarde'}
  const extraction:VisitExtraction={language:'Spanish',contacts:['Pedro','Ana'],companies:['Acme'],summary:'',location:'',insights:[],questions:[],actions:[base,{...base,contact:'Ana',evidence:'Llamar a Ana mañana'}]}
  const result=visitExtractionResult(extraction,'2026-09-11T16:00:00Z','America/Los_Angeles')
  assert.equal(calendarDraftFromAction(result.primaryActionStructured!,'Spanish','America/Los_Angeles').time,'15:00')
  assert.equal(calendarDraftFromAction(result.additionalSteps[0].actionStructured,'Spanish','America/Los_Angeles').time,'09:00')
  assert.equal(extraction.actions[0].time,'')
})
