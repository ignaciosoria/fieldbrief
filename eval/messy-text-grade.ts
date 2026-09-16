import type {MessyCase,ExpectedTask} from './messy-text-corpus'
import {visitActionFields,visitExtractionResult,type VisitExtraction,type VisitAction} from '../lib/visitExtraction'
import {calendarDraftFromAction,googleCalendarUrl,CALENDAR_TITLE_LIMIT} from '../lib/calendarDraft'
import {formatProfessionalCrmNote} from '../lib/formatCrmSalesNote'
const has=(text:string,pattern:string)=>new RegExp(pattern,'iu').test(text)
function matches(a:VisitAction,e:ExpectedTask){return a.type===e.type&&e.contact.includes(a.contact)&&e.company.includes(a.company)&&a.date===e.date&&a.time===e.time}

/** Deterministic contract checks, not a claim of complete semantic correctness. */
export function gradeMessyText(c:MessyCase,v:VisitExtraction):string[]{
  const issues:string[]=[]
  if(v.language!==c.language)issues.push('language')
  for(const name of c.contacts)if(!v.contacts.includes(name))issues.push(`missing-header-contact:${name}`)
  for(const name of c.forbidContacts)if(v.contacts.includes(name))issues.push(`wrong-header-contact:${name}`)
  for(const name of c.companies)if(!v.companies.includes(name))issues.push(`missing-header-company:${name}`)
  for(const name of c.forbidCompanies)if(v.companies.includes(name))issues.push(`wrong-header-company:${name}`)
  if(v.actions.length!==c.tasks.length)issues.push(`action-count:${v.actions.length}/${c.tasks.length}`)
  const used=new Set<number>(),mapping:number[]=[]
  for(const [i,e] of c.tasks.entries()){
    const index=v.actions.findIndex((a,j)=>!used.has(j)&&matches(a,e));mapping.push(index)
    if(index<0){issues.push(`action-contract:${i}:${e.type}`);continue}
    used.add(index);const a=v.actions[index]
    for(const pattern of e.need)if(!has(a.description,pattern))issues.push(`action-detail:${i}:${pattern}`)
    for(const pattern of e.avoid)if(has(a.description,pattern))issues.push(`action-leak:${i}:${pattern}`)
    if(e.object&&!has(a.object,e.object))issues.push(`action-object:${i}`)
    const draft=calendarDraftFromAction(visitActionFields(a,v.language),v.language,c.zone)
    if(e.clock&&draft.time!==e.clock)issues.push(`calendar-clock:${i}:${draft.time}/${e.clock}`)
    if(Array.from(draft.title).length>CALENDAR_TITLE_LIMIT)issues.push(`calendar-title-length:${i}`)
    for(const identity of [a.contact,a.company].filter(Boolean))if(![draft.title,draft.details].join(' ').includes(identity))issues.push(`calendar-identity:${i}`)
    if(!draft.details.endsWith(a.description))issues.push(`calendar-description:${i}`)
    const url=googleCalendarUrl(draft)
    if(!a.date&&url)issues.push(`exported-missing-date:${i}`)
    if(a.date&&!url)issues.push(`invalid-calendar:${i}`)
    if(url){const params=new URL(url).searchParams;if(params.get('text')!==draft.title||params.get('details')!==draft.details)issues.push(`calendar-roundtrip:${i}`)}
  }
  for(const q of c.questions)if(mapping[q.task]>=0&&!v.questions.some(actual=>actual.action_index===mapping[q.task]&&actual.field===q.field))issues.push(`missing-question:${q.task}:${q.field}`)
  if(!c.questions.length&&v.questions.length)issues.push('unnecessary-clarification')
  const crm=formatProfessionalCrmNote(visitExtractionResult(v,c.now,c.zone))
  for(const pattern of c.context)if(!has(crm,pattern))issues.push(`lost-crm-fact:${pattern}`)
  for(const pattern of c.insights)if(!has(v.insights.join(' '),pattern))issues.push(`lost-visible-fact:${pattern}`)
  for(const pattern of c.summaryAvoid)if(has(v.summary,pattern))issues.push(`summary-invention:${pattern}`)
  if(v.insights.length>4)issues.push('too-many-insights')
  if(c.location!==undefined&&v.location!==c.location)issues.push('wrong-location')
  return issues
}

/** Added AFTER rounds 1/2 manual review. Report separately from the frozen v1 score.
 * These narrow checks catch observed factuality errors, not arbitrary paraphrases.
 */
export function auditMessyText(c:MessyCase,v:VisitExtraction):string[]{
  const issues:string[]=[],prose=[v.summary,...v.insights].join(' ')
  if(c.family==='future-purpose-only'&&v.actions.some(a=>/no\s+promet(?:er|as)|(?:do not|don't|never)\s+promise/i.test(a.description)))issues.push('past-negation-became-prohibition')
  if(c.language==='Spanish'&&/(?:no hubo (?:ninguna )?compra\b(?!\s+(?:reportada|confirmada|mencionada))|no (?:ha |había )?compr(?:ó|ado) nada)/i.test(prose))issues.push('unreported-purchase-became-denial')
  if(c.family==='uncertain-quantity'&&/rep.s price was not accepted/i.test(prose))issues.push('price-rejection-owner-reversed')
  if(c.family==='ambiguous-company'&&c.forbidCompanies.slice(1).some(name=>prose.includes(name)))issues.push('uncertain-company-in-crm')
  return issues
}
