import test from 'node:test'
import assert from 'node:assert/strict'
import {SALES_PROMPT,SALES_SCHEMA} from '../lib/salesDecision'
import {buildVisitRequest} from '../lib/extractVisitServer'
import {SMART_STEP_CASES} from '../eval/smart-step-corpus'

// Contract checks, NOT proof that a live model complies with the instructions.
test('selection compares eligible alternatives without exposing extra output',()=>{
  assert.match(SALES_PROMPT,/up to three distinct, grounded candidate actions, plus waiting\/no recommendation/)
  assert.match(SALES_PROMPT,/First discard candidates that violate restrictions/)
  assert.match(SALES_PROMPT,/Use lower customer burden as a tie-breaker/)
  assert.equal(SALES_SCHEMA.properties.recommendations.maxItems,1)
  assert.deepEqual(SALES_SCHEMA.properties.recommendations.items.required,['action','rationale','timingReason'])
})
test('coordination is not a booked meeting and contact restrictions outrank convenience',()=>{
  assert.match(SALES_PROMPT,/action.date is when the rep should CONTACT/)
  assert.match(SALES_PROMPT,/habitual Wednesday visit is not confirmed availability/)
  assert.match(SALES_PROMPT,/Explicit pauses override travel convenience/)
  assert.doesNotMatch(SALES_PROMPT,/Choose the least intrusive useful next action/)
})
test('existing single request keeps factual extraction and response contract',()=>{
  const request=buildVisitRequest('Send the label tomorrow.','2026-10-07T18:00:00Z','America/Los_Angeles','gpt-6-sol')
  assert.equal(request.messages.length,2)
  assert.equal(request.messages[0].content,SALES_PROMPT)
  assert.equal(request.max_completion_tokens,4000)
  assert.match(SALES_PROMPT,/Preserve outstanding explicit rep commitments first/)
})
test('paired evaluation has twelve unique cases and explicit review rubrics',()=>{
  assert.equal(SMART_STEP_CASES.length,12)
  assert.equal(new Set(SMART_STEP_CASES.map(c=>c.id)).size,12)
  assert.ok(SMART_STEP_CASES.every(c=>c.note.length>80&&c.expected.length>40))
})
