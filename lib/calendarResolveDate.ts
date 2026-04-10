import { DateTime } from 'luxon'
import {
  defaultTimeForActionKind,
  inferActionKind,
  type ActionKind,
} from './nextStepActionKind'

/**
 * Convert a client-provided instant (always interpreted in `timeZone` for calendar math).
 * Prefer sending ISO from the browser (`new Date().toISOString()`) or epoch ms — never use
 * server-only `Date` for user-relative phrases.
 */
export function toUserAnchorDateTime(
  userLocalNow: Date | number | string,
  timeZone: string,
): DateTime {
  const z = normalizeIanaTimeZone(timeZone)
  let dt: DateTime
  if (typeof userLocalNow === 'number') {
    dt = DateTime.fromMillis(userLocalNow)
  } else if (typeof userLocalNow === 'string') {
    const t = userLocalNow.trim()
    if (!t) return DateTime.now().setZone(z)
    dt = DateTime.fromISO(t, { setZone: true })
    if (!dt.isValid) {
      const d = new Date(t)
      dt = DateTime.fromJSDate(d)
    }
  } else {
    dt = DateTime.fromJSDate(userLocalNow)
  }
  if (!dt.isValid) return DateTime.now().setZone(z)
  return dt.setZone(z)
}

/** Options for {@link resolveRelativePhraseToMmdd} / {@link resolveRelativeDate}. */
export type ResolveRelativePhraseOptions = {
  /**
   * Primary next-step only: a bare weekday (Mon–Sun) resolves to the **next** occurrence of that
   * weekday, never the anchor calendar day. Omit for supporting rows (nearest-weekday behavior).
   */
  weekdaySkipAnchorDay?: boolean
}

/**
 * Resolve a natural-language date reference to MM/DD/YYYY in `timeZone`, anchored to the user's
 * real clock instant (not server local time, not UTC calendar day alone).
 */
export function resolveRelativeDate(
  reference: string | null | undefined,
  userLocalNow: Date | number | string,
  timeZone: string,
  options?: ResolveRelativePhraseOptions,
): string | null {
  const phrase = (reference || '').trim()
  if (!phrase) return null
  const z = normalizeIanaTimeZone(timeZone)
  const anchor = toUserAnchorDateTime(userLocalNow, z)
  return resolveRelativePhraseToMmdd(phrase, z, anchor, options)
}

/** @deprecated Use {@link resolveRelativeDate} — same behavior when `now` is the client instant. */
export function resolveDate(
  timeReference: string | null | undefined,
  now: Date,
  timeZone: string,
  options?: ResolveRelativePhraseOptions,
): string | null {
  return resolveRelativeDate(timeReference, now, timeZone, options)
}

function normalizeIanaTimeZone(tz: string): string {
  const t = (tz || '').trim()
  if (!t) return 'America/Los_Angeles'
  const probe = DateTime.now().setZone(t)
  if (!probe.isValid) return 'America/Los_Angeles'
  return t
}

function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '')
}

