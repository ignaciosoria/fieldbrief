import {DateTime} from 'luxon'
import {calendarDraftFromAction,type CalendarDraft} from './calendarDraft'
import {suggestCalendarSchedule} from './calendarSuggestion'
import {visitActionFields,type VisitExtraction} from './visitExtraction'

/** Space only automatic slots within this note, not the user's actual calendar.
 * Never move explicit clocks, restored drafts, dates or daypart boundaries.
 */
export function visitSchedules(v:VisitExtraction,timezone:string,referenceAt:string|undefined,now:string,restored?:Record<number,CalendarDraft>):Record<number,CalendarDraft> {
  const drafts=v.actions.map((a,i)=>restored?.[i] ?? suggestCalendarSchedule(calendarDraftFromAction(visitActionFields(a,v.language),v.language,timezone),a.evidence,referenceAt,now))
  const occupied=new Set<string>()
  const key=(d:CalendarDraft)=>`${d.date}T${d.time}`
  drafts.forEach((d,i)=>{if(restored?.[i] || !d.timeSuggested)occupied.add(key(d))})
  drafts.forEach((d,i)=>{
    if(restored?.[i] || !d.timeSuggested || !d.date || !d.time)return
    const start=DateTime.fromISO(key(d),{zone:timezone})
    if(!start.isValid)return
    const cutoff=start.hour<12?12:start.hour<18?18:22
    let slot=start
    while(occupied.has(`${d.date}T${slot.toFormat('HH:mm')}`) && slot.plus({minutes:30}).hasSame(start,'day') && slot.plus({minutes:30}).hour<cutoff)slot=slot.plus({minutes:30})
    // If the window is full, retain the original rather than invent a later day.
    if(!occupied.has(`${d.date}T${slot.toFormat('HH:mm')}`))d.time=slot.toFormat('HH:mm')
    occupied.add(key(d))
  })
  return Object.fromEntries(drafts.map((d,i)=>[i,d]))
}
