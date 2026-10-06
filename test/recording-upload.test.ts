import {test} from 'node:test'
import assert from 'node:assert/strict'
import {pcmWav,recordingParts,transcribeRecording} from '../lib/recordingUpload'
import {MAX_AUDIO_BYTES} from '../lib/audioUpload'

test('small recording is sent unchanged',async()=>{
 const original=new Blob(['audio'],{type:'audio/mp4'})
 const parts=[];for await(const part of recordingParts(original))parts.push(part)
 assert.deepEqual(parts,[original])
})
test('WAV header and clipping produce independent PCM audio',async()=>{
 const wav=pcmWav(new Float32Array([-2,0,2]),16000)
 const data=new DataView(await wav.arrayBuffer())
 assert.equal(wav.type,'audio/wav');assert.equal(data.byteLength,50)
 assert.equal(data.getUint32(24,true),16000)
 assert.equal(data.getInt16(44,true),-32768);assert.equal(data.getInt16(48,true),32767)
})
test('large recording is split without dropping samples and closes decoder',async()=>{
 const previous=globalThis.AudioContext
 const samples=new Float32Array(16000*200).fill(.25);let closed=false
 globalThis.AudioContext=class {
  async decodeAudioData(){return {sampleRate:16000,length:samples.length,numberOfChannels:1,getChannelData:()=>samples}}
  async close(){closed=true}
 } as unknown as typeof AudioContext
 try{
  const parts=[];for await(const part of recordingParts(new Blob([new Uint8Array(MAX_AUDIO_BYTES+1)])))parts.push(part)
  assert.equal(parts.length,3);assert.ok(closed)
  assert.equal(parts.reduce((sum,p)=>sum+(p.size-44)/2,0),samples.length)
  assert.ok(parts.every(p=>p.size<=MAX_AUDIO_BYTES && p.type==='audio/wav'))
 }finally{globalThis.AudioContext=previous}
})
test('retry resumes completed parts and preserves transcript order',async()=>{
 const blob=new Blob(['original']),parts=[new Blob(['one']),new Blob(['two']),new Blob(['three'])]
 async function* split(){yield* parts}
 let calls=0
 await assert.rejects(()=>transcribeRecording(blob,async()=>{calls++;if(calls===2)throw Error('offline');return 'first'},()=>true,split),/offline/)
 const text=await transcribeRecording(blob,async p=>{calls++;return await p.text()},()=>true,split)
 assert.equal(text,'first\ntwo\nthree');assert.equal(calls,4)
})
test('owner change stops sending subsequent parts',async()=>{
 let current=true,calls=0
 async function* split(){yield new Blob(['a']);yield new Blob(['b'])}
 await assert.rejects(()=>transcribeRecording(new Blob(['x']),async()=>{calls++;current=false;return 'a'},()=>current,split),/owner changed/)
 assert.equal(calls,1)
})
