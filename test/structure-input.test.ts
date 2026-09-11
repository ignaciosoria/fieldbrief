import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readStructureInput, MAX_STRUCTURE_BYTES } from '../lib/structureInput'
import { prepareStructure } from '../lib/structureAccess'

const request=(body:string)=>new Request('https://folup.example.test/api/structure',{method:'POST',body})
test('invalid JSON, empty and oversized notes do not consume quota',async()=>{
  for(const [body,status] of [['invalid',400],['null',400],['[]',400],['{}',400],['{"note":" "}',400],[JSON.stringify({note:'a'.repeat(20001)}),413],[JSON.stringify({note:'valid',extra:'x'.repeat(MAX_STRUCTURE_BYTES)}),413]] as const) {
    let reserves=0
    const result=await prepareStructure(request(body),{getEmail:async()=>'owner',reserve:async()=>{reserves++;return 'allowed'},readInput:readStructureInput})
    assert.ok(result instanceof Response);assert.equal(result.status,status);assert.equal(reserves,0)
  }
})
test('authentication precedes body parsing and quota reservation',async()=>{
  const req=request('invalid')
  const result=await prepareStructure(req,{getEmail:async()=>null,reserve:async()=>{throw Error('must not reserve')},readInput:readStructureInput})
  assert.ok(result instanceof Response);assert.equal(result.status,401);assert.equal(req.bodyUsed,false)
})
test('valid notes reserve once under authenticated identity and preserve date context',async()=>{
  let reserves=0
  const body={note:'Mañana llamar a Lucía.',clientNow:'2026-09-10T09:00:00-07:00',timezone:'America/Los_Angeles'}
  const result=await prepareStructure(request(JSON.stringify({...body,email:'attacker'})),{getEmail:async()=>'owner',reserve:async(email,operation)=>{assert.equal(email,'owner');assert.equal(operation,'structure');reserves++;return 'allowed'},readInput:readStructureInput})
  assert.deepEqual(result,body);assert.equal(reserves,1)
})
test('quota and database denials remain closed',async()=>{
  for(const [reserve,status] of [[async()=> 'quota_exceeded' as const,403],[async()=> 'rate_limited' as const,429],[async()=>{throw Error('secret')},503]] as const) {
    const result=await prepareStructure(request('{"note":"Call Bob"}'),{getEmail:async()=>'owner',reserve,readInput:readStructureInput})
    assert.ok(result instanceof Response);assert.equal(result.status,status);assert.doesNotMatch(await result.text(),/secret/)
  }
})
