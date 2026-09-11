import assert from 'node:assert/strict'
import {test} from 'node:test'
import {fetchWithTimeout} from '../lib/fetchWithTimeout'

test('AI timeout covers response body after headers have already arrived',async()=>{
  let calls=0, signal:AbortSignal|null|undefined
  const stream=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{"partial":'))}})
  await assert.rejects(fetchWithTimeout('/api/structure',{},10,async(_url,init)=>{
    calls++;signal=init?.signal;return new Response(stream)
  }),/took too long/)
  assert.equal(calls,1);assert.equal(signal?.aborted,true)
})
test('deadline releases callers even when the transport ignores abort',async()=>{
  let calls=0
  await assert.rejects(fetchWithTimeout('/api/transcribe',{},10,async()=>{calls++;return new Promise(()=>{})}),/took too long/)
  assert.equal(calls,1)
})
test('buffered API errors preserve status headers and non-JSON body',async()=>{
  const response=await fetchWithTimeout('/api/transcribe',{},100,async()=>new Response('<html>Too large</html>',{status:413,headers:{'Retry-After':'60'}}))
  assert.equal(response.status,413);assert.equal(response.ok,false)
  assert.equal(response.headers.get('retry-after'),'60');assert.equal(await response.text(),'<html>Too large</html>')
})
test('caller cancellation is preserved and pre-cancelled calls never start',async()=>{
  const controller=new AbortController();controller.abort()
  let calls=0
  await assert.rejects(fetchWithTimeout('/api/structure',{signal:controller.signal},100,async()=>{calls++;return new Response('{}')}),/cancelled/)
  assert.equal(calls,0)
  const active=new AbortController()
  const pending=fetchWithTimeout('/api/structure',{signal:active.signal},100,async()=>{active.abort();return new Promise(()=>{})})
  await assert.rejects(pending,/cancelled/)
})
test('successful and empty responses remain readable after timer cleanup',async()=>{
  const response=await fetchWithTimeout('/api/structure',{},10,async()=>Response.json({actions:[]}))
  await new Promise(resolve=>setTimeout(resolve,20))
  assert.deepEqual(await response.json(),{actions:[]})
  const empty=await fetchWithTimeout('/api/structure',{},10,async()=>new Response(null,{status:204}))
  assert.equal(empty.status,204)
})
