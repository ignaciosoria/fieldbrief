/**
 * Plain-text bodies for calendar export (Google / Apple / ICS).
 * Line 1: Company — Contact. Lines 2–3: short visit context (max 2 lines).
 * Does not affect event titles, times, or UI.
 */

import { normalizeProductField, productFieldToList } from './productField'
import {
  insightLineContainsActionLanguage,
  insightLineTooVagueForCalendarDescription,
} from './filterInsightLines'

export const CALENDAR_EVENT_DESC_LINE_MAX = 72

export type CalendarEventDescriptionFields = {
  customer: string
  contact: string
  contactCompany: string
  crop: string
  product: string
  location: string
  acreage: string
  calendarDescription: string
  crmText: string
  crmFull: string[]
  notes: string
  summary: string
}

export type BuildCalendarEventDescriptionOptions = {
  /** Event SUMMARY — skip description lines that repeat it */
  eventTitle: string
  /** Primary/supporting action wording — must not be echoed in context */
  excludeActionPhrases: string[]
}

function stripEmojisForCalendar(s: string): string {
  return s
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\uFE0F/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeCalendarDedupeKey(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase()
}

function truncateCalendarLine(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  if (!t) return ''
  return t.length > max ? `${t.slice(0, max - 1).trim()}…` : t
}

function normalizeInsightEmoji(line: string): string {
  return line
    .replace(/^(\s*)🌱/u, '$1📦')
    .replace(/^(\s*)🌾/u, '$1📊')
}

function compactInsightForCalendar(line: string): string {
  let s = normalizeInsightEmoji(line).trim()
  s = stripEmojisForCalendar(s).replace(/^[\s\-•*→]+/g, '').trim()
  return s
}

/** First clause; strip numeric dates (event already carries timing). */
function telegraphicInsightFragment(raw: string): string {
  let s = raw.replace(/\s+/g, ' ').trim()
  s = s.replace(/\d{1,2}\/\d{1,2}\/\d{2,4}/g, '')
  s = s.replace(/\s+/g, ' ').trim()
  const oneSentence = (s.split(/[.!?]/)[0] || s).trim()
  const oneClause = (oneSentence.split(/[,;:]/)[0] || oneSentence).trim()
  return oneClause.replace(/\.\s*$/g, '').trim()
}

function calendarFragmentOverlapsTitle(fragment: string, eventTitle: string): boolean {
  const f = normalizeCalendarDedupeKey(fragment)
  const e = normalizeCalendarDedupeKey(stripEmojisForCalendar(eventTitle))
  if (!f || !e) return false
  if (f === e) return true
  if (f.length >= 14 && (e.includes(f) || f.includes(e))) return true
  return false
}

function contextLineConflicts(
  line: string,
  excludePhrases: string[],
  pickedKeys: Set<string>,
  eventTitle: string,
): boolean {
  const k = normalizeCalendarDedupeKey(line)
  if (!k) return true
  if (pickedKeys.has(k)) return true
  if (calendarFragmentOverlapsTitle(line, eventTitle)) return true

  for (const phrase of excludePhrases) {
    const pk = normalizeCalendarDedupeKey(phrase)
    if (!pk) continue
    if (pk === k || pk.includes(k) || k.includes(pk)) return true
    if (k.length >= 10 && pk.length >= 10 && (pk.includes(k) || k.includes(pk))) return true
  }
  for (const ex of pickedKeys) {
    if (!ex || !k) continue
    if (k.length >= 10 && ex.length >= 10 && (ex.includes(k) || k.includes(ex))) return true
  }
  return false
}

function productDisplayItems(crop: string, productCsv: string): string[] {
  const parts = productFieldToList(normalizeProductField(productCsv))
  const c = (crop || '').trim()
  if (!c) return parts
  if (parts.some((p) => p.toLowerCase() === c.toLowerCase())) return parts
  return [c, ...parts]
}

function calendarDescriptionLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^→\s*/, '').trim())
    .filter(Boolean)
}

