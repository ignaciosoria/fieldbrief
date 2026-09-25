import assert from 'node:assert/strict'
import {test} from 'node:test'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import CompactVisitResult from '../app/components/CompactVisitResult'
import type {VisitExtraction} from '../lib/visitExtraction'
import {visitActionFields} from '../lib/visitExtraction'
import {calendarDraftFromAction} from '../lib/calendarDraft'

const extraction:VisitExtraction={language:'Spanish',contacts:['Pedro'],companies:['Acme'],summary:'THIS FULL CRM SUMMARY MUST NOT BE VISIBLE',location:'',insights:['Todavía no hay pedido.'],questions:[],actions:[{type:'call',contact:'Pedro',company:'Acme',description:'Confirmar recepción de muestras.',object:'',date:'2026-09-16',time:'',evidence:'Llamar a Pedro mañana por la tarde'}]}
function render(value:VisitExtraction){return renderToStaticMarkup(createElement(CompactVisitResult,{extraction:value,timezone:'America/Los_Angeles',onCalendarOpened:()=>{},onCopy:async()=>{},onVoice:()=>{},onClarify:()=>{},recording:false,voiceDisabled:false}))}
test('compact result shows action, time and insight without the CRM narrative or duplicate controls',()=>{
  const html=render(extraction)
  assert.doesNotMatch(html,/THIS FULL CRM|Correct in writing|Share/)
  assert.match(html,/15:00/);assert.match(html,/Todavía no hay pedido/)
  assert.equal((html.match(/Copy to CRM/g)||[]).length,1)
  assert.equal((html.match(/Correct by voice/g)||[]).length,1)
  assert.equal((html.match(/Add to calendar/g)||[]).length,1)
})
test('no-action visits do not manufacture a calendar button',()=>{
  const html=render({...extraction,actions:[]})
  assert.match(html,/No follow-up agreed/);assert.doesNotMatch(html,/Add to calendar/)
})
test('suggestion card hides duplicate explanations, preserves full calendar data and offers long-description expansion',()=>{
  const description='Preguntar si pudo hablar con David sobre la posible prueba de Quantum Flower y si le sería útil alguna ayuda; no dar por aprobada la prueba ni insistir durante la semana de cosecha.'
  const value:VisitExtraction={...extraction,actions:[{...extraction.actions[0],description,origin:'recommendation',rationale:'LONG RATIONALE',timingReason:'LONG TIMING REASON'}]}
  const before=structuredClone(value)
  const draft=()=>calendarDraftFromAction(visitActionFields(value.actions[0],value.language),value.language,'America/Los_Angeles')
  const full=draft(),html=render(value)
  assert.equal((html.match(/Suggested by Folup/g)||[]).length,1)
  assert.doesNotMatch(html,/LONG RATIONALE|LONG TIMING REASON|no es un compromiso acordado|edit if needed/)
  assert.match(html,/aria-expanded="false"/)
  assert.match(html,/More/)
  assert.match(full.details,/no dar por aprobada/)
  assert.match(full.details,/no es un compromiso acordado/)
  assert.deepEqual(draft(),full)
  assert.deepEqual(value,before)
})
test('v3 keeps the distinguishing purpose visible and ambiguous time blank without extra controls',()=>{
  const v:VisitExtraction={...extraction,contractVersion:3,questions:[{action_index:0,field:'time',question:'¿Nueve o diez?'}],actions:[{...extraction.actions[0],subject:'garantía Z9',daypart:'ambiguous'}]}
  const html=render(v)
  assert.match(html,/Llamar a Pedro sobre garantía Z9/)
  assert.match(html,/value=""/);assert.doesNotMatch(html,/value="09:00"|suggested/)
  assert.equal((html.match(/Add to calendar/g)||[]).length,1)
  assert.doesNotMatch(html,/THIS FULL CRM/)
})
