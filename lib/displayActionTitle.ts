import { cleanCalendarTitle } from './calendarTitle'
import {
  isSoftFollowUpTiming,
  softFollowUpLabel,
  type SoftFollowUpTiming,
} from './calendarSoftTiming'

function pad2(n: number) {
  return n.toString().padStart(2, '0')
}

/** Same wall-clock resolution as app calendar (`app/page.tsx` `resolveTimeFromHint`). */
function resolveTimeFromHint(hint: string): { hour: number; minute: number } {
  const value = (hint || '').toLowerCase().trim()
  if (value === 'morning') return { hour: 9, minute: 0 }
  if (value === 'afternoon') return { hour: 15, minute: 0 }
  if (value === 'evening') return { hour: 18, minute: 0 }
  if (value === 'first thing') return { hour: 8, minute: 0 }
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

/** UI display only — does not affect calendar payloads. */
function formatRelativeDayWordsForDisplay(s: string): string {
  return s.replace(/\btoday\b/gi, 'Today').replace(/\btomorrow\b/gi, 'Tomorrow')
}

function relativeDayLabelFromMmdd(mmdd: string): string {
  const t = (mmdd || '').trim()
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(t)) return t
  const [mm, dd, y] = t.split('/').map((x) => parseInt(x, 10))
  if ([mm, dd, y].some((n) => Number.isNaN(n))) return t
  const d = new Date(y, mm - 1, dd)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  d.setHours(0, 0, 0, 0)
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  return t
}

function formatDisplayDateLabelForPrimary(mmdd: string): string {
  const rel = relativeDayLabelFromMmdd(mmdd)
  if (rel === 'Today' || rel === 'Tomorrow') return rel
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(mmdd)) {
    const [m, d, y] = mmdd.split('/').map((x) => parseInt(x, 10))
    const dt = new Date(y, m - 1, d)
    return dt.toLocaleDateString('en-US', { weekday: 'long' })
  }
  return rel
}

function formatClock12FromHint(hint: string): string {
  const { hour, minute } = resolveTimeFromHint(hint)
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  const ap = hour >= 12 ? 'PM' : 'AM'
  return `${h12}:${pad2(minute)} ${ap}`
}

export type PrimaryDisplayTitleInput = {
  nextStep: string
  nextStepTitle: string
  nextStepDate: string
  nextStepTimeHint: string
  /** follow_up soft window (no fixed MM/DD until calendar). */
  nextStepSoftTiming?: string
  /** When true, use Spanish labels for soft timing. */
  langEs?: boolean
}

/**
 * APP only — includes when the action happens. Calendar SUMMARY uses `cleanCalendarTitle(nextStepTitle)` without this suffix.
 * Example: `Call John — GreenFields (Monday · 9:00 AM)`
 */
export function buildPrimaryDisplayTitle(r: PrimaryDisplayTitleInput): string {
  const raw = (r.nextStepTitle || r.nextStep || '').trim()
  const base = cleanCalendarTitle(raw)
  if (!base) return formatRelativeDayWordsForDisplay(raw)
  const mmdd = (r.nextStepDate || '').trim()
  const hint = (r.nextStepTimeHint || '').trim()
  const hasDate = /^\d{2}\/\d{2}\/\d{4}$/.test(mmdd)
  const softRaw = (r.nextStepSoftTiming || '').trim()
  if (!hasDate && isSoftFollowUpTiming(softRaw)) {
    const label = softFollowUpLabel(softRaw as SoftFollowUpTiming, !!r.langEs)
    const em = '\u2014'
    return formatRelativeDayWordsForDisplay(
      label ? `${base} ${em} ${label}` : base,
    )
  }
  if (!hasDate && !hint) return formatRelativeDayWordsForDisplay(base)

  const dateLabel = hasDate ? formatDisplayDateLabelForPrimary(mmdd) : ''
  const timeLabel = hint ? formatClock12FromHint(hint) : ''
  const inner = [dateLabel, timeLabel].filter(Boolean).join(' · ')
  if (!inner) return formatRelativeDayWordsForDisplay(base)
  return formatRelativeDayWordsForDisplay(`${base} (${inner})`)
}

export type SupportingDisplayTitleInput = {
  action: string
  resolvedDate: string
  timeHint: string
}

/**
 * APP only — same pattern as `buildPrimaryDisplayTitle`: base action line, then timing in parentheses.
 * Example: `Send contract — GreenFields (Today · 4:00 PM)`
 */
export function buildSupportingDisplayTitle(step: SupportingDisplayTitleInput): string {
  const raw = (step.action || '').trim()
  if (!raw) return ''
  const base = cleanCalendarTitle(raw)
  if (!base) return formatRelativeDayWordsForDisplay(raw)

  const dateRaw = (step.resolvedDate || '').trim()
  const hint = (step.timeHint || '').trim()
  const hasMmdd = /^\d{2}\/\d{2}\/\d{4}$/.test(dateRaw)
  if (!hasMmdd && !dateRaw && !hint) return formatRelativeDayWordsForDisplay(base)

  const dateLabel = hasMmdd
    ? formatDisplayDateLabelForPrimary(dateRaw)
    : dateRaw
      ? formatRelativeDayWordsForDisplay(dateRaw)
      : ''
  const timeLabel = hint ? formatClock12FromHint(hint) : ''
  const inner = [dateLabel, timeLabel].filter(Boolean).join(' · ')
  if (!inner) return formatRelativeDayWordsForDisplay(base)
  return formatRelativeDayWordsForDisplay(`${base} (${inner})`)
}