function crmTextChunks(raw: string): string[] {
  const t = stripEmojisForCalendar(raw)
  if (!t) return []
  const sentences = t
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
  return sentences.slice(0, 4)
}

function tryContextLine(
  raw: string,
  excludePhrases: string[],
  pickedKeys: Set<string>,
  eventTitle: string,
  minLen: number,
): string | null {
  const compact = compactInsightForCalendar(raw)
  if (!compact.trim()) return null
  if (insightLineContainsActionLanguage(compact)) return null
  if (insightLineTooVagueForCalendarDescription(compact)) return null
  let s = telegraphicInsightFragment(compact)
  s = s.replace(/\s+/g, ' ').trim()
  if (s.length < minLen) return null
  if (insightLineTooVagueForCalendarDescription(s)) return null
  if (contextLineConflicts(s, excludePhrases, pickedKeys, eventTitle)) return null
  return truncateCalendarLine(s, CALENDAR_EVENT_DESC_LINE_MAX)
}

/**
 * Line 1: Company — Contact (account + person). Omits duplicate org in header when same as customer.
 */
export function buildCalendarDescriptionHeaderLine(
  data: Pick<CalendarEventDescriptionFields, 'customer' | 'contact' | 'contactCompany'>,
): string {
  const cust = stripEmojisForCalendar((data.customer || '').trim())
  const contact = stripEmojisForCalendar((data.contact || '').trim())
  const line =
    cust && contact ? `${cust} — ${contact}` : cust || contact || ''
  return line ? truncateCalendarLine(line, CALENDAR_EVENT_DESC_LINE_MAX) : ''
}

/**
 * Up to two context lines: concrete visit/situation copy, not generic AI filler or a repeat of the action.
 */
export function buildCalendarEventDescriptionBody(
  data: CalendarEventDescriptionFields,
  options: BuildCalendarEventDescriptionOptions,
): string {
  const { eventTitle, excludeActionPhrases } = options
  const phrases = excludeActionPhrases.map((p) => stripEmojisForCalendar(p)).filter(Boolean)

  const header = buildCalendarDescriptionHeaderLine(data)
  const firstLine = header
    ? truncateCalendarLine(header, CALENDAR_EVENT_DESC_LINE_MAX)
    : 'Visit note'

  const picked = new Set<string>()
  if (firstLine) picked.add(normalizeCalendarDedupeKey(firstLine))
  const out: string[] = [firstLine]

  const pushLine = (raw: string, minLen: number): boolean => {
    const t = tryContextLine(raw, phrases, picked, eventTitle, minLen)
    if (!t) return false
    const key = normalizeCalendarDedupeKey(t)
    picked.add(key)
    out.push(t)
    return true
  }

  for (const raw of calendarDescriptionLines((data.calendarDescription || '').trim())) {
    if (out.length >= 3) break
    pushLine(raw, 6)
  }

  for (const raw of data.crmFull || []) {
    if (out.length >= 3) break
    if (!raw.trim() || raw.trimStart().startsWith('📅')) continue
    pushLine(raw, 6)
  }

  for (const raw of crmTextChunks((data.crmText || '').trim())) {
    if (out.length >= 3) break
    pushLine(raw, 10)
  }

  if (out.length < 3) {
    const n = (data.notes || '').trim()
    if (n) pushLine(n, 8)
  }
  if (out.length < 3) {
    const s = (data.summary || '').trim()
    if (s) pushLine(s, 8)
  }
  if (out.length < 3) {
    const offerings = productDisplayItems(data.crop, data.product)
    const loc = stripEmojisForCalendar((data.location || '').trim())
    const size = stripEmojisForCalendar((data.acreage || '').trim())
    const parts: string[] = []
    if (offerings.length) parts.push(offerings.join(', '))
    if (loc) parts.push(loc)
    if (size) parts.push(size)
    if (parts.length) {
      const combined = parts.join(' · ')
      if (combined.length >= 8) pushLine(combined, 8)
    }
  }

  return out.slice(0, 3).join('\n').trim()
}
