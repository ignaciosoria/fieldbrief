'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

type MentionedEntity = { name: string; type: string }

type StructureResult = {
  customer: string
  dealer: string
  contact: string
  summary: string
  nextStep: string
  nextStepTitle: string
  nextStepAction: string
  nextStepTarget: string
  nextStepDate: string
  nextStepTimeHint: string
  nextStepConfidence: string
  ambiguityFlags: string[]
  mentionedEntities: MentionedEntity[]
  notes: string
  crop: string
  product: string
  location: string
  acreage: string
  crmText: string
  crmFull: string[]
}

const emptyResult: StructureResult = {
  customer: '',
  dealer: '',
  contact: '',
  summary: '',
  nextStep: '',
  nextStepTitle: '',
  nextStepAction: '',
  nextStepTarget: '',
  nextStepDate: '',
  nextStepTimeHint: '',
  nextStepConfidence: '',
  ambiguityFlags: [],
  mentionedEntities: [],
  notes: '',
  crop: '',
  product: '',
  location: '',
  acreage: '',
  crmText: '',
  crmFull: [],
}

function normalizeCrmFull(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    if (typeof raw === 'string' && raw.trim()) {
      try {
        return normalizeCrmFull(JSON.parse(raw))
      } catch {
        return []
      }
    }
    return []
  }
  return raw.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean)
}

function normalizeMentionedEntities(raw: unknown): MentionedEntity[] {
  if (!Array.isArray(raw)) return []
  const out: MentionedEntity[] = []
  for (const item of raw) {
    if (item && typeof item === 'object' && 'name' in item) {
      const o = item as Record<string, unknown>
      const name = typeof o.name === 'string' ? o.name.trim() : ''
      const type = typeof o.type === 'string' ? o.type.trim() : 'other'
      if (name) out.push({ name, type: type || 'other' })
    }
  }
  return out
}

function normalizeAmbiguityFlags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean)
}

function normalizeConfidence(raw: unknown): string {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase()
  if (s === 'high' || s === 'medium' || s === 'low') return s
  return 'medium'
}

function normalizeStructureResult(m: StructureResult): StructureResult {
  return {
    ...emptyResult,
    ...m,
    crmFull: normalizeCrmFull(m.crmFull),
    ambiguityFlags: normalizeAmbiguityFlags(m.ambiguityFlags),
    mentionedEntities: normalizeMentionedEntities(m.mentionedEntities),
    nextStepConfidence: normalizeConfidence(m.nextStepConfidence),
  }
}

/** Structured calendar: derive wall-clock time from AI hint (default 9:00). */
function resolveTimeFromHint(hint: string): { hour: number; minute: number } {
  const value = (hint || '').toLowerCase().trim()
  if (value === 'morning') return { hour: 9, minute: 0 }
  if (value === 'afternoon') return { hour: 15, minute: 0 }
  if (value === 'noon') return { hour: 12, minute: 0 }
  if (!value) return { hour: 9, minute: 0 }

  const h24 = hint.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (h24) {
    const hour = Math.min(23, Math.max(0, parseInt(h24[1], 10)))
    const minute = Math.min(59, Math.max(0, parseInt(h24[2], 10)))
    return { hour, minute }
  }

  const h12 = hint.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)\.?$/i)
  if (h12) {
    let hour = parseInt(h12[1], 10)
    const minute = h12[2] ? parseInt(h12[2], 10) : 0
    const ap = h12[3].toLowerCase()
    if (ap === 'pm' && hour < 12) hour += 12
    if (ap === 'am' && hour === 12) hour = 0
    return { hour: Math.min(23, hour), minute: Math.min(59, minute) }
  }

  const compact = hint.trim().match(/^(\d{1,2})\s*(pm|am)$/i)
  if (compact) {
    let hour = parseInt(compact[1], 10)
    if (compact[2].toLowerCase() === 'pm' && hour < 12) hour += 12
    if (compact[2].toLowerCase() === 'am' && hour === 12) hour = 0
    return { hour: Math.min(23, hour), minute: 0 }
  }

  return { hour: 9, minute: 0 }
}

function pad2(n: number) {
  return n.toString().padStart(2, '0')
}

/**
 * If the resolved local date+time is already past (e.g. "Tuesday morning" when it is
 * Tuesday afternoon), shift forward by 7 days so the event is never in the past.
 */
function ensureCalendarDateTimeNotPast(
  dateMmddyyyy: string,
  hour: number,
  minute: number,
): { dateMmddyyyy: string; hour: number; minute: number } {
  const ds = dateMmddyyyy.trim()
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(ds)) {
    return { dateMmddyyyy: ds, hour, minute }
  }
  const [mm, dd, yyyy] = ds.split('/').map((x) => parseInt(x, 10))
  if ([mm, dd, yyyy].some((n) => Number.isNaN(n))) {
    return { dateMmddyyyy: ds, hour, minute }
  }
  const event = new Date(yyyy, mm - 1, dd, hour, minute, 0, 0)
  const now = new Date()
  if (event.getTime() >= now.getTime()) {
    return { dateMmddyyyy: ds, hour, minute }
  }
  event.setDate(event.getDate() + 7)
  return {
    dateMmddyyyy: `${pad2(event.getMonth() + 1)}/${pad2(event.getDate())}/${event.getFullYear()}`,
    hour: event.getHours(),
    minute: event.getMinutes(),
  }
}

/** MM/DD/YYYY → YYYY-MM-DD for date input (YYYY-MM-DD). */
function mmddyyyyToIsoDate(mmddyyyy: string): string | null {
  const t = mmddyyyy.trim()
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(t)) return null
  const [mm, dd, yyyy] = t.split('/')
  return `${yyyy}-${mm}-${dd}`
}

function isoDateToMmddyyyy(iso: string): string {
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return ''
  return `${m}/${d}/${y}`
}

function todayIsoDate() {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function hourMinuteToTimeInput(hour: number, minute: number) {
  return `${pad2(hour)}:${pad2(minute)}`
}

function timeInputToHourMinute(value: string): { hour: number; minute: number } {
  const m = value.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return { hour: 9, minute: 0 }
  return {
    hour: Math.min(23, Math.max(0, parseInt(m[1], 10))),
    minute: Math.min(59, Math.max(0, parseInt(m[2], 10))),
  }
}

type CalendarTimeInput =
  | { kind: 'hint'; hint: string }
  | { kind: 'clock'; hour: number; minute: number }

/** Build Google Calendar `dates` segment; 30-minute duration. Requires MM/DD/YYYY. */
function buildGoogleCalendarDateRangeParts(
  dateMmddyyyy: string,
  time: CalendarTimeInput,
): { start: string; end: string } | null {
  const ds = dateMmddyyyy.trim()
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(ds)) return null
  const resolved =
    time.kind === 'hint'
      ? resolveTimeFromHint(time.hint)
      : { hour: time.hour, minute: time.minute }
  const bumped = ensureCalendarDateTimeNotPast(ds, resolved.hour, resolved.minute)
  const hour = bumped.hour
  const minute = bumped.minute
  const [mm, dd, yyyy] = bumped.dateMmddyyyy.split('/')
  let endH = hour
  let endM = minute + 30
  if (endM >= 60) {
    endH = Math.min(23, endH + 1)
    endM -= 60
  }
  return {
    start: `${yyyy}${mm}${dd}T${pad2(hour)}${pad2(minute)}00`,
    end: `${yyyy}${mm}${dd}T${pad2(endH)}${pad2(endM)}00`,
  }
}

