/** Paid text-only runner. Never imported by the application or unit test suite. */
import {readFileSync,writeFileSync,appendFileSync,existsSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {MESSY_TEXT_CASES} from './messy-text-corpus'
import {gradeMessyText,auditMessyText} from './messy-text-grade'
import {extractVisit,VisitExtractionError,VISIT_MODEL} from '../lib/extractVisitServer'
import {VISIT_PROMPT} from '../lib/visitExtraction'
const hash=(v:string)=>createHash('sha256').update(v).digest('hex')
const run=process.env.FOLUP_EVAL_RUN||''
const rates={input:2.5,output:15}
const maxRequestUsd=0.09 // <=4,000 output tokens + bounded input with conservative margin.
async function main(){
  const cases=MESSY_TEXT_CASES
  if(cases.length!==100||cases.some(c=>c.note.length>5000))throw Error('Corpus scope changed')
  const ledger=JSON.parse(readFileSync(new URL('./api-budget.json',import.meta.url),'utf8'))
  const reservation=ledger.reservations.find((r:{id:string,status:string})=>r.id===run&&r.status==='reserved')
  if(!/^messy-text-\d+$/.test(run)||!reservation||reservation.maxRequests!==100||reservation.model!==VISIT_MODEL)throw Error('Explicit active text-run reservation required')
  const file=new URL(`./${run}.jsonl`,import.meta.url)
  if(existsSync(file))throw Error('Run already exists; do not silently repeat paid calls')
  const sourceCommit=process.env.FOLUP_SOURCE_COMMIT||'working-tree'
  writeFileSync(file,JSON.stringify({metadata:true,run,model:VISIT_MODEL,sourceCommit,promptSha256:hash(VISIT_PROMPT),corpusSha256:hash(JSON.stringify(cases)),graderSha256:hash(readFileSync(new URL('./messy-text-grade.ts',import.meta.url),'utf8')),ratesPerMillion:rates,scope:'100 synthetic TEXT notes, no audio and no production writes; v1 checks and post-round-2 audit separately reported'})+'\n',{flag:'wx'})
  let knownCost=0,unknownHold=0,requests=0,failures=0
  for(let offset=0;offset<cases.length;offset+=4){
    const batch=cases.slice(offset,offset+4)
    if(knownCost+unknownHold+batch.length*maxRequestUsd>reservation.reservedUsd)throw Error('Conservative run budget exhausted; partial results retained')
    const rows=await Promise.all(batch.map(async c=>{
      const started=Date.now();requests++
      try{
        const {result,usage}=await extractVisit(c.note,c.now,c.zone)
        const usd=usage?(usage.prompt_tokens*rates.input+usage.completion_tokens*rates.output)/1e6:0
        if(usage)knownCost+=usd;else unknownHold+=maxRequestUsd
        const issues=gradeMessyText(c,result.extraction);if(issues.length)failures++
        return {id:c.id,family:c.family,split:c.split,language:c.language,ms:Date.now()-started,usd,usage,issues,auditIssues:auditMessyText(c,result.extraction),output:result.extraction,unknownCost:!usage}
      }catch(error){
        failures++
        if(error instanceof VisitExtractionError&&error.usage){
          const usd=(error.usage.prompt_tokens*rates.input+error.usage.completion_tokens*rates.output)/1e6;knownCost+=usd
          return {id:c.id,family:c.family,split:c.split,ms:Date.now()-started,error:error.message,usd,usage:error.usage,rawOutput:error.rawOutput}
        }
        unknownHold+=maxRequestUsd
        return {id:c.id,family:c.family,split:c.split,ms:Date.now()-started,error:error instanceof Error?error.message:'Unknown failure',unknownCost:true}
      }
    }))
    for(const row of rows)appendFileSync(file,JSON.stringify(row)+'\n')
    console.log(JSON.stringify({completed:requests,total:100,failedChecks:failures,knownCostUsd:knownCost,unknownCostHoldUsd:unknownHold}))
  }
  const summary={summary:true,run,requests,failedChecks:failures,knownCostUsd:knownCost,unknownCostHoldUsd:unknownHold,limitations:'Automated semantic-contract checks need human review. Synthetic text only; no transcription or microphone test. Prices exclude cached discount, not an invoice.'}
  appendFileSync(file,JSON.stringify(summary)+'\n');console.log(JSON.stringify(summary))
}
main().catch(error=>{console.error(error.message);process.exitCode=1})
