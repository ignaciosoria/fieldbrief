// Synthetic local UI gateway. Never forwards API requests to a real service.
import {createServer} from 'node:http'
import {visitExtractionResult} from '../lib/visitExtraction.ts'
import {calendarDraftFromAction} from '../lib/calendarDraft.ts'
import {visitActionFields} from '../lib/visitExtraction.ts'
const action={type:'call',contact:'Mike',company:'Valley',object:'',subject:'Q7 trial',description:'Check the Q7 trial.',
 date:'2026-09-29',time:'09:00',daypart:'unspecified',evidence:'Call Mike Tuesday.',origin:'commitment'}
const extraction={contractVersion:3,crmNarrativeVersion:1,language:'English',contacts:['Mike'],companies:['Valley'],location:'',summary:'Mike discussed Q7.',insights:[],actions:[action],questions:[]}
const id='12345678-1234-4123-8123-123456789abc',owner='synthetic@example.test'
const now='2026-09-25T18:00:00Z',zone='America/Los_Angeles'
createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1:3102')
  const changed=new URL(req.headers.referer||'http://127.0.0.1').searchParams.has('changed')
  const current=changed?{...action,date:'2026-10-01'}:action
  const json=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data))}
  if(url.pathname==='/api/auth/session')return json({user:{name:'Synthetic Rep',email:owner},expires:'2099-01-01T00:00:00Z'})
  if(url.pathname==='/api/subscription')return json({active:true})
  if(url.pathname==='/api/notes' && req.method==='GET')return json({notes:[{id,created_at:now,raw_text:'Call Mike Tuesday.',structured_output:visitExtractionResult({...extraction,actions:[current]},now,zone)}],hasMore:false})
  if(url.pathname==='/api/calendar/events' && req.method==='GET')return json({actions:[{
   actionId:'abcdefab-1234-4123-8123-123456789abc',actionIndex:0,snapshot:current,needsReview:false,
   saved:{sourceSnapshot:action,url:'https://calendar.google.com/calendar/event?eid=synthetic-only',
     draft:{...calendarDraftFromAction(visitActionFields(action,'English'),'English',zone),date:'2026-09-30',time:'15:30'}}}]})
  if(url.pathname.startsWith('/api/'))return json({error:'Synthetic fixture blocks all unmocked API requests'},405)
  if(req.method!=='GET')return json({error:'Read-only fixture'},405)
  const upstream=await fetch('http://127.0.0.1:3101'+url.pathname+url.search)
  res.writeHead(upstream.status,{'Content-Type':upstream.headers.get('content-type')||'application/octet-stream',
   'Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self' data:"})
  res.end(Buffer.from(await upstream.arrayBuffer()))
 }catch{res.writeHead(500);res.end('Fixture error')}
}).listen(3102,'127.0.0.1',()=>console.log('Synthetic calendar fixture http://127.0.0.1:3102'))
