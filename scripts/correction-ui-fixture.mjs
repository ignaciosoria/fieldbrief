/** Local-only synthetic gateway for CUA interaction tests. No real API forwarding.
 * Run the production app on 127.0.0.1:3101, then this fixture on 127.0.0.1:3102.
 * The browser gets fake microphone data; no hardware recording or paid APIs.
 */
import {createServer} from 'node:http'
import {readFileSync} from 'node:fs'
import {visitExtractionResult} from '../lib/visitExtraction.ts'
const rows=readFileSync(new URL('../eval/visit-v2-run-7.jsonl',import.meta.url),'utf8').trim().split('\n').map(JSON.parse)
const extraction=rows.find(r=>r.id==='en-future-purpose').output
const now='2026-09-10T18:00:00Z',zone='America/Los_Angeles'
const original={id:'synthetic-correction-note',created_at:now,raw_text:'Visited Maya at Northstar. Tomorrow I will call her to discuss the Z9 warranty and check whether the replacement arrived.',structured_output:visitExtractionResult(extraction,now,zone)}
const corrected=structuredClone(extraction)
corrected.contacts=['Maia'];corrected.summary='Visited Maia at Northstar.'
corrected.actions[0].contact='Maia'
const notes=new Map([[original.id,original]])
let transcribe=0,structure=0,save=0
const bootstrap=`<script>
Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>({getTracks:()=>[{stop:()=>console.log('fixture: microphone released')}]})}});
window.MediaRecorder=class {static isTypeSupported(){return true} constructor(stream){this.stream=stream;if(new URL(location.href).searchParams.get('testScenario')==='constructor')throw Error('Synthetic recorder constructor failure');this.mimeType='audio/webm';this.state='inactive'} start(){this.state='recording'} stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['synthetic audio'],{type:this.mimeType})});this.onstop?.()}};
</script>`
createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://127.0.0.1:3102')
    const json=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value))}
    if(url.pathname==='/__test/state')return json({transcribe,structure,save,notes:[...notes.values()]})
    if(url.pathname==='/api/auth/session')return json({user:{name:'Synthetic Rep',email:'synthetic@example.test'},expires:'2099-01-01T00:00:00Z'})
    if(url.pathname==='/api/subscription')return json({active:false})
    if(url.pathname==='/api/transcribe') {
      for await(const _chunk of req) {} // Drain synthetic upload, never forward it.
      transcribe++;console.log(JSON.stringify({stage:'transcribe',attempt:transcribe}))
      if(new URL(req.headers.referer || 'http://127.0.0.1').searchParams.get('testScenario')==='413') {
        res.writeHead(413,{'Content-Type':'text/html'});res.end('<html>Payload too large</html>');return
      }
      if(transcribe%3===1)return json({error:'Synthetic audio upload failure'},503)
      return json({transcript:'The name is Maia, not Maya.'})
    }
    if(url.pathname==='/api/structure') {
      let body='';for await(const chunk of req)body+=chunk
      structure++;console.log(JSON.stringify({stage:'structure',attempt:structure,body:JSON.parse(body)}))
      if(structure===1)return json({error:'Synthetic structure failure'},503)
      return json(visitExtractionResult(corrected,now,zone))
    }
    if(url.pathname==='/api/notes') {
      if(req.method==='GET') {
        const historyScenario=new URL(req.headers.referer || 'http://127.0.0.1').searchParams.get('testScenario')==='history'
        const damaged={id:'synthetic-damaged-note',created_at:now,raw_text:'Original transcript preserved: call Ana tomorrow.',structured_output:{schemaVersion:2,extraction:{actions:null}}}
        return json({notes:historyScenario?[...notes.values(),damaged]:[...notes.values()],hasMore:false})
      }
      if(req.method!=='PUT')return json({error:'Fixture forbids mutation other than synthetic upsert'},405)
      let body='';for await(const chunk of req)body+=chunk
      const value=JSON.parse(body)
      if(value.id!==original.id)return json({error:'Unexpected note id'},400)
      save++;notes.set(value.id,{...original,raw_text:value.transcript,structured_output:value.result})
      console.log(JSON.stringify({stage:'save',attempt:save,id:value.id,noteCount:notes.size}))
      if(save===1)return json({error:'Synthetic save acknowledgement failure'},503)
      return json({saved:true})
    }
    if(url.pathname.startsWith('/api/'))return json({error:'Unmocked API blocked'},501)
    if(req.method!=='GET')return json({error:'Only local page GETs may be forwarded'},405)
    const upstream=await fetch('http://127.0.0.1:3101'+url.pathname+url.search)
    const headers={'Content-Type':upstream.headers.get('content-type')||'application/octet-stream','Cache-Control':'no-store',
      'Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; font-src 'self' data:"}
    res.writeHead(upstream.status,headers)
    if(headers['Content-Type'].includes('text/html'))res.end((await upstream.text()).replace('<head>','<head>'+bootstrap))
    else res.end(Buffer.from(await upstream.arrayBuffer()))
  }catch(error){res.writeHead(500);res.end('Synthetic fixture error');console.error(error.message)}
}).listen(3102,'127.0.0.1',()=>console.log('Synthetic correction fixture: http://127.0.0.1:3102/try'))
