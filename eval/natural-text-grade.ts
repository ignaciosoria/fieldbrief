import {calendarDraftFromAction,googleCalendarUrl} from '../lib/calendarDraft'
import {formatProfessionalCrmNote} from '../lib/formatCrmSalesNote'
import {visitActionFields,visitExtractionResult,type VisitExtraction} from '../lib/visitExtraction'
import {NATURAL_NOW,NATURAL_ZONE,type NaturalCase} from './natural-text-corpus'
const has=(text:string,pattern:string)=>new RegExp(pattern,'iu').test(text)
export function naturalView(v:VisitExtraction){return {crm:formatProfessionalCrmNote(visitExtractionResult(v,NATURAL_NOW,NATURAL_ZONE)),insights:v.insights,drafts:v.actions.map(a=>calendarDraftFromAction(visitActionFields(a,v.language),v.language,NATURAL_ZONE))}}
/** These assertions flag specific semantic errors; manual source-to-claim review remains required. */
export function gradeNatural(c:NaturalCase,v:VisitExtraction){
 const issues:string[]=[],view=naturalView(v),used=new Set<number>()
 if(v.language!==c.language)issues.push('language')
 if(v.actions.length!==c.tasks.length)issues.push(`action-count:${v.actions.length}/${c.tasks.length}`)
 for(const [i,t] of c.tasks.entries()){
  const index=v.actions.findIndex((a,j)=>!used.has(j)&&a.type===t.type&&t.contact.includes(a.contact)&&a.company===t.company&&a.date===t.date&&a.time===t.time&&t.need.every(p=>has(a.description,p)))
  if(index<0){issues.push(`action-semantics:${i}`);continue}
  used.add(index);const draft=view.drafts[index]
  if(draft.time!==t.clock)issues.push(`clock:${i}:${draft.time}/${t.clock}`)
  if(t.titleNeed&&!has(draft.title,t.titleNeed))issues.push(`title-purpose:${i}`)
  if(Array.from(draft.title).length>44)issues.push(`title-length:${i}`)
  const a=v.actions[index]
  for(const identity of [a.contact,a.company].filter(Boolean))if(![draft.title,draft.details].join(' ').includes(identity))issues.push(`identity:${i}`)
  if(t.date&&t.clock&&!googleCalendarUrl(draft))issues.push(`calendar-invalid:${i}`)
 }
 const actual=v.questions.map(q=>q.field).sort(),expected=[...c.questions].sort()
 if(JSON.stringify(actual)!==JSON.stringify(expected))issues.push('clarification-fields')
 for(const fact of c.facts)if(!has(view.crm,fact))issues.push(`missing-fact:${fact}`)
 for(const fact of c.forbid)if(has(view.crm,fact))issues.push(`unsupported-claim:${fact}`)
 if(v.insights.length>4)issues.push('insight-count')
 return {issues,view}
}
