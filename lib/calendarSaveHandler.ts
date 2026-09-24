import {parseCalendarSaveInput,CalendarWriteError,type CalendarSaveInput} from './googleCalendarEvent'
import {CalendarConnectionRequired} from './googleCalendarConnection'

type Deps={getEmail:()=>Promise<string|null>;ownsNote:(email:string,id:string)=>Promise<boolean>;getToken:(email:string)=>Promise<string>;save:(email:string,input:CalendarSaveInput,token:string)=>Promise<unknown>}
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}})
export async function handleCalendarSave(request:Request,deps:Deps):Promise<Response> {
  try {
    const email=await deps.getEmail()
    if(!email)return reply({error:'Sign in to save a follow-up.',code:'AUTH_REQUIRED'},401)
    if(request.headers.get('origin')!==new URL(request.url).origin || !request.headers.get('content-type')?.startsWith('application/json'))
      return reply({error:'Invalid request.'},403)
    const reader=request.body?.getReader()
    if(!reader)return reply({error:'Missing event.'},400)
    let size=0,text='';const decoder=new TextDecoder()
    try {
      while(true){const {value,done}=await reader.read();if(done)break;size+=value.length
        if(size>32_000){void reader.cancel().catch(()=>{});return reply({error:'Event is too large.'},413)}
        text+=decoder.decode(value,{stream:true})}
    } finally {reader.releaseLock()}
    let input
    try{input=parseCalendarSaveInput(JSON.parse(text+decoder.decode()))}catch{}
    if(!input)return reply({error:'Check the event title, date, time and time zone.'},400)
    if(!await deps.ownsNote(email,input.noteId))return reply({error:'Save this note before adding its follow-up.'},404)
    const token=await deps.getToken(email)
    return reply(await deps.save(email,input,token))
  } catch(e) {
    if(e instanceof CalendarConnectionRequired)return reply({code:'CONNECT_CALENDAR',error:'Connect Google Calendar to save this follow-up.'},428)
    if(e instanceof CalendarWriteError)return reply({code:e.code,error:e.message,...(e.url?{url:e.url}:{})},e.status)
    return reply({code:'CALENDAR_UNAVAILABLE',error:'Could not confirm the event. Retry safely; Folup will not create a duplicate.'},503)
  }
}
