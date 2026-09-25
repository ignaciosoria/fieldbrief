import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import {visitExtractionResult,visitActionFields} from '../lib/visitExtraction'
import {calendarDraftFromAction} from '../lib/calendarDraft'
import {formatProfessionalCrmNote} from '../lib/formatCrmSalesNote'

// Recorded paid outputs, not new inference. This guards adapters against regressions;
// ten observations do not establish the model's general accuracy or audio quality.
const records=readFileSync(new URL('../eval/followup-corrections-20260924.jsonl',import.meta.url),'utf8').trim().split('\n').map(line=>JSON.parse(line))
const meta=records[0],rows=records.slice(1)
test('follow-up correction recording covers both languages and all five stages',()=>{
  assert.equal(rows.length,10)
  assert.deepEqual(rows.map(r=>r.id).sort(),['en','es'].flatMap(lang=>['baseline','name','time','fact','recipient'].map(kind=>`${lang}-${kind}`)).sort())
})
for(const row of rows)test(`live correction replay ${row.id}`,()=>{
  assert.equal(row.error,undefined)
  assert.deepEqual(row.checks,[])
  const result=visitExtractionResult(row.output,meta.now,meta.zone)
  assert.equal(formatProfessionalCrmNote(result),row.crm)
  const drafts=result.extraction.actions.map(action=>calendarDraftFromAction(visitActionFields(action,result.extraction.language),result.extraction.language,meta.zone))
  assert.deepEqual(drafts,row.calendar)
  const baseline=rows.find(r=>r.id===row.id.slice(0,2)+'-baseline')!
  assert.deepEqual(drafts[1],baseline.calendar[1],'Unrelated Laura event must remain identical')
  if(row.id.endsWith('-name')||row.id.endsWith('-time'))assert.doesNotMatch(row.crm,/\bMike\b/)
  if(row.id.endsWith('-name'))assert.equal(drafts[0].date,'2026-09-25','Name-only change keeps original tomorrow')
  if(row.id.endsWith('-time')){assert.equal(drafts[0].date,'2026-10-01');assert.equal(drafts[0].time,'15:00');assert.equal(drafts[0].timeSuggested,true)}
  if(row.id.endsWith('-fact')){
    assert.match(row.crm,/did not approve|no aprobó/)
    assert.doesNotMatch(row.crm,/cancel|anul|withdraw/i)
    assert.doesNotMatch(drafts[0].details,/delivery|entrega/i)
    assert.match(drafts[0].details,/Q7/)
  }
  if(row.id.endsWith('-recipient')){
    assert.equal(row.output.actions[0].contact,'Tom')
    assert.equal(row.output.actions[0].company,'Northfield')
    assert.match(row.output.summary,/Mike/)
    assert.match(row.output.summary,/approved|aprobó/)
    assert.doesNotMatch(JSON.stringify(drafts[0]),/Mike|Valley|Laura|Alba/)
  }
})
