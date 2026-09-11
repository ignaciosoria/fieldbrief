/** Explicit paid pilot; local synthetic TTS, not real field audio. */
import OpenAI from 'openai'
import {readFileSync,writeFileSync,createReadStream} from 'node:fs'
const ledger=JSON.parse(readFileSync(new URL('./api-budget.json',import.meta.url),'utf8'))
const reservation=ledger.reservations.find(r=>r.id===process.env.FOLUP_EVAL_RUN && r.status==='reserved')
if(reservation?.id!=='asr-pilot-1' || reservation.maxRequests!==12)throw Error('Explicit active 12-request reservation required')
const source=readFileSync(new URL('../app/api/transcribe/route.ts',import.meta.url),'utf8')
const currentPrompt=source.match(/const WHISPER_CONTEXT_PROMPT =\s*'([^']+)'/)?.[1]
if(!currentPrompt)throw Error('Current context prompt unavailable')
const arms=[{id:'whisper-current',model:'whisper-1',prompt:currentPrompt},{id:'whisper-no-context',model:'whisper-1'},{id:'mini-no-context',model:'gpt-4o-mini-transcribe-2025-12-15'}]
const files=[]
for(const lang of ['es','en']) {
  const path=new URL(`./asr-audio/${lang}-clean.wav`,import.meta.url)
  const wav=readFileSync(path)
  let offset=12,dataStart=0,bytes=0
  while(offset+8<=wav.length){const size=wav.readUInt32LE(offset+4);if(wav.toString('ascii',offset,offset+4)==='data'){dataStart=offset+8;bytes=size;break}offset+=8+size+(size%2)}
  const seconds=bytes/32000
  if(seconds<5 || seconds>30 || wav.length>1_000_000)throw Error('Synthetic audio scope changed')
  let energy=0
  for(let i=dataStart;i<dataStart+bytes;i+=2)energy+=wav.readInt16LE(i)**2
  const rms=Math.sqrt(energy/(bytes/2)),noiseAmplitude=rms/(10**(12/20))*Math.sqrt(3)
  let seed=42
  const noisy=Buffer.from(wav)
  for(let i=dataStart;i<dataStart+bytes;i+=2){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const noise=(seed/4294967296*2-1)*noiseAmplitude;noisy.writeInt16LE(Math.max(-32768,Math.min(32767,Math.round(wav.readInt16LE(i)+noise))),i)}
  const noisyPath=new URL(`./asr-audio/${lang}-noise12db.wav`,import.meta.url)
  writeFileSync(noisyPath,noisy)
  files.push({id:`${lang}-clean`,path,seconds},{id:`${lang}-noise12db`,path:noisyPath,seconds})
}
const client=new OpenAI({apiKey:process.env.OPENAI_API_KEY,timeout:45000,maxRetries:0})
let count=0
for(const file of files)for(const arm of arms) {
  const started=Date.now();count++
  try {
    const result=await client.audio.transcriptions.create({file:createReadStream(file.path),model:arm.model,...(arm.prompt?{prompt:arm.prompt}:{}),response_format:'json'})
    console.log(JSON.stringify({id:file.id,arm:arm.id,model:arm.model,seconds:file.seconds,ms:Date.now()-started,...result}))
  }catch(error){console.log(JSON.stringify({id:file.id,arm:arm.id,ms:Date.now()-started,error:error.message,unknownCost:true}))}
}
console.log(JSON.stringify({summary:true,requests:count,note:'Synthetic macOS TTS with optional seeded white noise at 12dB SNR. No real microphone, accent or field-noise validation. No extraction calls.'}))
