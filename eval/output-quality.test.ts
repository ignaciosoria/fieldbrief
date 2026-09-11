/** Desired behavior, NOT assertions that the bugs are correct.
 * Separate explicit red suite: npm run test:output-quality. No API calls.
 * Move fixed cases into the green regression suite as each block ships.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseStructuredAiPayload, structuredPayloadToStructureBody } from '../lib/structuredAiMapper'
import { detectNoteLanguage } from '../lib/detectNoteLanguage'
import { VISIT_CORPUS } from './visit-corpus'

function primary(overrides: Record<string, unknown> = {}) {
  return { type: 'call', contact: 'Ana', company: 'Acme', object: '', date: '09/11/2026', time: '', ...overrides }
}
function payload(p = primary(), supporting: Record<string, unknown>[] = []) {
  return { primary: p, supporting, crm_summary: 'Met Ana at Acme.', insights: [] }
}
function mapped(raw: unknown, note = '') {
  const p = parseStructuredAiPayload(raw)
  assert.ok(p, 'Structured payload should be accepted')
  return structuredPayloadToStructureBody(p, 'English', note)
}

test('control: explicit call remains a call', () => {
  assert.equal(mapped(payload(), 'I will call Ana tomorrow.').primaryActionStructured?.type, 'call')
})
test('control: primary contact and company are preserved', () => {
  const r = mapped(payload())
  assert.equal(r.contact, 'Ana')
  assert.equal(r.contactCompany, 'Acme')
})
test('Q02: secondary meeting must survive parsing', () => {
  const p = parseStructuredAiPayload(payload(primary({type:'send',object:'catalog'}), [
    {type:'meeting',contact:'Ana',date:'09/11/2026',time:'10:00'},
  ]))
  assert.ok(p)
  assert.equal(p.supporting.length, 1)
  assert.equal(String(p.supporting[0].type), 'meeting')
})
test('Q03: secondary company must not inherit another company', () => {
  const r = mapped(payload(primary(), [{type:'call',contact:'Bob',company:'Beta',date:'09/14/2026'}]))
  assert.equal(r.additionalSteps[0].contact, 'Bob')
  assert.equal(r.additionalSteps[0].company, 'Beta')
})
test('Q04: complete deliverable must not be truncated', () => {
  const c = VISIT_CORPUS.find(c => c.id === 'en-long-product')!
  const object = c.actions[0].object!
  const p = parseStructuredAiPayload(payload(primary({type:'send',object})))
  assert.equal(p?.primary.object, object)
})
test('Q05: accented name must not change English note language', () => {
  const c = VISIT_CORPUS.find(c => c.id === 'en-accented-name')!
  assert.equal(detectNoteLanguage(c.note), c.language)
})
test('Q06: no-action visit must have a valid empty representation', () => {
  const c = VISIT_CORPUS.find(c => c.id === 'es-no-followup')!
  const p = parseStructuredAiPayload({primary:null,supporting:[],crm_summary:c.crmFacts.join(' '),insights:[]})
  assert.ok(p, 'The extraction contract must allow no primary action')
})
