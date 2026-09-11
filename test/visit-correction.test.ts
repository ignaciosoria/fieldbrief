import assert from 'node:assert/strict'
import { test } from 'node:test'
import { appendVisitCorrection } from '../lib/visitCorrection'
import { visitUserMessage } from '../lib/extractVisitServer'

test('a later correction carries its own timestamp without replacing the original anchor', () => {
  const original = 'Met Ana. I will call her tomorrow.'
  const combined = appendVisitCorrection(original,'Her name is Anna.','2026-09-15T18:00:00Z','America/Los_Angeles')
  assert.ok(combined.startsWith(original))
  assert.match(combined,/2026-09-15T11:00:00.000-07:00/)
  const prompt = visitUserMessage(combined,'2026-09-10T18:00:00Z','America/Los_Angeles')
  assert.match(prompt,/Tomorrow: 2026-09-11/)
  assert.match(prompt,/2026-09-15/)
})
test('successive corrections retain each earlier timestamp', () => {
  const first = appendVisitCorrection('Visit.','Call tomorrow.','2026-09-11T18:00:00Z','America/Los_Angeles')
  const second = appendVisitCorrection(first,'Send results tomorrow.','2026-09-14T18:00:00Z','America/Los_Angeles')
  assert.ok(second.startsWith(first))
  assert.match(second,/2026-09-14/)
  assert.throws(()=>appendVisitCorrection(first,'','invalid','bad-zone'))
})
