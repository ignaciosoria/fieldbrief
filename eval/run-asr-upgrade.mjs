import OpenAI from 'openai'
import {readFileSync,createReadStream,appendFileSync,existsSync} from 'node:fs'
const ledger=JSON.parse(readFileSync('eval/api-budget.json','utf8'))
if(!ledger.reservations.some(r=>r.id==='asr-upgrade-1'&&r.status==='reserved'))throw Error('Active budget reservation required')
const output='eval/asr-upgrade-1.jsonl'
if(existsSync(output))throw Error('Run already started; do not repeat paid calls')
const source=readFileSync('lib/transcriptionModel.ts','utf8')
const oldPrompt=source.match(/const WHISPER_CONTEXT_PROMPT =\s*'([^']+)'/)[1]
const vocabulary='Quantum Flower, Quantum Engorde, Ferbloom Flower, Ferbloom 75. Visita, seguimiento, ficha técnica, presupuesto, pedido, distribuidor, fresa, arándano, frambuesa. Client visit, technical sheet, quote, order, grower, strawberry, blueberry.'
const client=new OpenAI({timeout:45000,maxRetries:0})
const arms=[{id:'current',model:'whisper-1',prompt:oldPrompt},{id:'vocabulary',model:'whisper-1',prompt:vocabulary},{id:'candidate',model:'gpt-transcribe',prompt:'A field sales representative dictating a visit note in Spanish or English, sometimes mixing both. Names, product numbers, negations, and spoken self-corrections matter. '+vocabulary}]
const disabled=new Set()
for(const id of ['es-clean','es-noise12db','en-clean','en-noise12db'])for(const arm of arms){
 if(disabled.has(arm.model))continue
 const started=Date.now()
 try{
  const result=await client.audio.transcriptions.create({file:createReadStream(`eval/asr-audio/${id}.wav`),model:arm.model,prompt:arm.prompt,response_format:'json'})
  const row={id,arm:arm.id,model:arm.model,ms:Date.now()-started,...result}
  appendFileSync(output,JSON.stringify(row)+'\n');console.log(JSON.stringify(row))
 }catch(e){
  const row={id,arm:arm.id,model:arm.model,status:e.status,code:e.code,error:e.message,ms:Date.now()-started}
  appendFileSync(output,JSON.stringify(row)+'\n');console.log(JSON.stringify(row))
  if([400,403,404].includes(e.status))disabled.add(arm.model)
 }
}
