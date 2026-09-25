/** Recorded API regression, not fresh model inference. */
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {parseSalesDecision} from '../lib/salesDecision'
import {SOL_CORRECTION_CASES,checkSolCorrection} from '../eval/sol-correction-corpus'

const rows=readFileSync(new URL('../eval/sol-correction-20260924.jsonl',import.meta.url),'utf8').trim().split('\n').map(line=>JSON.parse(line)).filter(row=>row.id&&!row.metadata)
test('correction eval contains exactly two recorded responses per case',()=>{
  assert.equal(rows.length,16)
  for(const c of SOL_CORRECTION_CASES)assert.deepEqual(rows.filter(r=>r.id===c.id).map(r=>r.repeat).sort(),[0,1])
})
for(const row of rows)test(`Sol correction replay: ${row.id}, repeat ${row.repeat}`,()=>{
  const c=SOL_CORRECTION_CASES.find(c=>c.id===row.id)!
  assert.equal(row.error,undefined)
  // This corpus expects no advice; reconstruct wire field to test source validation.
  const parsed=parseSalesDecision({...row.output,recommendations:[]},c.note,'2026-09-24T18:30:00Z','America/Los_Angeles')
  assert.deepEqual(checkSolCorrection(c.id,parsed),[])
  assert.equal(parsed.questions.length,0)
  if(c.id==='original-two-contacts'){
    const eva=parsed.actions.find(a=>a.contact==='Eva')!,tom=parsed.actions.find(a=>a.contact==='Tom')!
    assert.equal(eva.company,'AlbaGrow');assert.equal(eva.date,'2026-09-25');assert.equal(eva.daypart,'afternoon')
    assert.match(eva.description,/without prices|no prices/i)
    assert.equal(tom.company,'Northfield');assert.equal(tom.date,'2026-09-29');assert.equal(tom.time,'10:30')
  }
})

const attributionRows=readFileSync(new URL('../eval/sol-correction-attribution-20260924.jsonl',import.meta.url),'utf8').trim().split('\n').map(line=>JSON.parse(line)).filter(row=>row.id&&!row.metadata)
test('attribution follow-up contains both cases twice',()=>{
  assert.equal(attributionRows.length,4)
  for(const id of ['mixed-scope','outcome-repair'])assert.deepEqual(attributionRows.filter(r=>r.id===id).map(r=>r.repeat).sort(),[0,1])
})
for(const row of attributionRows)test(`Sol attribution replay: ${row.id}, repeat ${row.repeat}`,()=>{
  assert.equal(row.error,undefined)
  const c=SOL_CORRECTION_CASES.find(c=>c.id===row.id)!
  const parsed=parseSalesDecision({...row.output,recommendations:[]},c.note,'2026-09-24T18:30:00Z','America/Los_Angeles')
  assert.deepEqual(checkSolCorrection(row.id,parsed),[])
  const prose=[parsed.summary,...parsed.insights].join(' ')
  if(row.id==='mixed-scope'){
    assert.doesNotMatch(prose,/asked|requested|told|demanded/i)
    assert.match(prose,/no further contact/i)
    assert.match(prose,/Nadia.*cancel/i)
  }else{
    assert.match(prose,/pidió/i)
    assert.match(prose,/no.*evalu/i)
  }
})
