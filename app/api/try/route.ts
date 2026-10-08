import {NextResponse} from 'next/server'
import {DateTime} from 'luxon'
import OpenAI from 'openai'
import {auth} from '../../../auth'
import {serverDb} from '../../../lib/serverDb'
import {extractVisitWithResearch} from '../../../lib/parallelVisit'
import {transcribeVisitAudio} from '../../../lib/transcriptionModel'
import {audioUploadError} from '../../../lib/audioUpload'
import {readStructureInput} from '../../../lib/structureInput'
import {boundedGuestRequest,GUEST_COOKIE,guestCookieOptions,guestNetwork,guestToken,newGuestToken,sameOrigin,tokenHash} from '../../../lib/guestTryPolicy'

export const maxDuration=150
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}})
const enabled=()=>process.env.GUEST_TRY_ENABLED==='true'

export async function GET(request:Request){
  if(!enabled())return json({enabled:false})
  const token=guestToken(request);if(!token){const res=json({enabled:true});res.cookies.set(GUEST_COOKIE,newGuestToken(),guestCookieOptions(request));return res}
  try{
    const {data,error}=await serverDb().from('folup_guest_visits').select('state,raw_text,output,expires_at,claimed_by,id').eq('token_hash',tokenHash(token)).maybeSingle()
    if(error)throw error
    if(!data)return json({enabled:true})
    if(Date.parse(data.expires_at)<Date.now())return json({enabled:true,state:'expired'})
    const email=(await auth())?.user?.email?.trim()
    if(data.claimed_by&&data.claimed_by!==email)return json({enabled:true,state:'used'})
    return json({enabled:true,state:data.state,...(data.state==='ready'?{previewId:data.id,note:data.raw_text,result:data.output,noteId:data.claimed_by?data.id:undefined}:{})})
  }catch{return json({error:'The trial is temporarily unavailable. Please try again.'},503)}
}

export async function POST(request:Request){
  if(!enabled())return json({error:'The live demo is not available yet. Explore an example below.'},503)
  if(!sameOrigin(request))return json({error:'Invalid request origin.'},403)
  let note='',file:File|undefined,zone:unknown
  try{
    const bounded=await boundedGuestRequest(request)
    if(request.headers.get('content-type')?.startsWith('multipart/form-data')){
      const form=await bounded.formData();const audio=form.get('file');const error=audioUploadError(audio)
      if(error)return json({error},400)
      file=audio as File;zone=form.get('timezone')
    }else{
      const body=await readStructureInput(bounded);if(body instanceof Response)return body
      note=body.note;zone=body.timezone
    }
  }catch{return json({error:'Could not read this note. Try a shorter recording or paste text.'},400)}
  const token=guestToken(request)||newGuestToken();const hash=tokenHash(token)
  const reply=(body:unknown,status=200)=>{const res=json(body,status);res.cookies.set(GUEST_COOKIE,token,guestCookieOptions(request));return res}
  let reserved=false
  try{
    const db=serverDb()
    const {data,error}=await db.rpc('reserve_guest_visit',{p_token:hash,p_network:guestNetwork(request)})
    if(error)throw error
    if(data!=='allowed')return reply({error:data==='running'?'Your note is still processing. Check again shortly.':data==='ready'?'Your result is ready. Reload to retrieve it.':'Your free preview has been used or is temporarily busy. Sign in to continue.',code:data},data==='running'?409:429)
    reserved=true
    if(file){
      const client=new OpenAI({apiKey:process.env.OPENAI_API_KEY,timeout:45000,maxRetries:0})
      note=await transcribeVisitAudio(client,file,process.env.TRANSCRIPTION_MODEL)
    }
    if(!note.trim()||note.length>20000)throw Error('Invalid transcript')
    const timezone=typeof zone==='string'&&DateTime.now().setZone(zone).isValid?zone:'America/Los_Angeles'
    // Same extraction, selector, research and configured models as the paid route.
    // The atomic reservation covers the entire bounded pipeline, including research.
    const {result}=await extractVisitWithResearch(note,new Date().toISOString(),timezone,async()=>true)
    const saved=await db.from('folup_guest_visits').update({state:'ready',raw_text:note,output:result}).eq('token_hash',hash).eq('state','running').select('id').single()
    if(saved.error)throw saved.error
    return reply({state:'ready',previewId:saved.data.id,note,result})
  }catch{
    if(reserved)await serverDb().from('folup_guest_visits').update({state:'failed'}).eq('token_hash',hash).eq('state','running')
    return reply({error:'Could not finish this note. Your input is still here; please retry.'},503)
  }
}
