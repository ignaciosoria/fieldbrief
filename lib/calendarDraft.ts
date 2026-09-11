import { DateTime } from 'luxon'
import { buildPrimaryBaseTitle, type ActionStructuredFields } from './actionTitleContract'

export type CalendarDraft = { title: string; details: string; date: string; time: string; timezone: string; language: string }

/** Only this action's fields. Never borrow another action's person, company or topic. */
export function calendarDraftFromAction(
  action: ActionStructuredFields,
  language: string,
  timezone: string,
): CalendarDraft {
  const es = language === 'Spanish'
  const title = action.type === 'other'
    ? [action.description?.trim() || action.verb, action.contact, action.company].filter(Boolean).join(' — ')
    : buildPrimaryBaseTitle(action, language)
  const date = DateTime.fromFormat(action.date.trim(), 'MM/dd/yyyy', { zone: timezone })
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(action.time) ? action.time : ''
  const instruction = buildPrimaryBaseTitle({...action,contact:'',company:''},language)
  const details = action.description?.trim() || `${instruction.replace(/[.!?]+$/, '')}.`
  return { title, details, date: date.isValid ? date.toISODate()! : '', time, timezone, language: es ? 'Spanish' : 'English' }
}

/** Validate the exact draft the user reviewed; an empty time means all day. */
export function googleCalendarUrl(draft: CalendarDraft): string | null {
  if (!draft.title.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) return null
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
