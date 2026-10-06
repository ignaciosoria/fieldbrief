import {extractVisit} from './extractVisitServer'
import {investigateVisit} from './visitResearchServer'
import {mayRequestResearch,type ResearchResult} from './visitResearch'

/** Both planners start together. Web search still waits for the identity privacy guard.
 * Research failure cannot discard a successfully extracted visit. No detached jobs.
 */
export async function extractVisitWithResearch(note:string,now:string,timezone:string,
  allowResearch:()=>Promise<boolean>,
  extract=extractVisit,investigate=investigateVisit){
  const visit=extract(note,now,timezone)
  if(!mayRequestResearch(note))return visit
  const names=visit.then(({result})=>[...result.extraction.contacts,...result.extraction.companies])
  const language=visit.then(({result})=>result.extraction.language)
  // Observe a rejection even if the research classifier exits early with none/clarify.
  void names.catch(()=>{})
  void language.catch(()=>{})
  const research:Promise<ResearchResult|null>=(async()=>{
    if(!await allowResearch())return null
    return investigate(note,language,undefined,names)
  })().catch(()=>null)
  const [processed,answer]=await Promise.all([visit,research])
  processed.result.extraction.research={source:note,result:answer}
  return processed
}
