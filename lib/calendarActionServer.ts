import {serverDb} from './serverDb'
import {CalendarWriteError,googleEventPayload,saveGoogleCalendarEvent,type CalendarSaveInput} from './googleCalendarEvent'
import {calendarEventLink} from './calendarSaveClient'
import type {CalendarActionState} from './calendarActionState'

export async function calendarActionStates(email:string,noteId:string):Promise<CalendarActionState[]> {
  const db=serverDb()
  const [{data:actions,error},{data:links,error:linkError}]=await Promise.all([
    db.from('folup_actions').select('action_id,action_index,snapshot,needs_review').eq('user_id',email).eq('note_id',noteId).eq('active',true),
    db.from('folup_calendar_links').select('action_id,event_url,draft,source_snapshot,status').eq('user_id',email).eq('note_id',noteId),
  ])
  if(error||linkError)throw Error('Calendar status unavailable')
  return (actions||[]).map(a=>{
    const link=links?.find(l=>l.action_id===a.action_id && l.status==='saved')
    const url=calendarEventLink(link?.event_url)
    return {actionId:a.action_id,actionIndex:a.action_index,snapshot:a.snapshot,needsReview:a.needs_review,
      ...(url&&link?{saved:{url,draft:link.draft,sourceSnapshot:link.source_snapshot}}:{})}
  })
}

export async function saveLinkedCalendarEvent(email:string,input:CalendarSaveInput,token:string) {
  const db=serverDb()
  if(!input.actionId || !input.sourceAction){
    const {data:note,error}=await db.from('folup_notes').select('structured_output').eq('user_id',email).eq('id',input.noteId).maybeSingle()
    if(error)throw Error('Note lookup unavailable')
    // Historical pre-extraction records keep their original export path. Never
    // permit an old browser to bypass stable IDs for a current-format note.
    if(note && note.structured_output?.schemaVersion!==2 && !note.structured_output?.extraction)
      return saveGoogleCalendarEvent(email,input,token)
    throw new CalendarWriteError('REFRESH_NOTE',409,'Reload this note before adding its follow-up.')
  }
  const {data:action,error}=await db.from('folup_actions').select('legacy_index').eq('user_id',email)
    .eq('note_id',input.noteId).eq('action_id',input.actionId).eq('active',true).maybeSingle()
  if(error)throw Error('Action lookup unavailable')
  if(!action)throw new CalendarWriteError('REFRESH_NOTE',409,'This action changed. Reload the note before adding it.')
  // Do not change the event ID of actions exported before this release.
  const eventId=googleEventPayload(email,action.legacy_index===null?input:{...input,actionId:undefined,actionIndex:action.legacy_index}).id
  const {data:reservation,error:reserveError}=await db.rpc('reserve_folup_calendar',{
    p_user_id:email,p_note_id:input.noteId,p_action_id:input.actionId,p_snapshot:input.sourceAction,p_draft:input.draft,p_event_id:eventId,
  })
  if(reserveError||!reservation)throw Error('Calendar reservation unavailable')
  if(reservation.error)throw new CalendarWriteError('CALENDAR_REVIEW_REQUIRED',409,
    reservation.error==='stale'?'This action changed. Reload the note before adding it.':
    'This follow-up may already be scheduled with different details. Review Google Calendar; Folup has not created or changed an event.',calendarEventLink(reservation.url))
  const result=await saveGoogleCalendarEvent(email,{...input,serverEventId:reservation.event_id},token)
  const {data:confirmed,error:confirmError}=await db.rpc('confirm_folup_calendar',{
    p_user_id:email,p_note_id:input.noteId,p_action_id:input.actionId,p_event_id:result.id,p_url:result.url,
  })
  if(confirmError||confirmed!==true)throw Error('Calendar link confirmation failed')
  return result
}
