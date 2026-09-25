import assert from 'node:assert/strict'
import {test} from 'node:test'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {suggestCalendarSchedule} from '../lib/calendarSuggestion'
import {googleCalendarUrl,type CalendarDraft} from '../lib/calendarDraft'
import {insightPresentation} from '../lib/insightPresentation'
import CompactVisitResult from '../app/components/CompactVisitResult'
import type {VisitExtraction} from '../lib/visitExtraction'

const draft:CalendarDraft={title:'Send offer to Jeremy',details:'Send the Promars Ferro offer to Jeremy for review.',date:'',time:'09:00',timeSuggested:true,timezone:'America/Los_Angeles',language:'English'}
const thursday='2026-09-24T18:27:00Z'
for(const [evidence,date,time] of [
  ['Enviar la oferta a Jeremy','2026-09-25','09:00'],
  ['Send the quote to Jeremy','2026-09-25','09:00'],
  ['Enviar mañana por la mañana','2026-09-25','09:00'],
  ['Send tomorrow morning','2026-09-25','09:00'],
  ['Enviar pasado mañana','2026-09-26','09:00'],
  ['Send the day after tomorrow','2026-09-26','09:00'],
  ['Mandarlo esta semana','2026-09-24','11:30'],
  ['Send this week','2026-09-24','11:30'],
  ['Visita la próxima semana','2026-09-28','09:00'],
  ['Visit next week','2026-09-28','09:00'],
  ['Llamar en 3 días','2026-09-27','09:00'],
  ['Call in 2 weeks','2026-10-08','09:00'],
  ['If he approves next week, send it','2026-09-25','09:00'],
  ['Mañana o la próxima semana','2026-09-25','09:00'],
] as const){
  test(`calendar suggestion: ${evidence}`,()=>{
    const before=structuredClone(draft)
    const suggested=suggestCalendarSchedule(draft,evidence,thursday,thursday)
    assert.equal(suggested.date,date);assert.equal(suggested.time,time)
    assert.equal(suggested.dateSuggested,true)
    assert.deepEqual(draft,before)
    const url=new URL(googleCalendarUrl(suggested)!)
    assert.equal(url.pathname,'/calendar/r/eventedit')
    assert.equal(url.searchParams.get('stz'),draft.timezone)
    assert.equal(url.searchParams.get('etz'),draft.timezone)
    assert.equal(url.searchParams.get('details'),draft.details)
  })
}
test('defaults skip weekends; explicit dates and times remain untouched',()=>{
  const friday='2026-09-25T18:00:00Z'
  assert.equal(suggestCalendarSchedule(draft,'',friday,friday).date,'2026-09-28')
  const explicit={...draft,date:'2026-09-20',time:'16:45',timeSuggested:false}
  assert.deepEqual(suggestCalendarSchedule(explicit,'next week',thursday,thursday),{...explicit,dateSuggested:false,suggestionReason:''})
  const exactClock=suggestCalendarSchedule({...draft,time:'10:15',timeSuggested:false},'today',thursday,thursday)
  assert.equal(exactClock.time,'10:15');assert.equal(exactClock.date,'2026-09-25')
  const old=suggestCalendarSchedule(draft,'tomorrow','2026-08-01T18:00:00Z',thursday)
  assert.equal(old.date,'2026-09-25')
})
test('suggested slots stay within the requested part of day and the local time zone',()=>{
  const afternoon='2026-09-24T21:45:00Z'
  assert.equal(suggestCalendarSchedule(draft,'today',afternoon,afternoon).time,'15:00')
  const morning=suggestCalendarSchedule(draft,'this morning',afternoon,afternoon)
  assert.equal(morning.date,'2026-09-25');assert.equal(morning.time,'09:00')
  const madrid={...draft,timezone:'Europe/Madrid'}
  assert.equal(suggestCalendarSchedule(madrid,'',undefined,'2026-09-25T22:30:00Z').date,'2026-09-28')
})
test('timing questions allow an editable proposal; identity questions still block export',()=>{
  const extraction:VisitExtraction={language:'English',contacts:['Jeremy'],companies:['Farmers Fertilizer'],summary:'',location:'',insights:[],
    actions:[{type:'send',contact:'Jeremy',company:'Farmers Fertilizer',object:'offer',description:draft.details,date:'',time:'',evidence:'Send the offer'}],
    questions:[{action_index:0,field:'date',question:'When?'}]}
  const props={extraction,timezone:draft.timezone,onCalendarOpened:()=>{},onCopy:async()=>{},onVoice:()=>{},onClarify:()=>{},recording:false,voiceDisabled:false}
  const before=structuredClone(extraction)
  assert.match(renderToStaticMarkup(createElement(CompactVisitResult,props)),/type="date" required="" class=/)
  assert.deepEqual(extraction,before)
  assert.match(renderToStaticMarkup(createElement(CompactVisitResult,{...props,extraction:{...extraction,questions:[{action_index:0,field:'contact',question:'Which Jeremy?'}]}})),/type="date" required="" disabled=""/)
})
for(const [text,icon] of [
  ['Jay confirmó que sí vio la oferta enviada hace un mes.','📄'],
  ['Jay confirmed he received the offer last month.','📄'],
  ['Pidieron que la oferta se pase directamente a Jeremy.','📄'],
  ['Forward the offer to Jeremy for review.','📄'],
  ['El crédito está ajustado.','💰'],['Credit is tight.','💰'],
  ['Helena ofrece un precio más barato.','⚖️'],['A competitor offers a cheaper price.','⚖️'],
  ['Hay un problema de ácaros.','⚠️'],['The shipment has damage.','⚠️'],
  ['Todavía no hay pedido.','📦'],['No order yet.','📦'],
  ['Buena respuesta en cuajado.','🌱'],['The foliage looks better.','🌱'],
  ['Some other neutral context.','📌'],
] as const)test(`contextual insight icon: ${text}`,()=>{
  assert.deepEqual(insightPresentation('💡 '+text),{text,icon})
  assert.deepEqual(insightPresentation('⚠️ '+text),{text,icon})
})
