import assert from 'node:assert/strict'
import {test} from 'node:test'
import {insightPresentation} from '../lib/insightPresentation'
import {SALES_PROMPT} from '../lib/salesDecision'

for(const [text,icon] of [
  ['La superficie sería de 80–85 acres, pero Roberto no confirmó la cifra.','📏'],
  ['Roberto confirmed 85 acres.','📏'],
  ['Approximately 80–85 acres; the rep may have misheard.','📏'],
  ['Unas 20 hectáreas, pendiente de confirmar.','📏'],
  ['No approved trial yet.','📌'],
  ['Mike confirmed he has not received the sheet.','📌'],
  ['No confirmó que recibió la ficha técnica.','📄'],
  ['No order approved.','📦'],
  ['Helena ofrece una alternativa más barata.','⚖️'],
  ['They may consult the lab about a possible problem.','⚠️'],
])test(`neutral topic icon: ${text}`,()=>{
  assert.deepEqual(insightPresentation('✅ '+text),{text,icon})
})
test('prompt retains source, certainty, clause scope and confirmed counterexamples',()=>{
  for(const rule of ['SOURCE AND CERTAINTY FIDELITY','dictating salesperson','qualify the datum neutrally',
    'Preserve exact confirmed figures','never blend two customers','possible iron deficiency is not a diagnosis',
    'planned PCA/lab consultation is not completed'])assert.ok(SALES_PROMPT.includes(rule),rule)
})
