import assert from 'node:assert/strict'
import {test} from 'node:test'
import {persistThenPublishCorrection} from '../lib/visitCorrection'

test('failed correction save leaves both visible result and transcript unchanged; retry publishes together',async()=>{
  const original={result:'Call Mike Tuesday',transcript:'Mike, Tuesday'}
  const corrected={result:'Call Mark Thursday',transcript:'Mike, Tuesday. Correction: Mark, Thursday'}
  let visible=original
  let stored=original
  await assert.rejects(persistThenPublishCorrection(async()=>{throw Error('Offline')},()=>{visible=corrected}),/Offline/)
  assert.equal(visible,original)
  assert.equal(stored,original)
  await persistThenPublishCorrection(async()=>{stored=corrected},()=>{
    assert.equal(stored,corrected)
    visible=corrected
  })
  assert.equal(visible,corrected)
})

test('a pending save does not publish the correction prematurely',async()=>{
  let finish!:()=>void
  const saved=new Promise<void>(resolve=>{finish=resolve})
  let published=false
  const pending=persistThenPublishCorrection(()=>saved,()=>{published=true})
  await Promise.resolve()
  assert.equal(published,false)
  finish()
  await pending
  assert.equal(published,true)
})
