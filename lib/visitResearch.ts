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
  const heading=spanish?'Investigación externa — no forma parte de lo declarado en la visita':'External research — not statements from the visit'
  const body=researchSegments(result).map(s=>s.url?`${s.text} (${s.url})`:s.text).join('')
  return `\n\n${heading}\n${result.completedAt.slice(0,10)}\n${body}`
}
