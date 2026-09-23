import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {test} from 'node:test'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import CalendarFollowUp from '../app/components/CalendarFollowUp'
import CompactVisitResult from '../app/components/CompactVisitResult'
import {googleCalendarUrl, type CalendarDraft} from '../lib/calendarDraft'
import type {VisitExtraction} from '../lib/visitExtraction'

const draft:CalendarDraft = {title:'Call Armando — Brand Ag Products',details:'Follow up on the Quantum Engorde trial.',date:'2026-09-24',time:'15:00',timezone:'America/Los_Angeles',language:'English'}
function render(patch:Partial<CalendarDraft> = {}, props:Partial<Parameters<typeof CalendarFollowUp>[0]> = {}) {
  return renderToStaticMarkup(createElement(CalendarFollowUp,{initial:{...draft,...patch},...props}))
}
function hrefs(html:string):string[] {
  return [...html.matchAll(/href="([^"]+)"/g)].map(match=>match[1].replace(/&amp;/g,'&'))
}

test('ready follow-up is a native Google Calendar link with full payload and no intermediate editor',()=>{
  const html=render()
  assert.deepEqual(hrefs(html),[googleCalendarUrl(draft)])
  assert.match(html,/target="_blank" rel="noopener noreferrer"/)
  assert.doesNotMatch(html,/dialog|textarea|Review calendar event|window\.open/)
  const params=new URL(hrefs(html)[0]).searchParams
  assert.equal(params.get('text'),draft.title)
  assert.equal(params.get('details'),draft.details)
  assert.equal(params.get('dates'),'20260924T220000Z/20260924T223000Z')
  assert.equal(params.get('ctz'),'America/Los_Angeles')
})

test('missing date/time stay inline and never export a guessed appointment',()=>{
  for(const patch of [{date:''},{time:''},{date:'2026-02-30'},{time:'25:00'},{timezone:'Invalid/Zone'},{title:''}]){
    const html=render(patch)
    assert.deepEqual(hrefs(html),[],JSON.stringify(patch))
    assert.match(html,/type="date"/)
    assert.match(html,/type="time"/)
    assert.match(html,/<button[^>]+type="button"/)
    assert.doesNotMatch(html,/<dialog/)
  }
  assert.match(render({date:''}),/Date needed/)
})

test('spring gaps and ambiguous fall times cannot export silently',()=>{
  assert.deepEqual(hrefs(render({date:'2026-03-08',time:'02:30'})),[])
  assert.deepEqual(hrefs(render({date:'2026-11-01',time:'01:30'})),[])
})

test('clarifications and an active recording block navigation even with valid scheduling',()=>{
  for(const props of [{disabled:true},{onClarify:()=>{}}]){
    const html=render({},props)
    assert.deepEqual(hrefs(html),[])
    assert.match(html,/<button/)
  }
})

test('corrected fields generate only the new payload without changing the source draft',()=>{
  const before=structuredClone(draft)
  const updated={title:'Send quote to Maya',details:'Send only the updated Z9 quote.',date:'2026-12-02',time:'10:15',timezone:'Europe/Madrid'}
  const params=new URL(hrefs(render(updated))[0]).searchParams
  assert.equal(params.get('text'),updated.title)
  assert.equal(params.get('details'),updated.details)
  assert.equal(params.get('dates'),'20261202T091500Z/20261202T094500Z')
  assert.equal(params.get('ctz'),updated.timezone)
  assert.deepEqual(draft,before)
})

test('each sorted action exports its own contact, description, date and time',()=>{
  const extraction:VisitExtraction={language:'English',contacts:['Roberto','his father'],companies:['Estrada & Sons'],location:'',summary:'',insights:[],questions:[],actions:[
    {type:'meeting',contact:'his father',company:'Estrada & Sons',object:'',description:'Discuss the three properties with his father.',date:'2026-09-28',time:'16:00',evidence:''},
    {type:'send',contact:'Roberto',company:'Estrada & Sons',object:'price list',description:'Send the Fitasio price to Roberto.',date:'2026-09-24',time:'09:30',evidence:''},
  ]}
  const props={extraction,timezone:'America/Los_Angeles',onCalendarOpened:()=>{},onCopy:async()=>{},onVoice:()=>{},onClarify:()=>{},recording:false,voiceDisabled:false}
  const links=hrefs(renderToStaticMarkup(createElement(CompactVisitResult,props))).map(url=>new URL(url).searchParams)
  assert.equal(links.length,2)
  assert.match(links[0].get('text')!,/Roberto/)
  assert.match(links[0].get('details')!,/Fitasio/)
  assert.equal(links[0].get('dates'),'20260924T163000Z/20260924T170000Z')
  assert.match(links[1].get('text')!,/father/)
  assert.match(links[1].get('details')!,/three properties/)
  assert.equal(links[1].get('dates'),'20260928T230000Z/20260928T233000Z')
  const unresolved={...extraction,questions:[{action_index:0,field:'contact' as const,question:'Who is his father?'}]}
  assert.equal(hrefs(renderToStaticMarkup(createElement(CompactVisitResult,{...props,extraction:unresolved}))).length,1)
})

test('record and history paths no longer fall back to a provisional event editor',()=>{
  const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8')
  assert.doesNotMatch(page,/CalendarPreview|setCalendarDraft|openActionCalendar/)
  assert.match(page,/primaryCalendar\(recordDisplayResult/)
  assert.match(page,/primaryCalendar\(selectedNote\.result/)
  assert.match(page,/supportingCalendar\(recordDisplayResult/)
  assert.match(page,/supportingCalendar\(selectedNote\.result/)
  const component=readFileSync(new URL('../app/components/CalendarFollowUp.tsx',import.meta.url),'utf8')
  assert.doesNotMatch(component,/window\.open\(/)
  assert.match(component,/key=\{JSON\.stringify\(props\.initial\)\}/)
})
