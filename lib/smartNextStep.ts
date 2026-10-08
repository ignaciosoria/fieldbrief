import {SALES_PROMPT,SALES_SCHEMA,parseSalesDecision} from './salesDecision'
import type {VisitAction,VisitExtraction} from './visitExtraction'

export type SmartCandidate = {id:string;action:VisitAction}
export type SmartCandidates = {facts:VisitExtraction;candidates:SmartCandidate[];modelChoice:string;rejected:number}
export const smartSelectorEnabled=(value=process.env.FOLUP_SMART_SELECTOR)=>value==='decisions'

// Experimental wire format only. Persisted/UI extraction still contains at most
// one recommendation. The disabled production path uses SALES_SCHEMA unchanged.
export const SMART_CANDIDATE_SCHEMA={...SALES_SCHEMA,
  properties:{...SALES_SCHEMA.properties,
    recommendations:{...SALES_SCHEMA.properties.recommendations,maxItems:3},
    preferredRecommendation:{type:'string',enum:['none','candidate_0','candidate_1','candidate_2']},
  },required:[...SALES_SCHEMA.required,'preferredRecommendation'],
}
export const SMART_CANDIDATE_PROMPT=SALES_PROMPT
  .replace('recommendations may contain zero or ONE useful proposed rep action','recommendations may contain zero to THREE useful alternative proposed rep actions')
  .replace('output at most one recommendation overall:','generate at most three alternative recommendations overall:')
  .replace('Do not force three candidates or output the alternatives or a reasoning transcript.','Do not force three candidates or output a reasoning transcript. Return the eligible alternatives in recommendations for internal selection only.')
  .replace('Preserve the existing output schema: one recommendation at most, with all explicit commitments separately retained.','Return at most three distinct alternatives in recommendations, with all explicit commitments separately retained.')+
  `\nCANDIDATE MODE: recommendations are mutually exclusive alternatives, NOT a multi-step plan. Generate alternatives BEFORE selecting your preference. When the note supports two different feasible ways to address the blocker, retain BOTH for comparison even if one looks better; do not prune the runner-up just because you already prefer another. For example, checking the customer's advisor discussion later and proposing coordination through the customer earlier can be distinct feasible alternatives when timing context supports both. Alternatives for a price concern might clarify comparable terms or propose reviewing an already-available comparison, but never invent access to that comparison. Do not force extra options when only one is grounded; do not pad with paraphrases. Each option must have its own final concise action, rationale and timingReason, ready for display without another writing call. Return [] when none adds value. Set preferredRecommendation to your best eligible option by its array index (candidate_0, candidate_1, candidate_2), or none. The selector will independently choose one or none. Never put alternatives in the factual summary, insights or explicit actions.`

/** Invalid advice is dropped individually; facts and commitments are never lost. */
export function parseSmartCandidates(raw:unknown,source:string,now:string,zone:string):SmartCandidates{
  if(!raw||typeof raw!=='object')throw Error('Invalid candidate extraction')
  const wire=raw as Record<string,unknown>
  const {recommendations,preferredRecommendation,...factual}=wire
  const facts=parseSalesDecision({...factual,recommendations:[]},source,now,zone)
  const candidates:SmartCandidate[]=[]
  let rejected=0
  if(!Array.isArray(recommendations)||recommendations.length>3)return {facts,candidates,modelChoice:'none',rejected:1}
  for(const [index,item] of recommendations.entries()){
    try{
      const parsed=parseSalesDecision({...factual,recommendations:[item]},source,now,zone)
      const action=parsed.actions.find(a=>a.origin==='recommendation')
      if(!action||candidates.some(c=>c.action.contact===action.contact&&c.action.company===action.company&&c.action.description.trim().toLowerCase()===action.description.trim().toLowerCase())){rejected++;continue}
      candidates.push({id:`candidate_${index}`,action})
    }catch{rejected++}
  }
  const modelChoice=candidates.some(c=>c.id===preferredRecommendation)?String(preferredRecommendation):'none'
  return {facts,candidates,modelChoice,rejected}
}

/** A selector can only append a validated alternative, never rewrite facts. */
export function applySmartChoice(bundle:SmartCandidates,choice:string):VisitExtraction{
  const facts=structuredClone(bundle.facts)
  const chosen=bundle.candidates.find(c=>c.id===choice)
  if(chosen)facts.actions.push(structuredClone(chosen.action))
  return facts
}
