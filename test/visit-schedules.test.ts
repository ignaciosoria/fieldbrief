import {test} from 'node:test'
import assert from 'node:assert/strict'
import {visitSchedules} from '../lib/visitSchedules'
import {calendarDraftFromAction} from '../lib/calendarDraft'
import {visitActionFields,type VisitExtraction} from '../lib/visitExtraction'

const now='2026-10-07T17:00:00Z',zone='America/Los_Angeles'
const v:VisitExtraction={language:'Spanish',contacts:['Robert','Daniel'],companies:['Pacific Berry Farms','Nutrien'],summary:'No hay prueba aprobada.',location:'Santa María',insights:[],questions:[],actions:[
  {type:'call',contact:'Daniel',company:'Nutrien',object:'',description:'Explicar el programa y definir condiciones solo si está de acuerdo.',date:'',time:'',daypart:'unspecified',evidence:'Tengo que contactar con Daniel'},
  {type:'send',contact:'Robert',company:'Pacific Berry Farms',object:'ficha técnica de Quantum Flower y precio por acre',subject:'ficha técnica Quantum Flower y precio definitivo por acre',description:'Confirmar el precio definitivo por acre y enviar la ficha técnica de Quantum Flower junto con ese precio.',date:'',time:'',daypart:'unspecified',evidence:'enviar a Robert la ficha técnica y el precio por acre'},
]}
test('long send title retains the deliverables and full export description',()=>{
  const d=calendarDraftFromAction(visitActionFields(v.actions[1],v.language),v.language,zone)
  assert.equal(d.title,'Enviar ficha y precio a Robert')
  assert.ok(d.details.includes(v.actions[1].description))
})
test('same-note automatic schedules are spaced without altering source facts',()=>{
  const before=structuredClone(v),d=visitSchedules(v,zone,now,now)
  assert.equal(d[0].time,'09:00');assert.equal(d[1].time,'09:30')
  assert.equal(d[0].date,'2026-10-08');assert.equal(d[1].date,'2026-10-08')
  assert.deepEqual(v,before)
})
test('explicit clocks get priority and afternoon defaults remain afternoon',()=>{
  const a=structuredClone(v);a.actions[1].time='09:00'
  const d=visitSchedules(a,zone,now,now)
  assert.equal(d[1].time,'09:00');assert.equal(d[0].time,'09:30')
  a.actions.forEach(x=>{x.time='';x.daypart='afternoon'})
  const p=visitSchedules(a,zone,now,now)
  assert.equal(p[0].time,'15:00');assert.equal(p[1].time,'15:30')
})
test('restored schedules and explicit collisions are never silently moved',()=>{
  const a=structuredClone(v);a.actions.forEach(x=>{x.time='10:30'})
  const d=visitSchedules(a,zone,now,now)
  assert.equal(d[0].time,'10:30');assert.equal(d[1].time,'10:30')
  const stored={...d[1],time:'09:00',timeSuggested:true}
  const next=visitSchedules(v,zone,now,now,{1:stored})
  assert.equal(next[1].time,'09:00');assert.equal(next[0].time,'09:30')
  assert.deepEqual(next[1],stored)
})
