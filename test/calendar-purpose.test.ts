import {test} from 'node:test'
import assert from 'node:assert/strict'
import {calendarDraftFromAction,googleCalendarUrl} from '../lib/calendarDraft'
const a={type:'call',verb:'Call',object:'',contact:'Carlos',company:'Maple Growers',date:'09/18/2026',time:'11:30',description:'Discuss the Z9 warranty and check whether the replacement arrived.'}
test('call title preserves topic in ES/EN, while full identities and instructions remain in Google',()=>{
 for(const [language,subject,expected] of [['English','Z9 warranty','Call Carlos about Z9 warranty'],['Spanish','garantía Z9','Llamar a Carlos sobre garantía Z9']]){
  const d=calendarDraftFromAction({...a,subject},language,'America/Los_Angeles')
  assert.equal(d.title,expected);assert.ok(d.details.includes('Maple Growers'));assert.ok(d.details.endsWith(a.description))
  assert.equal(new URL(googleCalendarUrl(d)!).searchParams.get('text'),expected)
 }
})
test('two tasks for same recipient remain distinguishable without opening details',()=>{
 const drafts=['Q2 replacement','autumn prices'].map(subject=>calendarDraftFromAction({...a,subject},'English','America/Los_Angeles'))
 assert.notEqual(drafts[0].title,drafts[1].title);assert.match(drafts[0].title,/Q2/);assert.match(drafts[1].title,/prices/)
})
test('send and internal tasks keep identifying subject, without a product-specific classification',()=>{
 const send=calendarDraftFromAction({...a,type:'send',object:'ficha de Koral 18 sin precios',subject:'ficha Koral 18',contact:'Clara',company:'Viñas del Río',description:'Enviar la ficha de Koral 18 sin precios.'},'Spanish','America/Los_Angeles')
 assert.equal(send.title,'Enviar ficha Koral 18 a Clara');assert.match(send.details,/sin precios/)
 const internal=calendarDraftFromAction({...a,type:'other',subject:'Consultar ácaros',contact:'Diego'},'Spanish','America/Los_Angeles')
 assert.match(internal.title,/Consultar ácaros/)
})
test('long identity moves intact to details instead of truncating a name or product',()=>{
 const contact='María del Carmen Fernández de la Fuente',subject='Quantum Flower 75'
 const d=calendarDraftFromAction({...a,contact,subject},'Spanish','America/Los_Angeles')
 assert.ok(d.title.length<=44);assert.ok(d.title.includes(subject));assert.ok(d.details.includes(contact));assert.ok(!d.title.includes('…'))
})
test('vague action stays vague and absent subject preserves old saved-note behavior',()=>{
 assert.equal(calendarDraftFromAction({...a,description:'Call.',subject:''},'English','America/Los_Angeles').title,'Call Carlos — Maple Growers')
 assert.equal(calendarDraftFromAction(a,'English','America/Los_Angeles').title,'Call Carlos — Maple Growers')
 const long='María del Carmen Fernández de la Fuente'
 const vague=calendarDraftFromAction({...a,contact:long,subject:'',description:'Call.'},'English','America/Los_Angeles')
 assert.doesNotMatch(vague.title,/…/);assert.ok(vague.details.includes(long))
})
