import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {VISIT_ROLES,roleIssues} from '../eval/visit-roles'
import {confirmVisitField,parseVisitExtraction,visitActionFields,visitExtractionResult,type VisitExtraction} from '../lib/visitExtraction'
import {calendarDraftFromAction,googleCalendarUrl} from '../lib/calendarDraft'
import {formatProfessionalCrmNote} from '../lib/formatCrmSalesNote'
import CompactVisitResult from '../app/components/CompactVisitResult'

test('role evaluation covers competitors, actual participants and explicit recipients in both languages',()=>{
  assert.equal(VISIT_ROLES.length,8)
  assert.equal(new Set(VISIT_ROLES.map(c=>c.id)).size,8)
  assert.equal(VISIT_ROLES.filter(c=>c.language==='Spanish').length,4)
  for(const c of VISIT_ROLES){
    assert.ok(c.headerContacts && c.headerCompanies)
    for(const a of c.actions)assert.ok(c.note.includes(a.evidence))
  }
})
test('role evaluator catches a competitor in the header, without a hardcoded name blacklist',()=>{
  const c=VISIT_ROLES.find(c=>c.id==='en-helena-visited-company')!
  const v:VisitExtraction={language:'English',contacts:['Sarah'],companies:['Helena'],summary:'Met Sarah at Helena; AgriWest is cheaper.',insights:[],location:'',actions:[],questions:[]}
  assert.deepEqual(roleIssues(c,v),[])
  assert.deepEqual(roleIssues(c,{...v,companies:['Helena','AgriWest']}),['header-companies'])
  assert.deepEqual(roleIssues(c,{...v,contacts:['Sarah','Oscar']}),['header-contacts'])
})

// Recorded real API outputs, replayed offline. These do not prove future model accuracy.
for(const id of ['es-messy-roles','en-messy-roles']){
  test(`recorded ${id}: header, CRM and Calendar preserve distinct roles`,()=>{
    const c=VISIT_ROLES.find(c=>c.id===id)!
    const rows=readFileSync(new URL('../eval/visit-v2-run-12.jsonl',import.meta.url),'utf8').trim().split('\n').map(line=>JSON.parse(line))
    const extraction=parseVisitExtraction(rows.find(r=>r.id===id).output,c.note)
    assert.deepEqual(roleIssues(c,extraction),[])
    assert.equal(extraction.actions.length,1)
    assert.equal(extraction.actions[0].type,'send')
    const result=visitExtractionResult(extraction,'2026-09-10T18:00:00Z')
    const crm=formatProfessionalCrmNote(result)
    assert.equal(crm.split('\n')[0],'Carlos — Robles Family Farms')
    assert.match(crm,/AgriWest/);assert.match(crm,/Oscar/)
    assert.match(crm,/viernes|Friday/)
    const html=renderToStaticMarkup(createElement(CompactVisitResult,{extraction,timezone:'America/Los_Angeles',onCalendar:()=>{},onCopy:async()=>{},onVoice:()=>{},onClarify:()=>{},recording:false,voiceDisabled:false}))
    assert.match(html,/Carlos · Robles Family Farms/)
    assert.doesNotMatch(html,/Carlos, Oscar|Robles Family Farms, AgriWest/)
    const before=calendarDraftFromAction(visitActionFields(extraction.actions[0],extraction.language),extraction.language,'America/Los_Angeles')
    assert.equal(googleCalendarUrl(before),null)
    const q=extraction.questions.find(q=>q.field==='date')!
    const confirmed=confirmVisitField(extraction,q,'2026-09-11')
    const draft=calendarDraftFromAction(visitActionFields(confirmed.actions[0],confirmed.language),confirmed.language,'America/Los_Angeles')
    const params=new URL(googleCalendarUrl(draft)!).searchParams
    assert.match(params.get('text')!,/tank mix.*Carlos/i)
    assert.doesNotMatch(params.get('text')!,/Oscar|AgriWest/)
    assert.ok(params.get('details')!.endsWith(extraction.actions[0].description))
    assert.ok([params.get('text'),params.get('details')].join(' ').includes('Robles Family Farms'))
    assert.equal(params.get('dates'),'20260911T160000Z/20260911T163000Z')
    assert.equal(draft.timeSuggested,true)
  })
}
