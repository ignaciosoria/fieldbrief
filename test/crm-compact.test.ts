import {test} from 'node:test'
import assert from 'node:assert/strict'
import {compactCrmNarrative} from '../lib/compactCrmNarrative'
import {formatProfessionalCrmNote} from '../lib/formatCrmSalesNote'
import {visitExtractionResult,type VisitExtraction} from '../lib/visitExtraction'

const mike=():VisitExtraction=>({language:'English',contacts:['Mike'],companies:['Valley Growers'],location:'',summary:'Met with Mike from Valley Growers this morning. They discussed Quantum, mainly the Flower product. Mike said they have about 80 to 85 acres of strawberries and are currently using something from Ultra Gro, but he is open to testing something different. The rep said they could leave product for about a five-acre trial. Mike needs to talk to his PCA first.',insights:[
  'Mike needs to talk to his PCA before moving forward with a trial.',
  'Valley Growers is currently using something from Ultra Gro but Mike is open to testing a different product.',
  'They discussed a possible product trial of about five acres.',
  'Mike said they have about 80 to 85 acres of strawberries.',
],questions:[],actions:[
  {type:'follow_up',contact:'Mike',company:'Valley Growers',object:'',description:'Follow up after he talks to his PCA.',date:'2026-09-29',time:'',evidence:'follow up'},
  {type:'send',contact:'Mike',company:'Valley Growers',object:'label and pricing',description:'Send the label and pricing.',date:'',time:'',evidence:'send label and pricing'},
]})
test('Mike CRM is one narrative with each repeated fact once and no invented commitment',()=>{
  const v=mike(), before=structuredClone(v)
  const crm=formatProfessionalCrmNote(visitExtractionResult(v,'2026-09-24T20:45:00Z'))
  assert.equal(crm.split('\n\n').length,3)
  assert.equal((crm.match(/Ultra Gro/g)||[]).length,1)
  assert.equal((crm.match(/80 to 85/g)||[]).length,1)
  assert.equal((crm.match(/five[ -]acre/g)||[]).length,1)
  assert.equal((crm.match(/PCA/g)||[]).length,2,'one condition in context, one necessary follow-up dependency')
  assert.match(crm,/could leave product/)
  assert.match(crm,/before moving forward/)
  assert.match(crm,/Next steps:/)
  assert.match(crm,/2026-09-29/)
  assert.match(crm,/Send the label and pricing/)
  assert.doesNotMatch(crm,/Mike — Valley Growers:/,'the sole owner is already clear in the header')
  assert.deepEqual(v,before)
})
test('CRM keeps each action owner, unresolved questions and input dates; never adds defaults',()=>{
  const v=mike();v.contacts.push('Ana');v.companies.push('Acme')
  v.actions[1]={...v.actions[1],contact:'Ana',company:'Acme'}
  v.questions=[{action_index:1,field:'date',question:'Which day this week?'}]
  const before=structuredClone(v)
  const crm=formatProfessionalCrmNote(visitExtractionResult(v,'2026-09-24T20:45:00Z'))
  assert.match(crm,/Mike — Valley Growers: Follow up/)
  assert.match(crm,/Ana — Acme: Send the label and pricing\./)
  assert.match(crm,/To clarify: Which day this week\?/)
  assert.doesNotMatch(crm,/09:00|2026-09-25/)
  assert.deepEqual(v,before)
})
test('insight-only facts, quantities and conditions survive in both languages',()=>{
  for(const [language,summary,insights] of [
    ['English','Met Mike.', ['Credit is blocked.','The Q7 trial finished.','The order is for 40 gallons.','Approval is needed before starting.']],
    ['Spanish','Visita con Mike.', ['El crédito está bloqueado.','El ensayo Q7 terminó.','El pedido es de 40 galones.','Hace falta aprobación antes de empezar.']],
  ] as const){
    const text=compactCrmNarrative(summary,[...insights],language,['Mike'],[])
    for(const line of insights) assert.ok(text.includes(line),line)
  }
})
test('different polarity, timing, quantities and epistemic status are never treated as duplicates',()=>{
  for(const [summary,detail] of [
    ['Mike approved the Q7 trial.','Mike has not approved the Q7 trial.'],
    ['Mike may report a Q7 problem.','Mike reported a Q7 problem.'],
    ['Mike will ask the lab about Q7 damage.','Mike reported Q7 damage.'],
    ['Mike needs approval before the trial.','Mike needs approval after the trial.'],
    ['Mike ordered 40 gallons.','Mike ordered 45 gallons.'],
    ['Mike has about 80 acres.','Mike has 85 acres.'],
    ['Mike podría aprobar el ensayo.','Mike aprobó el ensayo.'],
    ['Mike no aprobó el pedido.','Mike aprobó el pedido.'],
    ['Mike bought Q7 and sold Q8.','Mike bought Q8 and sold Q7.'],
    ['Mike approved the order, not the trial.','Mike approved the trial, not the order.'],
  ]){
    const result=compactCrmNarrative(summary,[detail],'English',['Mike'],[])
    assert.ok(result.includes(summary));assert.ok(result.includes(detail))
  }
})
test('multi-contact facts and rep versus customer ownership remain separate',()=>{
  for(const [summary,detail,contacts,companies] of [
    ['Ana approved the Q7 trial.','Bob approved the Q7 trial.',['Ana','Bob'],[]],
    ['The rep could leave product for a five-acre trial.','Mike could leave product for a five-acre trial.',['Mike'],['Valley Growers']],
    ['Mike sent Q7 to Laura yesterday.','Laura sent Q7 to Mike.',['Mike'],['Valley Growers']],
  ] as const){
    const result=compactCrmNarrative(summary,[detail],'English',[...contacts],[...companies])
    assert.ok(result.includes(summary));assert.ok(result.includes(detail))
  }
})
test('Spanish repeated context is compacted while new restrictions are retained',()=>{
  const result=compactCrmNarrative('Visita con Ana. Ana dijo que tiene 80 acres de fresas. El crédito está pendiente.',[
    'Ana tiene 80 acres de fresas.','El crédito está pendiente.','No enviar presupuesto hasta aprobar el crédito.',
  ],'Spanish',['Ana'],[])
  assert.equal((result.match(/80 acres/g)||[]).length,1)
  assert.equal((result.match(/El crédito está pendiente/g)||[]).length,1)
  assert.match(result,/No enviar presupuesto hasta aprobar el crédito/)
})
test('empty summary falls back to insights; empty note adds no invented context or next step',()=>{
  assert.equal(compactCrmNarrative('',['Crédito pendiente.','Crédito pendiente.'],'Spanish',[],[]),'Crédito pendiente.')
  assert.equal(compactCrmNarrative('',[],'English',[],[]),'')
  const v=mike();v.summary='';v.insights=[];v.actions=[]
  assert.equal(formatProfessionalCrmNote(visitExtractionResult(v,'2026-09-24T20:45:00Z')),'Mike / Valley Growers')
})
