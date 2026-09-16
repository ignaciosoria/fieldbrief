/** Offline inspection only: no API, no production writes, never alters recorded runs. */
import {readFileSync} from 'node:fs'
import {MESSY_TEXT_CASES} from './messy-text-corpus'
import {gradeMessyText,auditMessyText} from './messy-text-grade'
import type {VisitExtraction} from '../lib/visitExtraction'
type Row={id?:string;ms:number;usd:number;issues?:string[];error?:string;output?:VisitExtraction;usage?:{prompt_tokens:number;completion_tokens:number;prompt_tokens_details?:{cached_tokens:number}}}
const percentile=(values:number[],p:number)=>values.slice().sort((a,b)=>a-b)[Math.ceil(values.length*p)-1]
for(const name of process.argv.slice(2)){
  if(!/^messy-text-\d+$/.test(name))throw Error('Expected a recorded messy-text run name')
  const rows=(readFileSync(new URL(`./${name}.jsonl`,import.meta.url),'utf8').trim().split('\n').map(line=>JSON.parse(line)) as Row[]).filter(r=>r.id)
  const details=rows.map(r=>{
    const c=MESSY_TEXT_CASES.find(c=>c.id===r.id)!
    return {id:r.id,language:c.language,split:c.split,family:c.family,issues:r.error?[r.error]:gradeMessyText(c,r.output!),audit:r.output?auditMessyText(c,r.output):[]}
  })
  const conservativeUsd=rows.reduce((n,r)=>n+(r.usd||0),0)
  const cachedDiscount=rows.reduce((n,r)=>n+(r.usage?.prompt_tokens_details?.cached_tokens||0)*2.25/1e6,0)
  const group=(key:'language'|'split')=>Object.fromEntries([...new Set(details.map(r=>r[key]))].map(value=>{
    const selected=details.filter(r=>r[key]===value)
    return [value,{count:selected.length,v1Passed:selected.filter(r=>!r.issues.length).length,withAuditPassed:selected.filter(r=>!r.issues.length&&!r.audit.length).length}]
  }))
  console.log(JSON.stringify({run:name,count:rows.length,v1Passed:details.filter(r=>!r.issues.length).length,
    withAuditPassed:details.filter(r=>!r.issues.length&&!r.audit.length).length,auditFlagged:details.filter(r=>r.audit.length).length,
    errors:rows.filter(r=>r.error).length,conservativeUsd,cachedRateEstimateUsd:conservativeUsd-cachedDiscount,
    latencySeconds:{median:percentile(rows.map(r=>r.ms),.5)/1000,p95:percentile(rows.map(r=>r.ms),.95)/1000},
    languages:group('language'),originalSplit:group('split'),flags:details.filter(r=>r.issues.length||r.audit.length),
    caveats:'Original split was only blind before round 2. Extra audit added after round 2 and reapplied equally offline; narrow pattern checks, not complete semantic judgment. Synthetic text, 25 template families, no ASR. Costs are usage estimates, not invoices.'},null,2))
}
