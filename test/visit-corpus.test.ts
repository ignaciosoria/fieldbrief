import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DateTime } from 'luxon'
import { VISIT_CORPUS, VISIT_NOW, VISIT_ZONE } from '../eval/visit-corpus'

test('evaluation corpus has unique cases and balanced ES/EN coverage', () => {
  assert.equal(new Set(VISIT_CORPUS.map(c => c.id)).size, VISIT_CORPUS.length)
  assert.equal(VISIT_CORPUS.filter(c => c.language === 'Spanish').length, 8)
  assert.equal(VISIT_CORPUS.filter(c => c.language === 'English').length, 8)
  const tags = new Set(VISIT_CORPUS.flatMap(c => c.tags))
  for (const tag of ['negation','no-action','multiple-companies','secondary-meeting','long-object',
    'ambiguous-date','missing-date','ambiguous-contact','ambiguous-company','self-correction','mixed-language','third-party','past-action']) {
    assert.ok(tags.has(tag), `Missing scenario: ${tag}`)
  }
  assert.equal(DateTime.fromISO(VISIT_NOW).setZone(VISIT_ZONE).toISODate(), '2026-09-10')
})

for (const c of VISIT_CORPUS) {
  test(`corpus integrity: ${c.id} (not a model-quality test)`, () => {
    assert.ok(c.crmFacts.length > 0)
    assert.ok(c.forbiddenClaims.length > 0)
    for (const a of c.actions) {
      assert.ok(a.evidence.length > 0 && c.note.includes(a.evidence), 'Action evidence must quote the input')
      if (a.contact) assert.ok(c.note.includes(a.contact), 'Contact must occur in input')
      if (a.company) assert.ok(c.note.includes(a.company), 'Company must occur in input')
      if (a.date) assert.ok(DateTime.fromISO(a.date).isValid, 'Expected date must be valid')
    }
    if (c.tags.includes('no-action')) assert.deepEqual(c.actions, [])
    if (c.tags.includes('missing-date')) {
      assert.ok(c.actions.every(a => a.date === null))
      assert.deepEqual(c.clarification, [], 'Missing date is not ambiguous')
    }
    if (c.tags.some(t => t.startsWith('ambiguous-'))) assert.ok(c.clarification.length > 0)
  })
}
