import {test} from 'node:test'
import assert from 'node:assert/strict'
import {configuredVisitModel,VISIT_MODEL,VISIT_CANDIDATE_MODEL,visitModelParameters} from '../lib/visitModelConfig'
import {buildVisitRequest} from '../lib/extractVisitServer'
import {SALES_PROMPT,SALES_SCHEMA} from '../lib/salesDecision'

test('migration is opt-in with a pinned baseline and restricted server configuration',()=>{
  assert.equal(configuredVisitModel(''),VISIT_MODEL)
  assert.equal(configuredVisitModel('  '),VISIT_MODEL)
  assert.equal(configuredVisitModel(VISIT_MODEL),VISIT_MODEL)
  assert.equal(configuredVisitModel(' gpt-6-sol '),VISIT_CANDIDATE_MODEL)
  assert.throws(()=>configuredVisitModel('gpt-6-astra'),/Unsupported/)
  assert.throws(()=>configuredVisitModel('typo'),/Unsupported/)
})
test('both migration choices preserve low reasoning without sampling controls',()=>{
  for(const model of [VISIT_MODEL,VISIT_CANDIDATE_MODEL]){
    const request=buildVisitRequest('Send Jo the sheet tomorrow.','2026-09-24T18:30:00Z','America/Los_Angeles',model)
    assert.equal(request.model,model)
    assert.equal(request.reasoning_effort,'low')
    for(const key of ['temperature','top_p','logprobs','tools'])assert.equal(key in request,false)
    assert.equal(request.max_completion_tokens,4000)
    assert.deepEqual(request.response_format,{type:'json_schema',json_schema:{name:'folup_sales_v1',strict:true,schema:SALES_SCHEMA}})
    assert.equal(request.messages[0].content,SALES_PROMPT)
  }
  assert.deepEqual(visitModelParameters('gpt-4o'),{temperature:0})
})
test('request reads server-side selection at call time and supports rollback',()=>{
  const previous=process.env.FOLUP_VISIT_MODEL
  try {
    delete process.env.FOLUP_VISIT_MODEL
    const build=()=>buildVisitRequest('A note','2026-09-24T18:30:00Z','America/Los_Angeles')
    assert.equal(build().model,VISIT_MODEL)
    process.env.FOLUP_VISIT_MODEL=VISIT_CANDIDATE_MODEL
    assert.equal(build().model,VISIT_CANDIDATE_MODEL)
    process.env.FOLUP_VISIT_MODEL=VISIT_MODEL
    assert.equal(build().model,VISIT_MODEL)
    process.env.FOLUP_VISIT_MODEL='unsupported'
    assert.throws(build,/Unsupported/)
  } finally {
    if(previous===undefined)delete process.env.FOLUP_VISIT_MODEL
    else process.env.FOLUP_VISIT_MODEL=previous
  }
})
test('prompt distinguishes narration repairs from real business cancellations',()=>{
  assert.match(SALES_PROMPT,/DICTATION REPAIR IS NOT A BUSINESS EVENT/)
  assert.match(SALES_PROMPT,/NOT a canceled quote/)
  assert.match(SALES_PROMPT,/DOES establish a canceled request/)
  assert.match(SALES_PROMPT,/one correction never cancels another person's task/)
})
