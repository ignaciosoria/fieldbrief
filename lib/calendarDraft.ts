import { DateTime } from 'luxon'
import { buildPrimaryBaseTitle, normalizePrimarySendObjectField, type ActionStructuredFields } from './actionTitleContract'

export type CalendarDraft = { title: string; details: string; date: string; time: string; timezone: string; language: string; timeSuggested?: boolean }

/** Suggestions are UI defaults, never written back as explicitly agreed times. */
export function suggestedCalendarTime(action: ActionStructuredFields): string {
  if (/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(action.time)) return action.time
  // The adapter retains each action's evidence. Never inspect the whole transcript.
  const text=(action.evidence || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  const afternoon=/\b(?:por la tarde|en la tarde|a la tarde|esta tarde|afternoon)\b/.test(text)
  const night=/\b(?:por la noche|en la noche|a la noche|esta noche|evening|tonight|at night)\b/.test(text)
  const morning=/\b(?:por la manana|en la manana|a la manana|esta manana|morning)\b/.test(text)
  // Conflicting windows are left as a reviewable morning default, not guessed.
  if (Number(afternoon)+Number(night)+Number(morning)>1) return '09:00'
  if(night) return '19:00'
  if(afternoon) return '15:00'
  return '09:00'
}

export const CALENDAR_TITLE_LIMIT = 44
const cleanPhrase = (value:string) => value.replace(/\s+/g,' ').trim()
const characters = (value:string) => Array.from(value).length

/** Whole words where possible; the complete wording always stays in details. */
function fitPhrase(value:string,limit:number):string {
  const phrase=cleanPhrase(value)
  if(characters(phrase)<=limit)return phrase
  const prefix=Array.from(phrase).slice(0,limit-1).join('')
  const boundary=prefix.lastIndexOf(' ')
  const words=boundary>0?prefix.slice(0,boundary):prefix
  return words.replace(/(?:\s+(?:de|del|para|por|con|of|for|to|the|a|an))+$/i,'').trimEnd()+'…'
}

export function shortCalendarTitle(action: ActionStructuredFields, es: boolean): string {
  const object=normalizePrimarySendObjectField(action.object || '',action.contact,action.verb,es?'Spanish':'English')
  const sendObject=/\btank[ -]?mix\b/i.test(object)?'tank mix':
    /ficha|technical sheet|data\s?sheet/i.test(object)?(es?'ficha':'datasheet'):
    /presupuesto|cotizaci[oó]n|quote|quotation/i.test(object)?(es?'presupuesto':'quote'):
    /cat[aá]logo|catalog/i.test(object)?(es?'catálogo':'catalog'):
    /muestras?|samples?/i.test(object)?(es?'muestras':'samples'):
    /informe|report|results|resultados/i.test(object)?(es?'informe':'report'):
    /certificado|certificate/i.test(object)?(es?'certificado':'certificate'):
    /\bprogram(?:a|me)?\b/i.test(object)?(es?'programa':'program'):
    object.replace(/^(?:el|la|los|las|un|una|the|a|an)\s+/i,'').replace(/\s+(?:por escrito|in writing)\.?$/i,'')
  const verb=action.type==='send' ? `${es?'Enviar':'Send'} ${sendObject}`.trim() :
    action.type==='call'?(es?'Llamar':'Call'):action.type==='meeting'?(es?'Reunión':'Meeting'):
    action.type==='follow_up'?(es?'Seguimiento':'Follow up'):
    (action.description || action.verb || (es?'Tarea':'Task'))
  const contact=cleanPhrase(action.contact)
  const company=cleanPhrase(action.company)
  const connector=action.type==='send'?(es?' a ':' to '):
    action.type==='call'?(es?' a ':' '):
    action.type==='meeting' || action.type==='follow_up'?(es?' con ':' with '):' — '
  const phrase=cleanPhrase(verb)+(contact?connector+contact:'')
  const complete=phrase+(company?' — '+company:'')
  if(characters(complete)<=CALENDAR_TITLE_LIMIT)return complete
  // First remove the secondary identity, not the action or its recipient.
  if(contact && characters(phrase)<=CALENDAR_TITLE_LIMIT)return phrase
  const recipient=contact || company
  if(!recipient)return fitPhrase(verb,CALENDAR_TITLE_LIMIT)
  // Reserve space for both the action's subject and a recognizable recipient.
  const actionLimit=Math.min(28,CALENDAR_TITLE_LIMIT-characters(connector)-Math.min(characters(recipient),12))
  const shortAction=fitPhrase(verb,actionLimit)
  return shortAction+connector+fitPhrase(recipient,CALENDAR_TITLE_LIMIT-characters(shortAction)-characters(connector))
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
  const time = suggestedCalendarTime(action)
  const instruction = buildPrimaryBaseTitle({...action,contact:'',company:''},language)
  const description = action.description?.trim() || `${instruction.replace(/[.!?]+$/, '')}.`
  const identities=[cleanPhrase(action.contact),cleanPhrase(action.company)].filter(Boolean)
  // Calendar must remain self-contained when its compact title omits an identity.
  const identityContext=identities.some(identity=>!title.includes(identity)) ? identities.join(' — ') : ''
  const details = [identityContext,description].filter(Boolean).join('\n\n')
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
    dates,ctz:draft.timezone,stz:draft.timezone,etz:draft.timezone})
  return `https://calendar.google.com/calendar/r/eventedit?${query}`
}
