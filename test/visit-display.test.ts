import assert from 'node:assert/strict'
import {test} from 'node:test'
import {buildPrimaryDisplayTitle,buildSupportingDisplayTitle} from '../lib/displayActionTitle'
import {calendarDraftFromAction,googleCalendarUrl} from '../lib/calendarDraft'
import {formatProfessionalCrmNote} from '../lib/formatCrmSalesNote'
import {visitExtractionResult,type VisitExtraction} from '../lib/visitExtraction'

test('structured product parentheses are never interpreted as timing',()=>{
  const action = 'Send Tomorrow (next week edition) to Ana — Acme'
  assert.equal(buildSupportingDisplayTitle({action,resolvedDate:'',timeHint:'',preserveStructuredTitle:true}),action)
  assert.equal(buildPrimaryDisplayTitle({nextStep:action,nextStepTitle:action,nextStepDate:'',nextStepTimeHint:'',preserveStructuredTitle:true}),action)
})
test('other calendar actions retain their meaning, contact and company',()=>{
  const draft=calendarDraftFromAction({type:'other',verb:'Complete',contact:'Ana',company:'Acme',object:'',description:'Review Q7 stock',date:'09/11/2026',time:''},'English','America/Los_Angeles')
  assert.equal(draft.title,'Review Q7 stock — Ana — Acme')
  assert.equal(draft.details,'Review Q7 stock')
})
test('ambiguous autumn DST time requires review instead of choosing an offset silently',()=>{
  assert.equal(googleCalendarUrl({title:'Call Ana',details:'',date:'2026-11-01',time:'01:30',timezone:'America/Los_Angeles',language:'English'}),null)
})
test('CRM copy includes all action owners, descriptions and additional facts',()=>{
  const v:VisitExtraction={language:'English',contacts:['Ana','Bob'],companies:['Acme','Beta'],location:'',summary:'Met Ana and Bob.',insights:['The Q7 trial finished.'],questions:[],actions:[
    {type:'send',contact:'Ana',company:'Acme',object:'catalog',description:'Send the catalog.',date:'',time:'',evidence:'Send catalog'},
    {type:'call',contact:'Bob',company:'Beta',object:'',description:'Confirm trial results.',date:'2026-09-14',time:'11:00',evidence:'Call Bob'},
  ]}
  const text=formatProfessionalCrmNote(visitExtractionResult(v,'2026-09-10T18:00:00Z','Europe/Madrid'))
  for(const part of ['Ana — Acme: Send the catalog.','Bob — Beta: Confirm trial results.','2026-09-14 11:00','The Q7 trial finished.']) assert.ok(text.includes(part))
})
