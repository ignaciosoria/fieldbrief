import assert from 'node:assert/strict'
import {test} from 'node:test'
import {handleTranscription} from '../lib/transcriptionHandler'
import {MAX_AUDIO_BYTES} from '../lib/audioUpload'
import {fetchWithTimeout} from '../lib/fetchWithTimeout'
import type {AiAccessDecision} from '../lib/aiAccess'

const upload=(size=10)=>{
  const form=new FormData();form.set('file',new File([new Uint8Array(size)],'visit.webm',{type:'audio/webm'}))
  return new Request('https://folup.example.test/api/transcribe',{method:'POST',body:form})
}
function setup(decision:AiAccessDecision='allowed') {
  let reserves=0,calls=0
  return {
    deps:{getEmail:async()=> 'owner@example.test',reserve:async(email:string)=>{assert.equal(email,'owner@example.test');reserves++;return decision},transcribe:async()=>{calls++;return 'Una visita de prueba.'}},
    counts:()=>({reserves,calls}),
  }
}
test('anonymous uploads do not parse bodies, reserve quota or call the provider',async()=>{
  const s=setup()
  const response=await handleTranscription(new Request('https://folup.example.test',{method:'POST',body:'invalid'}),{...s.deps,getEmail:async()=>null})
  assert.equal(response.status,401);assert.deepEqual(s.counts(),{reserves:0,calls:0})
})
test('empty, malformed and oversized uploads do not consume quota',async()=>{
  for(const [request,status] of [[upload(0),400],[upload(MAX_AUDIO_BYTES+1),413],[new Request('https://folup.example.test',{method:'POST',body:'invalid'}),400]] as const) {
    const s=setup();assert.equal((await handleTranscription(request,s.deps)).status,status)
    assert.deepEqual(s.counts(),{reserves:0,calls:0})
  }
  const s=setup()
  const request=new Request('https://folup.example.test',{method:'POST',headers:{'content-length':'5000000'},body:'invalid'})
  assert.equal((await handleTranscription(request,s.deps)).status,413)
  assert.deepEqual(s.counts(),{reserves:0,calls:0})
})
test('quota and rate denials never reach transcription',async()=>{
  for(const [decision,status] of [['quota_exceeded',403],['rate_limited',429]] as const) {
    const s=setup(decision);assert.equal((await handleTranscription(upload(),s.deps)).status,status)
    assert.deepEqual(s.counts(),{reserves:1,calls:0})
  }
})
test('valid audio reserves once and returns noncacheable transcript',async()=>{
  const s=setup();const response=await handleTranscription(upload(),s.deps)
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store')
  assert.deepEqual(await response.json(),{transcript:'Una visita de prueba.'})
  assert.deepEqual(s.counts(),{reserves:1,calls:1})
})
test('authentication and quota database failures fail closed',async()=>{
  for(const override of [{getEmail:async()=>{throw Error('secret')}},{reserve:async()=>{throw Error('secret')}}]) {
    const s=setup();const response=await handleTranscription(upload(),{...s.deps,...override})
    assert.equal(response.status,503);assert.equal(s.counts().calls,0)
    assert.doesNotMatch(await response.text(),/secret/)
  }
})
test('provider errors are sanitized and timeouts have a distinct retryable code',async()=>{
  for(const name of ['Error','APIConnectionTimeoutError']) {
    const s=setup();const error=new Error('private customer, provider key and request details');error.name=name
    const response=await handleTranscription(upload(),{...s.deps,transcribe:async()=>{throw error}})
    assert.equal(response.status,name==='Error'?502:504)
    assert.doesNotMatch(await response.text(),/private|provider key|request details/)
  }
})
test('empty provider text is not passed to extraction',async()=>{
  const s=setup();const response=await handleTranscription(upload(),{...s.deps,transcribe:async()=> '   '})
  assert.equal(response.status,422);assert.equal((await response.json()).code,'NO_SPEECH')
})
test('browser upload timeout aborts one attempt without implicit retries',async()=>{
  let calls=0
  const hanging:typeof fetch=async(_url,init)=>{
    calls++
    return new Promise((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(Error('aborted'))))
  }
  await assert.rejects(()=>fetchWithTimeout('/api/transcribe',{method:'POST'},5,hanging),/took too long/)
  assert.equal(calls,1)
  const response=await fetchWithTimeout('/api/transcribe',{},50,async()=>new Response('ok'))
  assert.equal(await response.text(),'ok')
})
