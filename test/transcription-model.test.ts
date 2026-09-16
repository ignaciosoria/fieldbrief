import {test} from 'node:test'
import assert from 'node:assert/strict'
import OpenAI from 'openai'
import {transcribeVisitAudio,TRANSCRIPTION_PROMPT,WHISPER_CONTEXT_PROMPT} from '../lib/transcriptionModel'

function fixture(text:string){
 const requests:FormData[]=[]
 const client=new OpenAI({apiKey:'test-only',maxRetries:0,fetch:async(input,init)=>{
  const request=new Request(input,init)
  requests.push(await request.formData())
  return Response.json({text})
 }})
 return {client,requests}
}
const audio=()=>new File(['synthetic'], 'visit.webm',{type:'audio/webm'})
test('new model sends original audio and bilingual context, no forced language',async()=>{
 const {client,requests}=fixture('a las diez, no, once y media; sin precios')
 assert.equal(await transcribeVisitAudio(client,audio()),'a las diez, no, once y media; sin precios')
 assert.equal(requests.length,1)
 assert.equal(requests[0].get('model'),'gpt-transcribe')
 assert.equal(requests[0].get('prompt'),TRANSCRIPTION_PROMPT)
 assert.equal(requests[0].get('language'),null)
 assert.equal(await (requests[0].get('file') as File).text(),'synthetic')
})
test('explicit Whisper rollback preserves the previous prompt',async()=>{
 const {client,requests}=fixture('Hello')
 await transcribeVisitAudio(client,audio(),'whisper-1')
 assert.equal(requests[0].get('model'),'whisper-1')
 assert.equal(requests[0].get('prompt'),WHISPER_CONTEXT_PROMPT)
})
test('empty transcript remains empty for existing no-speech recovery',async()=>{
 const {client}=fixture('')
 assert.equal(await transcribeVisitAudio(client,audio()),'')
})
test('invalid configuration fails before any paid call',async()=>{
 const {client,requests}=fixture('')
 await assert.rejects(transcribeVisitAudio(client,audio(),'unknown'))
 assert.equal(requests.length,0)
})
test('provider failure is not silently retried with another model',async()=>{
 let calls=0
 const client=new OpenAI({apiKey:'test-only',maxRetries:0,fetch:async(input)=>{
  if(String(input)==='data:,')return new Response('') // SDK multipart capability probe, not an API call.
  calls++;return Response.json({error:{message:'unavailable'}},{status:503})
 }})
 await assert.rejects(transcribeVisitAudio(client,audio()))
 assert.equal(calls,1)
})
