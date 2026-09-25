import type {CalendarDraft} from './calendarDraft'
import {fetchWithTimeout} from './fetchWithTimeout'

export function calendarEventLink(value:unknown):string|undefined {
  if(typeof value!=='string')return
  try {const u=new URL(value);if(u.protocol==='https:'&&['calendar.google.com','www.google.com'].includes(u.hostname)&&u.pathname.startsWith('/calendar'))return u.href}catch{}
}
export async function saveCalendarFromClient(input:{noteId:string;actionIndex:number;draft:CalendarDraft;actionId?:string;sourceAction?:unknown},fetcher:typeof fetch=fetch) {
  const response=await fetchWithTimeout('/api/calendar/events',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),cache:'no-store',
  },35_000,fetcher)
  const data=await response.json()
  if(response.status===428&&data.code==='CONNECT_CALENDAR')return {kind:'connect' as const}
  const url=calendarEventLink(data.url)
  if(!response.ok)return {kind:'error' as const,message:typeof data.error==='string'?data.error:'Could not confirm the event. Please retry.',url}
  if(data.saved!==true||typeof data.id!=='string'||!url)throw Error('Could not verify the saved event. Please retry safely.')
  return {kind:'saved' as const,url}
}
