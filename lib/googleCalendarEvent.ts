import {createHash} from 'node:crypto'
import {DateTime} from 'luxon'
import {googleCalendarUrl,type CalendarDraft} from './calendarDraft'
import {fetchWithTimeout} from './fetchWithTimeout'
import {calendarEventLink} from './calendarSaveClient'

export class CalendarWriteError extends Error {
  constructor(readonly code:string,readonly status:number,message:string,readonly url?:string){super(message)}
}
export type CalendarSaveInput={noteId:string;actionIndex:number;draft:CalendarDraft}
export function parseCalendarSaveInput(value:unknown):CalendarSaveInput|null {
  if(!value||typeof value!=='object')return null
  const body=value as Record<string,unknown>,d=body.draft as Record<string,unknown>|undefined
  if(typeof body.noteId!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(body.noteId)||
    !Number.isInteger(body.actionIndex)||Number(body.actionIndex)<0||Number(body.actionIndex)>29||!d)return null
  for(const field of ['title','details','date','time','timezone'])if(typeof d[field]!=='string')return null
  if(String(d.title).length>200||!String(d.title).trim()||String(d.details).length>8000||String(d.timezone).length>100)return null
  const draft:CalendarDraft={title:String(d.title),details:String(d.details),date:String(d.date),time:String(d.time),timezone:String(d.timezone),language:d.language==='Spanish'?'Spanish':'English'}
  if(!googleCalendarUrl(draft))return null
  return {noteId:body.noteId,actionIndex:Number(body.actionIndex),draft}
}
export function googleEventPayload(email:string,input:CalendarSaveInput) {
  const {draft}=input
  const start=DateTime.fromISO(`${draft.date}T${draft.time}`,{zone:draft.timezone})
  if(!googleCalendarUrl(draft))throw Error('Invalid calendar event')
  // Stable across retries, devices and schedule edits: never create a second event
  // for the same saved-note action. A changed existing event requires manual review.
  const id='f'+createHash('sha256').update(JSON.stringify([email.trim().toLowerCase(),input.noteId,input.actionIndex])).digest('hex')
  return {id,summary:draft.title,description:draft.details,
    start:{dateTime:start.toISO()!,timeZone:draft.timezone},end:{dateTime:start.plus({minutes:30}).toISO()!,timeZone:draft.timezone},
    extendedProperties:{private:{folupSource:id}},reminders:{useDefault:true},
  }
}
export async function saveGoogleCalendarEvent(email:string,input:CalendarSaveInput,token:string,fetcher:typeof fetch=fetch) {
  const payload=googleEventPayload(email,input)
  const endpoint='https://www.googleapis.com/calendar/v3/calendars/primary/events'
  const headers={'Authorization':`Bearer ${token}`,'Content-Type':'application/json'}
  let response=await fetchWithTimeout(`${endpoint}?sendUpdates=none`,{method:'POST',headers,body:JSON.stringify(payload),cache:'no-store'},15_000,fetcher)
  // A retry after an ambiguous network failure targets exactly the same id.
  if(response.status===409)response=await fetchWithTimeout(`${endpoint}/${payload.id}`,{headers,cache:'no-store'},10_000,fetcher)
  const event=await response.json().catch(()=>null)
  if(response.status===401)throw new CalendarWriteError('CONNECT_CALENDAR',428,'Reconnect Google Calendar to save this follow-up.')
  if(response.status===403){
    const reasons=event?.error?.errors?.map((e:{reason?:string})=>e.reason)||[]
    if(reasons.includes('insufficientPermissions'))throw new CalendarWriteError('CONNECT_CALENDAR',428,'Allow Calendar access to save this follow-up.')
    throw new CalendarWriteError('CALENDAR_UNAVAILABLE',503,'Google Calendar is unavailable. Your follow-up has not been confirmed as saved. Please retry later.')
  }
  if(!response.ok)throw new CalendarWriteError('CALENDAR_UNAVAILABLE',503,'Could not confirm the event. Retry safely; Folup will not create a duplicate.')
  const url=calendarEventLink(event?.htmlLink)
  const sameInstant=(a:unknown,b:string)=>typeof a==='string'&&DateTime.fromISO(a).toMillis()===DateTime.fromISO(b).toMillis()
  if(event?.id!==payload.id||event.status==='cancelled'||event.summary!==payload.summary||(event.description||'')!==payload.description||
    !sameInstant(event.start?.dateTime,payload.start.dateTime)||!sameInstant(event.end?.dateTime,payload.end.dateTime)||
    event.start?.timeZone!==payload.start.timeZone||event.end?.timeZone!==payload.end.timeZone||
    event.extendedProperties?.private?.folupSource!==payload.id||event.attendees?.length){
    throw new CalendarWriteError('CALENDAR_EVENT_CHANGED',409,'This follow-up already exists with different details, or Google returned a mismatch. Review it in Google Calendar; no duplicate will be created.',url)
  }
  if(!url)throw new CalendarWriteError('CALENDAR_UNAVAILABLE',503,'Google saved a response without a valid event link. Retry safely to verify it.')
  return {saved:true as const,id:payload.id,url}
}
