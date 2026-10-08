import test from 'node:test'
import assert from 'node:assert/strict'
import {parseVisitExtraction,visitActionFields,visitExtractionResult,type VisitAction,type VisitExtraction} from '../lib/visitExtraction'
import {calendarDraftFromAction} from '../lib/calendarDraft'
import {suggestCalendarSchedule} from '../lib/calendarSuggestion'
import {formatProfessionalCrmNote} from '../lib/formatCrmSalesNote'
import {SALES_PROMPT} from '../lib/salesDecision'

const now='2026-10-07T18:00:00Z',zone='America/Los_Angeles'
const source='Owen asks finance Friday October ninth. Need to learn if credit clears before proceeding.'
const action:VisitAction={type:'follow_up',contact:'Owen',company:'Demo Oak',object:'',subject:'credit approval',description:'Check whether finance approved credit after Friday’s review; do not assume approval.',date:'',time:'',daypart:'unspecified',evidence:'Need to learn if credit clears before proceeding.',scheduleAfter:{date:'2026-10-09',evidence:'Owen asks finance Friday October ninth.'}}
const fixture=():VisitExtraction=>({contractVersion:3,language:'English',contacts:['Owen'],companies:['Demo Oak'],location:'',summary:'Owen will ask finance Friday.',insights:[],actions:[structuredClone(action)],questions:[]})
const draft=(a:VisitAction,at=now)=>suggestCalendarSchedule(calendarDraftFromAction(visitActionFields(a,'English'),'English',zone),a.evidence,now,at)

test('Friday prerequisite survives parsing/persistence/adapters and moves default to Monday',()=>{
  const v=parseVisitExtraction(JSON.parse(JSON.stringify(fixture())),source)
  const d=draft(v.actions[0])
  assert.equal(d.date,'2026-10-12')
  assert.equal(d.time,'09:00')
  assert.equal(d.dateSuggested,true)
  assert.equal(v.actions[0].date,'')
  assert.match(formatProfessionalCrmNote(visitExtractionResult(v,now,zone),{0:d}),/2026-10-12 9:00 AM/)
})
test('bound applies to recommendations too, but never reschedules explicit same-day later time',()=>{
  assert.equal(draft({...action,date:'2026-10-08',origin:'recommendation'}).date,'2026-10-12')
  const explicit=draft({...action,date:'2026-10-09',time:'16:00'})
  assert.equal(explicit.date,'2026-10-09');assert.equal(explicit.time,'16:00')
  assert.equal(explicit.dateSuggested,false)
})
test('dependency cannot move a later date backwards or override another action',()=>{
  assert.equal(draft({...action,date:'2026-10-20',origin:'recommendation'}).date,'2026-10-20')
  assert.equal(draft({...action,scheduleAfter:null,type:'send'}).date,'2026-10-08')
  assert.equal(draft(action,'2026-10-15T18:00:00Z').date,'2026-10-16')
})
test('local date boundaries, weekends and time clarification are preserved',()=>{
  assert.equal(draft({...action,scheduleAfter:{date:'2026-10-08',evidence:'x'}}).date,'2026-10-09')
  const d=draft({...action,daypart:'ambiguous'})
  assert.equal(d.date,'2026-10-12');assert.equal(d.time,'');assert.equal(d.needsTimeClarification,true)
})
test('legacy notes remain compatible; invented evidence and impossible dependency dates fail',()=>{
  const old=fixture();delete old.actions[0].scheduleAfter
  assert.equal(draft(parseVisitExtraction(old,source).actions[0]).date,'2026-10-08')
  for(const bound of [{date:'2026-02-30',evidence:source},{date:'tomorrow',evidence:source},{date:'2026-10-09',evidence:'Finance approved it.'}]){
    const raw=fixture();raw.actions[0].scheduleAfter=bound
    assert.throws(()=>parseVisitExtraction(raw,source),/Invalid scheduling dependency/)
  }
})
test('travel completeness rule retains future presence without creating a booked meeting',()=>{
  assert.match(SALES_PROMPT,/Never omit it from BOTH/)
  assert.match(SALES_PROMPT,/travel context, not a booked meeting or a past visit/)
  assert.match(SALES_PROMPT,/Do not borrow another customer's date/)
})
