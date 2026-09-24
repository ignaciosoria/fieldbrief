import {test} from 'node:test'
import assert from 'node:assert/strict'
import {buildPrimaryBaseTitle,type ActionStructuredFields} from '../lib/actionTitleContract'
import {calendarDraftFromAction} from '../lib/calendarDraft'

const fields=(object:string):ActionStructuredFields=>({type:'send',verb:'Send',object,contact:'Mike',company:'Valley Growers',date:'09/25/2026',time:'09:00',description:'Send the label and pricing.'})
test('generic label and pricing uses sentence case in action and calendar titles',()=>{
  const action=fields('Label and pricing'), before=structuredClone(action)
  assert.equal(buildPrimaryBaseTitle(action,'English'),'Send label and pricing to Mike — Valley Growers')
  const draft=calendarDraftFromAction(action,'English','America/Los_Angeles')
  assert.equal(draft.title,'Send label and pricing to Mike')
  assert.equal(draft.details,'Mike — Valley Growers\n\nSend the label and pricing.')
  assert.equal(draft.date,'2026-09-25');assert.equal(draft.time,'09:00')
  assert.deepEqual(action,before)
})
test('case correction preserves proper names, product spelling and acronyms',()=>{
  for(const object of ['Quantum Flower','SDS','Label Studio','LABEL and pricing','Ferbloom 75 label','label and pricing']){
    assert.equal(buildPrimaryBaseTitle(fields(object),'English'),`Send ${object} to Mike — Valley Growers`)
  }
  assert.equal(buildPrimaryBaseTitle(fields('Label and pricing for Quantum EC'),'English'),'Send label and pricing for Quantum EC to Mike — Valley Growers')
})
