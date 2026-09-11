/** Explicit paid benchmark only. Never imported by application or npm test. */
import { extractVisit, VisitExtractionError } from '../lib/extractVisitServer'
import { VISIT_CORPUS, VISIT_NOW, VISIT_ZONE } from './visit-corpus'
import { VISIT_HELDOUT } from './visit-heldout'
import { readFileSync } from 'node:fs'

async function main() {
  const ledger = JSON.parse(readFileSync(new URL('./api-budget.json',import.meta.url),'utf8'))
  const reservation = ledger.reservations.find((r:{id:string;status:string}) => r.id === process.env.FOLUP_EVAL_RUN && r.status === 'reserved')
  const cases = [...VISIT_CORPUS,...VISIT_HELDOUT]
  if (!reservation || reservation.maxRequests !== cases.length) throw Error('Explicit active reservation required')
  const model = reservation.model || 'gpt-4.1-2025-04-14'
  const rates = model === 'gpt-5.4-mini-2026-03-17' ? {input:0.75,output:4.5} : model === 'gpt-5.4-2026-03-05' ? {input:2.5,output:15} : {input:2,output:8}
  if (cases.some(c=>c.note.length>1000)) throw Error('Benchmark scope changed')
  let cost = 0
  let failed = 0
  // Four at a time; bounded request count, no automatic retries.
  for (let start = 0; start < cases.length; start+=4) {
    const batch = await Promise.all(cases.slice(start,start+4).map(async c=> {
      const began = Date.now()
      try {
        const {result,usage} = await extractVisit(c.note,VISIT_NOW,VISIT_ZONE,model)
        const usd = ((usage?.prompt_tokens || 0)*rates.input + (usage?.completion_tokens || 0)*rates.output)/1e6
        cost += usd // Conservative: no cached-input discount.
        const actual = result.extraction.actions
        const issues:string[] = []
        if (result.extraction.language !== c.language) issues.push('language')
        if (actual.length !== c.actions.length) issues.push(`action-count:${actual.length}/${c.actions.length}`)
        for (const expected of c.actions) {
          if (!actual.some(a => a.type===expected.type && a.contact===(expected.contact || '') && a.company===(expected.company || '') && a.date===(expected.date || ''))) issues.push(`action:${expected.type}/${expected.contact}/${expected.company}/${expected.date}`)
        }
        if (!!result.extraction.questions.length !== !!c.clarification.length) issues.push('clarification-presence')
        if (c.id === 'en-long-product' && /Baja California/i.test(result.extraction.location)) issues.push('study-is-not-visit-location')
        if (c.id === 'es-location-confounder' && result.extraction.location) issues.push('phone-call-has-no-visit-location')
        if (c.id === 'en-uncertain-company' && result.extraction.questions.some(q=>q.action_index !== 0 || /[¿áéíóú]|empresa|cuál/i.test(q.question))) issues.push('question-target-or-language')
        if (c.id === 'es-clear-purpose' && !actual.some(a=>/Q7/.test(a.description) && /precio/.test(a.description))) issues.push('missing-stated-purpose')
        if (c.id === 'es-secondary-meeting' && !actual.some(a=>a.type==='meeting' && a.time==='10:00')) issues.push('meeting-time')
        if (c.id === 'en-long-product' && !actual.some(a=>/intensive care unit in Baja California/i.test(a.object))) issues.push('truncated-deliverable')
        const prose = [result.extraction.summary,...result.extraction.insights].join(' ')
        // Summary deliberately excludes rep commitments (rendered from actions).
        if (c.id === 'es-clear-purpose' && /Q7|precio|propuesta/i.test(result.extraction.summary)) issues.push('future-purpose-in-visit-summary')
        if (c.tags.includes('temporal-factuality')) {
          if (/Z9|warranty|garant[ií]a/i.test(result.extraction.summary)) issues.push('future-purpose-in-visit-summary')
          if (!actual.some(a=>/Z9/.test(a.description))) issues.push('lost-future-purpose')
          if (c.id.includes('past-and-future') && (!/R8/.test(prose) || !/color/i.test(prose))) issues.push('lost-stated-visit-discussion')
        }
        if (c.tags.includes('action-constraint')) {
          const send = actual.find(a=>a.type==='send')
          const call = actual.find(a=>a.type==='call')
          const restriction = c.language === 'Spanish' ? /(?:no|sin|exclu|omiti).*precio/i : /(?:no|not|without|exclud|omit|leave out).*pric/i
          if (!send || !restriction.test(send.description)) issues.push('lost-action-restriction')
          if (!call || /precio|pric|Q7|Quantum/i.test(call.description)) issues.push('borrowed-action-context')
          if (call?.time !== '11:00') issues.push('call-time')
        }
        if (c.id === 'en-negation' && !/not|don't|no quote/i.test(prose)) issues.push('lost-negative-constraint')
        if (c.id === 'es-no-followup' && /mostr|demostr/i.test(prose)) issues.push('invented-demonstration')
        if (c.id === 'en-uncertain-company' && /interest|interested/i.test(prose)) issues.push('invented-interest')
        if (c.id.includes('confirmed-') && /no qued[oó] clar|no est[aá] clar|unclear|por confirmar|o Mar[ií]a|Acme or Apex/i.test(prose + actual.map(a=>a.description).join(' '))) issues.push('stale-uncertainty-after-confirmation')
        if (issues.length) failed++
        return {id:c.id,ms:Date.now()-began,usd,usage,issues,output:result.extraction}
      } catch (error) {
        failed++
        if (error instanceof VisitExtractionError && error.usage) {
          const usd = (error.usage.prompt_tokens*rates.input + error.usage.completion_tokens*rates.output)/1e6
          cost += usd
          return {id:c.id,ms:Date.now()-began,usd,error:error.message,usage:error.usage,rawOutput:error.rawOutput}
        }
        return {id:c.id,ms:Date.now()-began,error:error instanceof Error?error.message:'unknown',unknownCost:true}
      }
    }))
    for (const row of batch) console.log(JSON.stringify(row))
  }
  console.log(JSON.stringify({summary:true,model,requests:cases.length,failedChecks:failed,knownCostUsd:cost,ratesPerMillion:rates,notMeasured:'semantic factuality and description quality require human review; not an ASR test; cached discount not applied'}))
}
main().catch(error=>{console.error(error.message);process.exitCode=1})