/** Strip pictographic / emoji chars for plain-text calendar bodies. */
function stripEmojisForCalendar(s: string): string {
  return s
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\uFE0F/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function formatCalendarContactLine(
  data: Pick<StructureResult, 'contact' | 'customer'>,
): string {
  const contact = stripEmojisForCalendar(data.contact || '')
  const customer = stripEmojisForCalendar(data.customer || '')
  if (contact && customer) return `${contact} (${customer})`
  if (contact) return contact
  if (customer) return customer
  return ''
}

/** One readable context line; keeps first sentence when long, else soft-truncates. */
function shortCalendarContext(raw: string): string {
  let s = stripEmojisForCalendar(raw)
  if (!s) return ''
  if (s.length <= 280) return s
  const sentence = s.match(/^.{20,320}?[.!?](?:\s|$)/)
  if (sentence) return sentence[0].trim()
  const cut = s.slice(0, 260)
  const sp = cut.lastIndexOf(' ')
  return (sp > 48 ? cut.slice(0, sp) : cut) + '…'
}

/** Strip emoji/bullets; trim a leading arrow so we can re-add a single →. */
function cleanCalendarBulletLine(raw: string): string {
  return stripEmojisForCalendar(raw)
    .replace(/^[\s•\u2022\u25AA\-–—→]+\s*/u, '')
    .trim()
}

/** Multi-line summary/crmText → → bullets; single block → short prose (no emojis). */
function formatCalendarContextBlock(crmText: string, summary: string): string {
  const raw = (crmText || summary || '').trim()
  if (!raw) return ''
  const lines = raw.split(/\n/).map((l) => l.trim()).filter(Boolean)
  if (lines.length > 1) {
    return lines
      .map((l) => {
        const c = cleanCalendarBulletLine(l)
        return c ? `→ ${c}` : ''
      })
      .filter(Boolean)
      .join('\n')
  }
  const prose = shortCalendarContext(raw)
  return prose ? `→ ${prose}` : ''
}

/** Google Calendar event title: short structured title first, then long next step. */
function calendarEventTitle(r: StructureResult): string {
  const t = (r.nextStepTitle || '').trim()
  if (t) return t
  return (r.nextStep || '').trim()
}

function buildCalendarDescription(
  data: Pick<
    StructureResult,
    'crmText' | 'summary' | 'crmFull' | 'contact' | 'customer'
  >,
) {
  const contactLine = formatCalendarContactLine(data)
  const contextBlock = formatCalendarContextBlock(data.crmText || '', data.summary || '')
  const insightLines = (data.crmFull || [])
    .slice(0, 3)
    .map((i) => cleanCalendarBulletLine(i))
    .filter(Boolean)
    .map((line) => `→ ${line}`)

  const headParts: string[] = []
  if (contactLine) headParts.push(contactLine)
  if (contextBlock) headParts.push(contextBlock)
  const head = headParts.join('\n\n')

  if (insightLines.length === 0) return head
  return head ? `${head}\n\n${insightLines.join('\n')}` : insightLines.join('\n')
}

function needsCalendarConfirmation(r: StructureResult): boolean {
  const conf = (r.nextStepConfidence || '').toLowerCase()
  const hasDate = !!(r.nextStepDate || '').trim() && /^\d{2}\/\d{2}\/\d{4}$/.test((r.nextStepDate || '').trim())
  const hasTarget = !!(r.nextStepTarget || '').trim()
  const flags = r.ambiguityFlags?.length ?? 0
  return conf !== 'high' || !hasDate || !hasTarget || flags > 0
}

function needsTargetPicker(r: StructureResult): boolean {
  if ((r.mentionedEntities?.length ?? 0) > 1) return true
  const f = r.ambiguityFlags || []
  return f.some(
    (x) =>
      x.includes('unclear_target') ||
      x.includes('multiple_people') ||
      x.includes('multiple_people_mentioned'),
  )
}

function openGoogleCalendarWindow(opts: {
  title: string
  dateMmddyyyy: string
  details: string
  time: CalendarTimeInput
}) {
  const range = buildGoogleCalendarDateRangeParts(opts.dateMmddyyyy, opts.time)
  if (!range) return
  const title = encodeURIComponent(opts.title.trim())
  const details = encodeURIComponent(opts.details)
  const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${range.start}/${range.end}&details=${details}`
  window.open(url, '_blank')
}

/** Only pricing pressure, risk, and blockers/urgency use tinted backgrounds. */
function getInsightTone(text: string): 'negative' | 'neutral' {
  const t = text.trimStart()
  if (
    t.startsWith('💰') ||
    t.startsWith('🌡️') ||
    t.startsWith('🌡') ||
    t.startsWith('❗') ||
    t.startsWith('⚠️')
  ) {
    return 'negative'
  }
  return 'neutral'
}

function getInsightStyle(text: string) {
  const ink = 'text-zinc-900'
  const t = text.trimStart()
  if (getInsightTone(text) === 'negative') {
    if (t.startsWith('💰')) return `${ink} bg-red-50`
    if (t.startsWith('🌡️') || t.startsWith('🌡')) return `${ink} bg-orange-50`
    if (t.startsWith('❗') || t.startsWith('⚠️')) return `${ink} bg-amber-50`
    return `${ink} bg-amber-50`
  }
  return `${ink} bg-transparent`
}

function insightsCollapsedMaxPx(): number {
  if (typeof window === 'undefined') return 400
  const vh = window.innerHeight
  return Math.min(Math.max(vh * 0.38, 200), 520)
}

function KeyInsightsList({
  lines,
  gapClass,
  lineClassName,
  expanded,
  onToggle,
  buttonMarginClass,
  buttonTextClass,
}: {
  lines: string[]
  gapClass: string
  lineClassName: string
  expanded: boolean
  onToggle: () => void
  buttonMarginClass: string
  buttonTextClass: string
}) {
  const measureRef = useRef<HTMLDivElement>(null)
  const [collapsedMaxPx, setCollapsedMaxPx] = useState(() => insightsCollapsedMaxPx())
  const [needsToggle, setNeedsToggle] = useState(false)

  useLayoutEffect(() => {
    const measure = () => {
      setCollapsedMaxPx(insightsCollapsedMaxPx())
      const el = measureRef.current
      if (!el) return
      const cap = insightsCollapsedMaxPx()
      setNeedsToggle(el.offsetHeight > cap + 2)
    }
    measure()
    const onResize = () => measure()
    window.addEventListener('resize', onResize)
    const ro = new ResizeObserver(measure)
    if (measureRef.current) ro.observe(measureRef.current)
    return () => {
      window.removeEventListener('resize', onResize)
      ro.disconnect()
    }
  }, [lines])

  const showCollapsed = needsToggle && !expanded

  return (
    <>
      <div className="relative">
        <div
          ref={measureRef}
          className={`pointer-events-none absolute left-0 right-0 top-0 -z-10 flex flex-col ${gapClass} opacity-0`}
          aria-hidden
        >
          {lines.map((line, i) => (
            <p key={i} className={`${lineClassName} ${getInsightStyle(line)}`}>
              {line}
            </p>
          ))}
        </div>
        <div
          className={`flex flex-col ${gapClass} ${showCollapsed ? 'overflow-hidden' : ''}`}
          style={showCollapsed ? { maxHeight: collapsedMaxPx } : undefined}
        >
          {lines.map((line, i) => (
            <p key={i} className={`${lineClassName} ${getInsightStyle(line)}`}>
              {line}
            </p>
          ))}
        </div>
      </div>
      {needsToggle ? (
        <button
          type="button"
          onClick={onToggle}
          className={`${buttonMarginClass} ${buttonTextClass} font-semibold text-[#1a4d2e] underline decoration-[#1a4d2e]/30 underline-offset-2 hover:decoration-[#1a4d2e]/60`}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      ) : null}
    </>
  )
}

type Tab = 'record' | 'history' | 'settings'

type SavedNote = {
  id: string
  date: string
  result: StructureResult
  transcript: string
}

type CalendarConfirmState = {
  title: string
  dateIso: string
  timeStr: string
  target: string
  showTarget: boolean
  targetOptions: string[]
  baseDescription: string
}

function isWeakNextStep(nextStep: string) {
  if (!nextStep || !nextStep.trim()) return true

  const weakPatterns = [
    'call again',
    'follow up later',
    'check back',
    'llamar nuevamente',
    'seguir más tarde',
    'ver qué pasa',
  ]

  const lower = nextStep.toLowerCase()
  return weakPatterns.some((pattern) => lower.includes(pattern))
}

function hasStrongVerb(nextStep: string) {
  if (!nextStep || !nextStep.trim()) return false

  const verbs = [
    'call',
    'send',
    'follow up',
    'visit',
    'confirm',
    'review',
    'schedule',
    'llamar',
    'enviar',
    'hacer seguimiento',
    'visitar',
    'confirmar',
    'revisar',
    'agendar',
  ]

  const lower = nextStep.toLowerCase().trim()
  return verbs.some((verb) => lower.startsWith(verb))
}

/** Loose match: is this contact name tied to this org string (same token / substring)? */
function contactAlignsWithOrg(contact: string, org: string): boolean {
  const c = contact.trim().toLowerCase()
  const o = org.trim().toLowerCase()
  if (!c || !o) return false
  if (c === o) return true
  if (o.includes(c) || c.includes(o)) return true
  const cWords = c.split(/\s+/).filter((w) => w.length > 2)
  const oWords = o.split(/\s+/).filter((w) => w.length > 2)
  for (const cw of cWords) {
    for (const ow of oWords) {
      if (ow.includes(cw) || cw.includes(ow)) return true
    }
  }
  return false
}

/**
 * Company in nextStepTitle parens = org the direct contact belongs to (dealer vs customer).
 * Never default to "dealer first" when both exist — only the matching side, else fall back to API title.
 */
function companyForDirectContact(r: StructureResult): string {
  const contact = (r.nextStepTarget || r.contact || '').trim()
  const dealer = (r.dealer || '').trim()
  const customer = (r.customer || '').trim()

  if (!dealer && !customer) return ''
  if (dealer && !customer) return dealer
  if (customer && !dealer) return customer

  const alignDealer = contactAlignsWithOrg(contact, dealer)
  const alignCustomer = contactAlignsWithOrg(contact, customer)

  if (alignDealer && !alignCustomer) return dealer
  if (alignCustomer && !alignDealer) return customer
  if (alignDealer && alignCustomer) return ''

  return ''
}

/** Affiliation-based org, then API title parens, then location. */
function resolveCompanyForTitle(r: StructureResult): string {
  const affiliated = companyForDirectContact(r)
  if (affiliated) return affiliated
  const fromTitle = (r.nextStepTitle || '').match(/\(([^)]+)\)\s*$/)
  if (fromTitle) return fromTitle[1].trim()
  return (r.location || '').trim()
}

/**
 * True if `action` already ends with the full target (e.g. action "Call Mike", target "Mike").
 */
function actionAlreadyEndsWithTarget(action: string, target: string): boolean {
  const a = action.trim()
  const t = target.trim()
  if (!a || !t) return false
  const aLower = a.toLowerCase()
  const tLower = t.toLowerCase()
  if (aLower === tLower) return true
  if (!aLower.endsWith(tLower)) return false
  const prefix = a.slice(0, a.length - t.length)
  return prefix === '' || /\s$/.test(prefix)
}

