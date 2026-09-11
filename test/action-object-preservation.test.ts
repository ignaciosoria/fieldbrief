import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseStructuredAiPayload, structuredPayloadToStructureBody } from '../lib/structuredAiMapper'
import { runStructurePipelineFromParsedJson } from '../lib/structurePipelineRun'
import { VISIT_NOW, VISIT_ZONE } from '../eval/visit-corpus'

for (const [language, object] of [
  ['English','the complete clinical trial results from the intensive care unit in Baja California'],
  ['Spanish','los resultados completos de los ensayos de Quantum Flower en la finca de Baja California'],
]) {
  for (const position of ['primary','supporting']) {
    test(`Q04: preserve full ${language} ${position} deliverable`, () => {
      const send = {type:'send',object,contact:'Ana',company:'Acme',date:'09/12/2026',time:'10:00'}
      const raw = {primary: position === 'primary' ? send : { ...send, type:'call',object:'',date:'09/11/2026' },
        supporting: position === 'supporting' ? [send] : [], crm_summary:'Ana, Acme.',insights:[]}
      const p = parseStructuredAiPayload(raw)
      assert.ok(p)
      assert.equal(position === 'primary' ? p.primary.object : p.supporting[0].object, object)
      const mapped = structuredPayloadToStructureBody(p, language)
      const mappedAction = position === 'primary' ? mapped.primaryActionStructured : mapped.additionalSteps[0].actionStructured
      assert.equal(mappedAction?.object,object)
      const final = runStructurePipelineFromParsedJson(raw,'',language,VISIT_ZONE,new Date(VISIT_NOW))
      const all = [final.primaryActionStructured,...final.additionalSteps.map(s => s.actionStructured)]
      assert.ok(all.some(a => a?.type === 'send' && a.object === object), 'Ranking must preserve the full deliverable too')
    })
  }
}
