import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import {MESSY_TEXT_CASES} from '../eval/messy-text-corpus'
import {gradeMessyText,auditMessyText} from '../eval/messy-text-grade'
import {parseVisitExtraction,visitActionFields,type VisitExtraction} from '../lib/visitExtraction'
import {calendarDraftFromAction} from '../lib/calendarDraft'
type Row={id?:string;output?:VisitExtraction;rawOutput?:string}
const read=(run:number)=>(readFileSync(new URL(`../eval/messy-text-${run}.jsonl`,import.meta.url),'utf8').trim().split('\n').map(line=>JSON.parse(line)) as Row[])
test('recorded capitalization rejection replays without semantic rewriting or a paid retry',()=>{
  const raw=JSON.parse(read(1).find(r=>r.id==='messy-12-3')!.rawOutput!) as VisitExtraction
  const c=MESSY_TEXT_CASES.find(c=>c.id==='messy-12-3')!
  const parsed=parseVisitExtraction(raw,c.note)
  assert.deepEqual(gradeMessyText(c,parsed),[])
  const expected=structuredClone(raw)
  expected.actions[0].evidence=expected.actions[0].evidence.replace(/^yo/,'Yo')
  assert.deepEqual(parsed,expected)
})
// Recorded final outputs test downstream stability, not future stochastic model accuracy.
for(const id of ['messy-01-3','messy-19-1','messy-19-2','messy-22-1','messy-24-1']){
  test(`recorded ${id}: corrected meaning survives validation and calendar adaptation`,()=>{
    const c=MESSY_TEXT_CASES.find(c=>c.id===id)!
    const v=parseVisitExtraction(read(3).find(r=>r.id===id)!.output,c.note)
    assert.deepEqual(gradeMessyText(c,v),[])
    assert.deepEqual(auditMessyText(c,v),[])
    for(const a of v.actions){
      const draft=calendarDraftFromAction(visitActionFields(a,v.language),v.language,c.zone)
      assert.ok(draft.details.endsWith(a.description))
      assert.ok(Array.from(draft.title).length<=44)
      assert.ok(c.note.includes(a.evidence))
    }
  })
}
