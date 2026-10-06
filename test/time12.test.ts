import assert from 'node:assert/strict'
import {test} from 'node:test'
import {formatTime12,timeFrom12} from '../lib/time12'
import {formatProfessionalCrmNote} from '../lib/formatCrmSalesNote'
import {visitExtractionResult,type VisitExtraction} from '../lib/visitExtraction'

test('12-hour display round-trips every minute without changing event time',()=>{
 for(let h=0;h<24;h++)for(let m=0;m<60;m++){
  const value=`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`
  const [clock,period]=formatTime12(value).split(' ')
  const [hour,minute]=clock.split(':')
  assert.equal(timeFrom12(hour,minute,period),value)
 }
 assert.equal(formatTime12('00:00'),'12:00 AM')
 assert.equal(formatTime12('12:00'),'12:00 PM')
 assert.equal(formatTime12('15:30'),'3:30 PM')
 assert.equal(formatTime12('25:00'),'')
 assert.equal(timeFrom12('13','00','AM'),'')
})
test('CRM copies edited visible schedules, preserves source and marks defaults as proposed',()=>{
 const v:VisitExtraction={language:'English',contacts:['Laura'],companies:['South'],location:'',summary:'No order approved.',insights:[],questions:[],actions:[{type:'call',contact:'Laura',company:'South',object:'',description:'Check receipt.',date:'2026-10-08',time:'',evidence:''}]}
 const result=visitExtractionResult(v,'2026-10-05T18:00:00Z'),before=structuredClone(result)
 assert.match(formatProfessionalCrmNote(result),/2026-10-08 9:00 AM · proposed schedule/)
 const crm=formatProfessionalCrmNote(result,{0:{title:'Call Laura',details:'Check receipt.',date:'2026-10-09',time:'15:45',timezone:'America/Los_Angeles',language:'English',timeSuggested:false,dateSuggested:false}})
 assert.match(crm,/2026-10-09 3:45 PM/)
 assert.doesNotMatch(crm,/2026-10-08|15:45|proposed schedule/)
 assert.deepEqual(result,before)
})
