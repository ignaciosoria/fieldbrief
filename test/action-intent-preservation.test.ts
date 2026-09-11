import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseStructuredAiPayload, structuredPayloadToStructureBody } from '../lib/structuredAiMapper'
import { runStructurePipelineFromParsedJson } from '../lib/structurePipelineRun'
import { VISIT_CORPUS, VISIT_NOW, VISIT_ZONE } from '../eval/visit-corpus'

function extracted(type: 'call' | 'meeting' | 'follow_up' | 'send') {
  return {
    primary: { type, contact: 'Ana', company: 'Acme', object: type === 'send' ? 'catalog' : '', date: '09/11/2026', time: '10:00' },
    supporting: [], crm_summary: 'Ana at Acme.', insights: [],
  }
}

const cases = [
  { name: 'Q01 English negation', type: 'call', language: 'English', note: VISIT_CORPUS.find(c => c.id === 'en-negation')!.note },
  { name: 'Spanish negation', type: 'call', language: 'Spanish', note: VISIT_CORPUS.find(c => c.id === 'es-negation')!.note },
  { name: 'completed email', type: 'call', language: 'English', note: 'I already sent the email to Ana at Acme. I will call Ana tomorrow.' },
  { name: 'customer sends, rep calls', type: 'call', language: 'English', note: 'Ana will send her report. I will call Ana tomorrow.' },
  { name: 'Spanish customer sends', type: 'call', language: 'Spanish', note: 'Ana va a enviar el informe. Yo voy a llamar a Ana mañana.' },
  { name: 'contract is context, not send', type: 'call', language: 'English', note: 'The contract is pending. I will call Ana tomorrow.' },
  { name: 'meeting after negated send', type: 'meeting', language: 'English', note: 'Do not send the quote. I have a meeting scheduled with Ana tomorrow at ten.' },
  { name: 'follow-up after negated send', type: 'follow_up', language: 'English', note: 'Do not send samples. I agreed to follow up with Ana tomorrow.' },
  { name: 'positive send control', type: 'send', language: 'English', note: 'I will send the catalog to Ana tomorrow.' },
  { name: 'positive call control', type: 'call', language: 'English', note: 'I will call Ana tomorrow.' },
] as const

for (const c of cases) {
  test(`preserve extracted intent: ${c.name}`, () => {
    const raw = extracted(c.type)
    const payload = parseStructuredAiPayload(raw)
    assert.ok(payload)
    const original = structuredClone(payload)
    const mapped = structuredPayloadToStructureBody(payload, c.language, c.note)
    assert.equal(mapped.primaryActionStructured?.type, c.type, 'Mapper must not replace the extracted action')
    assert.deepEqual(payload, original, 'Mapping must not mutate its input')
    const final = runStructurePipelineFromParsedJson(raw, c.note, c.language, VISIT_ZONE, new Date(VISIT_NOW))
    assert.equal(final.primaryActionStructured?.type, c.type, 'Shared server pipeline must preserve the action type')
    assert.equal(final.primaryActionStructured?.contact, 'Ana')
    assert.equal(final.primaryActionStructured?.date, '09/11/2026')
    assert.equal(final.additionalSteps.length, 0, 'Must not invent a second action')
  })
}

test('send and call remain separate; unrelated supporting type is not rewritten', () => {
  const payload = parseStructuredAiPayload({
    ...extracted('call'),
    supporting: [
      {type:'other',object:'review inventory',contact:'Ana',label:'review inventory'},
      {type:'send',object:'catalog',contact:'Ana',date:'09/12/2026'},
    ],
  })
  assert.ok(payload)
  const r = structuredPayloadToStructureBody(payload, 'English', 'I will send the catalog Saturday, call Ana Friday and review inventory.')
  assert.equal(r.primaryActionStructured?.type, 'call')
  assert.deepEqual(r.additionalSteps.map(s => s.supportingType), ['other','send'])
  assert.equal(r.additionalSteps[1].actionStructured?.object, 'catalog')
})