/** Remove time-of-day phrases so weekday/date resolution stays on the calendar day. */
function stripTimeOfDayFromDatePhrase(s: string): string {
  return s
    .replace(/\bpor\s+la\s+mañana\b/gi, ' ')
    .replace(/\bpor\s+la\s+tarde\b/gi, ' ')
    .replace(/\bpor\s+la\s+noche\b/gi, ' ')
    .replace(/\bal\s+mediod[ií]a\b/gi, ' ')
    .replace(/\bin\s+the\s+morning\b/gi, ' ')
    .replace(/\bin\s+the\s+afternoon\b/gi, ' ')
    .replace(/\bin\s+the\s+evening\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** English + Spanish weekday tokens → Luxon weekday (Mon=1 … Sun=7). */
function parseWeekdayToLuxonWeekday(raw: string): number | null {
  const t = stripDiacritics(raw.trim().toLowerCase())
  if (!t) return null
  const map: Record<string, number> = {
    sunday: 7,
    sun: 7,
    domingo: 7,
    monday: 1,
    mon: 1,
    lunes: 1,
    lun: 1,
    tuesday: 2,
    tue: 2,
    tues: 2,
    martes: 2,
    mar: 2,
    wednesday: 3,
    wed: 3,
    miercoles: 3,
    miércoles: 3,
    thursday: 4,
    thu: 4,
    thurs: 4,
    jueves: 4,
    friday: 5,
    fri: 5,
    viernes: 5,
    vie: 5,
    saturday: 6,
    sat: 6,
    sabado: 6,
    sábado: 6,
  }
  if (map[t] !== undefined) return map[t]
  for (const w of t.split(/\s+/)) {
    if (w && map[w] !== undefined) return map[w]
  }
  return null
}

/** "next Friday" / "próximo jueves" → when landing on *this* weekday, use the following week's occurrence. */
function isExplicitNextWeekdayPhrase(lower: string): boolean {
  if (/\bnext\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(lower))
    return true
  if (
    /\bpr[oó]xim[oa]\s+(?:lunes|martes|mi[eé]rcoles|miercoles|jueves|viernes|s[aá]bado|sabado|domingo)\b/i.test(
      lower,
    )
  )
    return true
  return false
}

/** If it's already that weekday late at night, "Friday" usually means the following Friday. */
const LATE_SAME_WEEKDAY_LOCAL_HOUR = 21

/**
 * Convert relative / phrase date strings to MM/DD/YYYY using the user's timezone and **anchor**
 * instant (client "now"). All "today" / "tomorrow" / weekday math uses `anchor` in `timeZone`.
 */
export function resolveRelativePhraseToMmdd(
  raw: string,
  timeZone: string,
  anchor: DateTime,
  options?: ResolveRelativePhraseOptions,
): string | null {
  const z = normalizeIanaTimeZone(timeZone)
  const anchorDt = anchor.setZone(z)
  const t = (raw || '').trim()
  if (!t) return null

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(t)) return t
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) {
    const d = DateTime.fromISO(t.slice(0, 10), { zone: z })
    return d.isValid ? d.toFormat('MM/dd/yyyy') : null
  }

  let s = stripTimeOfDayFromDatePhrase(t)
  s = s.replace(/^el\s+/i, '').replace(/^la\s+/i, '').trim()
  const lower = s.toLowerCase()

  if (/\bpasado\s+mañana\b/.test(lower) || /\bday\s+after\s+tomorrow\b/.test(lower)) {
    return anchorDt.plus({ days: 2 }).toFormat('MM/dd/yyyy')
  }
  if (/\bhoy\b/.test(lower) || /\btoday\b/.test(lower)) {
    return anchorDt.toFormat('MM/dd/yyyy')
  }
  if (/\bmañana\b/.test(lower) || /\btomorrow\b/.test(lower)) {
    return anchorDt.plus({ days: 1 }).toFormat('MM/dd/yyyy')
  }

  if (/\bnext\s+week\b/.test(lower) || /\bpr[oó]xima\s+semana\b/.test(lower)) {
    const daysToMonday = (8 - anchorDt.weekday) % 7
    const upcomingMonday = anchorDt.plus({
      days: daysToMonday === 0 ? 0 : daysToMonday,
    })
    return upcomingMonday.plus({ days: 7 }).toFormat('MM/dd/yyyy')
  }

  const luxWd = parseWeekdayToLuxonWeekday(s)
  if (luxWd !== null) {
    let add = (luxWd - anchorDt.weekday + 7) % 7
    if (options?.weekdaySkipAnchorDay) {
      if (add === 0) add = 7
    } else {
      if (add === 0 && isExplicitNextWeekdayPhrase(lower)) {
        add = 7
      } else if (
        add === 0 &&
        !isExplicitNextWeekdayPhrase(lower) &&
        anchorDt.hour >= LATE_SAME_WEEKDAY_LOCAL_HOUR
      ) {
        add = 7
      }
    }
    return anchorDt.plus({ days: add }).toFormat('MM/dd/yyyy')
  }

  return null
}

function pad2(n: number) {
  return n.toString().padStart(2, '0')
}

/** HH:mm for nextStepTimeHint when applying server-side defaults. */
export function formatClockHint(hour: number, minute: number): string {
  return `${pad2(hour)}:${pad2(minute)}`
}

/** If hint already has a concrete clock, keep it; else use action-kind defaults. */
export function resolveCalendarTimeHint(
  nextStepTimeHint: string,
  nextStep: string,
  nextStepTitle: string,
  nextStepAction: string,
): string {
  const hint = (nextStepTimeHint || '').trim()
  if (/^\d{1,2}:\d{2}$/.test(hint)) return hint
  if (/\b(am|pm)\b/i.test(hint) && /\d/.test(hint)) return hint
  const h = hint.toLowerCase()
  if (h === 'morning' || h === 'afternoon' || h === 'noon') return hint

  const kind: ActionKind = inferActionKind(
    `${nextStepAction} ${nextStep} ${nextStepTitle}`,
  )
  const { hour, minute } = defaultTimeForActionKind(kind)
  return formatClockHint(hour, minute)
}
