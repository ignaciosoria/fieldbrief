import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calendarDraftFromAction, googleCalendarUrl } from '../lib/calendarDraft'
const action = {type:'send',verb:'Send',object:'the complete clinical trial results from the ICU study in Baja California',contact:'Ana',company:'Acme',date:'12/31/2026',time:'23:45'}
const draft = () => calendarDraftFromAction(action,'English','America/Los_Angeles')
test('Spanish calendar keeps restrictions in details and revised fields replace original drafts',()=>{
  const original={...action,object:'ficha técnica de Quantum Flower 75 sin precios',description:'Enviar la ficha técnica de Quantum Flower 75 sin precios',contact:'José Martínez',company:'AgroSol',time:''}
  const before=calendarDraftFromAction(original,'Spanish','America/Los_Angeles')
  assert.equal(before.title,'Enviar ficha técnica a José Martínez — AgroSol')
  assert.equal(before.details,original.description);assert.equal(before.time,'09:00');assert.equal(before.timeSuggested,true)
  const after=calendarDraftFromAction({...original,contact:'Ana',company:'Beta',time:'15:30',date:'01/04/2027'},'Spanish','America/Los_Angeles')
  assert.equal(after.title,'Enviar ficha técnica a Ana — Beta');assert.equal(after.time,'15:30');assert.equal(after.timeSuggested,false)
  assert.equal(after.date,'2027-01-04')
  assert.doesNotMatch(new URL(googleCalendarUrl(after)!).searchParams.get('text')!,/José|AgroSol/)
})
test('short calendar title keeps recipient while description preserves full deliverable', () => {
  const d = draft()
  assert.equal(d.title,'Send report to Ana — Acme')
  assert.ok(d.details.includes(action.object))
  const q = new URL(googleCalendarUrl(d)!).searchParams
  assert.equal(q.get('text'),d.title)
  assert.equal(q.get('details'),d.details)
  assert.equal(q.get('dates'),'20270101T074500Z/20270101T081500Z')
})
test('secondary calendar data never inherits another action context', () => {
  const d = calendarDraftFromAction({...action,type:'call',verb:'Call',object:'',contact:'Bob',company:'Beta'},'English','America/Los_Angeles')
  assert.equal(d.title,'Call Bob — Beta')
  assert.ok(!/Ana|Acme|ICU/.test(d.details))
})
test('missing date cannot export; missing time is explicitly suggested at 09:00', () => {
  const missing = calendarDraftFromAction({...action,date:'',time:''},'English','America/Los_Angeles')
  assert.equal(missing.date,''); assert.equal(missing.time,'09:00'); assert.equal(missing.timeSuggested,true); assert.equal(googleCalendarUrl(missing),null)
  const url = googleCalendarUrl({...missing,date:'2026-12-31'})!
  assert.equal(new URL(url).searchParams.get('dates'),'20261231T170000Z/20261231T173000Z')
  assert.equal(googleCalendarUrl({...missing,date:'2026-12-31',time:''}),null)
})
test('user-edited values round-trip; no query injection', () => {
  const d = {...draft(),title:'A&B + Q7?',details:'José\nline 2 &text=wrong'}
  const q = new URL(googleCalendarUrl(d)!).searchParams
  assert.equal(q.get('text'),d.title); assert.equal(q.get('details'),d.details)
})
test('invalid dates, clocks, zones and DST gaps are rejected', () => {
  for (const patch of [{date:'2026-02-31'},{time:'25:00'},{timezone:'not/a-zone'},{date:'2026-03-08',time:'02:30'},{title:' '}]) {
    assert.equal(googleCalendarUrl({...draft(),...patch}),null)
  }
})
