import OpenAI from 'openai'
import {readFileSync,writeFileSync,appendFileSync,existsSync,mkdtempSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {transcribeVisitAudio} from '../lib/transcriptionModel'
const ledger=JSON.parse(readFileSync('eval/api-budget.json','utf8'))
if(!ledger.reservations.some((r:{id:string,status:string})=>r.id==='asr-upgrade-safety-1'&&r.status==='reserved'))throw Error('Reservation required')
const output='eval/asr-upgrade-safety-1.jsonl'
if(existsSync(output))throw Error('Already started; do not repeat')
const dir=mkdtempSync(join(tmpdir(),'folup-asr-safety-'))
const samples=[
 {id:'es-messy',voice:'Paulina',text:'Eh, visité a José García, perdón, José Martínez de AgroSol. Le mandaré mañana por la tarde la ficha de Quantum Flower setenta y cinco, no cincuenta, sin precios. A Ana de Campo Verde la llamaré el viernes a las diez, no, a las once y media. Ella enviará el informe, no yo. La reunión del lunes se canceló.'},
 {id:'en-messy',voice:'Samantha',text:'Um, I visited Maya at Northstar. Send the Z nine technical sheet tomorrow afternoon, without prices. Call Bob from Delta on Friday at ten, sorry, eleven thirty in the morning. Bob will send the report, not me. The meeting on Monday was cancelled.'},
]
const client=new OpenAI({timeout:45000,maxRetries:0})
async function run(id:string,buffer:Buffer,source:string){
 for(const model of ['whisper-1','gpt-transcribe']){
  const started=Date.now()
  try{
   const text=await transcribeVisitAudio(client,new File([new Uint8Array(buffer)],id+'.wav',{type:'audio/wav'}),model)
   const row={id,model,source,text,ms:Date.now()-started}
   appendFileSync(output,JSON.stringify(row)+'\n');console.log(JSON.stringify(row))
  }catch(error){const row={id,model,error:error instanceof Error?error.message:'error'};appendFileSync(output,JSON.stringify(row)+'\n');console.log(row)}
 }
}
async function main(){
 for(const s of samples){
  const aiff=join(dir,s.id+'.aiff'),wav=join(dir,s.id+'.wav')
  execFileSync('say',['-v',s.voice,'-r','175','-o',aiff,s.text])
  execFileSync('afconvert',['-f','WAVE','-d','LEI16@16000','-c','1',aiff,wav])
  const buffer=readFileSync(wav)
  if(buffer.length<1000||buffer.length>2_000_000)throw Error('Audio scope invalid')
  await run(s.id,buffer,s.text)
 }
 const data=Buffer.alloc(44+16000*2*3)
 data.write('RIFF');data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(1,22);data.writeUInt32LE(16000,24);data.writeUInt32LE(32000,28);data.writeUInt16LE(2,32);data.writeUInt16LE(16,34);data.write('data',36);data.writeUInt32LE(data.length-44,40)
 writeFileSync(join(dir,'silence.wav'),data)
 await run('silence',data,'')
 console.log('Synthetic fixtures retained at '+dir)
}
main().catch(()=>{console.error('Safety evaluation stopped; inspect recorded results before retrying');process.exitCode=1})
