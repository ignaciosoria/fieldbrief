import assert from 'node:assert/strict'
import {test} from 'node:test'
import {notesRequest} from '../lib/notesClient'

test('notes requests preserve the save id, custom headers and one attempt',async()=>{
  let calls=0
  const fetcher:typeof fetch=async(_url,init)=>{
    calls++
    assert.equal(init?.method,'PUT')
    assert.equal(JSON.parse(init?.body as string).id,'same-note')
    assert.equal(new Headers(init?.headers).get('X-Test'),'yes')
    assert.equal(init?.cache,'no-store')
    return Response.json({saved:true})
  }
  assert.deepEqual(await notesRequest('/api/notes',{method:'PUT',headers:new Headers({'X-Test':'yes'}),body:JSON.stringify({id:'same-note'})},{fetcher}),{saved:true})
  assert.equal(calls,1)
})

test('notes timeout covers both the connection and a stalled JSON body without retries',async()=>{
  for(const phase of ['connection','body']) {
    let calls=0;let signal:AbortSignal|undefined|null
    const fetcher:typeof fetch=async(_url,init)=>{
      calls++;signal=init?.signal
      if(phase==='connection') return new Promise<Response>(()=>{})
      return {ok:true,json:()=>new Promise(()=>{})} as Response
    }
    await assert.rejects(notesRequest('/api/notes',{method:'PUT'},{fetcher,timeoutMs:5}),/too long.*may already have been saved/)
    assert.equal(calls,1);assert.equal(signal?.aborted,true)
  }
})

test('notes errors handle non-JSON proxy failures and failed HTTP status',async()=>{
  await assert.rejects(notesRequest('/api/notes',undefined,{fetcher:async()=>new Response('<html>502</html>',{status:502})}),/unreadable response/)
  await assert.rejects(notesRequest('/api/notes',undefined,{fetcher:async()=>Response.json({error:'Synthetic save failure'},{status:503})}),/Synthetic save failure/)
})

test('caller cancellation is respected before and during a request',async()=>{
  const controller=new AbortController();controller.abort()
  let calls=0
  await assert.rejects(notesRequest('/api/notes',{signal:controller.signal},{fetcher:async()=>{calls++;return Response.json({})}}),/cancelled/)
  assert.equal(calls,0)
  const later=new AbortController()
  await assert.rejects(notesRequest('/api/notes',{signal:later.signal},{fetcher:async()=>{later.abort();return new Promise<Response>(()=>{})}}),/cancelled/)
})
