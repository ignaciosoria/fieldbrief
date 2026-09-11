import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveRelativeDate } from '../lib/calendarResolveDate'
import { calendarExportDate, calendarTimedRange } from '../lib/calendarExportDate'

test('next week consistently means the following calendar week in ES and EN', () => {
  for (const date of ['2026-04-06T18:00:00Z','2026-04-09T18:00:00Z','2026-04-12T18:00:00Z']) {
    for (const phrase of ['next week','próxima semana']) assert.equal(resolveRelativeDate(phrase,new Date(date),'America/Los_Angeles'),'04/13/2026')
  }
})
test('dates reject invalid days but accept leap days and year rollover', () => {
  const now = new Date('2026-12-31T18:00:00Z')
  assert.equal(resolveRelativeDate('02/31/2026',now,'America/Los_Angeles'),null)
  assert.equal(resolveRelativeDate('02/29/2028',now,'America/Los_Angeles'),'02/29/2028')
  assert.equal(resolveRelativeDate('mañana',now,'America/Los_Angeles'),'01/01/2027')
})
test('export preserves overdue dates and rejects invalid calendar dates', () => {
  assert.deepEqual(calendarExportDate('04/09/2020',9,30),{dateMmddyyyy:'04/09/2020',hour:9,minute:30})
  assert.equal(calendarExportDate('02/31/2026',9,0),null)
  assert.equal(calendarExportDate('04/09/2026',NaN,0),null)
  assert.equal(calendarExportDate('04/09/2026',9,0.5),null)
})
test('timed export carries across midnight and year end', () => {
  assert.deepEqual(calendarTimedRange('12/31/2026',23,45), {
    kind:'floating',start:'20261231T234500',end:'20270101T001500',
  })
  assert.equal(calendarTimedRange('02/31/2026',9,0),null)
})