/** Collapse repeated identical token at end ("Mike Mike" → "Mike"). */
function dedupeTrailingRepeatedWords(s: string): string {
  const parts = s.trim().split(/\s+/)
  if (parts.length < 2) return s.trim()
  let i = parts.length - 1
  while (i > 0 && parts[i].toLowerCase() === parts[i - 1].toLowerCase()) {
    parts.splice(i, 1)
    i--
  }
  return parts.join(' ')
}

function joinActionAndTarget(action: string, target: string): string {
  const a = action.trim()
  const t = target.trim()
  if (!a) return t
  if (!t) return a

  if (actionAlreadyEndsWithTarget(a, t)) {
    return dedupeTrailingRepeatedWords(a)
  }

  if (a.toLowerCase() === 'llamar' && !/^llamar\s+a\b/i.test(a)) {
    return dedupeTrailingRepeatedWords(`Llamar a ${t}`)
  }
  return dedupeTrailingRepeatedWords(`${a} ${t}`.replace(/\s+/g, ' ').trim())
}

/**
 * Calendar-only title: VERB + CONTACT + (COMPANY). Company = org the direct contact belongs to (dealer or customer).
 * Does not use enrichNextStep (avoids stacking customer/dealer/contact/location).
 */
function buildCleanNextStepTitle(r: StructureResult): string {
  const action = (r.nextStepAction || '').trim()
  const target = (r.nextStepTarget || r.contact || '').trim()
  const company = resolveCompanyForTitle(r)

  if (action || target) {
    const core = joinActionAndTarget(action, target)
    if (!core) {
      return dedupeTrailingRepeatedWords((r.nextStepTitle || r.nextStep || '').trim())
    }

    if (company) {
      const coreLower = core.toLowerCase()
      const companyLower = company.toLowerCase()
      if (coreLower.includes(`(${companyLower})`)) {
        return core
      }
      return `${core} (${company})`
    }
    const preserved = (r.nextStepTitle || '').trim()
    if (preserved) return dedupeTrailingRepeatedWords(preserved)
    return core
  }

  return dedupeTrailingRepeatedWords((r.nextStepTitle || r.nextStep || '').trim())
}

function enrichNextStep(
  nextStep: string,
  data: { contact?: string; customer?: string; dealer?: string },
) {
  if (!nextStep) return nextStep

  const contact = data.contact || ''
  const company = data.customer || data.dealer || ''

  let enriched = nextStep.trim()

  const hasCompany = enriched.includes(')')
  const hasContact =
    contact && enriched.toLowerCase().includes(contact.toLowerCase())

  if (contact && !hasContact) {
    const parts = enriched.split(' ')
    if (parts.length > 1) {
      enriched = `${parts[0]} ${contact} ${parts.slice(1).join(' ')}`
    }
  }

  if (company && !hasCompany) {
    enriched = `${enriched} (${company})`
  }

  return enriched
}

function isSpanish(text: string) {
  if (!text) return false
  return (
    /[áéíóúñ]/i.test(text) ||
    text.includes(' el ') ||
    text.includes(' la ') ||
    text.includes(' que ')
  )
}

function forceLanguage(nextStep: string, originalText: string) {
  if (!nextStep) return nextStep

  const inputIsSpanish = isSpanish(originalText)
  const outputIsSpanish = isSpanish(nextStep)

  if (inputIsSpanish && !outputIsSpanish) {
    return nextStep
      .replace(/^call/i, 'Llamar')
      .replace(/^send/i, 'Enviar')
      .replace(/^follow up/i, 'Hacer seguimiento')
      .replace(/^schedule/i, 'Agendar')
  }

  if (!inputIsSpanish && outputIsSpanish) {
    return nextStep
      .replace(/^llamar/i, 'Call')
      .replace(/^enviar/i, 'Send')
      .replace(/^hacer seguimiento/i, 'Follow up')
      .replace(/^agendar/i, 'Schedule')
  }

  return nextStep
}

function finalizeNextStepFields(res: StructureResult, sourceText: string): StructureResult {
  const base = { ...res }
  let nextLine = enrichNextStep(base.nextStep, base)
  let nextTitle = buildCleanNextStepTitle(base)
  nextLine = forceLanguage(nextLine, sourceText)
  nextTitle = forceLanguage(nextTitle, sourceText)
  return { ...base, nextStep: nextLine, nextStepTitle: nextTitle }
}

async function fixNextStep(result: {
  nextStep?: string
  customer?: string
  dealer?: string
  contact?: string
}) {
  const prompt = `
Fix this next step so it becomes specific and directly usable as a calendar event title.

Rules:
- Use format: ACTION + TARGET + (COMPANY if available)
- Keep it short
- Use a strong verb
- Avoid generic phrases
- Keep the same language as the original
- Return ONLY valid JSON with:
  { "nextStep": "..." }

Original next step:
"${result.nextStep || ''}"

Context:
Customer: ${result.customer || ''}
Dealer: ${result.dealer || ''}
Contact: ${result.contact || ''}
`

  const res = await fetch('/api/structure', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note: prompt }),
  })

  const data = await res.json()

  if (!res.ok) {
    throw new Error(data.error || 'Failed to fix next step.')
  }

  return data.nextStep || result.nextStep || ''
}

