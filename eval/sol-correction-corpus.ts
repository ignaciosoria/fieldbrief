import {COMPARE_CASES} from './sales-model-corpus'
import type {VisitExtraction} from '../lib/visitExtraction'

export const SOL_CORRECTION_CASES = [
  {id:'original-two-contacts',note:COMPARE_CASES.find(c=>c.id==='two-contacts')!.note,cancellation:false,contacts:['Eva','Tom'],actions:2},
  {id:'new-es-repair',note:'eh con Inés de Prado Alto, le envío presupuesto de K22, no perdón me he liado al hablar, solamente la etiqueta de K22 sin precios mañana a las diez. No hay presupuesto previo. Iván de Costa Azul va aparte: le llamo el lunes a las cuatro para preguntar si llegó la caja, no sé si llegó.',cancellation:false,contacts:['Inés','Iván'],actions:2},
  {id:'real-en-cancel',note:'Ruth from Lakeview canceled yesterday\'s quote request for H7 this morning. That really happened, not a correction to this recording. She still wants the H7 safety sheet and I will send it tomorrow at nine. The trial is not approved.',cancellation:true,contacts:['Ruth'],actions:1},
  {id:'real-es-cancel',note:'Leo de Las Lomas anuló esta mañana la solicitud del presupuesto de H7 que había hecho ayer. Sí la anuló de verdad. Sigue interesado en leer la ficha de seguridad H7 y yo se la mando mañana a las nueve. No aprobó ningún ensayo.',cancellation:true,contacts:['Leo'],actions:1},
  {id:'mixed-scope',note:'Two separate people. Nadia at Elmworks canceled the quote request she made yesterday. For Owen at Brookside, send the quote, sorry I misspoke, send only the K4 sheet without prices tomorrow afternoon. Owen never requested a quote. Do not contact Nadia again; no task for her.',cancellation:true,contacts:['Owen'],actions:1},
  {id:'new-en-repair',note:'Okay Felix at Silver Orchard, I will send the estimate, scratch that, what I mean is just the X2 label, no prices, tomorrow morning. We never had an estimate request. Clara at Hill Farm needs a call Friday at eleven to check stock availability, I said I would call then.',cancellation:false,contacts:['Felix','Clara'],actions:2},
  {id:'outcome-repair',note:'eh hablé por teléfono con Alma de Monte Sur. El ensayo fue fatal, no, me he expresado mal yo: Alma dijo que todavía no lo han evaluado. No sé el resultado. Ya tiene la ficha. Me pidió no llamarla ni escribirle ni enviar más cosas. Lo acepté, no quedó nada pendiente.',cancellation:false,contacts:[],actions:0},
  {id:'real-with-repair',note:'Tomás de La Vega canceló el pedido de cuarenta, perdón, de catorce cajas de Z6. La cancelación sí ocurrió, estoy corrigiendo solo la cantidad. No quiere más contacto. No hay nada pendiente por nuestra parte.',cancellation:true,contacts:[],actions:0},
]

// Narrow assertions only. Inspect prose manually as well; these are not a truth score.
export function checkSolCorrection(id:string,v:VisitExtraction){
  const c=SOL_CORRECTION_CASES.find(c=>c.id===id)!
  const issues:string[]=[],prose=[v.summary,...v.insights,...v.actions.map(a=>a.description)].join(' ')
  const cancellation=/cancel|anul|withdrawn|retir[oó]/i.test(prose)
  if(cancellation!==c.cancellation)issues.push(c.cancellation?'REAL_CANCELLATION_LOST':'INVENTED_CANCELLATION_REVIEW')
  if(v.actions.length!==c.actions)issues.push('ACTION_COUNT')
  for(const contact of c.contacts)if(!v.actions.some(a=>a.contact.includes(contact)))issues.push('OWNER_'+contact)
  if(id==='mixed-scope'&&v.actions.some(a=>a.contact!=='Owen'))issues.push('CROSS_CONTACT_SCOPE')
  if(id==='real-with-repair'&&/cuarenta|\b40\b/.test(prose))issues.push('STALE_QUANTITY')
  if(id==='outcome-repair'&&(!/no.*evalu|sin evaluar/i.test(prose)||/aclar[oó]|corrigi[oó]|fatal|mal resultado/i.test(prose)))issues.push('OUTCOME_REPAIR_REVIEW')
  return issues
}
