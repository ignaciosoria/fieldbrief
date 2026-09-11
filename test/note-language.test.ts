import assert from 'node:assert/strict'
import { test } from 'node:test'
import { detectNoteLanguage } from '../lib/detectNoteLanguage'
import { VISIT_CORPUS } from '../eval/visit-corpus'

for (const c of VISIT_CORPUS) {
  test(`note language: ${c.id}`, () => assert.equal(detectNoteLanguage(c.note), c.language))
}
test('English with multiple accented names remains English', () => {
  assert.equal(detectNoteLanguage('I met José Peña and María Núñez at Acme. We agreed that I will send the quote tomorrow.'),'English')
})
test('empty note has stable default', () => assert.equal(detectNoteLanguage(''), 'English'))