export default function Home() {
  const [mounted, setMounted] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('record')
  const [input, setInput] = useState('')
  const [result, setResult] = useState<StructureResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [transcript, setTranscript] = useState('')
  const [savedNotes, setSavedNotes] = useState<SavedNote[]>([])
  const [selectedNote, setSelectedNote] = useState<SavedNote | null>(null)
  const [noteSaved, setNoteSaved] = useState(false)
  const [showEditArea, setShowEditArea] = useState(false)
  const [isCorrectingRecording, setIsCorrectingRecording] = useState(false)
  const [correctingSeconds, setCorrectingSeconds] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [showCalendarToast, setShowCalendarToast] = useState(false)
  const [calendarConfirm, setCalendarConfirm] = useState<CalendarConfirmState | null>(null)
  const [resultInsightsExpanded, setResultInsightsExpanded] = useState(false)
  const [historyInsightsExpanded, setHistoryInsightsExpanded] = useState(false)
  const [resultSummaryExpanded, setResultSummaryExpanded] = useState(false)
  const [historySummaryExpanded, setHistorySummaryExpanded] = useState(false)
  const correctTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const processingStartedAtRef = useRef(0)

  const awaitMinProcessingDisplay = async () => {
    const minMs = 400
    const elapsed = Date.now() - processingStartedAtRef.current
    if (elapsed < minMs) await new Promise((r) => setTimeout(r, minMs - elapsed))
  }

  useEffect(() => {
    setMounted(true)
    const loadNotes = async () => {
      try {
        const { data, error } = await supabase
          .from('notes')
          .select('*')
          .order('date', { ascending: false })
        if (!error && data && data.length > 0) {
          const mapped: SavedNote[] = data.map((n: any) => ({
            id: n.id,
            date: n.date,
            transcript: n.transcript || '',
            result: normalizeStructureResult({
              ...emptyResult,
              contact: n.contact || '',
              customer: n.customer || '',
              dealer: n.dealer || '',
              summary: n.summary || '',
              nextStep: n.next_step || '',
              notes: n.notes || '',
              crop: n.crop || '',
              product: n.product || '',
              location: n.location || '',
              acreage: n.acreage || '',
              crmText: n.crm_text || '',
              crmFull: normalizeCrmFull(n.crm_full),
            }),
          }))
          setSavedNotes(mapped)
          try { localStorage.setItem('fieldbrief-notes', JSON.stringify(mapped)) } catch {}
          return
        }
      } catch {}
      // Fallback to localStorage
      try {
        const stored = localStorage.getItem('fieldbrief-notes')
        if (stored) {
          const parsed = JSON.parse(stored) as SavedNote[]
          setSavedNotes(
            parsed.map((n) => ({
              ...n,
              result: normalizeStructureResult({
                ...emptyResult,
                ...n.result,
                crmFull: normalizeCrmFull(n.result.crmFull),
              }),
            })),
          )
        }
      } catch {}
    }
    loadNotes()
  }, [])

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(t)
  }, [copied])

  useEffect(() => {
    if (isRecording) {
      setRecordingSeconds(0)
      timerRef.current = setInterval(() => setRecordingSeconds((s) => s + 1), 1000)
    } else {
      if (timerRef.current) clearInterval(timerRef.current)
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [isRecording])

  useEffect(() => {
    if (!showCalendarToast) return
    const t = setTimeout(() => setShowCalendarToast(false), 2100)
    return () => clearTimeout(t)
  }, [showCalendarToast])

  useEffect(() => {
    setResultInsightsExpanded(false)
    setResultSummaryExpanded(false)
  }, [result])

  useEffect(() => {
    setHistoryInsightsExpanded(false)
    setHistorySummaryExpanded(false)
  }, [selectedNote?.id])

  const saveNote = async (res: StructureResult, tx: string) => {
    const note: SavedNote = {
      id: Date.now().toString(),
      date: new Date().toISOString(),
      result: res,
      transcript: tx,
    }
    const updated = [note, ...savedNotes]
    setSavedNotes(updated)
    setNoteSaved(true)
    setTimeout(() => setNoteSaved(false), 2300)
    try { localStorage.setItem('fieldbrief-notes', JSON.stringify(updated)) } catch {}
    try {
      await supabase.from('notes').insert({
        id: note.id,
        date: note.date,
        transcript: tx,
        contact: res.contact,
        customer: res.customer,
        summary: res.summary,
        next_step: res.nextStep,
        notes: res.notes,
        crop: res.crop,
        product: res.product,
        location: res.location,
        crm_text: res.crmText,
        crm_full: res.crmFull,
      })
    } catch {}
  }

  const deleteNote = async (id: string) => {
    const updated = savedNotes.filter((n) => n.id !== id)
    setSavedNotes(updated)
    try { localStorage.setItem('fieldbrief-notes', JSON.stringify(updated)) } catch {}
    if (selectedNote?.id === id) setSelectedNote(null)
    try { await supabase.from('notes').delete().eq('id', id) } catch {}
  }

  const updateNote = async (id: string, res: StructureResult, tx: string) => {
    const updated = savedNotes.map((n) =>
      n.id === id ? { ...n, result: res, transcript: tx } : n
    )
    setSavedNotes(updated)
    try { localStorage.setItem('fieldbrief-notes', JSON.stringify(updated)) } catch {}
    if (selectedNote?.id === id) setSelectedNote({ ...selectedNote, result: res, transcript: tx })
    if (result) setResult(res)
    try {
      await supabase.from('notes').update({
        transcript: tx,
        contact: res.contact,
        customer: res.customer,
        summary: res.summary,
        next_step: res.nextStep,
        notes: res.notes,
        crop: res.crop,
        product: res.product,
        location: res.location,
        crm_text: res.crmText,
        crm_full: res.crmFull,
      }).eq('id', id)
    } catch {}
  }

  const buildShareText = (r: StructureResult) => {
    const lines: string[] = ['📋 FieldBrief Note', '']
    if (r.contact) lines.push(`👤 ${r.contact}${r.customer ? ` — ${r.customer}` : ''}`)
    const pills = [r.location && `📍 ${r.location}`, r.crop && `🌱 ${r.crop}`, r.product && `🧪 ${r.product}`].filter(Boolean)
    if (pills.length) lines.push(pills.join('  '))
    if (r.summary) { lines.push(''); lines.push('SUMMARY'); lines.push(r.summary) }
    const stepLine = (r.nextStepTitle || r.nextStep).trim()
    if (stepLine) { lines.push(''); lines.push('⚡ NEXT STEP'); lines.push(stepLine) }
    if (r.crmFull.length > 0) {
      lines.push('')
      lines.push('CRM DETAIL')
      lines.push(...r.crmFull)
    }
    if (r.crmText) {
      lines.push('')
      lines.push('NOTE')
      lines.push(r.crmText)
    }
    return lines.join('\n')
  }

  const handleShare = async (r: StructureResult) => {
    const text = buildShareText(r)
    if (navigator.share) {
      try { await navigator.share({ text }) } catch {}
    } else {
      await navigator.clipboard.writeText(text)
    }
  }

  const correctRecorderRef = useRef<MediaRecorder | null>(null)

  const startCorrectionRecording = async (noteId: string, originalTranscript: string) => {
    try {
      setError('')
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Audio not supported.')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = pickSupportedMimeType()
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      correctRecorderRef.current = recorder
      const chunks: Blob[] = []
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        setIsCorrectingRecording(false)
        clearInterval(correctTimerRef.current!)
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
        if (blob.size === 0) return
        processingStartedAtRef.current = Date.now()
        setLoading(true)
        try {
          const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm'
          const file = new File([blob], `correction.${ext}`, { type: blob.type })
          const fd = new FormData()
          fd.append('file', file)
          const txRes = await fetch('/api/transcribe', { method: 'POST', body: fd })
          const txData = await txRes.json()
          const correction = txData.transcript || txData.text || ''
          const combined = `ORIGINAL NOTE: ${originalTranscript}\n\nCORRECTION: ${correction}`
          const strRes = await fetch('/api/structure', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ note: combined }),
          })
          const strData = await strRes.json()
          if (!strRes.ok) throw new Error(strData.error)
          let final = normalizeStructureResult({ ...emptyResult, ...strData } as StructureResult)
          final = finalizeNextStepFields(final, combined)
          await awaitMinProcessingDisplay()
          updateNote(noteId, final, combined)
        } catch (err: any) {
          setError(err?.message || 'Correction failed.')
        } finally {
          await new Promise((r) => setTimeout(r, 72))
          setLoading(false)
        }
      }
      setCorrectingSeconds(0)
      correctTimerRef.current = setInterval(() => setCorrectingSeconds((s) => s + 1), 1000)
      recorder.start()
      setIsCorrectingRecording(true)
    } catch (err: any) {
      setError(err?.message || 'Could not start correction.')
    }
  }

  const stopCorrectionRecording = () => {
    try { correctRecorderRef.current?.stop() } catch {}
    setIsCorrectingRecording(false)
    clearInterval(correctTimerRef.current!)
  }

  const activeResult = selectedNote?.result ?? result

  const copyText = useMemo(() => {
    const r = activeResult
    if (!r) return ''
    const parts: string[] = []
    if (r.crmFull.length > 0) parts.push(...r.crmFull)
    const narrative = r.crmText?.trim()
    if (narrative) {
      if (parts.length) parts.push('')
      parts.push(narrative)
    }
    return parts.join('\n')
  }, [activeResult])

  const formatSeconds = (s: number) => {
    const m = Math.floor(s / 60).toString().padStart(2, '0')
    const sec = (s % 60).toString().padStart(2, '0')
    return `${m}:${sec}`
  }

  const formatDate = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  const getInitials = (name: string) => {
    return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
  }

  const pickSupportedMimeType = () => {
    if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined') return ''
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
    for (const type of candidates) {
      if (MediaRecorder.isTypeSupported(type)) return type
    }
    return ''
  }

  const toggleRecording = async () => {
    if (isRecording) {
      try { mediaRecorderRef.current?.stop() } catch { setIsRecording(false) }
      return
    }
    try {
      setError('')
      setCopied(false)
      setResult(null)
      setTranscript('')
      setInput('')

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Audio recording is not supported on this device/browser.')
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = pickSupportedMimeType()
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)

      chunksRef.current = []
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }

      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        setIsRecording(false)
        stream.getTracks().forEach((t) => t.stop())
        if (blob.size > 0) await processRecordedAudio(blob)
      }

      recorder.start()
      setIsRecording(true)
    } catch (err: any) {
      setError(err?.message || 'Could not start recording.')
      setIsRecording(false)
    }
  }

  const processRecordedAudio = async (blob: Blob) => {
    processingStartedAtRef.current = Date.now()
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const extension = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm'
      const file = new File([blob], `voice-note.${extension}`, { type: blob.type || 'audio/webm' })
      const formData = new FormData()
      formData.append('file', file)

      const transcribeRes = await fetch('/api/transcribe', { method: 'POST', body: formData })
      const transcribeData = await transcribeRes.json()
      if (!transcribeRes.ok) throw new Error(transcribeData.error || 'Failed to transcribe.')

      const tx = transcribeData.transcript || transcribeData.text || ''
      setTranscript(tx)
      setInput(tx)

      const structureRes = await fetch('/api/structure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: tx }),
      })
      
      const structureData = await structureRes.json()
      if (!structureRes.ok) {
        throw new Error(structureData.error || 'Failed to structure.')
      }
      
      let final = normalizeStructureResult({ ...emptyResult, ...structureData } as StructureResult)

      if (isWeakNextStep(final.nextStep) || !hasStrongVerb(final.nextStep)) {
        try {
          const fixedNextStep = await fixNextStep({
            nextStep: final.nextStep,
            customer: final.customer,
            dealer: final.dealer,
            contact: final.contact,
          })

          final = { ...final, nextStep: fixedNextStep }
        } catch (error) {
          console.error('Failed to auto-correct next step:', error)
        }
      }

      final = finalizeNextStepFields(final, tx)

      await awaitMinProcessingDisplay()
      setResult(final)
      saveNote(final, tx)
    } catch (err: any) {
      setError(err?.message || 'Something went wrong.')
    } finally {
      await new Promise((r) => setTimeout(r, 72))
      setLoading(false)
    }
  }

  const processTypedNote = async () => {
    if (!input.trim()) return
    processingStartedAtRef.current = Date.now()
    setLoading(true)
    setError('')
    setResult(null)
    setCopied(false)
    try {
      const res = await fetch('/api/structure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: input }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to process note.')
      let final = normalizeStructureResult({ ...emptyResult, ...data } as StructureResult)
      final = finalizeNextStepFields(final, input)
      await awaitMinProcessingDisplay()
      setResult(final)
      saveNote(final, input)
    } catch (err: any) {
      setError(err?.message || 'Something went wrong.')
    } finally {
      await new Promise((r) => setTimeout(r, 72))
      setLoading(false)
    }
  }

  const handleCopy = async () => {
    if (!copyText) return
    try {
      await navigator.clipboard.writeText(copyText)
      setCopied(true)
    } catch {
      setError('Could not copy to clipboard.')
    }
  }

  const handleReset = () => {
    setInput('')
    setResult(null)
    setError('')
    setTranscript('')
    setCopied(false)
    setSelectedNote(null)
    setShowEditArea(false)
    setShowCalendarToast(false)
    setCalendarConfirm(null)
  }

  const openCalendarFromStructuredResult = (r: StructureResult) => {
    if (needsCalendarConfirmation(r)) {
      const title = calendarEventTitle(r)
      const mmddRaw = (r.nextStepDate || '').trim()
      const mmdd = /^\d{2}\/\d{2}\/\d{4}$/.test(mmddRaw)
        ? mmddRaw
        : isoDateToMmddyyyy(todayIsoDate())
      const resolved = resolveTimeFromHint(r.nextStepTimeHint || '')
      const adj = ensureCalendarDateTimeNotPast(mmdd, resolved.hour, resolved.minute)
      const dateIso = mmddyyyyToIsoDate(adj.dateMmddyyyy) ?? todayIsoDate()
      const timeStr = hourMinuteToTimeInput(adj.hour, adj.minute)
      const showTarget = needsTargetPicker(r)
      const targetOptions = [
        ...new Set(
          [
            (r.nextStepTarget || '').trim(),
            ...r.mentionedEntities.map((e) => e.name.trim()),
          ].filter(Boolean),
        ),
      ]
      const target = (r.nextStepTarget || targetOptions[0] || '').trim()
      setCalendarConfirm({
        title,
        dateIso,
        timeStr,
        target,
        showTarget,
        targetOptions,
        baseDescription: buildCalendarDescription(r),
      })
      return
    }
    const dateMmdd = (r.nextStepDate || '').trim()
    openGoogleCalendarWindow({
      title: calendarEventTitle(r),
      dateMmddyyyy: dateMmdd,
      details: buildCalendarDescription(r),
      time: { kind: 'hint', hint: r.nextStepTimeHint || '' },
    })
    setShowCalendarToast(true)
  }

  if (!mounted) return null

  return (
    <main className="flex min-h-screen flex-col bg-white text-zinc-900 antialiased select-none">

      {/* Header */}
      <header className="flex items-center justify-between px-5 pt-8 pb-2 bg-white">
        <button className="flex flex-col gap-[4px] p-1 opacity-90" aria-label="Menu">
          <span className="block h-[1.5px] w-5 rounded-full bg-zinc-300" />
          <span className="block h-[1.5px] w-5 rounded-full bg-zinc-300" />
          <span className="block h-[1.5px] w-3 rounded-full bg-zinc-300" />
        </button>
        <span className="text-[13px] font-semibold tracking-[0.16em] text-zinc-800 uppercase">FieldBrief</span>
        <div className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold text-white" style={{backgroundColor: '#1a4d2e'}}>
          IG
        </div>
      </header>

      {/* Full-screen processing — single calm state */}
      {loading && (
        <div
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-white/[0.94] px-8 backdrop-blur-[3px]"
          style={{ animation: 'processingOverlayIn 0.48s cubic-bezier(0.4, 0, 0.2, 1) forwards' }}
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <div className="flex flex-col items-center gap-0">
            <svg
              className="text-[#1a4d2e]"
              width="52"
              height="52"
              viewBox="0 0 52 52"
              fill="none"
              aria-hidden
            >
              <circle cx="26" cy="26" r="21.5" stroke="currentColor" strokeOpacity="0.055" strokeWidth="1.05" />
              <g style={{ transformOrigin: '26px 26px', animation: 'processingRingSpin 1.55s linear infinite' }}>
                <circle
                  cx="26"
                  cy="26"
                  r="21.5"
                  stroke="currentColor"
                  strokeOpacity="0.72"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeDasharray="29 106"
                />
              </g>
            </svg>
            <p className="mt-5 max-w-[17rem] text-center text-[14px] font-semibold leading-snug tracking-tight text-zinc-700/95">
              Creating your follow-up
            </p>
          </div>
        </div>
      )}

      {/* Note saved — floating toast; no layout shift */}
      {noteSaved && (
        <div
          className="pointer-events-none fixed left-1/2 z-[95] flex max-w-[min(20rem,90vw)] -translate-x-1/2 items-center gap-2 rounded-full border border-zinc-200/80 bg-white/95 px-3.5 py-2 pl-2.5 text-[13px] font-medium text-zinc-800 shadow-[0_4px_28px_rgba(0,0,0,0.08),0_0_0_1px_rgba(0,0,0,0.03)] backdrop-blur-sm"
          style={{
            top: 'calc(env(safe-area-inset-top, 8px) + 3.25rem)',
            animation: 'noteSavedToast 2.1s cubic-bezier(0.4, 0, 0.2, 1) forwards',
          }}
          role="status"
          aria-live="polite"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#1a4d2e]/95">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.4">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </span>
          Note saved
        </div>
      )}

      {/* Calendar — floating toast; no layout shift */}
      {showCalendarToast && (
        <div
          className="pointer-events-none fixed left-1/2 z-[96] flex max-w-[min(18rem,92vw)] -translate-x-1/2 items-center gap-2 rounded-full border border-zinc-200/85 bg-white/96 px-3.5 py-2 pl-2.5 text-[13px] font-medium text-zinc-800 shadow-[0_4px_28px_rgba(0,0,0,0.1),0_0_0_1px_rgba(0,0,0,0.025)] backdrop-blur-sm"
          style={{
            bottom: 'calc(env(safe-area-inset-bottom, 10px) + 5.5rem)',
            animation: 'calendarEventToast 2s cubic-bezier(0.4, 0, 0.2, 1) forwards',
          }}
          role="status"
          aria-live="polite"
        >
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#1a4d2e]">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.6">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </span>
          Event created
        </div>
      )}

      {/* Confirm calendar — bottom sheet when AI output needs review */}
      {calendarConfirm && (
        <div
          className="fixed inset-0 z-[102] flex flex-col justify-end bg-black/45 px-0 pt-8 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="calendar-confirm-title"
        >
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="Close"
            onClick={() => setCalendarConfirm(null)}
          />
          <div className="relative z-[1] mx-auto w-full max-w-lg rounded-t-2xl border border-zinc-200/90 bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 shadow-[0_-8px_32px_rgba(0,0,0,0.12)]">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-zinc-200/90" aria-hidden />
            <h2
              id="calendar-confirm-title"
              className="mb-3 text-center text-[15px] font-bold tracking-tight text-zinc-900"
            >
              Confirm next step
            </h2>
            <label className="mb-2 block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
                Next step title
              </span>
              <input
                type="text"
                value={calendarConfirm.title}
                onChange={(e) =>
                  setCalendarConfirm((c) => (c ? { ...c, title: e.target.value } : c))
                }
                className="w-full rounded-xl border border-zinc-200 bg-zinc-50/50 px-3 py-2.5 text-[14px] font-medium text-zinc-900 outline-none ring-0 focus:border-emerald-300/80"
              />
            </label>
            <div className="mb-2 flex gap-2">
              <label className="min-w-0 flex-1">
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
                  Date
                </span>
                <input
                  type="date"
                  value={calendarConfirm.dateIso}
                  onChange={(e) =>
                    setCalendarConfirm((c) => (c ? { ...c, dateIso: e.target.value } : c))
                  }
                  className="w-full rounded-xl border border-zinc-200 bg-zinc-50/50 px-2 py-2.5 text-[13px] font-medium text-zinc-900 outline-none focus:border-emerald-300/80"
                />
              </label>
              <label className="min-w-0 w-[8.5rem]">
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
                  Time
                </span>
                <input
                  type="time"
                  value={calendarConfirm.timeStr}
                  onChange={(e) =>
                    setCalendarConfirm((c) => (c ? { ...c, timeStr: e.target.value } : c))
                  }
                  className="w-full rounded-xl border border-zinc-200 bg-zinc-50/50 px-2 py-2.5 text-[13px] font-medium text-zinc-900 outline-none focus:border-emerald-300/80"
                />
              </label>
            </div>
            {calendarConfirm.showTarget ? (
              <label className="mb-4 block">
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
                  Target
                </span>
                {calendarConfirm.targetOptions.length > 1 ? (
                  <select
                    value={calendarConfirm.target}
                    onChange={(e) =>
                      setCalendarConfirm((c) =>
                        c ? { ...c, target: e.target.value } : c,
                      )
                    }
                    className="w-full rounded-xl border border-zinc-200 bg-zinc-50/50 px-3 py-2.5 text-[14px] font-medium text-zinc-900 outline-none focus:border-emerald-300/80"
                  >
                    {calendarConfirm.targetOptions.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={calendarConfirm.target}
                    onChange={(e) =>
                      setCalendarConfirm((c) =>
                        c ? { ...c, target: e.target.value } : c,
                      )
                    }
                    className="w-full rounded-xl border border-zinc-200 bg-zinc-50/50 px-3 py-2.5 text-[14px] font-medium text-zinc-900 outline-none focus:border-emerald-300/80"
                    placeholder="Who is this for?"
                  />
                )}
              </label>
            ) : (
              <div className="mb-4" />
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setCalendarConfirm(null)}
                className="flex-1 rounded-xl border border-zinc-200 bg-white py-3 text-[14px] font-semibold text-zinc-700 transition-colors active:scale-[0.99]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const c = calendarConfirm
                  const mmdd = isoDateToMmddyyyy(c.dateIso)
                  if (!mmdd) return
                  const { hour, minute } = timeInputToHourMinute(c.timeStr)
                  let details = c.baseDescription
                  if (c.showTarget && c.target.trim()) {
                    const line = `Target: ${c.target.trim()}`
                    details = details ? `${details}\n\n${line}` : line
                  }
                  openGoogleCalendarWindow({
                    title: c.title.trim(),
                    dateMmddyyyy: mmdd,
                    details,
                    time: { kind: 'clock', hour, minute },
                  })
                  setCalendarConfirm(null)
                  setShowCalendarToast(true)
                }}
                className="flex-[1.15] rounded-xl py-3 text-[14px] font-bold text-white shadow-sm transition-[transform,filter] active:scale-[0.99]"
                style={{ backgroundColor: '#1a4d2e' }}
              >
                Confirm and add
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-5 pb-28">

        {/* ── RECORD TAB ── */}
        {activeTab === 'record' && (
          <div
            className="relative flex flex-col"
            style={result ? undefined : { minHeight: 'calc(100vh - 132px)' }}
          >

            {/* SCREEN 1 — Record (hidden when result exists) */}
            <div
              className="absolute inset-0 flex flex-col items-center justify-center gap-0 px-4 py-5 transition-[opacity,transform] duration-[450ms] ease-[cubic-bezier(0.4,0,0.2,1)]"
              style={{
                opacity: result || loading ? 0 : 1,
                transform: result ? 'translateY(-16px)' : loading ? 'translateY(-8px) scale(0.985)' : 'translateY(0)',
                pointerEvents: result || loading ? 'none' : 'auto',
              }}
            >
              <div className="mb-4 max-w-[20rem] text-center">
                <h2 className="text-xl font-semibold leading-tight tracking-tight text-zinc-800 sm:text-2xl">
                  Speak your visit
                </h2>
                <p className="mt-2 text-sm leading-snug text-zinc-500/78 sm:text-[15px]">
                  We turn it into a follow-up you can run
                </p>
              </div>
              {/* Mic button */}
              <button
                onClick={toggleRecording}
                disabled={loading}
                className="relative z-[1] mb-2 flex h-36 w-36 shrink-0 items-center justify-center rounded-full transition-[transform,box-shadow] duration-200 ease-out active:scale-[0.94] disabled:pointer-events-none disabled:active:scale-100"
                style={{
                  backgroundColor: isRecording ? '#dc2626' : '#1a4d2e',
                  boxShadow: isRecording
                    ? '0 8px 32px rgba(220,38,38,0.22), 0 2px 10px rgba(220,38,38,0.11), 0 0 0 1px rgba(220,38,38,0.08)'
                    : '0 12px 44px rgba(26,77,46,0.34), 0 4px 16px rgba(26,77,46,0.16), 0 0 0 1px rgba(26,77,46,0.1)',
                  transform: isRecording ? 'scale(1.01)' : 'scale(1)',
                }}
              >
                {!isRecording && !loading && (
                  <span
                    className="pointer-events-none absolute inset-0 rounded-full"
                    style={{ animation: 'mic-idle-glow 3s ease-in-out infinite' }}
                    aria-hidden
                  />
                )}
                {isRecording && (
                  <span
                    className="pointer-events-none absolute rounded-full"
                    style={{
                      inset: '-4px',
                      animation: 'mic-ring-pulse 2.5s ease-in-out infinite',
                      border: '1px solid rgba(248,113,113,0.32)',
                      boxShadow: '0 0 16px 0 rgba(220,38,38,0.07)',
                    }}
                    aria-hidden
                  />
                )}
                <svg width="46" height="46" viewBox="0 0 24 24" fill="white">
                  <path d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4z"/>
                  <path d="M19 10a1 1 0 0 0-2 0 5 5 0 0 1-10 0 1 1 0 0 0-2 0 7 7 0 0 0 6 6.92V19H9a1 1 0 0 0 0 2h6a1 1 0 0 0 0-2h-2v-2.08A7 7 0 0 0 19 10z"/>
                </svg>
              </button>

              {/* Timer / status */}
              <div className="mb-2 min-h-[44px] flex flex-col items-center justify-center">
                {isRecording ? (
                  <span
                    className="text-[48px] font-semibold tabular-nums tracking-tight leading-none text-zinc-900 transition-transform duration-300 sm:text-[52px]"
                    style={{ animation: 'recording-timer-breathe 3s ease-in-out infinite' }}
                  >
                    {formatSeconds(recordingSeconds)}
                  </span>
                ) : null}
              </div>

              {/* Waveform */}
              {isRecording && (
                <div className="mb-2 flex h-6 items-end justify-center gap-0.5">
                  {Array.from({ length: 24 }).map((_, i) => (
                    <span
                      key={i}
                      className="w-[2px] max-w-[2px] rounded-full bg-red-600/55"
                      style={{ animation: `pulse-bar ${0.5 + (i % 5) * 0.08}s ease-in-out ${i * 0.03}s infinite alternate` }}
                    />
                  ))}
                </div>
              )}

              {/* Recording hints */}
              {isRecording && (
                <div className="mb-2 w-full px-2">
                  <p className="mb-1.5 text-center text-[9px] font-medium uppercase tracking-[0.12em] text-zinc-400/65">Mention in your note</p>
                  <div className="flex flex-wrap justify-center gap-1">
                    {[{icon:'🏢',label:'Company'},{icon:'👤',label:'Contact'},{icon:'🌱',label:'Crop'},{icon:'🧪',label:'Product'},{icon:'📍',label:'Location'},{icon:'📅',label:'Next step'}].map((h) => (
                      <span key={h.label} className="flex items-center gap-0.5 rounded-full border px-1 py-px text-[8px] font-medium text-emerald-900/42 sm:text-[8.5px]" style={{borderColor:'rgba(167,243,208,0.28)',backgroundColor:'rgba(236,253,245,0.38)',animation:'fadeIn 0.4s ease forwards'}}>
                        {h.icon} {h.label}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Manual textarea */}
              {!isRecording && !loading && (
                <div className="mt-1.5 w-full max-w-md px-1">
                  <textarea
                    className="mb-3 w-full resize-none rounded-2xl border border-zinc-200/80 bg-zinc-50/40 px-3.5 py-3 text-[13px] leading-relaxed text-zinc-500 outline-none placeholder:text-zinc-400/32 min-h-[68px] shadow-inner shadow-zinc-100/80"
                    placeholder="Or type a note…"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                  />
                  {input.trim() && (
                    <button
                      onClick={processTypedNote}
                      disabled={loading}
                      className="w-full rounded-2xl py-4 text-[15px] font-semibold text-white transition-all active:scale-[0.98]"
                      style={{backgroundColor: '#1a4d2e', boxShadow: '0 4px 16px rgba(26,77,46,0.25)'}}
                    >
                      Process Note
                    </button>
                  )}
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="mt-3 w-full rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-600">
                  {error}
                </div>
              )}
            </div>

            {/* SCREEN 2 — Result (slides up when result exists) */}
            {result && (
              <div
                className="flex flex-col px-0 pt-1 pb-2"
                style={{
                  animation: 'slideUp 0.68s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards',
                }}
              >
                {/* 1 — Next step + calendar (sticky) */}
                <div className="sticky top-0 z-20 -mx-5 border-b border-zinc-100/65 bg-white/93 px-5 pb-2 pt-0 backdrop-blur-md supports-[backdrop-filter]:bg-white/86">
                  <div className="mb-1.5 flex justify-end">
                    <button
                      type="button"
                      onClick={handleReset}
                      className="flex shrink-0 items-center gap-0.5 rounded-full border border-zinc-200/90 bg-white py-1.5 pl-2.5 pr-3 text-[11px] font-semibold text-zinc-600 shadow-sm transition-colors hover:border-zinc-300 hover:bg-zinc-50 active:scale-[0.97]"
                    >
                      <span className="text-[13px] font-semibold leading-none text-zinc-700" aria-hidden>+</span>
                      New
                    </button>
                  </div>

                  {(result.nextStep || result.nextStepTitle) && (
                    <>
                      <div
                        className="rounded-2xl px-4 py-3 text-center shadow-[0_6px_28px_rgba(26,77,46,0.09),0_2px_8px_rgba(26,77,46,0.05),inset_0_1px_0_rgba(255,255,255,0.65)] ring-1 ring-emerald-100/40 border border-emerald-200/90"
                        style={{ background: 'linear-gradient(165deg, #e8f6ed 0%, #dbece3 100%)' }}
                      >
                        <p className="mb-1 text-[9px] font-semibold uppercase tracking-[0.26em] text-emerald-900/42">
                          Next step
                        </p>
                        <p
                          className="text-[18px] font-black leading-[1.2] tracking-[-0.02em] antialiased"
                          style={{ color: '#0a2e1a' }}
                        >
                          {result.nextStepTitle || result.nextStep}
                        </p>
                      </div>

                      <button
                        onClick={() => {
                          if (navigator.vibrate) navigator.vibrate(10)
                          openCalendarFromStructuredResult(result)
                        }}
                        type="button"
                        className="group mt-2.5 inline-flex w-full select-none items-center justify-center gap-1.5 rounded-xl py-3.5 pl-4 pr-4 text-[15px] font-bold leading-none text-white antialiased shadow-[0_4px_18px_-4px_rgba(26,77,46,0.28),0_2px_8px_rgba(26,77,46,0.12),inset_0_1px_0_rgba(255,255,255,0.18)] transition-[transform,box-shadow,filter] duration-200 ease-out hover:shadow-[0_6px_22px_-4px_rgba(26,77,46,0.32),0_2px_10px_rgba(26,77,46,0.14),inset_0_1px_0_rgba(255,255,255,0.2)] hover:brightness-[1.02] active:translate-y-px active:scale-[0.982] active:shadow-[0_3px_12px_-2px_rgba(26,77,46,0.22),inset_0_1px_2px_rgba(0,0,0,0.12)] active:brightness-[0.95]"
                        style={{ backgroundColor: '#1a4d2e' }}
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="block h-4 w-4 shrink-0 opacity-[0.95]" aria-hidden>
                          <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                        </svg>
                        <span className="tracking-tight">Add to Calendar</span>
                      </button>
                    </>
                  )}
                </div>

                {/* 2 — Contact & company → 3 — Insights → 4 — Summary → actions */}
                <div className="mt-3 flex flex-col gap-1.5">
                  {(result.contact || result.customer || result.location || result.crop || result.product) && (
                    <div className="rounded-2xl border border-zinc-200/85 bg-white px-3 py-3 shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
                      {result.contact ? (
                        <p className="text-[16px] font-bold leading-snug tracking-tight text-zinc-900">
                          {result.contact}
                        </p>
                      ) : (
                        <p
                          className={`text-[16px] font-bold leading-snug tracking-tight ${result.customer ? 'text-zinc-900' : 'text-zinc-400'}`}
                        >
                          {result.customer || '—'}
                        </p>
                      )}
                      {result.contact &&
                      result.customer &&
                      result.contact.trim().toLowerCase() !==
                        result.customer.trim().toLowerCase() ? (
                        <p className="mt-0.5 text-[13px] font-medium leading-snug text-zinc-500">
                          {result.customer}
                        </p>
                      ) : null}
                      {(result.location || result.crop || result.product) && (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {result.location ? (
                            <span className="inline-flex max-w-full items-center rounded-full border border-zinc-200/80 bg-zinc-50/90 px-2 py-0.5 text-[11px] font-medium text-zinc-600">
                              📍 {result.location}
                            </span>
                          ) : null}
                          {result.crop ? (
                            <span className="inline-flex max-w-full items-center rounded-full border border-zinc-200/80 bg-zinc-50/90 px-2 py-0.5 text-[11px] font-medium text-zinc-600">
                              🌱 {result.crop}
                            </span>
                          ) : null}
                          {(result.product || '').trim() ? (
                            <span className="inline-flex max-w-full min-w-0 items-center rounded-full border border-zinc-200/80 bg-zinc-50/90 px-2 py-0.5 text-[11px] font-medium text-zinc-600">
                              🧪 {(result.product || '').trim()}
                            </span>
                          ) : null}
                        </div>
                      )}
                    </div>
                  )}

                  {result.crmFull.length > 0 && (
                    <div className="rounded-2xl border border-zinc-200/40 bg-white px-3 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.02),0_1px_8px_rgba(0,0,0,0.02)]">
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500/90">
                        Key insights
                      </p>
                      <KeyInsightsList
                        lines={result.crmFull}
                        gapClass="gap-1.5"
                        lineClassName="rounded-lg px-2 py-1.5 text-[12px] font-medium leading-[1.5] tracking-tight"
                        expanded={resultInsightsExpanded}
                        onToggle={() => setResultInsightsExpanded((e) => !e)}
                        buttonMarginClass="mt-2"
                        buttonTextClass="text-[11px]"
                      />
                    </div>
                  )}

                  {result.summary && (
                    <div className="rounded-xl border border-zinc-100/85 bg-zinc-50/30 px-3 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                      <button
                        type="button"
                        onClick={() => setResultSummaryExpanded((e) => !e)}
                        className="text-[12px] font-medium text-zinc-500/90 transition-colors hover:text-zinc-700"
                      >
                        {resultSummaryExpanded ? 'Hide summary' : 'View summary'}
                      </button>
                      <div
                        className={`grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${resultSummaryExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
                      >
                        <div className="min-h-0 overflow-hidden">
                          <div
                            className={`origin-top pt-3 transition-all duration-300 ease-out ${resultSummaryExpanded ? 'translate-y-0 opacity-100' : '-translate-y-1 opacity-0'}`}
                            style={{ pointerEvents: resultSummaryExpanded ? 'auto' : 'none' }}
                          >
                            <p className="whitespace-pre-line text-[12px] font-normal leading-relaxed text-zinc-500/85">
                              {result.summary}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Copy / Share / Correct — inline, directly under content */}
                  <div className="flex items-center gap-2 border-t border-zinc-100/90 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (navigator.vibrate) navigator.vibrate(5)
                        handleCopy()
                      }}
                      className="flex h-10 min-w-0 flex-1 items-center justify-center gap-1 rounded-xl border border-zinc-200/90 bg-white text-[11px] font-medium text-zinc-500 transition-all hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-700 active:scale-[0.98]"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 opacity-50">
                        <rect x="9" y="9" width="13" height="13" rx="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                      {copied ? 'Copied' : 'Copy CRM'}
                    </button>
                    <button
                      type="button"
                      onClick={() => result && handleShare(result)}
                      className="flex h-10 w-11 shrink-0 items-center justify-center rounded-xl border border-zinc-200/90 bg-white text-zinc-500 transition-all hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-600 active:scale-[0.98]"
                      aria-label="Share"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="opacity-60">
                        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
                        <polyline points="16 6 12 2 8 6" />
                        <line x1="12" y1="2" x2="12" y2="15" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      disabled={savedNotes.length === 0}
                      onClick={() => {
                        const latest = savedNotes[0]
                        if (!latest) return
                        if (isCorrectingRecording) stopCorrectionRecording()
                        else startCorrectionRecording(latest.id, latest.transcript)
                      }}
                      className={`flex h-10 w-11 shrink-0 items-center justify-center rounded-xl border text-white transition-all active:scale-[0.98] shadow-[0_2px_8px_rgba(217,119,6,0.18)] ${
                        savedNotes.length === 0
                          ? 'cursor-not-allowed border-amber-100/80 bg-amber-400/35 opacity-50'
                          : 'border-amber-200/60 bg-amber-600/90 hover:bg-amber-600 active:bg-amber-700'
                      }`}
                      aria-label="Correct"
                    >
                      {isCorrectingRecording ? (
                        <span className="flex items-center gap-0.5 text-white">
                          <span className="text-[9px] tabular-nums">
                            {String(Math.floor(correctingSeconds / 60)).padStart(2, '0')}:
                            {String(correctingSeconds % 60).padStart(2, '0')}
                          </span>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="white">
                            <rect x="3" y="3" width="18" height="18" rx="2" />
                          </svg>
                        </span>
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── HISTORY TAB ── */}
        {activeTab === 'history' && (
          <div className="pt-2">
            {selectedNote ? (
              <div>
                <button
                  onClick={() => setSelectedNote(null)}
                  className="mb-4 flex items-center gap-2 text-[13px] text-zinc-400 hover:text-zinc-700"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M15 18l-6-6 6-6"/>
                  </svg>
                  Back to history
                </button>

                <div className="space-y-5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">{formatDate(selectedNote.date)}</p>

                  <div className="rounded-2xl border border-zinc-100 bg-white px-4 py-4 shadow-sm">
                    <div className="flex items-center gap-3.5">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[13px] font-bold text-zinc-700">
                        {selectedNote.result.contact ? getInitials(selectedNote.result.contact) : 'NA'}
                      </div>
                      <div>
                        <p className="text-[20px] font-bold text-zinc-900">{selectedNote.result.contact || '—'}</p>
                        {selectedNote.result.customer && (
                          <p className="text-[13px] text-zinc-400 mt-0.5">{selectedNote.result.customer}</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {(selectedNote.result.location || selectedNote.result.crop || selectedNote.result.product) && (
                    <div className="flex flex-wrap gap-1.5">
                      {selectedNote.result.location && (
                        <span className="flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-[11px] text-zinc-500 shadow-sm">
                          📍 {selectedNote.result.location}
                        </span>
                      )}
                      {selectedNote.result.crop && (
                        <span className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-[11px] text-zinc-500 shadow-sm">
                          🌱 {selectedNote.result.crop}
                        </span>
                      )}
                      {(selectedNote.result.product || '').trim() ? (
                        <span className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-[11px] text-zinc-500 shadow-sm">
                          🧪 {(selectedNote.result.product || '').trim()}
                        </span>
                      ) : null}
                    </div>
                  )}

                  {selectedNote.result.crmFull.length > 0 && (
                    <div className="rounded-2xl border border-zinc-200/40 bg-white px-4 py-4 shadow-[0_1px_2px_rgba(0,0,0,0.02),0_1px_8px_rgba(0,0,0,0.02)]">
                      <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500/90">
                        Key insights
                      </p>
                      <KeyInsightsList
                        lines={selectedNote.result.crmFull}
                        gapClass="gap-4"
                        lineClassName="rounded-lg px-3 py-2.5 text-[15px] font-medium leading-[1.65] tracking-tight"
                        expanded={historyInsightsExpanded}
                        onToggle={() => setHistoryInsightsExpanded((e) => !e)}
                        buttonMarginClass="mt-3"
                        buttonTextClass="text-[12px]"
                      />
                    </div>
                  )}

                  {selectedNote.result.summary && (
                    <div className="rounded-xl border border-zinc-100/85 bg-zinc-50/30 px-3.5 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                      <button
                        type="button"
                        onClick={() => setHistorySummaryExpanded((e) => !e)}
                        className="text-[12px] font-medium text-zinc-500/90 transition-colors hover:text-zinc-700"
                      >
                        {historySummaryExpanded ? 'Hide summary' : 'View summary'}
                      </button>
                      <div
                        className={`grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${historySummaryExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
                      >
                        <div className="min-h-0 overflow-hidden">
                          <div
                            className={`origin-top pt-3 transition-all duration-300 ease-out ${historySummaryExpanded ? 'translate-y-0 opacity-100' : '-translate-y-1 opacity-0'}`}
                            style={{ pointerEvents: historySummaryExpanded ? 'auto' : 'none' }}
                          >
                            <p className="whitespace-pre-line text-[12px] font-normal leading-relaxed text-zinc-500/85">
                              {selectedNote.result.summary}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {(selectedNote.result.nextStep || selectedNote.result.nextStepTitle) && (
                    <div className="rounded-2xl px-4 py-4" style={{backgroundColor: '#f0f7f2', border: '1px solid #c8e6d0'}}>
                      <div className="mb-2 flex items-center gap-2">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="#1a4d2e">
                          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                        </svg>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{color: '#1a4d2e'}}>Next step</p>
                      </div>
                      <p className="text-[19px] font-bold leading-snug" style={{color: '#1a4d2e'}}>
                        {selectedNote.result.nextStepTitle || selectedNote.result.nextStep}
                      </p>
                    </div>
                  )}

                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={handleCopy}
                      className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white py-3.5 text-[13px] font-medium text-zinc-500 shadow-sm transition-all hover:text-zinc-800 active:scale-[0.98]"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="9" y="9" width="13" height="13" rx="2"/>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                      </svg>
                      {copied ? 'Copied!' : 'Copy for CRM'}
                    </button>
                    <button
                      onClick={() => handleShare(selectedNote.result)}
                      className="flex items-center justify-center gap-1.5 rounded-2xl border border-zinc-200 bg-white px-3.5 py-3.5 text-zinc-500 shadow-sm transition-all active:scale-[0.98]"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>
                      </svg>
                    </button>
                    <button
                      onClick={() => deleteNote(selectedNote.id)}
                      className="rounded-2xl border border-red-200 bg-red-50 px-4 text-[13px] text-red-500 transition-all hover:bg-red-100 active:scale-[0.98]"
                    >
                      Delete
                    </button>
                  </div>
                  {/* Correct button in history */}
                  <button
                    onClick={() => {
                      if (isCorrectingRecording) {
                        stopCorrectionRecording()
                      } else {
                        startCorrectionRecording(selectedNote.id, selectedNote.transcript)
                      }
                    }}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-[13px] font-semibold text-white transition-all active:scale-[0.98]"
                    style={{backgroundColor: isCorrectingRecording ? '#dc2626' : '#d97706'}}
                  >
                    {isCorrectingRecording ? (
                      <span className="flex items-center gap-2">
                        <span className="text-[11px] tabular-nums">{String(Math.floor(correctingSeconds/60)).padStart(2,'0')}:{String(correctingSeconds%60).padStart(2,'0')}</span>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="white">
                          <rect x="3" y="3" width="18" height="18" rx="2"/>
                        </svg>
                      </span>
                    ) : (
                      <>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                        Correct with voice
                      </>
                    )}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                {/* Search bar */}
                <div className="relative mb-4">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400">
                    <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
                  </svg>
                  <input
                    type="text"
                    placeholder="Search notes..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full rounded-2xl border border-zinc-200 bg-white py-3 pl-9 pr-4 text-[14px] text-zinc-700 outline-none shadow-sm placeholder:text-zinc-400"
                  />
                </div>
                <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
                  {savedNotes.length} {savedNotes.length === 1 ? 'note' : 'notes'} saved
                </p>
                {savedNotes.length === 0 ? (
                  <div className="flex flex-col items-center justify-center pt-16 text-center">
                    <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full" style={{backgroundColor: '#f0f7f2'}}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#1a4d2e" strokeWidth="1.5" opacity="0.5">
                        <path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="10"/>
                      </svg>
                    </div>
                    <p className="text-[14px] text-zinc-400">No notes yet</p>
                    <p className="mt-1 text-[12px] text-zinc-300">Record your first visit to get started</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {savedNotes.filter((note) => {
                      if (!searchQuery.trim()) return true
                      const q = searchQuery.toLowerCase()
                      return (
                        note.result.contact?.toLowerCase().includes(q) ||
                        note.result.customer?.toLowerCase().includes(q) ||
                        note.result.product?.toLowerCase().includes(q) ||
                        note.result.location?.toLowerCase().includes(q) ||
                        note.result.nextStep?.toLowerCase().includes(q) ||
                        note.result.nextStepTitle?.toLowerCase().includes(q) ||
                        note.result.crmFull.some((line) => line.toLowerCase().includes(q))
                      )
                    }).map((note) => (
                      <button
                        key={note.id}
                        onClick={() => setSelectedNote(note)}
                        className="w-full rounded-2xl border border-zinc-100 bg-white px-4 py-3.5 text-left shadow-sm transition-all hover:border-zinc-200 active:scale-[0.99]"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[11px] font-bold text-zinc-700">
                              {note.result.contact ? getInitials(note.result.contact) : 'NA'}
                            </div>
                            <div className="min-w-0">
                              <p className="text-[14px] font-semibold text-zinc-900 truncate">
                                {note.result.contact || note.result.customer || 'Unnamed'}
                              </p>
                              {note.result.customer && note.result.contact && (
                                <p className="text-[12px] text-zinc-400 truncate">{note.result.customer}</p>
                              )}
                            </div>
                          </div>
                          <p className="shrink-0 text-[11px] text-zinc-400 mt-0.5">{formatDate(note.date)}</p>
                        </div>
                        {(note.result.nextStep || note.result.nextStepTitle) && (
                          <p className="mt-2 text-[12px] truncate pl-12" style={{color: '#1a4d2e'}}>
                            → {note.result.nextStepTitle || note.result.nextStep}
                          </p>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── SETTINGS TAB ── */}
        {activeTab === 'settings' && (
          <div className="pt-2 space-y-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-400">Account</p>
            <div className="rounded-2xl border border-zinc-100 bg-white px-4 py-4 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full text-[13px] font-bold text-white" style={{backgroundColor: '#1a4d2e'}}>IG</div>
                <div>
                  <p className="text-[14px] font-semibold text-zinc-900">Ignacio</p>
                  <p className="text-[12px] text-zinc-400">Personal use</p>
                </div>
              </div>
            </div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-400">Data</p>
            <button
              onClick={() => {
                if (confirm('Delete all saved notes?')) {
                  setSavedNotes([])
                  localStorage.removeItem('fieldbrief-notes')
                }
              }}
              className="w-full rounded-2xl border border-red-200 bg-red-50 py-3.5 text-[13px] font-medium text-red-500 transition-all hover:bg-red-100"
            >
              Clear all notes
            </button>
          </div>
        )}

      </div>

      {/* ── BOTTOM NAV ── */}
      <nav className="fixed bottom-0 left-0 right-0 flex items-center justify-around border-t border-zinc-100 bg-white/95 px-2 pb-safe pt-2 backdrop-blur-md">
        <NavBtn
          active={activeTab === 'record'}
          onClick={() => { setActiveTab('record'); setSelectedNote(null) }}
          label="Record"
          activeColor="#1a4d2e"
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4z"/>
              <path d="M19 10a1 1 0 0 0-2 0 5 5 0 0 1-10 0 1 1 0 0 0-2 0 7 7 0 0 0 6 6.92V19H9a1 1 0 0 0 0 2h6a1 1 0 0 0 0-2h-2v-2.08A7 7 0 0 0 19 10z"/>
            </svg>
          }
        />
        <NavBtn
          active={activeTab === 'history'}
          onClick={() => { setActiveTab('history'); setSelectedNote(null) }}
          label="History"
          badge={savedNotes.length}
          activeColor="#1a4d2e"
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="10"/>
            </svg>
          }
        />
        <NavBtn
          active={activeTab === 'settings'}
          onClick={() => setActiveTab('settings')}
          label="Settings"
          activeColor="#1a4d2e"
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          }
        />
      </nav>

      <style jsx global>{`
        @keyframes processingOverlayIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes processingRingSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes noteSavedToast {
          0% { opacity: 0; }
          11% { opacity: 1; }
          84% { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes pulse-bar {
          from { height: 2px; opacity: 0.32; }
          to   { height: 12px; opacity: 0.62; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes calendarEventToast {
          0% { opacity: 0; }
          11% { opacity: 1; }
          84% { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes mic-ring-pulse {
          0%, 100% { opacity: 0.55; }
          50% { opacity: 0.88; }
        }
        @keyframes recording-timer-breathe {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.006); }
        }
        @keyframes mic-idle-glow {
          0%, 100% { box-shadow: 0 0 0 0 rgba(26, 77, 46, 0); opacity: 1; }
          50% { box-shadow: 0 0 28px 4px rgba(26, 77, 46, 0.14); opacity: 1; }
        }
        .pb-safe { padding-bottom: env(safe-area-inset-bottom, 12px); }
      `}</style>
    </main>
  )
}

function NavBtn({
  active, onClick, label, icon, badge, activeColor
}: {
  active: boolean
  onClick: () => void
  label: string
  icon: React.ReactNode
  badge?: number
  activeColor: string
}) {
  return (
    <button
      onClick={onClick}
      className="relative flex flex-col items-center gap-1 px-5 py-2 transition-all"
      style={{color: active ? activeColor : '#a1a1aa'}}
    >
      <span>{icon}</span>
      <span className="text-[10px] font-medium">{label}</span>
      {badge && badge > 0 ? (
        <span className="absolute right-3 top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[9px] font-bold text-white" style={{backgroundColor: activeColor}}>
          {badge}
        </span>
      ) : null}
    </button>
  )
}
