import {DateTime} from 'luxon'
import {VISIT_PROMPT,VISIT_SCHEMA,parseVisitExtraction,type VisitAction,type VisitExtraction} from './visitExtraction'

// Separate wire fields prevent advice being interpreted as a reported commitment.
export const SALES_SCHEMA = {...VISIT_SCHEMA,
  properties:{...VISIT_SCHEMA.properties,recommendations:{type:'array',maxItems:1,items:{type:'object',additionalProperties:false,
    required:['action','rationale','timingReason'],properties:{action:VISIT_SCHEMA.properties.actions.items,
      rationale:{type:'string'},timingReason:{type:'string'}}}}},
  required:[...VISIT_SCHEMA.required,'recommendations'],
}

export const SALES_PROMPT = `${VISIT_PROMPT}
DICTATION REPAIR IS NOT A BUSINESS EVENT
Apply the speaker's final corrected meaning without inventing a history for the discarded words. 'Send a quote, no sorry, only the technical sheet without prices' means a sheet-only send, NOT a canceled quote, withdrawn offer, rejected purchase or changed customer decision. 'La prueba fue mal, no, me expliqué mal: aún no la han evaluado' means the trial is not yet evaluated, NOT that the customer clarified its performance or that it performed well/badly. Do not attribute the narrator's repair to the customer. In summary, insights and actions retain the corrected meaning, not a story about the repair.
Conversely, preserve a real cancellation, rejection or withdrawal when the note explicitly reports that business event: 'The customer canceled yesterday's quote request; send the sheet instead' DOES establish a canceled request. Do not erase real events just because they also include replacement instructions. Resolve the scope per person and item; one correction never cancels another person's task.
Preserve the source of restrictions: 'Do not contact Nadia again' establishes a no-contact instruction, NOT that Nadia requested it. Write 'No further contact with Nadia' unless the note explicitly attributes the request to her. An unattributed instruction must not become customer speech or a customer decision.
COMPLETE CRM CONTEXT
summary is the complete, concise factual CRM narrative, written once. Every important fact used in insights MUST also be covered in summary with the same owner, quantities, uncertainty, negation and conditions. Insights are shorter screen highlights, NOT extra facts to append to CRM. The application exports summary alone, then explicit actions and separately labelled recommendations. Keep outstanding rep actions in actions, not repeated in summary; preserve customer-owned commitments and restrictions as context. Avoid repeating any fact in summary and do not narrate the act of dictation or correction.
Do not infer an encounter, communication channel or physical meeting location from the app's post-visit framing. 'Eva at Hillcrest wants to consider a trial' states an affiliation and interest, NOT 'Met with Eva at Hillcrest'. Start with substantive facts, e.g. 'Eva wants to consider a trial only after permit approval.' Write 'Met/Visited/Reunión/Visita' only when the source explicitly describes that encounter. A company affiliation is not a visited physical location. Keep location empty unless the source explicitly establishes where a visit took place. A future consultation, possible laboratory issue or question must never become a reported incident.
SALES RECOMMENDATION CONTRACT
All rules above govern factual extraction and explicit commitments in actions. Independently, recommendations may contain zero or ONE useful proposed rep action. Never put inferred actions in actions, summary, insights or header identities. Advice is not an agreement or a past fact. Preserve every explicit commitment.
Use only this note and its reference date. Identify the stated objective, unresolved obstacle, next actor and least intrusive useful next step. Unknown stage, authority, urgency or buying intent remain unknown. Never invent history, stakeholder access, product claims or contact permission. Interest alone does not require a task. Return [] for completed matters, requests not to contact, rejected opportunities, or when existing commitments already cover the next useful step. No duplicate actions or multi-step campaigns.
Respect who acts next. If Mike needs to speak with his PCA first, do not schedule a direct PCA call or assume a technical meeting occurred. You may suggest checking with Mike whether he spoke with the PCA and whether help would be useful. Prefer the known contact; do not bypass them to a mentioned father, approver or competitor. After several unanswered attempts allow breathing room, not another immediate call. Honor explicit waiting periods, cancellations and restrictions.
recommendation.action uses the same fields, but description is a proposed instruction and evidence quotes the exact passage establishing the unresolved need, NOT a supposed commitment. contact must be a confirmed contact in contacts; company must be in companies or empty. If identity or recipient/company relationship is unclear, omit the recommendation. subject names the proposed topic without inventing a deliverable. rationale briefly explains the practical purpose grounded in the note. timingReason briefly explains timing. Both use the note language.
For recommendations only, choose a concrete YYYY-MM-DD date based on context and the local reference date. It is always suggested, never agreed. Explicit expectations and waiting periods override cadence defaults. Leave time empty unless a relevant clock time was stated. Do not choose elapsed slots. When a prerequisite has an unknown completion date, propose a review/checkpoint to check its status, preserving the condition in description; never assume it happened or calculate a deadline from an imaginary event. Do not schedule the dependent execution itself. If insufficient context supports responsible advice, return recommendations=[].
Example: 'Mike liked Quantum but must discuss the trial with his PCA first' can support a check with Mike about that discussion, not a promised trial, technical-document send or direct PCA meeting. 'Do not contact me again' supports no recommendation. Never leak advice into the factual CRM narrative.`

export function parseSalesDecision(raw:unknown,source:string,referenceAt:string,timezone:string):VisitExtraction {
  const factual=parseVisitExtraction(raw,source)
  factual.crmNarrativeVersion=1
  // The wire recommendation is adapted below; do not persist two mutable copies.
  delete (factual as VisitExtraction & {recommendations?:unknown}).recommendations
  factual.actions=factual.actions.map(a=>({...a,origin:'commitment',rationale:undefined,timingReason:undefined}))
  const recommendations=(raw as {recommendations?:unknown}).recommendations
  if(!Array.isArray(recommendations)||recommendations.length>1)throw Error('Invalid recommendations')
  const reference=DateTime.fromISO(referenceAt,{zone:timezone})
  if(!reference.isValid)throw Error('Invalid recommendation reference')
  for(const item of recommendations){
    if(!item || typeof item.rationale!=='string' || !item.rationale.trim() || typeof item.timingReason!=='string' || !item.timingReason.trim())throw Error('Invalid recommendation rationale')
    const action:VisitAction=parseVisitExtraction({...factual,actions:[item.action],questions:[]},source).actions[0]
    if(!action.date || DateTime.fromISO(action.date,{zone:timezone}).startOf('day')<reference.startOf('day'))throw Error('Invalid recommendation date')
    if(action.time && DateTime.fromISO(`${action.date}T${action.time}`,{zone:timezone})<=reference)throw Error('Elapsed recommendation time')
    if(!action.contact || !factual.contacts.includes(action.contact) || (action.company && !factual.companies.includes(action.company)))throw Error('Unconfirmed recommendation recipient')
    if(factual.questions.some(q=>q.field==='contact'||q.field==='company'))continue
    if(factual.actions.some(a=>a.contact===action.contact && a.company===action.company && a.description.trim().toLowerCase()===action.description.trim().toLowerCase()))continue
    factual.actions.push({...action,origin:'recommendation',rationale:item.rationale.trim(),timingReason:item.timingReason.trim()})
  }
  return factual
}
