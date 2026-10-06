import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import CompactVisitResult from '../app/components/CompactVisitResult'
import {visitHeader} from '../lib/visitHeader'
import {insightPresentation} from '../lib/insightPresentation'
import type {VisitAction, VisitExtraction} from '../lib/visitExtraction'
import {visitExtractionResult} from '../lib/visitExtraction'
import {formatProfessionalCrmNote} from '../lib/formatCrmSalesNote'

const action=(contact:string,company:string):VisitAction=>({type:'call',contact,company,object:'',description:'Confirm receipt.',date:'2026-09-29',time:'10:30',evidence:'Call to confirm receipt.'})
const note=():VisitExtraction=>({language:'Spanish',contacts:['Laura','Miguel'],companies:['CampoSur','AgroNorte'],summary:'Unchanged CRM summary',location:'',insights:['Laura pidió la ficha técnica de Ferbloom 75 sin precios ni presupuesto.'],questions:[],actions:[action('Laura','AgroNorte'),action('Miguel','CampoSur')]})

test('header pairs explicit action identities, not array positions; does not mutate the note',()=>{
  const value=note(), before=structuredClone(value)
  assert.equal(visitHeader(value),'Laura — AgroNorte\nMiguel — CampoSur')
  assert.deepEqual(value,before)
})
test('repeated actions do not duplicate identities and unpaired contacts remain visible',()=>{
  const value=note()
  value.actions.push(action('Laura','AgroNorte'))
  value.contacts.push('Jay')
  assert.equal(visitHeader(value),'Laura — AgroNorte\nMiguel — CampoSur\nJay')
})
test('missing, conflicting or unresolved associations are not invented',()=>{
  const value=note()
  value.actions=[]
  assert.equal(visitHeader(value),'Laura\nMiguel\nCampoSur\nAgroNorte')
  value.actions=[action('Laura','AgroNorte'),action('Laura','CampoSur')]
  assert.equal(visitHeader(value),'Laura\nMiguel\nCampoSur\nAgroNorte')
  value.actions=[action('Laura','AgroNorte')]
  value.questions=[{action_index:0,field:'company',question:'Which company?'}]
  assert.equal(visitHeader(value),'Laura\nMiguel\nCampoSur\nAgroNorte')
})
test('header never imports extra identities from an action',()=>{
  const value=note()
  value.actions=[action('Laura','Helena'),action('Carlos','CampoSur')]
  assert.equal(visitHeader(value),'Laura\nMiguel\nCampoSur\nAgroNorte')
})
test('Roberto and Laura each have their own paired line in UI and copied CRM',()=>{
  const value:VisitExtraction={...note(),contacts:['Roberto','Laura'],companies:['CampoSur','Estrada Farms'],
    summary:'Roberto, de Estrada Farms, quiere valorar la prueba.\n\nLaura, de CampoSur, pidió la ficha.',
    actions:[{...action('Laura','CampoSur'),type:'send'},{...action('Roberto','Estrada Farms'),origin:'recommendation'}]}
  const header='Roberto — Estrada Farms\nLaura — CampoSur'
  assert.equal(visitHeader(value),header)
  assert.ok(formatProfessionalCrmNote(visitExtractionResult(value,'2026-10-05T18:30:00Z','America/Los_Angeles')).startsWith(header+'\n\n'))
  const html=renderToStaticMarkup(createElement(CompactVisitResult,{extraction:value,timezone:'America/Los_Angeles',onCalendarOpened:()=>{},onCopy:async()=>{},onVoice:()=>{},onClarify:()=>{},recording:false,voiceDisabled:false}))
  assert.ok(html.includes(header))
  assert.match(html,/whitespace-pre-line/)
  value.questions=[{action_index:1,field:'company',question:'Which company?'}]
  assert.equal(visitHeader(value),'Roberto\nLaura — CampoSur\nEstrada Farms')
})
test('technical documents without pricing get document icons in Spanish and English',()=>{
  for(const text of [note().insights[0],'Laura requested the technical sheet without prices or a quote.','Send the datasheet without pricing and budget.']){
    assert.deepEqual(insightPresentation(text),{text,icon:'📄'})
  }
})
test('actual financial context and other categories retain their icons',()=>{
  for(const [text,icon] of [
    ['Enviar ficha sin precios ni presupuesto; el crédito está bloqueado.','💰'],
    ['Send the technical sheet without prices; payment is overdue.','💰'],
    ['La ficha incluye un presupuesto.','💰'],
    ['Helena ofrece algo más barato.','⚖️'],
    ['Jay confirmed he received the technical sheet.','📄'],
    ['El pedido todavía no está aprobado.','📦'],
  ]) assert.deepEqual(insightPresentation(text),{text,icon})
})
test('compact result renders the two corrections without changing action or CRM data',()=>{
  const value=note(), before=structuredClone(value)
  const html=renderToStaticMarkup(createElement(CompactVisitResult,{extraction:value,timezone:'America/Los_Angeles',onCalendarOpened:()=>{},onCopy:async()=>{},onVoice:()=>{},onClarify:()=>{},recording:false,voiceDisabled:false}))
  assert.ok(html.includes('Laura — AgroNorte\nMiguel — CampoSur'))
  assert.ok(html.includes('📄'))
  assert.ok(html.includes(value.insights[0]))
  assert.equal((html.match(/Add to calendar/g)||[]).length,2)
  assert.equal((html.match(/Copy to CRM/g)||[]).length,1)
  assert.ok(!html.includes(value.summary))
  assert.deepEqual(value,before)
})
