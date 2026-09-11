import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calendarDraftFromAction, googleCalendarUrl } from '../lib/calendarDraft'
const action = {type:'send',verb:'Send',object:'the complete clinical trial results from the ICU study in Baja California',contact:'Ana',company:'Acme',date:'12/31/2026',time:'23:45'}
const draft = () => calendarDraftFromAction(action,'English','America/Los_Angeles')
test('calendar title and description preserve full deliverable and own recipient', () => {
  const d = draft()
  assert.ok(d.title.includes(action.object))
  assert.ok(d.title.includes('Ana — Acme'))
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
test('missing date stays blank and cannot export; missing time is all-day', () => {
  const missing = calendarDraftFromAction({...action,date:'',time:''},'English','America/Los_Angeles')
  assert.equal(missing.date,''); assert.equal(missing.time,''); assert.equal(googleCalendarUrl(missing),null)
  const url = googleCalendarUrl({...missing,date:'2026-12-31'})!
  assert.equal(new URL(url).searchParams.get('dates'),'20261231/20270101')
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
