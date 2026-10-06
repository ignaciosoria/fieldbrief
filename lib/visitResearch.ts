export type ResearchCitation={start:number;end:number;url:string;title:string}
export type ResearchResult={status:'none'|'clarify'|'ready';text:string;citations:ResearchCitation[];completedAt:string}

// Cheap prefilter only. The server classifier must still verify an explicit request
// directed to Folup, not a customer's quote, negation, or the rep's own task.
export function mayRequestResearch(text:string){
  const folded=text.normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  return /\b(investig\w*|research\w*|look\s+up|find\s+out|busc\w*|averigu\w*|consulta\w*|search\s+for)\b/i.test(folded)
}
export function safeResearchUrl(raw:string){
  try {const u=new URL(raw);return u.protocol==='https:' && !u.username && !u.password ? u.href : null}catch{return null}
}
export function researchSegments(result:ResearchResult):{text:string;url?:string;title?:string}[]{
  const out:{text:string;url?:string;title?:string}[]=[];let at=0
  for(const c of [...result.citations].sort((a,b)=>a.start-b.start)){
    const url=safeResearchUrl(c.url)
    if(!url || !Number.isInteger(c.start)||!Number.isInteger(c.end)||c.start<at||c.end<=c.start||c.end>result.text.length)continue
    out.push({text:result.text.slice(at,c.start)},{text:result.text.slice(c.start,c.end)||c.title,url,title:c.title});at=c.end
  }
  out.push({text:result.text.slice(at)});return out
}
export function researchCrmText(result:ResearchResult|null,spanish:boolean){
  if(!result||result.status==='none')return ''
  const heading=result.status==='clarify'?(spanish?'Consulta pendiente':'Research clarification'):(spanish?'Información adicional':'Additional information')
  return `\n\n${heading}\n${researchAnswerText(result)}`
}

/** Remove citation markers, not factual prose. Stored evidence stays untouched. */
export function researchAnswerText(result:ResearchResult){
  return researchPresentationSegments(result).map(researchSegmentProse).join('').replace(/[ \t]+([.,;:!?])/g,'$1').replace(/[ \t]{2,}/g,' ').trim()
}
export function researchSegmentProse(s:{text:string;url?:string}){
  if(!s.url)return s.text
  const label=s.text.trim()
  if(/^\[?\d+\]?$/.test(label)||/^\(?[\w-]+(?:\.[\w-]+)+(?:\/[^\s]*)?\)?$/.test(label)||label===new URL(s.url).hostname||label===s.url)return ''
  return s.text
}

/** Clean provider Markdown only inside verified citation ranges; never rewrite findings. */
export function researchPresentationSegments(result:ResearchResult){
  return researchSegments(result).map(s=>{
    if(!s.url)return s
    const markdown=s.text.trim().match(/^\(?\[([^\]]+)\]\((https:\/\/[^\s)]+)\)\)?$/)
    return markdown&&safeResearchUrl(markdown[2])===s.url?{...s,text:markdown[1]}:s
  })
}
