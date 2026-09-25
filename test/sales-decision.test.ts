import test from 'node:test'
import assert from 'node:assert/strict'
import {parseSalesDecision,SALES_SCHEMA,SALES_PROMPT} from '../lib/salesDecision'
import {visitActionFields,visitExtractionResult} from '../lib/visitExtraction'
import {calendarDraftFromAction} from '../lib/calendarDraft'
import {suggestCalendarSchedule} from '../lib/calendarSuggestion'
import {formatProfessionalCrmNote} from '../lib/formatCrmSalesNote'
import {visitHeader} from '../lib/visitHeader'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import CompactVisitResult from '../app/components/CompactVisitResult'

const source='Met Mike at Valley. Mike needs to speak with his PCA first.'
const now='2026-09-24T18:00:00Z', zone='America/Los_Angeles'
const action={type:'follow_up',contact:'Mike',company:'Valley',object:'',description:'Ask whether Mike spoke with his PCA and whether technical information would help.',subject:'PCA review',date:'2026-09-29',time:'',daypart:'unspecified',evidence:'Mike needs to speak with his PCA first.'}
const fixture=()=>({contractVersion:3,language:'English',contacts:['Mike'],companies:['Valley'],location:'',summary:'Met Mike at Valley.',insights:['Mike needs to speak with his PCA first.'],actions:[],questions:[],recommendations:[{action:{...action},rationale:'Check the stated approval prerequisite without bypassing Mike.',timingReason:'Allow time for Mike to speak with his PCA.'}]})

test('suggestion provenance survives persistence, CRM and Calendar without altering facts',()=>{
  const parsed=parseSalesDecision(fixture(),source,now,zone)
  const restored=JSON.parse(JSON.stringify(parsed))
  assert.equal(restored.actions[0].origin,'recommendation')
  assert.equal(restored.summary,'Met Mike at Valley.')
  assert.equal(visitHeader(restored),'Mike / Valley') // advice cannot establish identity pairing
  const result=visitExtractionResult(restored,now,zone)
  const crm=formatProfessionalCrmNote(result)
  assert.match(crm,/Proposed follow-up:/)
  assert.doesNotMatch(crm,/Folup suggestions|not agreed; suggested dates/)
  assert.doesNotMatch(crm,/Next steps:/)
  const draft=calendarDraftFromAction(visitActionFields(restored.actions[0],'English'),'English',zone)
  assert.match(draft.details,/not an agreed commitment/)
  assert.equal(draft.date,'2026-09-29')
  assert.equal(suggestCalendarSchedule(draft,action.evidence,now,now).dateSuggested,true)
})

test('explicit commitments remain distinct and historical payloads still render',()=>{
  const raw=fixture()
  const committed={...action,description:'Call Mike.',origin:'recommendation'}
  const parsed=parseSalesDecision({...raw,actions:[committed]},source,now,zone)
  assert.equal(parsed.actions[0].origin,'commitment')
  const crm=formatProfessionalCrmNote(visitExtractionResult(parsed,now,zone))
  assert.match(crm,/Next steps:\n- Call Mike/)
  assert.match(crm,/Proposed follow-up/)
  const legacy={...parsed,actions:[{...parsed.actions[0],origin:undefined}]}
  assert.doesNotMatch(formatProfessionalCrmNote(visitExtractionResult(legacy,now,zone)),/Proposed follow-up/)
})

test('recommendations reject invented evidence, unknown recipients and invalid or past dates',()=>{
  for(const patch of [{contact:'PCA'},{company:'Competitor'},{evidence:'PCA approved the trial'},{date:''},{date:'2026-09-23'},{date:'2026-02-30'},{date:'2026-09-24',time:'09:00'}]){
    const raw=fixture();Object.assign(raw.recommendations[0].action,patch)
    assert.throws(()=>parseSalesDecision(raw,source,now,zone))
  }
})

test('no forced recommendation; enforce cap, suppress duplicate and unresolved identity advice',()=>{
  const raw=fixture()
  assert.equal(parseSalesDecision({...raw,recommendations:[]},source,now,zone).actions.length,0)
  assert.throws(()=>parseSalesDecision({...raw,recommendations:[...raw.recommendations,...raw.recommendations]},source,now,zone))
  assert.equal(parseSalesDecision({...raw,actions:[action]},source,now,zone).actions.length,1)
  assert.equal(parseSalesDecision({...raw,questions:[{action_index:-1,field:'contact',question:'Which Mike?'}]},source,now,zone).actions.length,0)
  assert.ok(SALES_SCHEMA.required.includes('recommendations'))
  assert.match(SALES_PROMPT,/requests not to contact/)
  assert.match(SALES_PROMPT,/unknown completion date/)
})

test('Spanish recommendations export in a separate suggested section',()=>{
  const raw=fixture();raw.language='Spanish'
  const crm=formatProfessionalCrmNote(visitExtractionResult(parseSalesDecision(raw,source,now,zone),now,zone))
  assert.match(crm,/Seguimiento propuesto:/)
  assert.doesNotMatch(crm,/Sugerencias de Folup|no acordadas; fechas sugeridas/)
  assert.doesNotMatch(crm,/Próximos pasos:/)
})

test('UI shows one labelled suggestion and retains the explicit calendar save button',()=>{
  let opened=0
  const html=renderToStaticMarkup(createElement(CompactVisitResult,{
    extraction:parseSalesDecision(fixture(),source,now,zone),timezone:zone,referenceAt:now,
    onCalendarOpened:()=>{opened++},onCopy:async()=>{},onVoice:()=>{},onClarify:()=>{},recording:false,voiceDisabled:false,
  }))
  assert.match(html,/Suggested by Folup/)
  assert.doesNotMatch(html,/Allow time for Mike|Check the stated approval prerequisite|not an agreed commitment/)
  assert.match(html,/value="2026-09-29"/)
  assert.equal((html.match(/Add to calendar/g)||[]).length,1)
  assert.equal(opened,0)
  assert.doesNotMatch(html,/Met Mike at Valley/)
})

test('same-day proposed date never uses an elapsed default clock time',()=>{
  const raw=fixture();raw.recommendations[0].action.date='2026-09-24'
  const parsed=parseSalesDecision(raw,source,now,zone)
  const draft=calendarDraftFromAction(visitActionFields(parsed.actions[0],'English'),'English',zone)
  const scheduled=suggestCalendarSchedule(draft,action.evidence,now,now)
  assert.equal(scheduled.date,'2026-09-24')
  assert.equal(scheduled.time,'11:30')
  assert.equal(scheduled.timeSuggested,true)
})
