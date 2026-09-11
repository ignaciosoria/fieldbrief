import { DateTime } from 'luxon'
import { buildPrimaryBaseTitle, type ActionStructuredFields } from './actionTitleContract'

export type CalendarDraft = { title: string; details: string; date: string; time: string; timezone: string; language: string; timeSuggested?: boolean }

export function shortCalendarTitle(action: ActionStructuredFields, es: boolean): string {
  const object=action.object || ''
  const sendObject=/ficha|technical sheet|data\s?sheet/i.test(object)?(es?'ficha técnica':'technical sheet'):
    /presupuesto|cotizaci[oó]n|quote|quotation/i.test(object)?(es?'presupuesto':'quote'):
    /cat[aá]logo|catalog/i.test(object)?(es?'catálogo':'catalog'):
    /muestras?|samples?/i.test(object)?(es?'muestras':'samples'):
    /informe|report|results|resultados/i.test(object)?(es?'informe':'report'):''
  const verb=action.type==='send' ? `${es?'Enviar':'Send'} ${sendObject}`.trim() :
    action.type==='call'?(es?'Llamar':'Call'):action.type==='meeting'?(es?'Reunión':'Meeting'):
    action.type==='follow_up'?(es?'Seguimiento':'Follow up'):
    (action.description || action.verb || (es?'Tarea':'Task')).slice(0,48).trim()
  return [verb,action.contact,action.company].filter(Boolean).join(' · ')
}

/** Only this action's fields. Never borrow another action's person, company or topic. */
export function calendarDraftFromAction(
  action: ActionStructuredFields,
  language: string,
  timezone: string,
): CalendarDraft {
  const es = language === 'Spanish'
  const title = shortCalendarTitle(action,es)
  const date = DateTime.fromFormat(action.date.trim(), 'MM/dd/yyyy', { zone: timezone })
  const timeSuggested = !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(action.time)
  const time = timeSuggested ? '09:00' : action.time
  const instruction = buildPrimaryBaseTitle({...action,contact:'',company:''},language)
  const details = action.description?.trim() || `${instruction.replace(/[.!?]+$/, '')}.`
  return { title, details, date: date.isValid ? date.toISODate()! : '', time, timeSuggested, timezone, language: es ? 'Spanish' : 'English' }
}

/** Validate the exact draft reviewed; every follow-up needs a clock time. */
export function googleCalendarUrl(draft: CalendarDraft): string | null {
  if (!draft.time || !draft.title.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) return null
  const date = DateTime.fromISO(draft.date, { zone: draft.timezone })
  if (!date.isValid) return null
  let dates: string
  if (draft.time) {
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(draft.time)) return null
    const start = DateTime.fromISO(`${draft.date}T${draft.time}`, { zone: draft.timezone })
    // Reject nonexistent local times during the spring DST transition.
    if (!start.isValid || start.toFormat('HH:mm') !== draft.time || start.getPossibleOffsets().length > 1) return null
    const fmt = "yyyyMMdd'T'HHmmss'Z'"
    dates = `${start.toUTC().toFormat(fmt)}/${start.plus({minutes:30}).toUTC().toFormat(fmt)}`
  } else {
    dates = `${date.toFormat('yyyyMMdd')}/${date.plus({days:1}).toFormat('yyyyMMdd')}`
  }
  const query = new URLSearchParams({action:'TEMPLATE',text:draft.title.trim(),details:draft.details,
    dates,ctz:draft.timezone})
  return `https://calendar.google.com/calendar/render?${query}`
}
