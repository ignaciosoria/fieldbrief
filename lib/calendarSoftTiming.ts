/**
 * Soft follow-up labels (no fixed calendar date until user adds to calendar).
 */

export type SoftFollowUpTiming = 'this_week' | 'next_week' | 'in_2_weeks'

export function isSoftFollowUpTiming(s: string): s is SoftFollowUpTiming {
  return s === 'this_week' || s === 'next_week' || s === 'in_2_weeks'
}

/** Normalize model / API strings to canonical keys. */
export function normalizeSoftFollowUpTiming(raw: unknown): SoftFollowUpTiming | '' {
  const t = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
  if (t === 'this_week' || t === 'thisweek') return 'this_week'
  if (t === 'next_week' || t === 'nextweek') return 'next_week'
  if (t === 'in_2_weeks' || t === 'in_2weeks' || t === 'two_weeks' || t === '2_weeks') {
    return 'in_2_weeks'
  }
  return ''
}

function pad2(n: number) {
  return n.toString().padStart(2, '0')
}

export function formatLocalMmDdYyyy(d: Date): string {
  const mm = pad2(d.getMonth() + 1)
  const dd = pad2(d.getDate())
  return `${mm}/${dd}/${d.getFullYear()}`
}

/**
 * Next Mon–Fri day after `from` (skips weekends). If `from` is Fri, returns next Monday.
 */
export function nextWeekdayMmdd(from: Date = new Date()): string {
  const d = new Date(from)
  d.setHours(0, 0, 0, 0)
  for (let add = 1; add <= 14; add++) {
    const t = new Date(d)
    t.setDate(d.getDate() + add)
    const day = t.getDay()
    if (day !== 0 && day !== 6) return formatLocalMmDdYyyy(t)
  }
  return formatLocalMmDdYyyy(d)
}

/** Next Thursday or Friday on or after `from` (0 = today). */
export function resolveThisWeekThuOrFriMmdd(from: Date = new Date()): string {
  const d = new Date(from)
  d.setHours(0, 0, 0, 0)
  for (let add = 0; add < 14; add++) {
    const t = new Date(d)
    t.setDate(d.getDate() + add)
    const day = t.getDay()
    if (day === 4 || day === 5) return formatLocalMmDdYyyy(t)
  }
  return nextWeekdayMmdd(from)
}

/** Monday that starts the calendar week after the current one (weeks start Monday). */
export function nextWeekMondayMmdd(from: Date = new Date()): string {
  const d = new Date(from)
  const day = d.getDay()
  const daysSinceMonday = day === 0 ? 6 : day - 1
  const monday = new Date(d)
  monday.setDate(d.getDate() - daysSinceMonday)
  monday.setDate(monday.getDate() + 7)
  return formatLocalMmDdYyyy(monday)
}

/** Monday of the week two weeks after the upcoming “next week” Monday. */
export function inTwoWeeksMondayMmdd(from: Date = new Date()): string {
  const nextMon = nextWeekMondayMmdd(from)
  const [mm, dd, y] = nextMon.split('/').map((x) => parseInt(x, 10))
  const t = new Date(y, mm - 1, dd)
  t.setDate(t.getDate() + 7)
  return formatLocalMmDdYyyy(t)
}

export function resolveSoftFollowUpToMmdd(soft: SoftFollowUpTiming, from: Date = new Date()): string {
  switch (soft) {
    case 'this_week':
      return resolveThisWeekThuOrFriMmdd(from)
    case 'next_week':
      return nextWeekMondayMmdd(from)
    case 'in_2_weeks':
      return inTwoWeeksMondayMmdd(from)
    default:
      return nextWeekdayMmdd(from)
  }
}

/** How strong the follow-up opportunity is (primary.type = follow_up only). */
export type FollowUpStrength = 'soft' | 'medium' | 'hard'

export function normalizeFollowUpStrength(raw: unknown): FollowUpStrength | '' {
  const t = String(raw ?? '')
    .trim()
    .toLowerCase()
  if (t === 'soft' || t === 'medium' || t === 'hard') return t
  return ''
}

/**
 * Conservative default when the model omits strength — not medium (per product rules).
 */
export function resolveFollowUpStrengthWithDefault(raw: unknown): FollowUpStrength {
  return normalizeFollowUpStrength(raw) || 'soft'
}

/**
 * Combine model soft_timing with strength bands. Strength constrains suggested window.
 * - hard → always this_week
 * - medium → this_week or next_week (keep model if in band, else this_week)
 * - soft → next_week or in_2_weeks (downgrade this_week to next_week)
 */
export function clampSoftTimingToStrength(
  strength: FollowUpStrength,
  proposed: SoftFollowUpTiming | '',
): SoftFollowUpTiming {
  if (strength === 'hard') {
    return 'this_week'
  }
  if (strength === 'medium') {
    if (proposed === 'this_week' || proposed === 'next_week') return proposed
    return 'this_week'
  }
  if (proposed === 'next_week' || proposed === 'in_2_weeks') return proposed
  if (proposed === 'this_week') return 'next_week'
  return 'next_week'
}

export function softFollowUpLabel(soft: SoftFollowUpTiming, spanish: boolean): string {
  if (spanish) {
    switch (soft) {
      case 'this_week':
        return 'esta semana'
      case 'next_week':
        return 'la próxima semana'
      case 'in_2_weeks':
        return 'en 2 semanas'
      default:
        return ''
    }
  }
  switch (soft) {
    case 'this_week':
      return 'this week'
    case 'next_week':
      return 'next week'
    case 'in_2_weeks':
      return 'in 2 weeks'
    default:
      return ''
  }
}
