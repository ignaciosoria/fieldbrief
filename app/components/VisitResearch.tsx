'use client'
import {useEffect,useState} from 'react'
import {mayRequestResearch,researchCrmText,researchPresentationSegments,researchSegmentProse,type ResearchResult} from '../../lib/visitResearch'

export function useVisitResearch(noteId:string|undefined,version:number|undefined,owner:string|undefined,raw:string,auto:boolean,prepared?:{source:string;result:ResearchResult|null}){
  const preparedHere=prepared?.source===raw?prepared:undefined
  const eligible=!!noteId&&!!version&&!!owner&&mayRequestResearch(raw)
  const key=`${owner}:${noteId}:${version}`
  const [value,setValue]=useState<{key:string;state:string;result:ResearchResult|null}>({key:'',state:'idle',result:null})
  const [retry,setRetry]=useState(0)
  useEffect(()=>{
    if(!eligible||preparedHere?.result)return
    let active=true,timer:ReturnType<typeof setTimeout>|undefined
    const controller=new AbortController()
    const url=`/api/research?noteId=${encodeURIComponent(noteId!)}&version=${version}`
    setValue({key,state:'running',result:null})
    const load=async(run:boolean)=>{
      try{
        const response=await fetch(url,{method:run?'POST':'GET',signal:controller.signal})
        const data=await response.json()
        if(!active)return
        if(!response.ok)throw Error('Research unavailable')
        setValue({key,state:data.state,result:data.result||null})
        if(data.state==='running'){
          const expired=Date.now()-Date.parse(data.started_at)>125000
          if(expired){setValue({key,state:'failed',result:null});return}
          timer=setTimeout(()=>void load(false),2500)
        }
      }catch{if(active)setValue({key,state:'failed',result:null})}
    }
    void load((auto&&!preparedHere)||retry>0)
    return ()=>{active=false;controller.abort();if(timer)clearTimeout(timer)}
  },[eligible,key,noteId,version,auto,retry,preparedHere])
  if(preparedHere?.result)return {eligible:true,state:'done',result:preparedHere.result,retry:()=>{}}
  const state=value.key===key?value.state:'idle'
  return {eligible,state:preparedHere&&state==='idle'?'failed':state,result:value.key===key?value.result:null,retry:()=>setRetry(x=>x+1)}
}

export default function VisitResearch({research}:{research:ReturnType<typeof useVisitResearch>}){
  if(!research.eligible||research.result?.status==='none')return null
  if(research.state==='running')return <p role="status" className="text-sm text-gray-500">Researching… Your visit is saved.</p>
  if(!research.result)return <p className="text-sm text-gray-500">{research.state==='failed'?'Research unavailable. Your visit is saved.':'Research requested.'} <button className="text-indigo-700 underline" onClick={research.retry}>{research.state==='failed'?'Retry research':'Research now'}</button></p>
  const result=research.result
  return <details className="rounded-xl border border-zinc-200 p-3 text-sm" open={result.status==='clarify'}>
    <summary className="cursor-pointer font-medium text-gray-700">{result.status==='clarify'?'Clarify research':'Additional information'}</summary>
    <p className="mt-2 whitespace-pre-wrap leading-relaxed text-gray-700">{researchPresentationSegments(result).map((s,i)=>s.url?<span key={i}>{researchSegmentProse(s)}<a href={s.url} title={s.title} aria-label={`Source: ${s.title}`} target="_blank" rel="noopener noreferrer" className="text-indigo-700 underline underline-offset-2">[{Math.ceil(i/2)}]</a></span>:<span key={i}>{s.text}</span>)}</p>
    {result.status==='clarify'&&<p className="mt-2 text-gray-500">Use “Correct by voice” to clarify and request research again.</p>}
  </details>
}
export {researchCrmText}
