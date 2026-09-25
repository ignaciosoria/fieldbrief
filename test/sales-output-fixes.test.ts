import {test} from 'node:test'
import assert from 'node:assert/strict'
import {formatProfessionalCrmNote} from '../lib/formatCrmSalesNote'
import {visitExtractionResult,visitActionFields,VISIT_PROMPT,type VisitExtraction} from '../lib/visitExtraction'
import {SALES_PROMPT,parseSalesDecision} from '../lib/salesDecision'
import {calendarDraftFromAction} from '../lib/calendarDraft'
import {suggestCalendarSchedule} from '../lib/calendarSuggestion'
import {readFileSync} from 'node:fs'

const note:VisitExtraction={language:'English',contacts:['Eva'],companies:['Hillcrest'],location:'',summary:'Eva wants to consider a trial only after written permit approval. No technical issue was reported.',insights:['The trial depends on written permit approval.','No technical issue was reported.'],actions:[],questions:[]}
test('complete CRM context is exported once, legacy notes still preserve extra insight facts',()=>{
  const modern=formatProfessionalCrmNote(visitExtractionResult({...note,crmNarrativeVersion:1},'2026-09-24T18:30:00Z'))
  assert.equal((modern.match(/permit approval/g)||[]).length,1)
  assert.match(modern,/No technical issue was reported/)
  assert.doesNotMatch(modern,/Met with|Visita/)
  const legacy=formatProfessionalCrmNote(visitExtractionResult({...note,insights:['Credit is blocked.']},'2026-09-24T18:30:00Z'))
  assert.match(legacy,/Credit is blocked/)
})
test('sales contract is versioned, no stale recommendation copy is persisted',()=>{
  const v=parseSalesDecision({...note,recommendations:[]},'Eva wants to consider a trial.','2026-09-24T18:30:00Z','America/Los_Angeles')
  assert.equal(v.crmNarrativeVersion,1)
  assert.equal('recommendations' in v,false)
  assert.match(SALES_PROMPT,/NOT 'Met with Eva at Hillcrest'/)
  assert.match(VISIT_PROMPT,/do NOT ask which day/)
  assert.match(VISIT_PROMPT,/Tuesday OR Thursday/)
})
test('a long father meeting retains the intended person in the compact title',()=>{
  const action={type:'meeting' as const,contact:'el padre de Roberto',company:'Estrada e Hijos',object:'',description:'Estudiar un pedido para tres fincas; no hay pedido aprobado.',subject:'pedido tres fincas',date:'',time:'',evidence:'visita con su padre la próxima semana',daypart:'unspecified' as const}
  const draft=calendarDraftFromAction(visitActionFields(action,'Spanish'),'Spanish','America/Los_Angeles')
  assert.match(draft.title,/el padre de Roberto/)
  assert.ok(Array.from(draft.title).length<=44)
  assert.match(draft.details,/tres fincas/)
  const schedule=suggestCalendarSchedule(draft,action.evidence,'2026-09-24T18:30:00Z','2026-09-24T18:30:00Z')
  assert.equal(schedule.date,'2026-09-28')
  assert.equal(schedule.dateSuggested,true)
})
test('genuine ambiguous clock time remains empty instead of quietly becoming 09:00',()=>{
  const draft=calendarDraftFromAction({type:'call',verb:'Call',contact:'Eva',company:'Hillcrest',object:'',date:'09/29/2026',time:'',daypart:'ambiguous'},'English','America/Los_Angeles')
  const schedule=suggestCalendarSchedule(draft,'nine or ten','2026-09-24T18:30:00Z','2026-09-24T18:30:00Z')
  assert.equal(schedule.time,'')
  assert.equal(schedule.timeSuggested,false)
})

test('replay repaired real outputs: no invented visit, no date questions, no appended insights',()=>{
  const rows=readFileSync(new URL('../eval/sales-smoke-fixes-20260924.jsonl',import.meta.url),'utf8').trim().split('\n').map(line=>JSON.parse(line)).filter(row=>row.id)
  assert.equal(rows.length,2)
  for(const row of rows){
    const v:VisitExtraction=row.output
    assert.equal(v.crmNarrativeVersion,1)
    assert.equal(v.questions.length,0)
    const crm=formatProfessionalCrmNote(visitExtractionResult(v,'2026-09-24T18:30:00Z'))
    assert.equal(crm.split('\n\n')[1],v.summary)
    if(row.id==='unknown-prerequisite'){
      assert.equal(v.location,'')
      assert.doesNotMatch(v.summary,/Met with|visited|meeting at/i)
      assert.match(v.summary,/No technical issue was reported/)
      assert.match(v.actions[0].description,/unless written approval/)
    }else{
      const drafts=v.actions.map(a=>calendarDraftFromAction(visitActionFields(a,v.language),v.language,'America/Los_Angeles'))
      assert.match(drafts[0].title,/Consultar ácaros/)
      assert.match(drafts[2].title,/el padre de Roberto/)
    }
  }
})
