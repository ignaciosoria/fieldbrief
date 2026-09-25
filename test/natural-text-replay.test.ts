/** Offline replay of recorded model outputs, not a new extraction accuracy test. */
import {readFileSync} from 'node:fs'
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {NATURAL_CASES} from '../eval/natural-text-corpus'
import {naturalView} from '../eval/natural-text-grade'
import {parseVisitExtraction} from '../lib/visitExtraction'
import {reviewedRendering} from './fixtures/natural-rendering-migration'
const rows=readFileSync(new URL('../eval/natural-text-final.jsonl',import.meta.url),'utf8').trim().split('\n').map(line=>JSON.parse(line)).filter(row=>row.id)
test('every archived response has an individually reviewed presentation expectation',()=>{
 assert.deepEqual(rows.map(r=>r.id).sort(),Object.keys(reviewedRendering).sort())
})
for(const row of rows)test(`recorded ${row.id}: reviewed presentation migration preserves historical data`,()=>{
 const input=NATURAL_CASES.find(c=>c.id===row.id)!
 assert.ok(input);assert.ok(row.output);assert.equal(row.error,undefined)
 const parsed=parseVisitExtraction(row.output,input.note)
 const before=structuredClone(parsed),review=reviewedRendering[row.id]
 // Only migrate the explicitly reviewed presentation differences. Keep frozen
 // action wording, dates, questions, insights and all other calendar fields.
 const sections:string[]=row.view.crm.split('\n\n')
 let steps=sections.find(s=>/^(Acuerdos y próximos pasos|Agreements and next steps):/.test(s))||''
 steps=steps.replace(/^Acuerdos y próximos pasos:/,'Próximos pasos:').replace(/^Agreements and next steps:/,'Next steps:')
 if(review.soleOwner)steps=steps.split(`- ${review.soleOwner}: `).join('- ')
 const clarification=sections.find(s=>/^(Pendiente de aclarar|To clarify):/.test(s))||''
 const expected=structuredClone(row.view)
 expected.crm=[review.header,review.narrative,steps,clarification].filter(Boolean).join('\n\n')
 if(review.fatherTitle){
   const draft=expected.drafts[2]
   assert.equal(draft.title,'Reunión sobre pedido grande')
   assert.ok(draft.details.startsWith('el padre de Diego\n\n'))
   draft.title=review.fatherTitle
   draft.details=draft.details.slice('el padre de Diego\n\n'.length)
 }
 const rendered=naturalView(parsed)
 assert.deepEqual(rendered,expected)
 assert.deepEqual(parsed,before,'rendering must not mutate source extraction')
 for(const draft of rendered.drafts)assert.ok(Array.from(draft.title).length<=44)
})

test('historical factuality defects remain visible, not silently rewritten as successful extractions',()=>{
 const lab=rows.find(r=>r.id==='natural-26')!
 assert.match(lab.output.insights.join(' '),/Yellow leaves were reported as an issue/)
 const dates=rows.find(r=>r.id==='natural-29')!
 assert.match(dates.output.summary,/lunes y martes/)
 assert.ok(dates.output.questions.some((q:{field:string})=>q.field==='date'))
 // This test preserves evidence only. Current-prompt semantic regressions are
 // assessed separately, never by approving an archived rendering snapshot.
})
