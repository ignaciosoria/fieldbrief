import test from 'node:test'
import assert from 'node:assert/strict'
import {parseSmartCandidates,applySmartChoice,smartSelectorEnabled,SMART_CANDIDATE_PROMPT,SMART_CANDIDATE_SCHEMA} from '../lib/smartNextStep'
import {selectSmartNextStep,buildSmartDecisionRequest} from '../lib/smartDecisionServer'
import {buildVisitRequest} from '../lib/extractVisitServer'

const now='2026-10-07T18:00:00Z',zone='America/Los_Angeles'
const source='Robert at Ranch needs Daniel approval. I will send the label tomorrow. Daniel usually visits Wednesdays; I will be nearby next week.'
const action={type:'follow_up',contact:'Robert',company:'Ranch',description:'Ask Robert about Daniel approval.',object:'',subject:'Daniel approval',date:'2026-10-12',time:'',daypart:'unspecified',evidence:'Robert at Ranch needs Daniel approval.',scheduleAfter:null}
const fixture=()=>({contractVersion:3,language:'English',contacts:['Robert'],companies:['Ranch'],location:'',summary:'Robert needs Daniel approval.',insights:[],questions:[],
  actions:[{...action,type:'send',description:'Send label.',object:'label',date:'2026-10-08',evidence:'I will send the label tomorrow.'}],
  recommendations:[{action:{...action},rationale:'Approval pending.',timingReason:'Allow time.'},{action:{...action,description:'Propose coordinating a review through Robert.'},rationale:'Resolve approval through known contact.',timingReason:'Coordinate ahead of habitual Wednesday.'}],preferredRecommendation:'candidate_1'})
const bundle=()=>parseSmartCandidates(fixture(),source,now,zone)
const response=(body:unknown,status=200)=>(async()=>new Response(JSON.stringify(body),{status})) as typeof fetch
const answer=(choice:string)=>({answers:[{name:'smart_next_step',type:'choice',choice,confidence:.8}],usage:{input_tokens:500}})

test('feature is opt-in; default request and output contract remain unchanged',()=>{
  for(const value of ['', 'off','true','shadow','typo'])assert.equal(smartSelectorEnabled(value),false)
  assert.equal(smartSelectorEnabled('decisions'),true)
  const normal=buildVisitRequest(source,now,zone,'gpt-6-sol')
  const experimental=buildVisitRequest(source,now,zone,'gpt-6-sol',true)
  assert.notDeepEqual(normal.response_format,experimental.response_format)
  assert.equal(SMART_CANDIDATE_SCHEMA.properties.recommendations.maxItems,3)
  assert.doesNotMatch(SMART_CANDIDATE_PROMPT,/output at most one recommendation overall|one recommendation at most|Do not force three candidates or output the alternatives/)
})
test('invalid candidate is isolated without dropping commitments or the other alternative',()=>{
  const raw=fixture();raw.recommendations[0].action.evidence='The trial was approved.'
  const b=parseSmartCandidates(raw,source,now,zone)
  assert.equal(b.rejected,1);assert.deepEqual(b.candidates.map(c=>c.id),['candidate_1'])
  assert.equal(b.facts.actions[0].description,'Send label.')
  assert.equal('preferredRecommendation' in b.facts,false)
  assert.equal('recommendations' in b.facts,false)
})
test('malformed advice is discarded; invalid facts still fail validation',()=>{
  assert.equal(parseSmartCandidates({...fixture(),recommendations:'wrong'},source,now,zone).facts.actions.length,1)
  assert.equal(parseSmartCandidates({...fixture(),recommendations:Array(4).fill(fixture().recommendations[0])},source,now,zone).candidates.length,0)
  assert.throws(()=>parseSmartCandidates({...fixture(),actions:[{}]},source,now,zone))
})
test('selected alternative cannot modify facts, commitments or input bundle',()=>{
  const b=bundle(),before=structuredClone(b)
  const output=applySmartChoice(b,'candidate_1')
  assert.deepEqual(output.actions.slice(0,-1),b.facts.actions)
  assert.equal(output.summary,b.facts.summary)
  assert.equal(output.actions.at(-1)?.description,b.candidates[1].action.description)
  assert.equal(output.actions.at(-1)?.origin,'recommendation')
  output.actions[0].description='mutation'
  assert.deepEqual(b,before)
  assert.deepEqual(applySmartChoice(b,'none'),b.facts)
  assert.deepEqual(applySmartChoice(b,'unknown'),b.facts)
})
test('request includes original note and all candidates, but hides generator preference',()=>{
  const req=buildSmartDecisionRequest(bundle(),source,now,zone)
  assert.equal(JSON.parse(req.input).note,source)
  assert.doesNotMatch(req.input,/modelChoice|preferredRecommendation/)
  assert.deepEqual(req.questions[0].choices.map(c=>c.value),['candidate_0','candidate_1','none'])
  assert.match(req.questions[0].instructions,/Absence of an agreed call or rep promise is NOT a contact prohibition/)
  assert.match(req.questions[0].instructions,/Existing work for one customer does not cover a different customer's blocker/)
})
test('API result selects only known candidate and preserves usage separately',async()=>{
  const r=await selectSmartNextStep(bundle(),source,now,zone,{apiKey:'test',fetcher:response(answer('candidate_1'))})
  assert.equal(r.selection.status,'selected');assert.equal(r.selection.inputTokens,500)
  assert.equal(r.extraction.actions.length,2)
})
test('refusal, malformed answer, unknown id, errors and timeout keep facts without advice',async()=>{
  for(const body of [answer('unknown'),{answers:[{name:'smart_next_step',type:'refusal'}]},{answers:[]},{answers:[{name:'wrong',type:'choice',choice:'candidate_1'}]},null]){
    const r=await selectSmartNextStep(bundle(),source,now,zone,{apiKey:'test',fetcher:response(body)})
    assert.deepEqual(r.extraction,bundle().facts)
  }
  const error=await selectSmartNextStep(bundle(),source,now,zone,{apiKey:'test',fetcher:response({},429)})
  assert.equal(error.selection.httpStatus,429)
  const timeout=await selectSmartNextStep(bundle(),source,now,zone,{apiKey:'test',timeoutMs:5,fetcher:(()=>new Promise(()=>{})) as typeof fetch})
  assert.equal(timeout.selection.status,'unavailable');assert.deepEqual(timeout.extraction,bundle().facts)
})
test('no candidates performs no request, and none is a valid successful result',async()=>{
  const b=bundle();b.candidates=[]
  const skipped=await selectSmartNextStep(b,source,now,zone,{apiKey:'test',fetcher:async()=>{throw Error('must not call')}})
  assert.equal(skipped.selection.status,'no_candidates')
  const none=await selectSmartNextStep(bundle(),source,now,zone,{apiKey:'test',fetcher:response(answer('none'))})
  assert.equal(none.selection.status,'none');assert.deepEqual(none.extraction,bundle().facts)
})
