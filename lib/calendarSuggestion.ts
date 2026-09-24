import {DateTime} from 'luxon'
import type {CalendarDraft} from './calendarDraft'

type SuggestedDraft = CalendarDraft & {dateSuggested:boolean; suggestionReason:string}
const normalize = (s:string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
const workingDay = (d:DateTime):DateTime => d.weekday===6 ? d.plus({days:2}) : d.weekday===7 ? d.plus({days:1}) : d

/** Scheduling suggestions only: never mutate the extraction or claim a customer agreed. */
export function suggestCalendarSchedule(
  draft:CalendarDraft, evidence = '', referenceAt?:string, now = new Date().toISOString(),
):SuggestedDraft {
  const current=DateTime.fromISO(now,{zone:draft.timezone})
  const reference=referenceAt ? DateTime.fromISO(referenceAt,{zone:draft.timezone}) : current
  const time=draft.time || '09:00'
  const base={...draft,time,timeSuggested:draft.timeSuggested || !draft.time,dateSuggested:false,suggestionReason:''}
  // Explicit dates (even past dates) and invalid inputs are not silently replaced.
  if(draft.date || !current.isValid || !reference.isValid)return base
  const text=normalize(evidence)
  let day=workingDay(current.startOf('day').plus({days:1}))
  let reason='Next working day suggested'
  // Bounded, explicit timing cues from this action only. The model resolves exact dates.
  // Several day alternatives and conditional dependencies are deliberately not "resolved" here.
  const conditional=/\b(?:si|if|unless|cuando|once|after approval|tras la aprobacion|despues de que)\b/.test(text)
  const alternative=/\b(?:o|or)\b/.test(text)
  if(!conditional && !alternative){
    if(/\b(?:pasado manana|day after tomorrow)\b/.test(text)){
      day=reference.startOf('day').plus({days:2});reason='Suggested from “day after tomorrow”'
    }else if(/\b(?:tomorrow|manana(?!\s+(?:por|a)\s+la\s+manana))\b/.test(text.replace(/\b(?:por|en|a) la manana\b/g,''))){
      day=reference.startOf('day').plus({days:1});reason='Suggested for tomorrow'
    }else if(/\b(?:hoy|today|esta manana|esta tarde|esta noche|tonight|this morning|this afternoon|this evening)\b/.test(text)){
      day=reference.startOf('day');reason='Suggested for today'
    }else if(/\b(?:la (?:proxima|siguiente) semana|semana (?:que viene|proxima|siguiente)|next week)\b/.test(text)){
      day=reference.startOf('week').plus({weeks:1});reason='Suggested for next week'
    }else if(/\b(?:esta semana|this week|antes del viernes|by friday)\b/.test(text)){
      day=workingDay(reference.startOf('day'))
      reason='Suggested for this week'
    }else{
      const delay=text.match(/\b(?:en|in)\s+(\d{1,2})\s+(dias?|days?|semanas?|weeks?)\b/)
      if(delay && Number(delay[1])>0){
        day=reference.startOf('day').plus({days:Number(delay[1])*(/seman|week/.test(delay[2])?7:1)})
        reason='Suggested from the follow-up timing'
      }
    }
  }
  // Never propose an already elapsed slot. Today may use the next half-hour only
  // when the time was itself a default; explicit clock times stay intact.
  let suggestedTime=time
  const slot=DateTime.fromISO(`${day.toISODate()}T${time}`,{zone:draft.timezone})
  if(slot<=current){
    const soon=current.startOf('hour').plus({minutes:current.minute<30?30:60})
    const cutoff=/\b(?:manana|morning)\b/.test(text)?12:/\b(?:noche|evening|tonight|night)\b/.test(text)?22:18
    if(day.hasSame(current,'day') && base.timeSuggested && current.weekday<=5 && soon.hour<cutoff){
      suggestedTime=soon.toFormat('HH:mm')
    }else{
      day=workingDay(current.startOf('day').plus({days:1}));reason='Next working day suggested'
    }
  }
  return {...base,date:day.toISODate()!,time:suggestedTime,dateSuggested:true,suggestionReason:reason}
}
