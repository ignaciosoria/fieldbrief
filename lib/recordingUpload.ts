import {MAX_AUDIO_BYTES} from './audioUpload'

/** Each part is an independently decodable WAV, never a slice of compressed bytes. */
export function pcmWav(samples:Float32Array,sampleRate:number):Blob {
  const bytes=new ArrayBuffer(44+samples.length*2),view=new DataView(bytes)
  const label=(offset:number,text:string)=>{for(let i=0;i<text.length;i++)view.setUint8(offset+i,text.charCodeAt(i))}
  label(0,'RIFF');view.setUint32(4,36+samples.length*2,true);label(8,'WAVE');label(12,'fmt ')
  view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true)
  view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*2,true)
  view.setUint16(32,2,true);view.setUint16(34,16,true);label(36,'data');view.setUint32(40,samples.length*2,true)
  for(let i=0;i<samples.length;i++){const v=Math.max(-1,Math.min(1,samples[i]));view.setInt16(44+i*2,v<0?v*32768:v*32767,true)}
  return new Blob([bytes],{type:'audio/wav'})
}

export async function* recordingParts(blob:Blob):AsyncGenerator<Blob> {
  if(blob.size<=MAX_AUDIO_BYTES){yield blob;return}
  const context=new AudioContext({sampleRate:16000})
  let audio:AudioBuffer
  try {audio=await context.decodeAudioData(await blob.arrayBuffer())}
  finally {await context.close()}
  const maximum=Math.min(Math.floor((MAX_AUDIO_BYTES-44)/2),Math.floor(audio.sampleRate*90))
  // Prefer a quiet boundary near the end of each part to avoid cutting speech.
  const channels=Array.from({length:audio.numberOfChannels},(_,i)=>audio.getChannelData(i))
  for(let start=0;start<audio.length;){
    let end=Math.min(start+maximum,audio.length)
    if(end<audio.length){
      let best=Infinity
      const window=Math.max(1,Math.floor(audio.sampleRate*.02))
      for(let at=end-Math.floor(audio.sampleRate*5);at+window<=start+maximum;at+=window){
        if(at<=start)continue
        let energy=0
        for(let i=at;i<at+window;i++)for(const channel of channels)energy+=channel[i]*channel[i]
        if(energy<best){best=energy;end=at+Math.floor(window/2)}
      }
    }
    const mono=new Float32Array(end-start)
    for(const channel of channels)for(let i=start;i<end;i++)mono[i-start]+=channel[i]/channels.length
    yield pcmWav(mono,audio.sampleRate)
    start=end
  }
}

// Successful parts survive a retry while the original recording remains in memory.
const completed=new WeakMap<Blob,string[]>()
export async function transcribeRecording(blob:Blob,send:(part:Blob)=>Promise<string>,current:()=>boolean,
  split:(blob:Blob)=>AsyncIterable<Blob>=recordingParts):Promise<string>{
  const texts=completed.get(blob)??[];completed.set(blob,texts)
  let index=0
  for await(const part of split(blob)){
    if(!current())throw Error('Recording owner changed. Please sign in again.')
    if(index>=texts.length){
      const text=await send(part)
      if(!current())throw Error('Recording owner changed. Please sign in again.')
      texts.push(text)
    }
    index++
  }
  return texts.filter(Boolean).join('\n')
}
