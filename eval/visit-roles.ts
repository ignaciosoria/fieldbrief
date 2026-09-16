import type { VisitCase } from './visit-corpus'
import type { VisitExtraction } from '../lib/visitExtraction'
import { calendarDraftFromAction } from '../lib/calendarDraft'
import { visitActionFields } from '../lib/visitExtraction'

/** Synthetic counterparts of a reported failure; no customer record is reproduced. */
export const VISIT_ROLES: VisitCase[] = [
  {
    id:'es-messy-roles',language:'Spanish',tags:['entity-roles','mixed-ownership','tank-mix'],
    note:'Eh, estoy en Robles Family Farms con Carlos. Hablamos de Bloomset 75 del mes pasado en los limoneros del bloque norte: buena respuesta en cuajado, pero follaje amarillo en algunas zonas. Yo dije que probablemente sea deficiencia de hierro, no relacionada con el producto. Hablamos de subir la dosis de Flower Q antes de floración. Quiere el programa de tank mix por escrito. Quiere aprobar un pedido, creo que dijo 40 galones de Bloomset 75 y 20 de Blend EC para el bloque sur, pero necesita que Oscar lo confirme porque el crédito está ajustado. AgriWest ofrece algo parecido más barato. Quedamos en que yo le mando el programa esta semana y él me confirma el pedido para el viernes.',
    headerContacts:['Carlos'],headerCompanies:['Robles Family Farms'],
    actions:[{type:'send',contact:'Carlos',company:'Robles Family Farms',object:'programa de tank mix',date:null,evidence:'yo le mando el programa esta semana'}],
    crmFacts:['AgriWest ofrece algo parecido más barato.','Oscar debe confirmar por crédito ajustado.','Carlos confirma el pedido para el viernes.'],
    forbiddenClaims:['Visita con Oscar.','Llamar el viernes.','Pedido confirmado.'],clarification:['Qué día de esta semana enviar el programa.'],
  },
  {
    id:'en-messy-roles',language:'English',tags:['entity-roles','mixed-ownership','tank-mix'],
    note:'Um, at Robles Family Farms with Carlos. We discussed last month’s Bloomset 75 application on north-block lemons. Good fruit set, but some foliage is yellow; I said it is probably iron deficiency unrelated to the product. We discussed raising the Flower Q dose before flowering. He wants the tank mix program in writing. He wants an order, I think 40 gallons of Bloomset 75 and 20 of Blend EC for the south block, but Oscar must confirm because credit is tight. AgriWest is offering something similar cheaper. We agreed I will send the program this week and he will confirm the order by Friday.',
    headerContacts:['Carlos'],headerCompanies:['Robles Family Farms'],
    actions:[{type:'send',contact:'Carlos',company:'Robles Family Farms',object:'tank mix program',date:null,evidence:'I will send the program this week'}],
    crmFacts:['AgriWest is cheaper.','Oscar must confirm due to tight credit.','Carlos will confirm by Friday.'],
    forbiddenClaims:['Met Oscar.','Call Friday.','Confirmed order.'],clarification:['Which day this week to send the program.'],
  },
  {
    id:'es-helena-person',language:'Spanish',tags:['entity-roles'],
    note:'Visité a Helena de Norvia. Ella comentó que AgriWest ofrece algo más barato. Mañana llamaré a Helena para revisar los resultados.',
    headerContacts:['Helena'],headerCompanies:['Norvia'],
    actions:[{type:'call',contact:'Helena',company:'Norvia',object:null,date:'2026-09-11',evidence:'Mañana llamaré a Helena para revisar los resultados'}],
    crmFacts:['Helena es el contacto visitado.'],forbiddenClaims:['AgriWest es el cliente.'],clarification:[],
  },
  {
    id:'en-helena-visited-company',language:'English',tags:['entity-roles'],
    note:'I visited Sarah at Helena. She said AgriWest offered a cheaper alternative. Tomorrow I will email her the calibration certificate.',
    headerContacts:['Sarah'],headerCompanies:['Helena'],
    actions:[{type:'send',contact:'Sarah',company:'Helena',object:'calibration certificate',date:'2026-09-11',evidence:'Tomorrow I will email her the calibration certificate'}],
    crmFacts:['Sarah at Helena is the customer.'],forbiddenClaims:['AgriWest is the visited company.'],clarification:[],
  },
  {
    id:'es-approver-present',language:'Spanish',tags:['entity-roles'],
    note:'Hablé con Carlos y Oscar, ambos de Robles Farms. Oscar estuvo en la reunión y revisó el crédito. AgriWest les ofrece otro producto. No acordamos ninguna tarea ni próxima visita.',
    headerContacts:['Carlos','Oscar'],headerCompanies:['Robles Farms'],actions:[],
    crmFacts:['Oscar sí estuvo presente.'],forbiddenClaims:['AgriWest participó en la reunión.'],clarification:[],
  },
  {
    id:'en-approver-recipient',language:'English',tags:['entity-roles'],
    note:'Met Carlos at Robles Farms. Oscar, who also works at Robles Farms, was not there but approves credit. I will call Oscar tomorrow to check approval. AgriWest is offering a cheaper alternative.',
    headerContacts:['Carlos','Oscar'],headerCompanies:['Robles Farms'],
    actions:[{type:'call',contact:'Oscar',company:'Robles Farms',object:null,date:'2026-09-11',evidence:'I will call Oscar tomorrow to check approval'}],
    crmFacts:['Oscar is an explicit recipient, not a meeting participant.'],forbiddenClaims:['Met Oscar.'],clarification:[],
  },
  {
    id:'es-multiple-real-companies',language:'Spanish',tags:['entity-roles'],
    note:'En la feria hablé con Laura de Norvia y Luis de Delta. Sus competidores son Helena y AgriWest. Enviaré muestras a Laura mañana y llamaré a Luis el lunes. Marta de Delta debe aprobar el crédito, pero no hablé con ella ni tengo que contactarla.',
    headerContacts:['Laura','Luis'],headerCompanies:['Norvia','Delta'],
    actions:[{type:'send',contact:'Laura',company:'Norvia',object:'muestras',date:'2026-09-11',evidence:'Enviaré muestras a Laura mañana'},{type:'call',contact:'Luis',company:'Delta',object:null,date:'2026-09-14',evidence:'llamaré a Luis el lunes'}],
    crmFacts:['Marta debe aprobar el crédito.'],forbiddenClaims:['Helena es la empresa visitada.'],clarification:[],
  },
  {
    id:'en-no-rep-commitment',language:'English',tags:['entity-roles','mixed-ownership'],
    note:'Met Carlos at Robles Farms. Helena is offering a lower price. Oscar must approve his credit; Carlos will send me the confirmed order Friday. I have no task to do.',
    headerContacts:['Carlos'],headerCompanies:['Robles Farms'],actions:[],
    crmFacts:['Helena is a competitor.','Carlos owns the Friday commitment.'],forbiddenClaims:['Follow up Friday.'],clarification:[],
  },
]

export function roleIssues(c:VisitCase, value:VisitExtraction):string[] {
  const issues:string[]=[]
  for(const [key,expected] of [['contacts',c.headerContacts],['companies',c.headerCompanies]] as const){
    if(expected && JSON.stringify([...value[key]].sort())!==JSON.stringify([...expected].sort()))issues.push(`header-${key}`)
  }
  if(c.tags.includes('tank-mix')){
    const send=value.actions.find(a=>a.type==='send')
    if(!send || !/tank[ -]?mix/i.test(send.object) || !/tank[ -]?mix/i.test(send.description))issues.push('lost-tank-mix-deliverable')
    if(send && !/tank[ -]?mix/i.test(calendarDraftFromAction(visitActionFields(send,c.language),c.language,'America/Los_Angeles').title))issues.push('lost-tank-mix-title')
    const prose=[value.summary,...value.insights].join(' ')
    for(const fact of ['AgriWest','Oscar','40','20','Bloomset 75','Blend EC'])if(!prose.includes(fact))issues.push(`lost-context:${fact}`)
    if(!value.questions.some(q=>q.action_index===value.actions.indexOf(send!) && q.field==='date'))issues.push('missing-weekday-clarification')
  }
  return issues
}
