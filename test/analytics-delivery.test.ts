import assert from 'node:assert/strict'
import {test} from 'node:test'
import {deliverAnalytics} from '../lib/analyticsDelivery'
const payload={event:'note_saved',uuid:'12345678-1234-4234-8234-123456789abc',timestamp:new Date('2026-10-10T00:00:00Z'),properties:{distinct_id:'22345678-1234-4234-8234-123456789abc',is_internal:true}}
test('transient HTTP errors and timeouts retry the identical event, without changing business result',async()=>{
  const bodies:unknown[]=[],pauses:number[]=[],warnings:unknown[]=[]
  const ok=await deliverAnalytics(payload,{key:'SECRET',host:'https://us.i.posthog.com',pause:async ms=>{pauses.push(ms)},warn:(...args)=>warnings.push(args),send:async(url,init)=>{
    assert.equal(url,'https://us.i.posthog.com/i/v0/e/');bodies.push(init?.body)
    if(bodies.length===1)return new Response('PRIVATE',{status:503})
    if(bodies.length===2)throw new DOMException('PRIVATE','TimeoutError')
    return Response.json({status:1})
  }})
  assert.equal(ok,true);assert.equal(bodies.length,3);assert.equal(new Set(bodies).size,1)
  assert.deepEqual(pauses,[250,500]);assert.deepEqual(warnings,[])
  const sent=JSON.parse(String(bodies[0]));assert.equal(sent.uuid,payload.uuid);assert.equal(sent.distinct_id,payload.properties.distinct_id)
})
test('permanent rejection is surfaced once; diagnostics contain no response body, token or identity',async()=>{
  let calls=0;const warnings:unknown[]=[]
  assert.equal(await deliverAnalytics(payload,{key:'SECRET',host:'https://us.i.posthog.com',warn:(...args)=>warnings.push(args),send:async()=>{calls++;return new Response('PRIVATE',{status:400})}}),false)
  assert.equal(calls,1);assert.match(JSON.stringify(warnings),/400/);assert.doesNotMatch(JSON.stringify(warnings),/SECRET|PRIVATE|12345678|22345678/)
})
test('rate limits stop after three attempts and invalid hosts never receive credentials',async()=>{
  let calls=0;const options={key:'SECRET',host:'https://us.i.posthog.com',pause:async()=>{},warn:()=>{},send:async()=>{calls++;return new Response(null,{status:429})}}
  assert.equal(await deliverAnalytics(payload,options),false);assert.equal(calls,3)
  assert.equal(await deliverAnalytics(payload,{...options,host:'https://example.com'}),false);assert.equal(calls,3)
})
