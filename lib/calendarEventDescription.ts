/**
 * Plain-text bodies for calendar export (Google / Apple / ICS).
 * New notes: description is built in `calendarDescriptionFormat` + pipeline; this module dedupes
 * against the title and handles legacy labeled sections (Context / Goal / Opportunity).
 */

import { detectNoteLanguage } from './detectNoteLanguage'
import { normalizeProductField, productFieldToList } from './productField'
import {
  insightLineContainsActionLanguage,
  insightLineTooVagueForCalendarDescription,
} from './filterInsightLines'

export const CALENDAR_EVENT_DESC_LINE_MAX = 300
/** Max paragraphs when building or normalizing the event description body. */
export const CALENDAR_BODY_MAX_PARAGRAPHS = 4

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

/** Cap model output before we parse or display. */
export function normalizeCalendarDescriptionField(raw: string): string {
  const t = raw.replace(/\r\n/g, '\n').trim()
  if (!t) return ''
  return t.split('\n').slice(0, 12).join('\n').slice(0, 2500)
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

function calendarFragmentOverlapsTitle(fragment: string, eventTitle: string): boolean {
  const f = normalizeCalendarDedupeKey(fragment)
  const e = normalizeCalendarDedupeKey(stripEmojisForCalendar(eventTitle))
  if (!f || !e) return false
  if (f === e) return true
  if (f.length >= 14 && (e.includes(f) || f.includes(e))) return true
  return false
}

/** Strip timing phrases — event already carries date/time. */
function stripTimingPhrases(s: string): string {
  return s
    .replace(/\b(today|tomorrow|tonight|this\s+week|next\s+week|next\s+month)\b/gi, '')
    .replace(/\b(hoy|mañana|esta\s+semana|próxima\s+semana)\b/gi, '')
    .replace(/\d{1,2}\/\d{1,2}\/\d{2,4}/g, '')
    .replace(/\s+/g, ' ')
    .trim()
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
  s = stripTimingPhrases(s)
  s = s.replace(/\d{1,2}\/\d{1,2}\/\d{2,4}/g, '')
  s = s.replace(/\s+/g, ' ').trim()
  const oneSentence = (s.split(/[.!?]/)[0] || s).trim()
  const oneClause = (oneSentence.split(/[,;:]/)[0] || oneSentence).trim()
  return oneClause.replace(/\.\s*$/g, '').trim()
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

type SectionKey = 'context' | 'goal' | 'opportunity'

/**
 * Parse legacy model output with labeled sections (EN or ES).
 * Rendered as plain paragraphs without labels (see {@link formatStructuredSections}).
 */
export function parseStructuredCalendarSections(
  raw: string,
): Partial<Record<SectionKey, string>> | null {
  const text = raw.replace(/\r\n/g, '\n').trim()
  if (!text) return null

  const header = (line: string): { key: SectionKey; rest: string } | null => {
    const t = line.trim()
    let m = t.match(/^Contexto?:\s*(.*)$/i)
    if (m) return { key: 'context', rest: m[1].trim() }
    m = t.match(/^Goal\s*\/\s*Focus:\s*(.*)$/i)
    if (m) return { key: 'goal', rest: m[1].trim() }
    m = t.match(/^Objetivo\s*\/\s*Enfoque:\s*(.*)$/i)
    if (m) return { key: 'goal', rest: m[1].trim() }
    m = t.match(/^Opportunity:\s*(.*)$/i)
    if (m) return { key: 'opportunity', rest: m[1].trim() }
    m = t.match(/^Oportunidad:\s*(.*)$/i)
    if (m) return { key: 'opportunity', rest: m[1].trim() }
    return null
  }

  const out: Partial<Record<SectionKey, string>> = {}
  let current: SectionKey | null = null
  for (const line of text.split('\n')) {
    const h = header(line)
    if (h) {
      current = h.key
      if (h.rest) out[current] = (out[current] ? `${out[current]}\n` : '') + h.rest
      continue
    }
    if (current && line.trim()) {
      out[current] = (out[current] ? `${out[current]}\n` : '') + line.trim()
    }
  }
  if (!out.context && !out.goal && !out.opportunity) return null
  return out
}

function splitPlainCalendarBlocks(raw: string): string[] {
  const t = raw.replace(/\r\n/g, '\n').trim()
  if (!t) return []
  if (/\n\n/.test(t)) {
    return t.split(/\n\n+/).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean)
  }
  return t.split('\n').map((s) => s.trim()).filter(Boolean)
}

/**
 * Natural-language calendar body from the model (no Context / Goal / Opportunity headers).
 */
function normalizePlainCalendarDescription(
  raw: string,
  options: BuildCalendarEventDescriptionOptions,
): string {
  const phrases = options.excludeActionPhrases.map((p) => stripEmojisForCalendar(p)).filter(Boolean)
  const picked = new Set<string>()
  const out: string[] = []
  for (const block of splitPlainCalendarBlocks(raw)) {
    if (out.length >= CALENDAR_BODY_MAX_PARAGRAPHS) break
    const line = sanitizeSectionBody(block, phrases, picked, options.eventTitle)
    if (line) out.push(line)
  }
  return out.join('\n\n').trim()
}

function isLooseFragment(s: string): boolean {
  const t = s.trim()
  if (!t || t === '—' || t === '-') return false
  const words = t.split(/\s+/).filter(Boolean)
  return words.length <= 2 && t.length < 36 && !/[.!?]/.test(t)
}

function ensureSentenceOrDash(s: string, _langEs: boolean, looseFallback: string): string {
  const t = s.trim()
  if (!t || t === '—' || t === '-') return looseFallback
  if (isLooseFragment(t)) return looseFallback
  return t
}

function sanitizeSectionBody(
  raw: string,
  excludePhrases: string[],
  pickedKeys: Set<string>,
  eventTitle: string,
): string {
  let s = stripTimingPhrases(raw)
  s = s.replace(/\s+/g, ' ').trim()
  if (!s) return s
  if (contextLineConflicts(s, excludePhrases, pickedKeys, eventTitle)) return ''
  const k = normalizeCalendarDedupeKey(s)
  if (k) pickedKeys.add(k)
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

function buildFallbackSections(
  data: CalendarEventDescriptionFields,
  options: BuildCalendarEventDescriptionOptions,
): string {
  const { eventTitle, excludeActionPhrases } = options
  const phrases = excludeActionPhrases.map((p) => stripEmojisForCalendar(p)).filter(Boolean)
  const picked = new Set<string>()
  const langHint = detectNoteLanguage(
    [
      data.crmText,
      data.summary,
      (data.crmFull || []).join('\n'),
      data.notes,
    ].join('\n'),
  )
  const langEs = langHint === 'spanish'

  const looseCtx = langEs
    ? 'Situación de cuenta a revisar en la visita.'
    : 'Account situation to review from the visit.'
  const looseGoal = langEs
    ? 'Dirigir la conversación según la situación descrita primero.'
    : 'Steer the conversation using the situation described first.'
  const looseOpp = langEs ? 'Sin expansión adicional citada en la nota.' : 'No additional upside cited in the note.'

  let context = ''
  for (const raw of crmTextChunks((data.crmText || '').trim())) {
    const t = tryContextLine(raw, phrases, picked, eventTitle, 10)
    if (t) {
      context = t
      break
    }
  }
  if (!context) {
    for (const raw of data.crmFull || []) {
      if (!raw.trim() || raw.trimStart().startsWith('📅')) continue
      const t = tryContextLine(raw, phrases, picked, eventTitle, 10)
      if (t) {
        context = t
        break
      }
    }
  } else {
    picked.add(normalizeCalendarDedupeKey(context))
  }

  let goal = ''
  const n = (data.notes || '').trim()
  const summ = (data.summary || '').trim()
  if (n && !insightLineContainsActionLanguage(n)) {
    goal = tryContextLine(n, phrases, picked, eventTitle, 8) || ''
  }
  if (!goal && summ) {
    goal = tryContextLine(summ, phrases, picked, eventTitle, 8) || ''
  }
  if (!goal) {
    goal = looseGoal
  }

  let opportunity = ''
  for (const raw of data.crmFull || []) {
    if (!raw.includes('🆕')) continue
    const cleaned = stripEmojisForCalendar(raw.replace(/🆕/g, '').trim())
    const t = tryContextLine(cleaned, phrases, picked, eventTitle, 8)
    if (t) {
      opportunity = t
      break
    }
  }
  if (!opportunity) {
    for (const raw of data.crmFull || []) {
      if (!raw.trim() || raw.includes('🆕')) continue
      const t = tryContextLine(raw, phrases, picked, eventTitle, 8)
      if (t) {
        opportunity = t
        break
      }
    }
  }
  if (!opportunity) {
    const offerings = productDisplayItems(data.crop, data.product)
    const loc = stripEmojisForCalendar((data.location || '').trim())
    const size = stripEmojisForCalendar((data.acreage || '').trim())
    const parts: string[] = []
    if (offerings.length) parts.push(offerings.join(', '))
    if (loc) parts.push(loc)
    if (size) parts.push(size)
    if (parts.length) {
      const combined = parts.join(' · ')
      if (combined.length >= 8 && !contextLineConflicts(combined, phrases, picked, eventTitle)) {
        opportunity = truncateCalendarLine(combined, CALENDAR_EVENT_DESC_LINE_MAX)
      }
    }
  }
  if (!opportunity) opportunity = looseOpp

  context = context || looseCtx
  context = ensureSentenceOrDash(context, langEs, looseCtx)
  goal = ensureSentenceOrDash(goal, langEs, looseGoal)
  opportunity = ensureSentenceOrDash(opportunity, langEs, looseOpp)

  return [context, goal, opportunity].join('\n\n').trim()
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

function formatStructuredSections(
  sections: Partial<Record<SectionKey, string>>,
  langEs: boolean,
  options: BuildCalendarEventDescriptionOptions,
): string {
  const { eventTitle, excludeActionPhrases } = options
  const phrases = excludeActionPhrases.map((p) => stripEmojisForCalendar(p)).filter(Boolean)
  const picked = new Set<string>()
  const looseCtx = langEs
    ? 'Situación de cuenta a revisar en la visita.'
    : 'Account situation to review from the visit.'
  const looseGoal = langEs
    ? 'Dirigir la conversación según la situación descrita primero.'
    : 'Steer the conversation using the situation described first.'
  const looseOpp = langEs ? 'Sin expansión adicional citada en la nota.' : 'No additional upside cited in the note.'

  let context = sanitizeSectionBody(
    (sections.context || '').replace(/\n/g, ' '),
    phrases,
    picked,
    eventTitle,
  )
  let goal = sanitizeSectionBody(
    (sections.goal || '').replace(/\n/g, ' '),
    phrases,
    picked,
    eventTitle,
  )
  let opportunity = sanitizeSectionBody(
    (sections.opportunity || '').replace(/\n/g, ' '),
    phrases,
    picked,
    eventTitle,
  )

  context = ensureSentenceOrDash(context, langEs, looseCtx)
  goal = ensureSentenceOrDash(goal, langEs, looseGoal)
  opportunity = ensureSentenceOrDash(opportunity, langEs, looseOpp)

  return [context, goal, opportunity].join('\n\n').trim()
}

/**
 * Calendar event body for export: dedupes against title, strips timing; supports legacy section headers.
 */
export function buildCalendarEventDescriptionBody(
  data: CalendarEventDescriptionFields,
  options: BuildCalendarEventDescriptionOptions,
): string {
  const langHint = detectNoteLanguage(
    [
      data.calendarDescription,
      data.crmText,
      data.summary,
      (data.crmFull || []).join('\n'),
    ].join('\n'),
  )
  const langEs = langHint === 'spanish'

  const raw = (data.calendarDescription || '').trim()
  const parsed = parseStructuredCalendarSections(raw)
  if (parsed && (parsed.context || parsed.goal || parsed.opportunity)) {
    return formatStructuredSections(parsed, langEs, options)
  }

  if (raw) {
    const plain = normalizePlainCalendarDescription(raw, options)
    if (plain.trim()) return plain
    const rawClean = raw.replace(/\s+/g, ' ').trim()
    if (rawClean) return rawClean
  }

  return buildFallbackSections(data, options)
}
