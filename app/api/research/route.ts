import {auth} from '../../../auth'
import {serverDb} from '../../../lib/serverDb'
import {checkAiAccess} from '../../../lib/aiAccess'
import {reserveAiUsage} from '../../../lib/aiAccessServer'
import {mayRequestResearch} from '../../../lib/visitResearch'
import {investigateVisit} from '../../../lib/visitResearchServer'

export const maxDuration=90
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}})
async function handle(request:Request,run:boolean){
  const email=(await auth())?.user?.email?.trim()
  if(!email)return reply({error:'Sign in to view research.'},401)
  const params=new URL(request.url).searchParams,id=params.get('noteId'),version=Number(params.get('version'))
  if(!id||!/^[0-9a-f-]{36}$/i.test(id)||!Number.isSafeInteger(version)||version<1)return reply({error:'Invalid note.'},400)
  const db=serverDb()
  const {data:note,error}=await db.from('folup_notes').select('raw_text,structured_output,version').eq('user_id',email).eq('id',id).maybeSingle()
  if(error)return reply({error:'Research unavailable.'},503)
  if(!note)return reply({error:'Note not found.'},404)
  if(note.version!==version)return reply({error:'Note changed. Research will use the latest version.'},409)
  if(!mayRequestResearch(note.raw_text))return reply({state:'done',result:{status:'none'}})
  const read=()=>db.from('folup_visit_research').select('state,result,started_at,attempts').eq('user_id',email).eq('note_id',id).eq('note_version',version).maybeSingle()
  const cached=await read()
  if(cached.error)return reply({error:'Research unavailable.'},503)
  if(cached.data?.state==='done')return reply(cached.data)
  if(!run)return reply(cached.data||{state:'idle'})
  const attempt=crypto.randomUUID()
  const claim=await db.rpc('claim_folup_research',{p_owner:email,p_note:id,p_version:version,p_attempt:attempt})
  if(claim.error)return reply({error:'Research unavailable.'},503)
  if(!claim.data)return reply((await read()).data||{state:'idle'})
  const finish=(state:string,result:unknown=null)=>db.from('folup_visit_research').update({state,result}).eq('user_id',email).eq('note_id',id).eq('note_version',version).eq('attempt',attempt)
  try {
    const denied=await checkAiAccess('structure',{getEmail:async()=>email,reserve:reserveAiUsage})
    if(denied){await finish('failed');return denied}
    const extraction=note.structured_output?.extraction
    const privateNames=[...(Array.isArray(extraction?.contacts)?extraction.contacts:[]),...(Array.isArray(extraction?.companies)?extraction.companies:[])]
    const result=await investigateVisit(note.raw_text,extraction?.language==='Spanish'?'Spanish':'English',undefined,privateNames)
    const saved=await finish('done',result)
    if(saved.error)throw Error('Research not saved')
    const latest=await db.from('folup_notes').select('version').eq('user_id',email).eq('id',id).maybeSingle()
    if(latest.error||latest.data?.version!==version)return reply({error:'Note changed.'},409)
    return reply({state:'done',result})
  }catch{await finish('failed');return reply({error:'Research could not be completed. Your visit is saved.'},502)}
}
export async function GET(request:Request){return handle(request,false)}
export async function POST(request:Request){return handle(request,true)}
