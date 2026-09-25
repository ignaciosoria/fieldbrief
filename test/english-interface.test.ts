import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {test} from 'node:test'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import CompactVisitResult from '../app/components/CompactVisitResult'
import VisitClarification from '../app/components/VisitClarification'
import VisitSummary from '../app/components/VisitSummary'
import CalendarFollowUp from '../app/components/CalendarFollowUp'
import AudioRecovery from '../app/components/AudioRecovery'
import {calendarDraftFromAction,googleCalendarUrl} from '../lib/calendarDraft'
import {buildPrimaryDisplayTitle,buildSupportingDisplayTitle} from '../lib/displayActionTitle'
import {visitActionFields,type VisitExtraction} from '../lib/visitExtraction'

const spanish:VisitExtraction={
  language:'Spanish',contacts:['José'],companies:['Viñas del Río'],location:'',
  summary:'Reunión con José en Viñas del Río.',insights:['Todavía no hay pedido.'],
  actions:[{type:'send',contact:'José',company:'Viñas del Río',object:'ficha técnica',
    description:'Enviar la ficha técnica sin precios.',date:'2026-12-16',time:'',evidence:'Enviar la ficha mañana por la tarde'}],
  questions:[{action_index:0,field:'date',question:'¿El lunes o el martes?'}],
}
const noop=()=>{}
const done=async()=>{}

for(const language of ['Spanish','English'] as const){
  test(`result controls stay English for a ${language} note, including save and correction states`,()=>{
    const extraction={...spanish,language}
    for(const saving of ['saving','error'])for(const recording of [false,true]){
      const html=renderToStaticMarkup(createElement(CompactVisitResult,{
        extraction,timezone:'America/Los_Angeles',onCalendarOpened:noop,onCopy:done,onVoice:noop,
        onClarify:noop,onNew:noop,onRetrySave:noop,recording,voiceDisabled:false,saving,
      }))
      for(const label of ['Visit result','New note','Add to calendar','Copy to CRM','Review unclear details','suggested','Date for follow-up 1','2026-12-16'])assert.ok(html.includes(label),label)
      assert.match(html,recording?/Finish correction/:/Correct by voice/)
      assert.match(html,saving==='saving'?/Saving…/:/Not saved\. Keep this page open\..*Retry/)
      assert.match(html,/Todavía no hay pedido/)
      assert.doesNotMatch(html,/Nueva nota|Añadir|Copiar|Corregir|Guardando|Reintentar|sugerida|dic 16/)
    }
  })
}

test('missing-date and no-action states use English without inventing a follow-up',()=>{
  const render=(extraction:VisitExtraction)=>renderToStaticMarkup(createElement(CompactVisitResult,{
    extraction,timezone:'America/Los_Angeles',onCalendarOpened:noop,onCopy:done,onVoice:noop,onClarify:noop,recording:false,voiceDisabled:false,
  }))
  assert.match(render({...spanish,actions:[{...spanish.actions[0],date:''}]}),/>suggested</)
  const empty=render({...spanish,actions:[],questions:[]})
  assert.match(empty,/No follow-up agreed/)
  assert.doesNotMatch(empty,/Add to calendar/)
})

test('clarification controls are English; the generated question and evidence retain the note language',()=>{
  const html=renderToStaticMarkup(createElement(VisitClarification,{
    extraction:spanish,question:spanish.questions[0],onConfirm:done,onSkip:done,
  }))
  for(const label of ['Your answer','Leave unresolved','Confirm'])assert.ok(html.includes(label),label)
  assert.match(html,/¿El lunes o el martes\?/)
  assert.match(html,/Enviar la ficha mañana por la tarde/)
  assert.doesNotMatch(html,/Tu respuesta|Dejar pendiente|Confirmar/)
})

test('CRM correction controls and placeholder are English without translating the CRM content',()=>{
  for(const voiceRecording of [false,true]){
    const html=renderToStaticMarkup(createElement(VisitSummary,{
      text:spanish.summary,language:'Spanish',hasQuestions:true,onClarify:noop,onCorrect:done,onVoiceCorrect:noop,voiceRecording,
    }))
    for(const label of ['CRM note','Resolve unclear details','Correct in writing','What should change?','For example:','Apply correction'])assert.ok(html.includes(label),label)
    assert.match(html,voiceRecording?/Finish correction/:/Correct by voice/)
    assert.match(html,/Reunión con José/)
    assert.doesNotMatch(html,/Nota para CRM|Corregir|Aplicar corrección|Qué quieres/)
  }
})

test('direct calendar controls are English while the event payload remains in Spanish with the same time',()=>{
  const draft=calendarDraftFromAction(visitActionFields(spanish.actions[0],'Spanish'),'Spanish','America/Los_Angeles')
  const before=structuredClone(draft)
  const html=renderToStaticMarkup(createElement(CalendarFollowUp,{initial:draft,onOpen:noop}))
  for(const label of ['Date for follow-up 1','Time for follow-up 1','Add to calendar'])assert.ok(html.includes(label),label)
  assert.doesNotMatch(html,/Review calendar event|<dialog|<textarea/)
  assert.match(html,/Enviar la ficha técnica sin precios/)
  assert.doesNotMatch(html,/Revisar evento|Descripción|Duración|Cancelar|Abrir Google Calendar/)
  assert.deepEqual(draft,before)
  const url=new URL(googleCalendarUrl(draft)!)
  assert.equal(url.searchParams.get('details'),draft.details)
  assert.equal(url.searchParams.get('dates'),'20261216T230000Z/20261216T233000Z')
})

test('legacy display uses English date labels without translating Spanish action text',()=>{
  const fields={nextStep:'Llamar a José',nextStepTitle:'Llamar a José',nextStepDate:'12/16/2030',nextStepTimeHint:'15:00',langEs:false,preserveStructuredTitle:true}
  assert.equal(buildPrimaryDisplayTitle(fields),'Llamar a José (Monday Dec 16 · 3:00 PM)')
  assert.equal(buildSupportingDisplayTitle({action:fields.nextStep,resolvedDate:fields.nextStepDate,timeHint:'15:00',langEs:false,preserveStructuredTitle:true}),buildPrimaryDisplayTitle(fields))
  const source=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8')
  assert.match(source,/schemaVersion === 2\) return \{\.\.\.r,langEs:false,preserveStructuredTitle:true\}/)
  assert.equal((source.match(/langEs: false/g)||[]).length,3,'primary and both supporting UI paths use English timing')
})

test('recording recovery copy is English',()=>{
  const html=renderToStaticMarkup(createElement(AudioRecovery,{blob:new Blob(['audio'],{type:'audio/webm'}),busy:false,onRetry:noop,onDiscard:noop}))
  for(const label of ['Recover recording','Your recording is still here','Retry recording','Discard recording'])assert.ok(html.includes(label),label)
})

test('document and checkout explicitly request English without relying on browser language',()=>{
  const layout=readFileSync(new URL('../app/layout.tsx',import.meta.url),'utf8')
  const checkout=readFileSync(new URL('../app/api/stripe/checkout/route.ts',import.meta.url),'utf8')
  assert.match(layout,/lang="en"/)
  assert.match(checkout,/locale: "en"/)
  // Changing session parameters must also change the idempotency namespace.
  assert.match(checkout,/folup-checkout:en:/)
})
