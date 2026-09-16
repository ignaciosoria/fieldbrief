import assert from 'node:assert/strict'
import {test} from 'node:test'
import {DateTime} from 'luxon'
import {MESSY_TEXT_CASES} from '../eval/messy-text-corpus'
import {gradeMessyText,auditMessyText} from '../eval/messy-text-grade'
import type {VisitExtraction} from '../lib/visitExtraction'
test('stress corpus has 100 unique texts across 25 families, two languages and a held-out variant',()=>{
  assert.equal(MESSY_TEXT_CASES.length,100)
  assert.equal(new Set(MESSY_TEXT_CASES.map(c=>c.note)).size,100)
  assert.equal(new Set(MESSY_TEXT_CASES.map(c=>c.id)).size,100)
  assert.equal(new Set(MESSY_TEXT_CASES.map(c=>c.family)).size,25)
  assert.equal(MESSY_TEXT_CASES.filter(c=>c.language==='Spanish').length,50)
  assert.equal(MESSY_TEXT_CASES.filter(c=>c.split==='holdout').length,25)
  assert.equal(MESSY_TEXT_CASES.filter(c=>c.split==='holdout'&&c.language==='Spanish').length,13)
  assert.equal(MESSY_TEXT_CASES.filter(c=>c.split==='holdout'&&c.language==='English').length,12)
  for(const c of MESSY_TEXT_CASES){
    assert.ok(c.note.length>600&&c.note.length<5000,c.id)
    for(const a of c.tasks){if(a.date)assert.ok(DateTime.fromISO(a.date).isValid);if(a.time)assert.match(a.time,/^\d\d:\d\d$/)}
    for(const q of c.questions)assert.ok(q.task>=0&&q.task<c.tasks.length)
  }
})
test('additional factuality audit distinguishes reported absence from factual denial',()=>{
  const c=MESSY_TEXT_CASES.find(c=>c.family==='future-purpose-only'&&c.language==='Spanish')!
  const v:VisitExtraction={language:c.language,contacts:[],companies:[],location:'',summary:'No hubo compra reportada hoy.',insights:[],questions:[],actions:[]}
  assert.deepEqual(auditMessyText(c,v),[])
  assert.ok(auditMessyText(c,{...v,summary:'No hubo compra hoy.'}).includes('unreported-purchase-became-denial'))
  const e=c.tasks[0]
  v.actions=[{type:e.type,contact:e.contact[0],company:e.company[0],date:e.date,time:e.time,object:'',description:'Comentar la garantía; no prometer otro reemplazo.',evidence:''}]
  assert.ok(auditMessyText(c,v).includes('past-negation-became-prohibition'))
  v.actions[0].description='Comentar la garantía y comprobar si llegó el reemplazo.'
  assert.deepEqual(auditMessyText(c,v),[])
})
test('stress evaluator catches duplicate tasks, wrong recipients and leaked counterparties',()=>{
  const c=MESSY_TEXT_CASES.find(c=>c.family==='multiple-companies')!
  const v:VisitExtraction={language:c.language,contacts:c.contacts,companies:c.companies,location:'',summary:'',insights:[],questions:[],actions:[]}
  assert.ok(gradeMessyText(c,v).some(s=>s.startsWith('action-count')))
  assert.ok(gradeMessyText(c,{...v,companies:[...c.companies,c.forbidCompanies[0]]}).some(s=>s.startsWith('wrong-header-company')))
  const e=c.tasks[0]
  v.actions=Array.from({length:c.tasks.length},()=>({type:e.type,contact:e.contact[0],company:e.company[0],date:e.date,time:e.time,object:'catalog',description:'Enviar catálogo',evidence:'placeholder'}))
  assert.ok(gradeMessyText(c,v).filter(s=>s.startsWith('action-contract')).length>=2)
})
