import assert from 'node:assert/strict'
import {test} from 'node:test'
import {recoverHistoryRow, type HistoryRow} from '../lib/historyRecovery'

const empty={crmText:'',crmFull:[] as string[],contact:'',actions:[]}
const row=(id:string,structured_output:unknown):HistoryRow=>({id,created_at:'2026-09-11T09:00:00Z',raw_text:'Call Ana tomorrow.',structured_output})
test('one corrupted row does not hide its neighbours or change pagination count',()=>{
  const rows=[row('a',{crmText:'Visit A'}),row('b',{schemaVersion:2,extraction:{actions:null}}),row('c',{crmText:'Visit C'})]
  const before=JSON.stringify(rows)
  const recovered=rows.map(r=>recoverHistoryRow(r,empty,input=>input))
  assert.equal(recovered.length,3)
  assert.deepEqual(recovered.map(r=>r.recoveryRequired),[false,true,false])
  assert.equal(recovered[1].id,'b'); assert.equal(recovered[1].transcript,rows[1].raw_text)
  assert.equal(recovered[1].result.crmText,rows[1].raw_text)
  assert.deepEqual(recovered[1].result.actions,[])
  assert.equal(JSON.stringify(rows),before)
})
test('null, wrong text types and normalization exceptions retain raw transcript without actions',()=>{
  for(const raw of [null,[],{contact:42},{crmFull:[{}]}]) {
    const recovered=recoverHistoryRow(row('a',raw),empty,input=>input)
    assert.equal(recovered.recoveryRequired,true);assert.equal(recovered.result.crmText,'Call Ana tomorrow.')
  }
  assert.equal(recoverHistoryRow(row('a',{}),empty,()=>{throw Error('legacy malformed')}).recoveryRequired,true)
})
test('valid versioned extraction passes validation and invokes normalizer',()=>{
  const extraction={language:'English',contacts:['Ana'],companies:[],location:'',summary:'Visit.',insights:[],actions:[{type:'call',contact:'Ana',company:'',object:'',description:'Call Ana',date:'2026-09-12',time:'',evidence:'Call Ana tomorrow.'}],questions:[]}
  let calls=0
  const recovered=recoverHistoryRow(row('a',{schemaVersion:2,extraction}),empty,input=>{calls++;return {...input,contact:'Ana'}})
  assert.equal(calls,1);assert.equal(recovered.recoveryRequired,false);assert.equal(recovered.result.contact,'Ana')
})
