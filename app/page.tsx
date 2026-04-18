'use client'

import { initPosthog } from '../lib/posthog'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { signIn, signOut, useSession } from 'next-auth/react'
import {
  logNotesTableRlsAssumptions,
  logPostgrestError,
} from '../lib/saveNoteSupabaseDebug'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { resolveContactCompany } from '../lib/contactAffiliation'
import { dedupeConsecutiveRepeatedWords, mergeActionTargetAvoidOverlap } from '../lib/stringDedupe'
import { stripExecutionBlocksFromCrmNarrative } from '../lib/crmNarrativeSanitize'
import {
  stripDealerClosingFromCrmText,
  stripDealerLinesFromCrmFull,
} from '../lib/dealerField'
import { normalizeProductField, productFieldToList } from '../lib/productField'
import { formatProfessionalCrmNote } from '../lib/formatCrmSalesNote'
import { isNoClearFollowUpResult } from '../lib/noFollowUp'
import { cleanCalendarTitle } from '../lib/calendarTitle'
import { detectNoteLanguage } from '../lib/detectNoteLanguage'
import {
  mergePromotedInsightsIntoCrmFull,
  sanitizeAdditionalSteps,
} from '../lib/sanitizeAdditionalSteps'
import { buildPrimaryBaseTitle, type ActionStructuredFields } from '../lib/actionTitleContract'
import { supportingStructuredActionLine } from '../lib/structuredAiMapper'
import {
  buildCalendarContext,
  formatForCalendar,
  type CalendarFormatActionKind,
  type CommercialContextFields,
} from '../lib/calendarDescriptionFormat'
import {
  clampSoftTimingToStrength,
  isSoftFollowUpTiming,
  normalizeSoftFollowUpTiming,
  nextWeekdayMmdd,
  resolveFollowUpStrengthWithDefault,
  resolveSoftFollowUpToMmdd,
} from '../lib/calendarSoftTiming'
import { buildPrimaryDisplayTitle, buildSupportingDisplayTitle } from '../lib/displayActionTitle'
import { filterInsightsToContextOnly, normalizePendingInsightTense } from '../lib/filterInsightLines'
import { buildCalendarEventDescriptionBody } from '../lib/calendarEventDescription'
import {
  isWakeLockHeld,
  releaseWakeLock,
  requestWakeLock,
  subscribeWakeLockReleased,
} from '../lib/recordingWakeLock'

/**
 * Merge legacy `crop` + `product` for one Product row (📦 pills).
 * Values come from API `product`; structure prompt restricts this to the rep's offerings (competitors → ⚔️ in crmFull only).
 */
function productDisplayItems(crop: string, productCsv: string): string[] {
  const parts = productFieldToList(productCsv)
  const c = (crop || '').trim()
  if (!c) return parts
  if (parts.some((p) => p.toLowerCase() === c.toLowerCase())) return parts
  return [c, ...parts]
}

function normalizeLegacyInsightLine(line: string): string {
  return line
    .replace(/^(\s*)🌱/u, '$1📦')
    .replace(/^(\s*)🌾/u, '$1📊')
}

/** Result screen: hide date/schedule insight lines — timing belongs in next step / calendar export. */
function filterKeyInsightsForDisplay(lines: string[]): string[] {
  return lines
    .map(normalizeLegacyInsightLine)
    .filter((line) => !line.trimStart().startsWith('📅'))
}

import { FolupHeaderBrand, FolupLogo } from '../components/folup-branding'

type MentionedEntity = { name: string; type: string }

type SupportingStructuredType = 'send' | 'email' | 'call' | 'other'

type AdditionalStep = {
  action: string
  contact: string
  company: string
  resolvedDate: string
  timeHint: string
  supportingType?: SupportingStructuredType
  label?: string
  structuredDate?: string
  structuredTime?: string
  actionStructured?: ActionStructuredFields
}

/** Backend-built list (Phase 1); primary/supporting decided server-side. */
type NormalizedActionType =
  | 'call'
  | 'follow_up'
  | 'meeting'
  | 'send'
  | 'email'
  | 'other'

type NormalizedAction = {
  action: string
  type: NormalizedActionType
  date: string
  time: string
  primary: boolean
  object?: string
}

type StructureResult = {
  customer: string
  contact: string
  /** Employer / org of the direct contact (not the same field as customer). */
  contactCompany: string
  summary: string
  nextStep: string
  nextStepTitle: string
  nextStepAction: string
  nextStepTarget: string
  nextStepDate: string
  /** Soft follow-up window when primary is follow_up with no fixed MM/DD (this_week | next_week | in_2_weeks). */
  nextStepSoftTiming: string
  /** follow_up only: soft | medium | hard */
  followUpStrength: string
  /** Natural-language timing from the note; server resolves to nextStepDate using client timezone. */
  nextStepTimeReference: string
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
  /** API field; used when building calendar event body (not shown as its own screen section). */
  calendarDescription: string
  /** Structured lines for deterministic calendar context (from structure API); absent on legacy notes. */
  commercialContext?: CommercialContextFields
  additionalSteps: AdditionalStep[]
  /** Ordered actions with backend-assigned primary; mirrors API `actions`. */
  actions: NormalizedAction[]
  primaryActionStructured?: ActionStructuredFields
}

const emptyResult: StructureResult = {
  customer: '',
  contact: '',
  contactCompany: '',
  summary: '',
  nextStep: '',
  nextStepTitle: '',
  nextStepAction: '',
  nextStepTarget: '',
  nextStepDate: '',
  nextStepSoftTiming: '',
  followUpStrength: '',
  nextStepTimeReference: '',
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
  calendarDescription: '',
  additionalSteps: [],
  actions: [],
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

const VALID_NORMALIZED_ACTION_TYPES = new Set<NormalizedActionType>([
  'call',
  'follow_up',
  'meeting',
  'send',
  'email',
  'other',
])

function normalizeActions(raw: unknown): NormalizedAction[] {
  if (!Array.isArray(raw)) return []
  const out: NormalizedAction[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const action = typeof o.action === 'string' ? o.action.trim() : ''
    if (!action) continue
    const t = o.type
    const type =
      typeof t === 'string' && VALID_NORMALIZED_ACTION_TYPES.has(t as NormalizedActionType)
        ? (t as NormalizedActionType)
        : 'other'
    const objectRaw = o.object
    const object =
      typeof objectRaw === 'string' && objectRaw.trim() ? objectRaw.trim() : undefined
    out.push({
      action,
      type,
      date: typeof o.date === 'string' ? o.date.trim() : '',
      time: typeof o.time === 'string' ? o.time.trim() : '',
      primary: o.primary === true,
      ...(object ? { object } : {}),
    })
  }
  return out
}

function normalizeAdditionalSteps(raw: unknown): AdditionalStep[] {
  if (!Array.isArray(raw)) return []
  const out: AdditionalStep[] = []
  for (const item of raw) {
    if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>
      const action = typeof o.action === 'string' ? o.action.trim() : ''
      if (!action) continue
      const rd =
        typeof o.resolvedDate === 'string'
          ? o.resolvedDate.trim()
          : typeof o.date === 'string'
            ? o.date.trim()
            : ''
      const th =
        typeof o.timeHint === 'string'
          ? o.timeHint.trim()
          : typeof o.time === 'string'
            ? o.time.trim()
            : ''
      const stRaw = typeof o.supportingType === 'string' ? o.supportingType.trim().toLowerCase() : ''
      const supportingType: SupportingStructuredType | undefined =
        stRaw === 'send' || stRaw === 'email' || stRaw === 'call' || stRaw === 'other'
          ? stRaw
          : undefined
      const label = typeof o.label === 'string' ? o.label.trim() : ''
      const structuredDate = typeof o.structuredDate === 'string' ? o.structuredDate.trim() : ''
      const structuredTime = typeof o.structuredTime === 'string' ? o.structuredTime.trim() : ''
      const asRaw = o.actionStructured
      let actionStructured: ActionStructuredFields | undefined
      if (asRaw && typeof asRaw === 'object') {
        const a = asRaw as Record<string, unknown>
        actionStructured = {
          type: typeof a.type === 'string' ? a.type : '',
          verb: typeof a.verb === 'string' ? a.verb : '',
          object: typeof a.object === 'string' ? a.object : '',
          contact: typeof a.contact === 'string' ? a.contact : '',
          company: typeof a.company === 'string' ? a.company : '',
          date: typeof a.date === 'string' ? a.date : '',
          time: typeof a.time === 'string' ? a.time : '',
        }
      }
      out.push({
        action,
        contact: typeof o.contact === 'string' ? o.contact.trim() : '',
        company: typeof o.company === 'string' ? o.company.trim() : '',
        resolvedDate: rd,
        timeHint: th,
        ...(supportingType ? { supportingType } : {}),
        ...(label ? { label } : {}),
        ...(structuredDate ? { structuredDate } : {}),
        ...(structuredTime ? { structuredTime } : {}),
        ...(actionStructured ? { actionStructured } : {}),
      })
    }
  }
  return out
}

/** Full StructureResult snapshot for Supabase `structured_output` jsonb (single JSON blob, no flattened columns). */
function buildStructuredOutputForSupabase(res: StructureResult): StructureResult {
  return JSON.parse(JSON.stringify(res)) as StructureResult
}

/**
 * Build a StructureResult-shaped object from a notes row: prefer `structured_output`, else legacy flat columns.
 * Includes contact, company fields, actions, insights (crmFull), commercial_context, and all other structured fields.
 */
function rawStructureResultFromSupabaseRow(n: {
  structured_output?: unknown
  contact?: unknown
  contact_company?: unknown
  customer?: unknown
  summary?: unknown
  next_step?: unknown
  next_step_title?: unknown
  next_step_action?: unknown
  next_step_target?: unknown
  next_step_date?: unknown
  next_step_time_reference?: unknown
  next_step_time_hint?: unknown
  next_step_confidence?: unknown
  ambiguity_flags?: unknown
  mentioned_entities?: unknown
  notes?: unknown
  crop?: unknown
  product?: unknown
  location?: unknown
  acreage?: unknown
  crm_text?: unknown
  crm_full?: unknown
  calendar_description?: unknown
  next_step_soft_timing?: unknown
  follow_up_strength?: unknown
}): StructureResult {
  const so = n.structured_output
  if (so && typeof so === 'object' && !Array.isArray(so)) {
    const partial = so as Partial<StructureResult>
    return {
      ...emptyResult,
      ...partial,
      crmFull: normalizeCrmFull(partial.crmFull ?? []),
      actions: normalizeActions(partial.actions ?? []),
      additionalSteps: normalizeAdditionalSteps(partial.additionalSteps ?? []),
    }
  }
  return {
    ...emptyResult,
    contact: String(n.contact ?? ''),
    contactCompany: String(n.contact_company ?? ''),
    customer: String(n.customer ?? ''),
    summary: String(n.summary ?? ''),
    nextStep: String(n.next_step ?? ''),
    nextStepTitle: String(n.next_step_title ?? ''),
    nextStepAction: String(n.next_step_action ?? ''),
    nextStepTarget: String(n.next_step_target ?? ''),
    nextStepDate: String(n.next_step_date ?? ''),
    nextStepTimeReference: String(n.next_step_time_reference ?? ''),
    nextStepTimeHint: String(n.next_step_time_hint ?? ''),
    nextStepConfidence: String(n.next_step_confidence ?? ''),
    ambiguityFlags: Array.isArray(n.ambiguity_flags)
      ? (n.ambiguity_flags as unknown[]).filter((x): x is string => typeof x === 'string')
      : [],
    mentionedEntities: normalizeMentionedEntities(n.mentioned_entities),
    notes: String(n.notes ?? ''),
    crop: String(n.crop ?? ''),
    product: String(n.product ?? ''),
    location: String(n.location ?? ''),
    acreage: String(n.acreage ?? ''),
    crmText: String(n.crm_text ?? ''),
    crmFull: normalizeCrmFull(n.crm_full),
    calendarDescription: String(n.calendar_description ?? ''),
    nextStepSoftTiming: String(n.next_step_soft_timing ?? ''),
    followUpStrength: String(n.follow_up_strength ?? ''),
  }
}

function normalizeConfidence(raw: unknown): string {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase()
  if (s === 'high' || s === 'medium' || s === 'low') return s
  return 'medium'
}

function capitalizeNextStepTitleFirst(s: string): string {
  const t = String(s ?? '').trim()
  if (!t) return ''
  return t.charAt(0).toUpperCase() + t.slice(1)
}

function formatLocalMmDdYyyy(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${mm}/${dd}/${d.getFullYear()}`
}

/**
 * Days to add to `from` (local) to reach the nearest `targetJsWeekday` (Sun=0 … Sat=6).
 * 0 = same calendar day when today is already that weekday — not +7.
 */
function getDaysUntilNearestWeekday(from: Date, targetJsWeekday: number): number {
  const today = from.getDay()
  return (targetJsWeekday - today + 7) % 7
}

function addDaysLocal(base: Date, days: number): Date {
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  return d
}

/** Next occurrence of `targetJsWeekday` for primary dates — never the anchor day when weekday matches. */
function getNextDayOfWeek(from: Date, targetJsWeekday: number): Date {
  let days = getDaysUntilNearestWeekday(from, targetJsWeekday)
  if (days === 0) days = 7
  return addDaysLocal(from, days)
}

function getClientTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles'
  } catch {
    return 'America/Los_Angeles'
  }
}

/** Instant at send time so the API anchors "today" / "tomorrow" / weekdays to the user's real clock. */
function getClientNowIso(): string {
  return new Date().toISOString()
}

function normalizeCommercialContext(raw: unknown): CommercialContextFields | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const problem = typeof o.problem === 'string' ? o.problem.trim() : ''
  const productInterest =
    typeof o.productInterest === 'string'
      ? o.productInterest.trim()
      : typeof o.product_interest === 'string'
        ? o.product_interest.trim()
        : ''
  const barrier = typeof o.barrier === 'string' ? o.barrier.trim() : ''
  if (!problem && !productInterest && !barrier) return undefined
  return { problem, productInterest, barrier }
}

function normalizeStructureResult(m: StructureResult): StructureResult {
  const { dealer: _legacyDealer, ...mRest } = m as StructureResult & {
    dealer?: string
    commercial_context?: unknown
  }
  const base = {
    ...emptyResult,
    ...mRest,
    crmFull: normalizeCrmFull(mRest.crmFull),
    ambiguityFlags: normalizeAmbiguityFlags(mRest.ambiguityFlags),
    mentionedEntities: normalizeMentionedEntities(mRest.mentionedEntities),
    nextStepConfidence: normalizeConfidence(mRest.nextStepConfidence),
  }
  const customer = dedupeConsecutiveRepeatedWords(base.customer)
  const contact = dedupeConsecutiveRepeatedWords(base.contact)
  const nextStepTarget = dedupeConsecutiveRepeatedWords(base.nextStepTarget)
  const productMerged = normalizeProductField(
    productDisplayItems(base.crop, normalizeProductField(base.product)).join(', '),
  )
  const noteLanguageHint = [base.nextStep, base.nextStepTitle, base.crmText].filter(Boolean).join('\n')
  const noteLang = detectNoteLanguage(noteLanguageHint.trim() || 'Note')
  const langEsInsights = noteLang === 'spanish'
  const sanitizeStepsResult = sanitizeAdditionalSteps(normalizeAdditionalSteps(base.additionalSteps), {
    noteLanguage: noteLang,
  })
  const crmFullMerged = mergePromotedInsightsIntoCrmFull(
    stripDealerLinesFromCrmFull(base.crmFull.map(normalizeLegacyInsightLine)),
    sanitizeStepsResult.promotedInsights,
  )
  const commercialContext = normalizeCommercialContext(
    (base as StructureResult & { commercial_context?: unknown }).commercialContext ??
      (base as StructureResult & { commercial_context?: unknown }).commercial_context,
  )
  return {
    ...base,
    customer,
    contact,
    nextStepTarget,
    product: productMerged,
    crop: '',
    crmFull: filterInsightsToContextOnly(
      crmFullMerged.map((l) => normalizePendingInsightTense(l, langEsInsights)),
    ).slice(0, 5),
    crmText: stripExecutionBlocksFromCrmNarrative(stripDealerClosingFromCrmText(base.crmText)),
    calendarDescription: (base.calendarDescription || '').trim(),
    ...(commercialContext !== undefined ? { commercialContext } : {}),
    nextStepTitle: dedupeConsecutiveRepeatedWords(capitalizeNextStepTitleFirst(base.nextStepTitle)),
    nextStep: dedupeConsecutiveRepeatedWords(base.nextStep),
    additionalSteps: sanitizeStepsResult.steps,
    mentionedEntities: base.mentionedEntities.map((e) => ({
      ...e,
      name: dedupeConsecutiveRepeatedWords(e.name),
    })),
    contactCompany: dedupeConsecutiveRepeatedWords(
      resolveContactCompany(
        customer,
        contact,
        nextStepTarget,
        base.contactCompany || '',
      ),
    ),
    nextStepTimeReference: (base.nextStepTimeReference || '').trim(),
    nextStepDate: (base.nextStepDate || '').trim(),
    nextStepSoftTiming: (base.nextStepSoftTiming || '').trim(),
    followUpStrength: (base.followUpStrength || '').trim(),
    actions: normalizeActions(base.actions),
  }
}

/** Structured calendar: derive wall-clock time from AI hint (no default when empty — use all-day). */
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

function pad2(n: number) {
  return n.toString().padStart(2, '0')
}

/**
 * If the resolved local date+time is already past, advance by whole weeks until it is
 * in the future (handles stale anchor dates, not only “+7 once”).
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
  let guard = 0
  while (event.getTime() < now.getTime() && guard < 365) {
    event.setDate(event.getDate() + 1)
    guard++
  }
  return {
    dateMmddyyyy: `${pad2(event.getMonth() + 1)}/${pad2(event.getDate())}/${event.getFullYear()}`,
    hour: event.getHours(),
    minute: event.getMinutes(),
  }
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

type CalendarTimeInput =
  | { kind: 'hint'; hint: string }
  | { kind: 'clock'; hour: number; minute: number }
  /** No specific clock — all-day event (date only). */
  | { kind: 'allday' }

type GoogleCalendarDateRange =
  | { kind: 'floating'; start: string; end: string }
  | { kind: 'allday'; start: string; end: string }

/** Build Google Calendar `dates` segment; 30-minute duration for timed events. Requires MM/DD/YYYY. */
function buildGoogleCalendarDateRangeParts(
  dateMmddyyyy: string,
  time: CalendarTimeInput,
): GoogleCalendarDateRange | null {
  const ds = dateMmddyyyy.trim()
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(ds)) return null

  if (time.kind === 'allday') {
    const bumped = ensureCalendarDateTimeNotPast(ds, 12, 0)
    const [mm, dd, yyyy] = bumped.dateMmddyyyy.split('/').map((x) => parseInt(x, 10))
    const y = String(yyyy).padStart(4, '0')
    const m = String(mm).padStart(2, '0')
    const d = String(dd).padStart(2, '0')
    const start = `${y}${m}${d}`
    const dt = new Date(yyyy, mm - 1, dd)
    dt.setDate(dt.getDate() + 1)
    const end = `${dt.getFullYear()}${pad2(dt.getMonth() + 1)}${pad2(dt.getDate())}`
    return { kind: 'allday', start, end }
  }

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
    kind: 'floating',
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

/**
 * Calendar export body: short plain paragraphs (see `buildCalendarEventDescriptionBody`).
 * Does not repeat the event title; timing lives on the event fields.
 */
function buildCalendarDescription(data: StructureResult): string {
  const eventTitle = calendarEventTitle(data)
  const exclude = [
    stripEmojisForCalendar((data.nextStep || '').trim()),
    stripEmojisForCalendar((data.nextStepTitle || '').trim()),
    stripEmojisForCalendar(eventTitle),
  ].filter(Boolean)

  // ✅ SAME path as supporting actions: derive from structured fields, not pre-written API string
  const langEs =
    detectNoteLanguage(
      `${data.crmText || ''} ${data.summary || ''} ${(data.crmFull || []).join('\n')} ${data.nextStep || ''} ${data.nextStepTitle || ''}`,
    ).toLowerCase() === 'spanish'
  const primaryActionType = data.primaryActionStructured?.type || data.nextStepAction || 'other'
  const kind: CalendarFormatActionKind =
    primaryActionType === 'send' || primaryActionType === 'email'
      ? 'send'
      : primaryActionType === 'call'
        ? 'call'
        : primaryActionType === 'follow_up'
          ? 'other'
          : 'other'

  const derivedDescription = formatForCalendar(kind, {
    contextParagraph: buildCalendarContext({
      contact: data.contact,
      company: data.contactCompany || data.customer,
      problem: data.commercialContext?.problem,
      productInterest: data.commercialContext?.productInterest,
      barrier: data.commercialContext?.barrier,
      langEs,
    }),
    langEs,
    deliverable: data.primaryActionStructured?.object || '',
    productInterest: data.commercialContext?.productInterest,
    productCsv: (data.product || '').trim(),
  })

  return buildCalendarEventDescriptionBody(
    {
      customer: data.customer,
      contact: data.contact,
      contactCompany: data.contactCompany,
      crop: data.crop,
      product: data.product,
      location: data.location,
      acreage: data.acreage,
      calendarDescription: derivedDescription, // ← CLEAN, STRUCTURED (same as supporting)
      crmText: data.crmText,
      crmFull: data.crmFull || [],
      notes: data.notes,
      summary: data.summary,
    },
    { eventTitle, excludeActionPhrases: exclude },
  )
}

/** Primary calendarTitle (event SUMMARY) — no date/time in string; timing is in event fields. */
function calendarEventTitle(r: StructureResult): string {
  const t = (r.nextStepTitle || '').trim()
  if (t) return cleanCalendarTitle(t)
  return cleanCalendarTitle((r.nextStep || '').trim())
}

/** Build event payload for Google Calendar URL or ICS — no modals; uses structured result as-is. */
function buildCalendarOpenOptsFromResult(r: StructureResult): CalendarOpenOpts {
  const title = calendarEventTitle(r)
  const mmddRaw = (r.nextStepDate || '').trim()
  let mmdd = mmddRaw
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(mmdd)) {
    const soft = (r.nextStepSoftTiming || '').trim()
    if (isSoftFollowUpTiming(soft)) {
      mmdd = resolveSoftFollowUpToMmdd(soft)
    } else {
      mmdd = isoDateToMmddyyyy(todayIsoDate())
    }
  }
  const mmddResolved = /^\d{2}\/\d{2}\/\d{4}$/.test(mmdd)
    ? mmdd
    : isoDateToMmddyyyy(todayIsoDate())
  const hintRaw = (r.nextStepTimeHint || '').trim()
  const details = buildCalendarDescription(r)
  const loc = stripEmojisForCalendar((r.location || '').trim())
  if (!hintRaw) {
    const adj = ensureCalendarDateTimeNotPast(mmddResolved, 9, 0)
    return {
      title,
      dateMmddyyyy: adj.dateMmddyyyy,
      details,
      time: { kind: 'clock', hour: adj.hour, minute: adj.minute },
      ...(loc ? { location: loc } : {}),
    }
  }
  const resolved = resolveTimeFromHint(hintRaw)
  const adj = ensureCalendarDateTimeNotPast(mmddResolved, resolved.hour, resolved.minute)
  return {
    title,
    dateMmddyyyy: adj.dateMmddyyyy,
    details,
    time: { kind: 'clock', hour: adj.hour, minute: adj.minute },
    ...(loc ? { location: loc } : {}),
  }
}

/** Supporting Google/ICS SUMMARY only — includes contact/company; not used for on-screen SUPPORTING titles. */
const SUPPORTING_CALENDAR_TITLE_MAX = 100

function truncateSupportingCalendarTitle(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim()
  if (t.length <= SUPPORTING_CALENDAR_TITLE_MAX) return t
  return `${t.slice(0, SUPPORTING_CALENDAR_TITLE_MAX - 1).trim()}…`
}

const SUPPORTING_CAL_TITLE_EM = '\u2014'

function stripWrappingParensCalendar(s: string): string {
  const t = s.trim()
  const m = t.match(/^\(([^)]+)\)$/)
  return m ? m[1].trim() : t
}

/**
 * Supporting calendar SUMMARY only: `{Verb} {contact|object} — {Company}` (no parens; never repeat contact).
 */
function supportingCalendarEventTitleWithContext(
  baseActionTitle: string,
  step: AdditionalStep,
  r: StructureResult,
): string {
  const companyRaw = stripEmojisForCalendar(
    (step.company || r.contactCompany || r.customer || '').trim(),
  )
  const company = companyRaw
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const fallbackBase =
    cleanCalendarTitle(stripEmojisForCalendar(baseActionTitle.trim())) || 'Follow-up'

  const as = step.actionStructured
  const st = `${step.supportingType || as?.type || ''}`.toLowerCase()

  let verb = (as?.verb || '').trim()
  let middle = ''

  if (st === 'send' || st === 'email') {
    middle = stripWrappingParensCalendar((as?.object || '').trim())
    if (!middle) middle = stripWrappingParensCalendar((step.label || '').trim())
  } else {
    middle = stripWrappingParensCalendar((as?.contact || '').trim())
    if (!middle) {
      middle = stripWrappingParensCalendar(
        stripEmojisForCalendar((step.contact || r.contact || '').trim()),
      )
    }
  }

  if (!verb) {
    const vm = fallbackBase.match(
      /^(Call|Send|Email|Llamar|Enviar|Follow up with|Follow up|Seguimiento con|Meet|Reuni[oó]n|Dar seguimiento)\b/i,
    )
    if (vm) verb = vm[1]
  }

  if (verb && middle) {
    const left = `${verb} ${middle}`.replace(/\s+/g, ' ').trim()
    if (company) {
      const full = `${left} ${SUPPORTING_CAL_TITLE_EM} ${company}`
      return truncateSupportingCalendarTitle(cleanCalendarTitle(full))
    }
    return truncateSupportingCalendarTitle(cleanCalendarTitle(left))
  }

  if (company) {
    const coLo = company.toLowerCase()
    const segs = fallbackBase.split(/\s*[\u2014\-]\s*/).map((s) => s.trim().toLowerCase())
    if (segs[segs.length - 1] === coLo) {
      return truncateSupportingCalendarTitle(fallbackBase)
    }
    const full = `${fallbackBase} ${SUPPORTING_CAL_TITLE_EM} ${company}`
    return truncateSupportingCalendarTitle(cleanCalendarTitle(full))
  }

  return truncateSupportingCalendarTitle(fallbackBase)
}

function supportingStepCalendarTitle(step: AdditionalStep, r: StructureResult): string {
  const raw = stripEmojisForCalendar((step.action || '').trim())
  return supportingCalendarEventTitleWithContext(raw || 'Follow-up', step, r)
}

function supportingCalendarFormatKind(step: AdditionalStep): CalendarFormatActionKind {
  const st = (step.supportingType || 'other').toLowerCase()
  if (st === 'send' || st === 'email' || st === 'call' || st === 'other') {
    return st as CalendarFormatActionKind
  }
  return 'other'
}

/** One calendar event for exactly one supporting step — deterministic body for that action type. */
function buildCalendarOpenOptsForSupportingStep(
  r: StructureResult,
  step: AdditionalStep,
): CalendarOpenOpts {
  const langEs =
    detectNoteLanguage(
      `${r.crmText || ''} ${r.summary || ''} ${(r.crmFull || []).join('\n')} ${r.nextStep || ''} ${r.nextStepTitle || ''} ${step.action || ''}`,
    ).toLowerCase() === 'spanish'
  let title: string
  if (step.supportingType && step.label?.trim()) {
    const base = stripEmojisForCalendar(
      supportingStructuredActionLine(
        step.supportingType,
        step.label.trim(),
        langEs,
        step.actionStructured?.contact,
        step.actionStructured?.object,
      ),
    )
    title = supportingCalendarEventTitleWithContext(base, step, r)
  } else {
    title = supportingStepCalendarTitle(step, r)
  }

  const mmddRaw = ((step.structuredDate || step.resolvedDate) || '').trim()
  const mmdd = /^\d{2}\/\d{2}\/\d{4}$/.test(mmddRaw)
    ? mmddRaw
    : isoDateToMmddyyyy(todayIsoDate())
  const hintRaw = (step.structuredTime || step.timeHint || '').trim()
  const resolved = hintRaw ? resolveTimeFromHint(hintRaw) : { hour: 9, minute: 0 }
  const adj = ensureCalendarDateTimeNotPast(mmdd, resolved.hour, resolved.minute)
  const timeOpts: CalendarTimeInput = { kind: 'clock', hour: adj.hour, minute: adj.minute }
  const st = (step.supportingType || '').toLowerCase()
  const supportingDeliverable =
    st === 'send' || st === 'email'
      ? (step.actionStructured?.object || step.label || '').trim()
      : (step.actionStructured?.object || '').trim()

  // For send steps, ensure contact appears in title
  if ((st === 'send' || st === 'email') && step.actionStructured?.contact) {
    const existingTitle = title
    if (!existingTitle.toLowerCase().includes(step.actionStructured.contact.toLowerCase())) {
      const contactName = step.actionStructured.contact.trim()
      const company = (step.company || step.actionStructured.company || '').trim()
      const companyStr = company ? ` — ${company}` : ''
      const verb = step.actionStructured.verb || 'Send'
      const obj = supportingDeliverable
      title = obj
        ? `${verb} ${obj} to ${contactName}${companyStr}`
        : `${verb} to ${contactName}${companyStr}`
    }
  }
  const stepContact = (step.actionStructured?.contact || step.contact || r.contact || '').trim()
  const stepCompany = (step.actionStructured?.company || step.company || r.contactCompany || r.customer || '').trim()
  const supportingDetails = formatForCalendar(supportingCalendarFormatKind(step), {
    contextParagraph: buildCalendarContext({
      contact: stepContact,
      company: stepCompany,
      problem: r.commercialContext?.problem,
      productInterest: undefined,
      barrier: undefined,
      langEs,
    }),
    langEs,
    deliverable: supportingDeliverable,
    productInterest: undefined,
    productCsv: '',
  })
  const details = buildCalendarEventDescriptionBody(
    {
      customer: r.customer,
      contact: r.contact,
      contactCompany: r.contactCompany,
      crop: r.crop,
      product: r.product,
      location: r.location,
      acreage: r.acreage,
      calendarDescription: supportingDetails,
      crmText: r.crmText,
      crmFull: r.crmFull || [],
      notes: r.notes,
      summary: r.summary,
    },
    {
      eventTitle: title,
      excludeActionPhrases: [
        stripEmojisForCalendar((r.nextStep || '').trim()),
        stripEmojisForCalendar((r.nextStepTitle || '').trim()),
        stripEmojisForCalendar((step.action || '').trim()),
        stripEmojisForCalendar(title),
      ].filter(Boolean),
    },
  )
  return {
    title,
    dateMmddyyyy: adj.dateMmddyyyy,
    details,
    time: timeOpts,
  }
}

/** Model or pipeline flags asking the app to validate instead of guessing. */
function hasReliabilityFlag(r: StructureResult, id: string): boolean {
  const idl = id.toLowerCase()
  return (r.ambiguityFlags || []).some((x) => x.toLowerCase().includes(idl))
}

/** Only show clarification sheets when the pipeline marked the extraction as uncertain. */
function confidenceLow(r: StructureResult): boolean {
  return (r.nextStepConfidence || '').toLowerCase() === 'low'
}

function primaryTitleForDisplay(r: StructureResult) {
  const langEs =
    detectNoteLanguage(
      `${r.crmText || ''} ${r.summary || ''} ${(r.crmFull || []).join('\n')} ${r.nextStep || ''} ${r.nextStepTitle || ''}`,
    ).toLowerCase() === 'spanish'
  const resolvedForDisplay = r.nextStepTimeHint
    ? ensureCalendarDateTimeNotPast(
        r.nextStepDate || isoDateToMmddyyyy(todayIsoDate()),
        resolveTimeFromHint(r.nextStepTimeHint).hour,
        resolveTimeFromHint(r.nextStepTimeHint).minute,
      )
    : null

  return {
    nextStep: r.nextStep,
    nextStepTitle: r.nextStepTitle,
    nextStepDate: resolvedForDisplay?.dateMmddyyyy || r.nextStepDate,
    nextStepTimeHint: resolvedForDisplay
      ? `${String(resolvedForDisplay.hour).padStart(2,'0')}:${String(resolvedForDisplay.minute).padStart(2,'0')}`
      : r.nextStepTimeHint,
    nextStepSoftTiming: r.nextStepSoftTiming,
    langEs,
  }
}

function namesRoughlyMatch(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

function contactTargetMismatch(r: StructureResult): boolean {
  const c = (r.contact || '').trim()
  const t = (r.nextStepTarget || '').trim()
  if (!c || !t) return false
  return !namesRoughlyMatch(c, t)
}

/** Date sheet only when no date and extraction confidence is low (otherwise defaults apply). */
function needsNextStepDatePick(r: StructureResult): boolean {
  if ((r.nextStepSoftTiming || '').trim()) return false
  return !(r.nextStepDate || '').trim() && confidenceLow(r)
}

/** Contact sheet only when missing and confidence is low. */
function needsContactPick(r: StructureResult): boolean {
  return !(r.contact || '').trim() && confidenceLow(r)
}

/**
 * Follow-up target sheet: contact vs target disagree — only when confidence is low
 * (medium/high resolve by aligning target to contact without prompting).
 */
function needsNextStepTargetPick(r: StructureResult): boolean {
  return contactTargetMismatch(r) && confidenceLow(r)
}

function needsContactCompanyPick(r: StructureResult): boolean {
  return !(r.contactCompany || '').trim() && confidenceLow(r)
}

function stripAmbiguityFlagsAfterContactConfirm(r: StructureResult): StructureResult {
  const flags = (r.ambiguityFlags || []).filter((x) => !x.toLowerCase().includes('unclear_contact'))
  return { ...r, ambiguityFlags: flags }
}

function stripAmbiguityFlagsAfterTargetConfirm(r: StructureResult): StructureResult {
  const drop = ['unclear_target', 'multiple_people', 'multiple_people_mentioned']
  const flags = (r.ambiguityFlags || []).filter(
    (x) => !drop.some((d) => x.toLowerCase().includes(d)),
  )
  return { ...r, ambiguityFlags: flags }
}

function stripAmbiguityFlagsAfterDateConfirm(r: StructureResult): StructureResult {
  const flags = (r.ambiguityFlags || []).filter((x) => !x.toLowerCase().includes('unclear_date'))
  return { ...r, ambiguityFlags: flags }
}

/** Calendar-style actions that make a next step concrete enough (no clarify sheet). */
function hasClarifyStrongActionVerb(line: string): boolean {
  const t = line.toLowerCase()
  return /\b(llamar|llama|enviar|envía|envia|visitar|visita|mandar|manda|call|calling|send|sending|visit|visiting|ship|mail)\b/i.test(
    t,
  )
}

/**
 * Next step text describes the contact applying product (their action), not the rep's.
 * If this matches at the start of nextStep or nextStepTitle, force the vague-action clarify modal.
 */
function isClientApplyNextStepStart(line: string): boolean {
  const raw = line.trim().replace(/^[¿¡"'«»]+/, '').trim()
  if (!raw) return false
  const t = raw.toLowerCase()
  const clientApplyPrefixes = [
    'aplicar',
    'aplicarán',
    'aplicaran',
    'apply',
    'they will apply',
    'van a aplicar',
  ]
  return clientApplyPrefixes.some((p) => t.startsWith(p))
}

/** Vague follow-up wording that needs an explicit action if no strong verb is present. */
function hasVagueNextStepWording(line: string): boolean {
  const t = line.toLowerCase()
  if (/\b(seguimiento|follow\s*-?\s*up|followup)\b/i.test(t)) return true
  if (/\brevis(ar|ión)\b/i.test(t)) return true
  if (/\b(check\s*back|touch\s*base)\b/i.test(t)) return true
  if (/\bver\b/i.test(t)) return true
  if (/\besperar\b/i.test(t)) return true
  if (/\bwait\b/i.test(t)) return true
  if (/a\s+que\s+me\s+llame\b/i.test(t)) return true
  if (/que\s+me\s+contacte\b/i.test(t)) return true
  if (/que\s+me\s+llame\b/i.test(t)) return true
  return false
}

/** Heuristic for vague / wrong-perspective next step — only used when confidence is low. */
function nextStepNeedsClarifyHeuristic(r: StructureResult): boolean {
  if (isNoClearFollowUpResult(r)) return false
  const step = (r.nextStep || '').trim()
  const title = (r.nextStepTitle || '').trim()
  const line = step || title
  if (!line) return false
  if (isClientApplyNextStepStart(step) || isClientApplyNextStepStart(title)) return true
  if (hasClarifyStrongActionVerb(line)) return false
  return hasVagueNextStepWording(line)
}

function needsNextStepClarifyPick(r: StructureResult): boolean {
  return confidenceLow(r) && nextStepNeedsClarifyHeuristic(r)
}

function applyQuickNextStepClarify(
  r: StructureResult,
  transcript: string,
  kind: 'call' | 'send' | 'visit' | 'samples',
): StructureResult {
  const spanish = isSpanish(transcript) || isSpanish(r.nextStep || r.nextStepTitle || '')
  const verbs: Record<typeof kind, { es: string; en: string }> = {
    call: { es: 'Llamar', en: 'Call' },
    send: { es: 'Enviar información', en: 'Send info' },
    visit: { es: 'Visitar', en: 'Visit' },
    samples: { es: 'Mandar muestras', en: 'Send materials' },
  }
  const { es, en } = verbs[kind]
  const action = spanish ? es : en
  let merged: StructureResult = {
    ...r,
    nextStepAction: action,
    nextStep: action,
  }
  merged = normalizeStructureResult(merged)
  merged = finalizeNextStepFields(merged, transcript)
  return {
    ...merged,
    nextStep: (merged.nextStepTitle || merged.nextStep).trim(),
  }
}

function applyCustomNextStepClarify(
  r: StructureResult,
  transcript: string,
  customLine: string,
): StructureResult {
  const line = dedupeConsecutiveRepeatedWords(customLine.trim())
  let merged: StructureResult = {
    ...r,
    nextStep: line,
    nextStepTitle: line,
    nextStepAction: '',
  }
  merged = normalizeStructureResult(merged)
  merged = finalizeNextStepFields(merged, transcript)
  return merged
}

function dateOptionToday(): string {
  return formatLocalMmDdYyyy(new Date())
}

function dateOptionTomorrow(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return formatLocalMmDdYyyy(d)
}

/** Nearest upcoming Friday (today if Friday). */
function dateOptionThisWeekFriday(): string {
  return formatLocalMmDdYyyy(getNextDayOfWeek(new Date(), 5))
}

/**
 * When confidence is medium or high, do not prompt: align target to contact; set soft follow-up timing
 * for exploratory follow_up (no fixed day), or next weekday for call/meeting/send without a date.
 */
function applyConfidenceDefaults(res: StructureResult): StructureResult {
  if (isNoClearFollowUpResult(res)) return res
  if (confidenceLow(res)) return res
  let out: StructureResult = { ...res }
  const contact = (out.contact || '').trim()
  const target = (out.nextStepTarget || '').trim()
  if (contact && target && !namesRoughlyMatch(contact, target)) {
    out = { ...out, nextStepTarget: dedupeConsecutiveRepeatedWords(contact) }
  }

  const hasMmdd = /^\d{2}\/\d{2}\/\d{4}$/.test((out.nextStepDate || '').trim())
  const pt = (out.primaryActionStructured?.type || '').toLowerCase()

  if (!hasMmdd) {
    if (pt === 'follow_up') {
      const strength = resolveFollowUpStrengthWithDefault(
        out.followUpStrength || out.primaryActionStructured?.followUpStrength,
      )
      const proposed = normalizeSoftFollowUpTiming(out.nextStepSoftTiming)
      const soft = clampSoftTimingToStrength(strength, proposed)
      out = {
        ...out,
        followUpStrength: strength,
        nextStepDate: '',
        nextStepSoftTiming: soft,
        ambiguityFlags: (out.ambiguityFlags || []).filter(
          (x) => !x.toLowerCase().includes('unclear_date'),
        ),
      }
      if (out.primaryActionStructured) {
        out = {
          ...out,
          primaryActionStructured: {
            ...out.primaryActionStructured,
            followUpStrength: strength,
            date: '',
            time: out.primaryActionStructured.time || '',
          },
        }
      }
    } else if (pt === 'call' || pt === 'meeting' || pt === 'send') {
      const d = nextWeekdayMmdd()
      out = {
        ...out,
        nextStepDate: d,
        nextStepSoftTiming: '',
        followUpStrength: '',
        primaryActionStructured: out.primaryActionStructured
          ? { ...out.primaryActionStructured, date: d, followUpStrength: undefined }
          : undefined,
      }
    } else {
      let soft = normalizeSoftFollowUpTiming(out.nextStepSoftTiming)
      if (!soft) soft = 'next_week'
      out = {
        ...out,
        nextStepDate: '',
        nextStepSoftTiming: soft,
      }
    }
  } else if ((out.nextStepSoftTiming || '').trim()) {
    out = { ...out, nextStepSoftTiming: '' }
  }

  return out
}

/** Monday that starts the calendar week after the current one (weeks start Monday). */
function dateOptionNextWeekMonday(): string {
  const d = new Date()
  const day = d.getDay()
  const daysSinceMonday = day === 0 ? 6 : day - 1
  const monday = new Date(d)
  monday.setDate(d.getDate() - daysSinceMonday)
  monday.setDate(monday.getDate() + 7)
  return formatLocalMmDdYyyy(monday)
}

type CalendarOpenOpts = {
  title: string
  dateMmddyyyy: string
  details: string
  time: CalendarTimeInput
  /** Physical / account location for Google Calendar + ICS. */
  location?: string
}

function openGoogleCalendarWindow(opts: CalendarOpenOpts) {
  const range = buildGoogleCalendarDateRangeParts(opts.dateMmddyyyy, opts.time)
  if (!range) return
  const title = encodeURIComponent(opts.title.trim())
  const details = encodeURIComponent(opts.details)
  const loc = (opts.location || '').trim()
  const locQ = loc ? `&location=${encodeURIComponent(loc)}` : ''
  const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${range.start}/${range.end}&details=${details}${locQ}`
  window.open(url, '_blank')
}

/** RFC 5545 TEXT escaping for SUMMARY / DESCRIPTION. */
function escapeIcsText(s: string): string {
  return s
    .replace(/\r\n/g, '\n')
    .replace(/\n/g, '\\n')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
}

/** Same wall-clock window as Google Calendar — local floating time (no Z) for broad client support. */
function buildIcsCalendarFile(opts: CalendarOpenOpts): string | null {
  const range = buildGoogleCalendarDateRangeParts(opts.dateMmddyyyy, opts.time)
  if (!range) return null
  const uid =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
  const now = new Date()
  const dtstamp = `${now.getUTCFullYear()}${pad2(now.getUTCMonth() + 1)}${pad2(now.getUTCDate())}T${pad2(now.getUTCHours())}${pad2(now.getUTCMinutes())}${pad2(now.getUTCSeconds())}Z`
  const summary = escapeIcsText(opts.title.trim())
  const description = escapeIcsText(opts.details.trim())
  const loc = (opts.location || '').trim()
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Folup//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}@folup`,
    `DTSTAMP:${dtstamp}`,
  ]
  if (range.kind === 'allday') {
    lines.push(`DTSTART;VALUE=DATE:${range.start}`)
    lines.push(`DTEND;VALUE=DATE:${range.end}`)
  } else {
    lines.push(`DTSTART:${range.start}`)
    lines.push(`DTEND:${range.end}`)
  }
  lines.push(`SUMMARY:${summary}`, `DESCRIPTION:${description}`)
  if (loc) lines.push(`LOCATION:${escapeIcsText(loc)}`)
  lines.push('END:VEVENT', 'END:VCALENDAR')
  return lines.join('\r\n')
}

function triggerIcsDownload(icsContent: string, filename: string) {
  const safeName = filename.endsWith('.ics') ? filename : `${filename}.ics`
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = safeName
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function openAppleCalendarFromOpts(opts: CalendarOpenOpts): boolean {
  const ics = buildIcsCalendarFile(opts)
  if (!ics) return false
  const raw = opts.title.trim() || 'follow-up'
  const slug = raw
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 48)
  triggerIcsDownload(ics, slug ? `folup-${slug}` : 'folup-follow-up')
  return true
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
  const ink = 'text-[#111111]'
  const t = text.trimStart()
  if (getInsightTone(text) === 'negative') {
    if (t.startsWith('💰')) return `${ink} bg-red-50`
    if (t.startsWith('🌡️') || t.startsWith('🌡')) return `${ink} bg-orange-50`
    if (t.startsWith('❗') || t.startsWith('⚠️')) return `${ink} bg-amber-50`
    return `${ink} bg-amber-50`
  }
  return `${ink} bg-transparent`
}

/** UI display only — sentence-case first letter; title-case "today"/"tomorrow" as words. */
function capitalizeFirstLetterOnlyForDisplay(s: string): string {
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (/\p{L}/u.test(ch)) {
      return s.slice(0, i) + ch.toLocaleUpperCase('en-US') + s.slice(i + 1)
    }
  }
  return s
}

function formatInsightRelativeDayWordsForDisplay(s: string): string {
  return s.replace(/\btoday\b/gi, 'Today').replace(/\btomorrow\b/gi, 'Tomorrow')
}

function formatKeyInsightLineForDisplay(line: string): string {
  return formatInsightRelativeDayWordsForDisplay(capitalizeFirstLetterOnlyForDisplay(line))
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
              {formatKeyInsightLineForDisplay(line)}
            </p>
          ))}
        </div>
        <div
          className={`flex flex-col ${gapClass} ${showCollapsed ? 'overflow-hidden' : ''}`}
          style={showCollapsed ? { maxHeight: collapsedMaxPx } : undefined}
        >
          {lines.map((line, i) => (
            <p key={i} className={`${lineClassName} ${getInsightStyle(line)}`}>
              {formatKeyInsightLineForDisplay(line)}
            </p>
          ))}
        </div>
      </div>
      {needsToggle ? (
        <button
          type="button"
          onClick={onToggle}
          className={`${buttonMarginClass} ${buttonTextClass} font-semibold text-[#4F46E5] underline decoration-[#4F46E5]/30 underline-offset-2 hover:decoration-[#4F46E5]/60`}
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
    'follow up with',
    'follow up',
    'seguimiento con',
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

/** Company in nextStepTitle after ` — ` (or legacy trailing parens) = org the direct contact belongs to. */
function companyForDirectContact(r: StructureResult): string {
  return resolveContactCompany(
    r.customer,
    r.contact,
    r.nextStepTarget,
    r.contactCompany || '',
  )
}

/** Parse company suffix from nextStepTitle: ` — Company` (preferred) or legacy `(Company)`. */
function companyFromNextStepTitle(title: string): string | null {
  const t = (title || '').trim()
  if (!t) return null
  const emSep = t.lastIndexOf(' — ')
  if (emSep !== -1) {
    const after = t.slice(emSep + 3).trim()
    if (after) return after
  }
  const paren = t.match(/\(([^)]+)\)\s*$/)
  if (paren) return paren[1].trim()
  return null
}

/** Affiliation-based org, then API title (` — ` or parens), then location. */
function resolveCompanyForTitle(r: StructureResult): string {
  const affiliated = companyForDirectContact(r)
  if (affiliated) return affiliated
  const fromTitle = companyFromNextStepTitle(r.nextStepTitle || '')
  if (fromTitle) return fromTitle
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

function joinActionAndTarget(action: string, target: string): string {
  const a = action.trim()
  const t = target.trim()
  if (!a) return dedupeConsecutiveRepeatedWords(t)
  if (!t) return dedupeConsecutiveRepeatedWords(a)

  if (actionAlreadyEndsWithTarget(a, t)) {
    return dedupeConsecutiveRepeatedWords(a)
  }

  if (a.toLowerCase() === 'llamar' && !/^llamar\s+a\b/i.test(a)) {
    return dedupeConsecutiveRepeatedWords(`Llamar a ${t}`)
  }
  return dedupeConsecutiveRepeatedWords(mergeActionTargetAvoidOverlap(a, t))
}

/**
 * Middle segment for VERB + [middle] + ` — ` + COMPANY: deliverable for send/email, person for call-style.
 */
function resolveActionMiddleSlot(r: StructureResult): string {
  const primary = (r.actions || []).find((a) => a.primary === true)
  if (primary && (primary.type === 'send' || primary.type === 'email')) {
    const o = (primary.object || '').trim()
    const person = (r.nextStepTarget || r.contact || '').trim()
    const langEs =
      detectNoteLanguage(
        `${r.crmText || ''} ${r.summary || ''} ${(r.crmFull || []).join('\n')} ${r.nextStep || ''} ${r.nextStepTitle || ''}`,
      ).toLowerCase() === 'spanish'
    if (o && person) return langEs ? `${o} a ${person}` : `${o} to ${person}`
    if (o) return o
  }
  return (r.nextStepTarget || r.contact || '').trim()
}

/**
 * Calendar-only title: VERB + middle + ` — ` + COMPANY (middle = object for send/email, else contact).
 * Does not use enrichNextStep (avoids stacking customer/contact/location).
 */
function buildCleanNextStepTitle(r: StructureResult): string {
  const action = (r.nextStepAction || '').trim()
  const target = resolveActionMiddleSlot(r)
  const company = resolveCompanyForTitle(r)

  if (action || target) {
    const core = joinActionAndTarget(action, target)
    if (!core) {
      return dedupeConsecutiveRepeatedWords((r.nextStepTitle || r.nextStep || '').trim())
    }

    if (company) {
      const coreLower = core.toLowerCase()
      const companyLower = company.toLowerCase()
      const emSuffix = ` — ${companyLower}`
      if (coreLower.includes(`(${companyLower})`) || coreLower.endsWith(emSuffix)) {
        return dedupeConsecutiveRepeatedWords(core)
      }
      return dedupeConsecutiveRepeatedWords(`${core} — ${company}`)
    }
    const preserved = (r.nextStepTitle || '').trim()
    if (preserved) return dedupeConsecutiveRepeatedWords(preserved)
    return dedupeConsecutiveRepeatedWords(core)
  }

  return dedupeConsecutiveRepeatedWords((r.nextStepTitle || r.nextStep || '').trim())
}

function enrichNextStep(
  nextStep: string,
  data: { contact?: string; customer?: string },
) {
  if (!nextStep) return nextStep

  const contact = data.contact || ''
  const company = data.customer || ''

  let enriched = nextStep.trim()

  const hasCompany =
    !!company &&
    (enriched.includes(`(${company})`) ||
      enriched.toLowerCase().endsWith(` — ${company}`.toLowerCase()))
  const hasContact =
    contact && enriched.toLowerCase().includes(contact.toLowerCase())

  if (contact && !hasContact) {
    const parts = enriched.split(' ')
    if (parts.length > 1) {
      enriched = `${parts[0]} ${contact} ${parts.slice(1).join(' ')}`
    }
  }

  if (company && !hasCompany) {
    enriched = `${enriched} — ${company}`
  }

  return dedupeConsecutiveRepeatedWords(enriched)
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
      .replace(/^follow up with/i, 'Seguimiento con')
      .replace(/^follow up/i, 'Seguimiento con')
      .replace(/^schedule/i, 'Agendar')
  }

  if (!inputIsSpanish && outputIsSpanish) {
    return nextStep
      .replace(/^llamar/i, 'Call')
      .replace(/^enviar/i, 'Send')
      .replace(/^seguimiento con/i, 'Follow up with')
      .replace(/^hacer seguimiento/i, 'Follow up with')
      .replace(/^agendar/i, 'Schedule')
  }

  return nextStep
}

function stripUnclearContactAmbiguity(r: StructureResult): StructureResult {
  if (!(r.contact || '').trim()) return r
  const flags = (r.ambiguityFlags || []).filter(
    (x) => !x.toLowerCase().includes('unclear_contact'),
  )
  return { ...r, ambiguityFlags: flags }
}

function isProbablyOrganizationEntityType(type: string): boolean {
  const t = (type || '').toLowerCase().trim()
  if (!t || t === 'other') return false
  return /\b(org|organization|company|account|customer|farm|clinic|hospital|distributor|dealer|retail|store|brand|buyer\s*org|site|location)\b/i.test(
    t,
  )
}

/**
 * If the model left contact empty but only one non-org person is listed, treat that as the contact.
 * Caller runs before finalizeNextStepFields (which also promotes nextStepTarget → contact).
 */
function inferMissingContact(r: StructureResult): StructureResult {
  let next = stripUnclearContactAmbiguity(r)
  if ((next.contact || '').trim()) return next
  const ents = next.mentionedEntities || []
  if (ents.length !== 1) return next
  const e = ents[0]
  const name = (e.name || '').trim()
  if (name.length < 2 || name.length > 120 || isProbablyOrganizationEntityType(e.type)) return next
  next = { ...next, contact: name }
  return stripUnclearContactAmbiguity(next)
}

function finalizeNextStepFields(res: StructureResult, sourceText: string): StructureResult {
  if (isNoClearFollowUpResult(res)) {
    const line = (res.nextStepTitle || res.nextStep || '').trim()
    return {
      ...res,
      nextStep: line,
      nextStepTitle: line,
      nextStepAction: '',
      nextStepTarget: '',
      nextStepDate: '',
      nextStepSoftTiming: '',
      followUpStrength: '',
      nextStepTimeHint: '',
      additionalSteps: [],
      primaryActionStructured: undefined,
    }
  }
  const base = { ...res }
  let contact = (base.contact || '').trim()
  let nextStepTarget = (base.nextStepTarget || '').trim()
  if (!contact && nextStepTarget) {
    contact = nextStepTarget
  }
  if (!contact) {
    nextStepTarget = ''
  } else if (!nextStepTarget) {
    nextStepTarget = contact
  }
  let ambiguityFlags = base.ambiguityFlags || []
  if (contact) {
    ambiguityFlags = ambiguityFlags.filter((x) => !x.toLowerCase().includes('unclear_contact'))
  }
  const baseAligned = { ...base, contact, nextStepTarget, ambiguityFlags }
  const noteLang = detectNoteLanguage(
    `${baseAligned.nextStep || ''} ${baseAligned.nextStepTitle || ''} ${sourceText || ''}`,
  )
  let nextLine: string
  let nextTitle: string
  if (baseAligned.primaryActionStructured) {
    const t = buildPrimaryBaseTitle(baseAligned.primaryActionStructured, noteLang)
    nextLine = t
    nextTitle = t
  } else {
    nextLine = enrichNextStep(baseAligned.nextStep, baseAligned)
    nextTitle = buildCleanNextStepTitle(baseAligned)
  }
  nextLine = dedupeConsecutiveRepeatedWords(forceLanguage(nextLine, sourceText))
  nextTitle = dedupeConsecutiveRepeatedWords(forceLanguage(nextTitle, sourceText))
  return {
    ...base,
    contact: dedupeConsecutiveRepeatedWords(contact),
    ambiguityFlags,
    nextStep: nextLine,
    nextStepTitle: nextTitle,
    nextStepTarget: dedupeConsecutiveRepeatedWords(nextStepTarget),
  }
}

async function fixNextStep(result: {
  nextStep?: string
  customer?: string
  contact?: string
}) {
  const prompt = `
Fix this next step so it becomes specific and directly usable as a calendar event title.

Rules:
- Use format: ACTION + TARGET + " — " + COMPANY (space, em dash, space) when company is available
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
Contact: ${result.contact || ''}
`

  const res = await fetch('/api/structure', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      note: prompt,
      timezone: getClientTimezone(),
      clientNow: getClientNowIso(),
    }),
  })

  const data = await res.json()

  if (!res.ok) {
    throw new Error(data.error || 'Failed to fix next step.')
  }

  return data.nextStep || result.nextStep || ''
}

function calendarResultFingerprint(r: StructureResult): string {
  const steps = (r.additionalSteps || [])
    .map((s) => `${s.action}|${s.resolvedDate}|${s.timeHint}`)
    .join('¦')
  return [
    r.nextStep || '',
    r.nextStepDate || '',
    r.nextStepSoftTiming || '',
    r.followUpStrength || '',
    r.nextStepTimeHint || '',
    r.contact || '',
    steps,
  ].join('§')
}

function getCalendarStorageKey(r: StructureResult, noteId: string | null | undefined): string {
  if (noteId) return `id:${noteId}`
  return `fp:${calendarResultFingerprint(r)}`
}

/** Stable id for a supporting row within a note (list order index). */
function supportingCalendarStepId(index: number): string {
  return String(index)
}

export default function Home() {
  const { data: session, status } = useSession()
  const signInWithGoogle = useCallback(() => {
    void signIn('google', { callbackUrl: '/' })
  }, [])
  /**
   * Authenticated user key for notes: Google account email (matches `notes.user_id` in Supabase).
   * See `supabase/migrations/*_add_notes_user_id.sql`.
   */
  const sessionEmail = session?.user?.email?.trim() ?? null
  const notesStorageKey = sessionEmail ? `voicta-notes:${sessionEmail}` : ''
  const [mounted, setMounted] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('record')
  const [input, setInput] = useState('')
  const [result, setResult] = useState<StructureResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingMsgIndex, setLoadingMsgIndex] = useState(0)
  const loadingMessages = [
    'One moment…',
    'Reading your note…',
    'Got it…',
    'Picking out what matters…',
    'Almost there…',
    'Building your next steps…',
    'On it…',
    'Just a sec…',
  ]
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [showWakeLockFallbackTip, setShowWakeLockFallbackTip] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [transcript, setTranscript] = useState('')
  const [savedNotes, setSavedNotes] = useState<SavedNote[]>([])
  const [selectedNote, setSelectedNote] = useState<SavedNote | null>(null)
  /** Internal save pipeline state (reserved for future UI; not shown yet). */
  const [savingStatus, setSavingStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  /** Cleared when a new save starts; callback checks gen so stale timeouts cannot reset status after a later save. */
  const savingIdleResetTimerRef = useRef<number | null>(null)
  const savingIdleResetGenerationRef = useRef(0)
  const [noteSaved, setNoteSaved] = useState(false)
  const [showEditArea, setShowEditArea] = useState(false)
  const [isCorrectingRecording, setIsCorrectingRecording] = useState(false)
  const [correctingSeconds, setCorrectingSeconds] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [showCalendarToast, setShowCalendarToast] = useState(false)
  const [pendingDatePick, setPendingDatePick] = useState<{
    result: StructureResult
    transcript: string
  } | null>(null)
  const [pendingContactPick, setPendingContactPick] = useState<{
    result: StructureResult
    transcript: string
  } | null>(null)
  const [contactPickInput, setContactPickInput] = useState('')
  const [pendingTargetPick, setPendingTargetPick] = useState<{
    result: StructureResult
    transcript: string
  } | null>(null)
  const [targetPickInput, setTargetPickInput] = useState('')
  const [pendingCompanyPick, setPendingCompanyPick] = useState<{
    result: StructureResult
    transcript: string
  } | null>(null)
  const [companyPickInput, setCompanyPickInput] = useState('')
  const [pendingNextStepClarifyPick, setPendingNextStepClarifyPick] = useState<{
    result: StructureResult
    transcript: string
  } | null>(null)
  const [nextStepClarifyInput, setNextStepClarifyInput] = useState('')
  const [resultInsightsExpanded, setResultInsightsExpanded] = useState(false)
  const [historyInsightsExpanded, setHistoryInsightsExpanded] = useState(false)
  const [primaryAdded, setPrimaryAdded] = useState(false)
  const [supportingAdded, setSupportingAdded] = useState<Record<string, boolean>>({})
  const [hasActiveSubscription, setHasActiveSubscription] = useState<boolean | null>(null)

  useEffect(() => {
    if (status !== 'authenticated') return
    console.log('[subscription] checking...')
    fetch('/api/subscription')
      .then((r) => r.json())
      .then((data) => {
        console.log('[subscription] result:', data)
        setHasActiveSubscription(data.active)
      })
      .catch((err) => {
        console.log('[subscription] error:', err)
        setHasActiveSubscription(false)
      })
  }, [status])

  const [showPaywall, setShowPaywall] = useState(false)
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
  }, [])

  useEffect(() => {
    if (!loading) {
      setLoadingMsgIndex(0)
      return
    }
    const interval = setInterval(() => {
      setLoadingMsgIndex((i) => (i + 1) % loadingMessages.length)
    }, 1500)
    return () => clearInterval(interval)
  }, [loading])

  useEffect(() => {
    initPosthog()
  }, [])

  const calendarStorageKey = useMemo(() => {
    if (activeTab === 'history' && selectedNote) {
      return getCalendarStorageKey(selectedNote.result, selectedNote.id)
    }
    if (activeTab === 'record' && result) {
      return getCalendarStorageKey(result, null)
    }
    return null
  }, [activeTab, selectedNote, result])

  /** Reset "+ Add" / primary calendar buttons when the note or result identity changes — never hydrate from storage (success state is click-only for this session). */
  useEffect(() => {
    setPrimaryAdded(false)
    setSupportingAdded({})
  }, [calendarStorageKey])

  useEffect(() => {
    if (!sessionEmail) {
      setSavedNotes([])
      return
    }
    const loadNotes = async () => {
      if (!isSupabaseConfigured) {
        try {
          const stored = localStorage.getItem(notesStorageKey)
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
          } else {
            setSavedNotes([])
          }
        } catch {
          setSavedNotes([])
        }
        return
      }
      try {
        const { data, error } = await supabase
          .from('notes')
          .select('*')
          .eq('user_id', sessionEmail)
          .order('id', { ascending: false })
        if (error) {
          console.error('[loadNotes] Supabase select error:', error.message, error)
        }
        if (!error && data && data.length > 0) {
          const mapped: SavedNote[] = data.map((n: any) => ({
            id: String(n.id),
            date:
              typeof n.created_at === 'string'
                ? n.created_at
                : typeof n.date === 'string'
                  ? n.date
                  : new Date().toISOString(),
            transcript:
              typeof n.raw_text === 'string' ? n.raw_text : typeof n.transcript === 'string' ? n.transcript : '',
            result: normalizeStructureResult(rawStructureResultFromSupabaseRow(n)),
          }))
          setSavedNotes(mapped)
          try { localStorage.setItem(notesStorageKey, JSON.stringify(mapped)) } catch {}
          return
        }
      } catch (e) {
        console.error('[loadNotes] Supabase request failed:', e)
      }
      try {
        const stored = localStorage.getItem(notesStorageKey)
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
        } else {
          setSavedNotes([])
        }
      } catch {
        setSavedNotes([])
      }
    }
    loadNotes()
  }, [sessionEmail])

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

  /** Keep screen awake during visit recording (Screen Wake Lock API; no-op if unsupported). */
  useEffect(() => {
    if (!isRecording) {
      setShowWakeLockFallbackTip(false)
      return
    }
    let cancelled = false
    const syncWakeLockAndTip = async () => {
      await requestWakeLock()
      if (cancelled) return
      setShowWakeLockFallbackTip(!isWakeLockHeld())
    }
    void syncWakeLockAndTip()
    const unsubRelease = subscribeWakeLockReleased(() => {
      if (cancelled) return
      setShowWakeLockFallbackTip(!isWakeLockHeld())
    })
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void syncWakeLockAndTip()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      unsubRelease()
      document.removeEventListener('visibilitychange', onVisibility)
      void releaseWakeLock()
      setShowWakeLockFallbackTip(false)
    }
  }, [isRecording])

  useEffect(() => {
    if (!showCalendarToast) return
    const t = setTimeout(() => setShowCalendarToast(false), 2100)
    return () => clearTimeout(t)
  }, [showCalendarToast])

  useEffect(() => {
    setResultInsightsExpanded(false)
  }, [result])

  useEffect(() => {
    setHistoryInsightsExpanded(false)
  }, [selectedNote?.id])

  useEffect(() => {
    if (pendingContactPick) setContactPickInput('')
  }, [pendingContactPick])

  useEffect(() => {
    if (pendingTargetPick) {
      const r = pendingTargetPick.result
      setTargetPickInput((r.contact || r.nextStepTarget || '').trim())
    }
  }, [pendingTargetPick])

  useEffect(() => {
    if (pendingCompanyPick) setCompanyPickInput('')
  }, [pendingCompanyPick])

  useEffect(() => {
    if (pendingNextStepClarifyPick) setNextStepClarifyInput('')
  }, [pendingNextStepClarifyPick])

  const saveNote = async (res: StructureResult, tx: string): Promise<void> => {
    const validSession = status === 'authenticated' && !!session?.user
    console.log('[saveNote] start', {
      path: 'pending',
      sessionStatus: status,
      validSession,
      sessionEmail: sessionEmail ?? '(none)',
      isSupabaseConfigured,
    })
    if (savingIdleResetTimerRef.current !== null) {
      clearTimeout(savingIdleResetTimerRef.current)
      savingIdleResetTimerRef.current = null
    }
    savingIdleResetGenerationRef.current += 1
    setSavingStatus('saving')
    const note: SavedNote = {
      id: Date.now().toString(),
      date: new Date().toISOString(),
      result: res,
      transcript: tx,
    }

    let localStorageFailed = false
    setSavedNotes((prev) => {
      const updated = [note, ...prev]
      try {
        if (sessionEmail && notesStorageKey) {
          localStorage.setItem(notesStorageKey, JSON.stringify(updated))
        }
      } catch (e) {
        localStorageFailed = true
        console.error('Save error:', e)
      }
      return updated
    })
    setNoteSaved(true)
    setTimeout(() => setNoteSaved(false), 2300)

    if (localStorageFailed) {
      setSavingStatus('error')
      throw new Error('localStorage persist failed')
    }

    if (!sessionEmail) {
      console.warn('[saveNote] path=local-only (no Supabase insert)', {
        reason: 'no-session-email',
        sessionStatus: status,
        validSession,
        sessionEmail: '(none)',
      })
      console.warn(
        'No authenticated user (email); note kept in UI/history only. Supabase sync skipped.',
      )
      setSavingStatus('saved')
      return
    }
    if (!isSupabaseConfigured) {
      console.warn('[saveNote] path=local-only (no Supabase insert)', {
        reason: 'supabase-not-configured',
        sessionStatus: status,
        validSession,
        sessionEmail,
      })
      console.error(
        'Save error: Supabase not configured (missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY). Note saved locally only.',
      )
      setSavingStatus('saved')
      return
    }

    const rowUserId = sessionEmail
    const clientNoteId = note.id
    const insertPayload = {
      user_id: rowUserId,
      raw_text: tx,
      structured_output: buildStructuredOutputForSupabase(res),
    }

    console.log('[saveNote] path=supabase-insert (about to insert)', {
      sessionStatus: status,
      validSession,
      sessionEmail,
      userIdForRow: rowUserId,
      noteId: clientNoteId,
    })
    logNotesTableRlsAssumptions({
      userIdForRow: rowUserId,
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    })
    console.log('[saveNote] insert payload (exact)', insertPayload)

    const verifyNoteRowVisible = async (phase: string, noteId: string) => {
      const verifyRes = await supabase
        .from('notes')
        .select('id, user_id')
        .eq('id', noteId)
        .eq('user_id', rowUserId)
        .maybeSingle()
      console.log(`[saveNote] verify select (${phase})`, {
        noteId,
        userId: rowUserId,
        rowFound: !!verifyRes.data,
        data: verifyRes.data,
        fullResponse: verifyRes,
      })
      if (verifyRes.error) {
        logPostgrestError('[saveNote] verify select error', verifyRes.error)
      }
      return verifyRes
    }

    try {
      const attemptInsert = async () => {
        const res = await supabase.from('notes').insert(insertPayload).select('id')
        console.log('[saveNote] insert response (full)', res)
        if (res.error) logPostgrestError('[saveNote] insert error', res.error)
        return res
      }

      let { data, error } = await attemptInsert()
      if (error) {
        if (error.code === '23505') {
          console.warn('[saveNote] insert duplicate key (23505) — row may already exist', {
            code: error.code,
            message: error.message,
          })
          await verifyNoteRowVisible('after-23505', clientNoteId)
          if (process.env.NODE_ENV === 'development') {
            console.log('Note saved (row already exists for this id)')
          }
          setSavingStatus('saved')
          return
        }
        console.error('Save error:', error)
        await new Promise((r) => setTimeout(r, 400))
        const retry = await attemptInsert()
        data = retry.data
        error = retry.error
        if (error) {
          if (error.code === '23505') {
            await verifyNoteRowVisible('after-23505-retry', clientNoteId)
            if (process.env.NODE_ENV === 'development') {
              console.log('Note saved (row already exists after retry)')
            }
            setSavingStatus('saved')
            return
          }
          logPostgrestError('[saveNote] insert error (after retry)', error)
          setSavingStatus('error')
          throw new Error(error.message || 'Supabase insert failed after retry')
        }
      }
      if (!error && (!data || data.length === 0)) {
        console.warn(
          '[saveNote] insert succeeded but returned no rows — check RLS SELECT policies or omit .select() behavior',
        )
      }
      const serverId = data?.[0]?.id != null ? String(data[0].id) : null
      if (serverId && serverId !== clientNoteId) {
        setSavedNotes((prev) => prev.map((row) => (row.id === clientNoteId ? { ...row, id: serverId } : row)))
        setSelectedNote((prev) => (prev && prev.id === clientNoteId ? { ...prev, id: serverId } : prev))
      }
      await verifyNoteRowVisible('after-successful-insert', serverId ?? clientNoteId)
      if (process.env.NODE_ENV === 'development') {
        console.log('Note saved', data?.length ?? 0, 'row(s)')
      }
      setSavingStatus('saved')
    } catch (err) {
      console.error('Save error:', err)
      setSavingStatus('error')
      throw err
    }
  }

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return
    console.log('[savingStatus]', savingStatus)
  }, [savingStatus])

  useEffect(() => {
    if (savingStatus !== 'saved' && savingStatus !== 'error') return
    const gen = savingIdleResetGenerationRef.current
    if (savingIdleResetTimerRef.current !== null) {
      clearTimeout(savingIdleResetTimerRef.current)
      savingIdleResetTimerRef.current = null
    }
    const t = window.setTimeout(() => {
      savingIdleResetTimerRef.current = null
      if (savingIdleResetGenerationRef.current !== gen) return
      setSavingStatus('idle')
    }, 4000)
    savingIdleResetTimerRef.current = t
    return () => {
      clearTimeout(t)
      if (savingIdleResetTimerRef.current === t) savingIdleResetTimerRef.current = null
    }
  }, [savingStatus])

  const commitPendingDatePick = (mmdd: string) => {
    const p = pendingDatePick
    if (!p) return
    let merged: StructureResult = {
      ...p.result,
      nextStepDate: mmdd,
      nextStepSoftTiming: '',
    }
    if (merged.primaryActionStructured) {
      merged = {
        ...merged,
        primaryActionStructured: { ...merged.primaryActionStructured, date: mmdd },
      }
    }
    merged = stripAmbiguityFlagsAfterDateConfirm(merged)
    setPendingDatePick(null)
    setResult(merged)
    saveNote(merged, p.transcript).catch((err) => {
      console.error('Save failed:', err)
    })
  }

  /** After contact step only: confirm follow-up target → empresa → fecha/resultado. */
  const advanceValidationFlow = (merged: StructureResult, transcript: string) => {
    if (needsNextStepTargetPick(merged)) {
      setPendingTargetPick({ result: merged, transcript })
      return
    }
    if (needsContactCompanyPick(merged)) {
      setPendingCompanyPick({ result: merged, transcript })
    } else {
      advanceAfterCompanyResolved(merged, transcript)
    }
  }

  /** After next-step clarify (or if skipped / not needed): optional date sheet → resultado. */
  const advanceAfterNextStepClarifyResolved = (
    merged: StructureResult,
    transcript: string,
  ) => {
    if (needsNextStepDatePick(merged)) {
      setPendingDatePick({ result: merged, transcript })
    } else {
      setResult(merged)
      saveNote(merged, transcript).catch((err) => {
        console.error('Save failed:', err)
      })
    }
  }

  /** After empresa modal (or if empresa was already set): clarify → fecha → resultado. Never re-open empresa. */
  const advanceAfterCompanyResolved = (merged: StructureResult, transcript: string) => {
    if (needsNextStepClarifyPick(merged)) {
      setPendingNextStepClarifyPick({ result: merged, transcript })
    } else {
      advanceAfterNextStepClarifyResolved(merged, transcript)
    }
  }

  const commitPendingContactSaltar = () => {
    const p = pendingContactPick
    if (!p) return
    setPendingContactPick(null)
    let merged = normalizeStructureResult(p.result)
    merged = finalizeNextStepFields(merged, p.transcript)
    advanceValidationFlow(merged, p.transcript)
  }

  const commitPendingContactContinuar = () => {
    const raw = contactPickInput.trim()
    if (!raw) return
    const p = pendingContactPick
    if (!p) return
    const name = dedupeConsecutiveRepeatedWords(raw)
    setPendingContactPick(null)
    setContactPickInput('')
    let merged: StructureResult = { ...p.result, contact: name }
    if (!(merged.nextStepTarget || '').trim()) {
      merged = { ...merged, nextStepTarget: name }
    }
    merged = normalizeStructureResult(merged)
    merged = finalizeNextStepFields(merged, p.transcript)
    merged = stripAmbiguityFlagsAfterContactConfirm(merged)
    advanceValidationFlow(merged, p.transcript)
  }

  const commitPendingTargetSaltar = () => {
    const p = pendingTargetPick
    if (!p) return
    setPendingTargetPick(null)
    setTargetPickInput('')
    const c = (p.result.contact || '').trim()
    let merged: StructureResult = { ...p.result, nextStepTarget: c }
    merged = normalizeStructureResult(merged)
    merged = finalizeNextStepFields(merged, p.transcript)
    merged = stripAmbiguityFlagsAfterTargetConfirm(merged)
    if (needsContactCompanyPick(merged)) {
      setPendingCompanyPick({ result: merged, transcript: p.transcript })
    } else {
      advanceAfterCompanyResolved(merged, p.transcript)
    }
  }

  const commitPendingTargetContinuar = () => {
    const raw = targetPickInput.trim()
    if (!raw) return
    const p = pendingTargetPick
    if (!p) return
    const name = dedupeConsecutiveRepeatedWords(raw)
    setPendingTargetPick(null)
    setTargetPickInput('')
    let merged: StructureResult = { ...p.result, contact: name, nextStepTarget: name }
    merged = normalizeStructureResult(merged)
    merged = finalizeNextStepFields(merged, p.transcript)
    merged = stripAmbiguityFlagsAfterTargetConfirm(merged)
    if (needsContactCompanyPick(merged)) {
      setPendingCompanyPick({ result: merged, transcript: p.transcript })
    } else {
      advanceAfterCompanyResolved(merged, p.transcript)
    }
  }

  const commitPendingCompanySaltar = () => {
    const p = pendingCompanyPick
    if (!p) return
    setPendingCompanyPick(null)
    let merged = normalizeStructureResult(p.result)
    merged = finalizeNextStepFields(merged, p.transcript)
    advanceAfterCompanyResolved(merged, p.transcript)
  }

  const commitPendingCompanyContinuar = () => {
    const raw = companyPickInput.trim()
    if (!raw) return
    const p = pendingCompanyPick
    if (!p) return
    const company = dedupeConsecutiveRepeatedWords(raw)
    setPendingCompanyPick(null)
    setCompanyPickInput('')
    let merged: StructureResult = { ...p.result, contactCompany: company }
    merged = normalizeStructureResult(merged)
    merged = finalizeNextStepFields(merged, p.transcript)
    advanceAfterCompanyResolved(merged, p.transcript)
  }

  const commitPendingNextStepClarifySaltar = () => {
    const p = pendingNextStepClarifyPick
    if (!p) return
    setPendingNextStepClarifyPick(null)
    setNextStepClarifyInput('')
    let merged = normalizeStructureResult(p.result)
    merged = finalizeNextStepFields(merged, p.transcript)
    advanceAfterNextStepClarifyResolved(merged, p.transcript)
  }

  const commitPendingNextStepClarifyQuick = (
    kind: 'call' | 'send' | 'visit' | 'samples',
  ) => {
    const p = pendingNextStepClarifyPick
    if (!p) return
    setPendingNextStepClarifyPick(null)
    setNextStepClarifyInput('')
    const merged = applyQuickNextStepClarify(p.result, p.transcript, kind)
    advanceAfterNextStepClarifyResolved(merged, p.transcript)
  }

  const commitPendingNextStepClarifyCustom = () => {
    const raw = nextStepClarifyInput.trim()
    if (!raw) return
    const p = pendingNextStepClarifyPick
    if (!p) return
    setPendingNextStepClarifyPick(null)
    setNextStepClarifyInput('')
    const merged = applyCustomNextStepClarify(p.result, p.transcript, raw)
    advanceAfterNextStepClarifyResolved(merged, p.transcript)
  }

  const deleteNote = async (id: string) => {
    const updated = savedNotes.filter((n) => n.id !== id)
    setSavedNotes(updated)
    try {
      if (sessionEmail && notesStorageKey) {
        localStorage.setItem(notesStorageKey, JSON.stringify(updated))
      }
    } catch {}
    if (selectedNote?.id === id) setSelectedNote(null)
    if (!sessionEmail || !isSupabaseConfigured) return
    try {
      const { error } = await supabase
        .from('notes')
        .delete()
        .eq('id', id)
        .eq('user_id', sessionEmail)
      if (error) {
        console.error('[deleteNote] Supabase delete failed:', error.message, error)
      }
    } catch (e) {
      console.error('[deleteNote] Unexpected error:', e)
    }
  }

  const updateNote = async (id: string, res: StructureResult, tx: string) => {
    const updated = savedNotes.map((n) =>
      n.id === id ? { ...n, result: res, transcript: tx } : n
    )
    setSavedNotes(updated)
    try {
      if (sessionEmail && notesStorageKey) {
        localStorage.setItem(notesStorageKey, JSON.stringify(updated))
      }
    } catch {}
    if (selectedNote?.id === id) setSelectedNote({ ...selectedNote, result: res, transcript: tx })
    if (result) setResult(res)
    if (!sessionEmail || !isSupabaseConfigured) return
    try {
      const { error } = await supabase
        .from('notes')
        .update({
          raw_text: tx,
          structured_output: buildStructuredOutputForSupabase(res),
        })
        .eq('id', id)
        .eq('user_id', sessionEmail)
      if (error) {
        console.error('[updateNote] Supabase update failed:', error.message, error)
      }
    } catch (e) {
      console.error('[updateNote] Unexpected error:', e)
    }
  }

  const buildShareText = (r: StructureResult) => formatProfessionalCrmNote(r)

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
            body: JSON.stringify({
              note: combined,
              timezone: getClientTimezone(),
              clientNow: getClientNowIso(),
            }),
          })
          const strData = await strRes.json()
          if (!strRes.ok) throw new Error(strData.error)
          let final = normalizeStructureResult({ ...emptyResult, ...strData } as StructureResult)
          final = inferMissingContact(final)
          final = finalizeNextStepFields(final, combined)
          final = applyConfidenceDefaults(final)
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
    return formatProfessionalCrmNote(r)
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

  /** History list: total actionable items (prefers normalized `actions[]` when present). */
  const historyActionCount = (r: StructureResult) => {
    const fromNormalized = Array.isArray(r.actions) ? r.actions.length : 0
    if (fromNormalized > 0) return fromNormalized
    const n =
      (isNoClearFollowUpResult(r) ? 0 : 1) + (r.additionalSteps?.length ?? 0)
    return Math.max(0, n)
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
      setPendingDatePick(null)
      setPendingContactPick(null)
      setPendingTargetPick(null)
      setPendingCompanyPick(null)
      setPendingNextStepClarifyPick(null)
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
    // Check subscription FIRST before any processing
    const subRes = await fetch('/api/subscription')
    const subData = await subRes.json()
    if (subData.active === false) {
      setShowPaywall(true)
      return
    }

    processingStartedAtRef.current = Date.now()
    setLoading(true)
    setError('')
    setResult(null)
    setPendingDatePick(null)
    setPendingContactPick(null)
    setPendingTargetPick(null)
    setPendingCompanyPick(null)
    setPendingNextStepClarifyPick(null)
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
        body: JSON.stringify({
          note: tx,
          timezone: getClientTimezone(),
          clientNow: getClientNowIso(),
        }),
      })
      
      const structureData = await structureRes.json()
      if (!structureRes.ok) {
        throw new Error(structureData.error || 'Failed to structure.')
      }

      let final = normalizeStructureResult({ ...emptyResult, ...structureData } as StructureResult)

      if (
        !isNoClearFollowUpResult(final) &&
        (isWeakNextStep(final.nextStep) || !hasStrongVerb(final.nextStep))
      ) {
        try {
          const fixedNextStep = await fixNextStep({
            nextStep: final.nextStep,
            customer: final.customer,
            contact: final.contact,
          })

          final = { ...final, nextStep: fixedNextStep }
        } catch (error) {
          console.error('Failed to auto-correct next step:', error)
        }
      }

      final = inferMissingContact(final)
      final = finalizeNextStepFields(final, tx)
      final = applyConfidenceDefaults(final)

      await awaitMinProcessingDisplay()
      if (needsContactPick(final)) {
        setPendingContactPick({ result: final, transcript: tx })
      } else if (needsNextStepTargetPick(final)) {
        setPendingTargetPick({ result: final, transcript: tx })
      } else if (needsContactCompanyPick(final)) {
        setPendingCompanyPick({ result: final, transcript: tx })
      } else if (needsNextStepClarifyPick(final)) {
        setPendingNextStepClarifyPick({ result: final, transcript: tx })
      } else if (needsNextStepDatePick(final)) {
        setPendingDatePick({ result: final, transcript: tx })
      } else {
        await new Promise((r) => setTimeout(r, 550))
        setResult(final)
        await saveNote(final, tx).catch((err) => {
          console.error('Save failed:', err)
        })
      }
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
    setPendingDatePick(null)
    setPendingContactPick(null)
    setPendingTargetPick(null)
    setPendingCompanyPick(null)
    setPendingNextStepClarifyPick(null)
    setCopied(false)
    try {
      const res = await fetch('/api/structure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          note: input,
          timezone: getClientTimezone(),
          clientNow: getClientNowIso(),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to process note.')
      let final = normalizeStructureResult({ ...emptyResult, ...data } as StructureResult)
      final = inferMissingContact(final)
      final = finalizeNextStepFields(final, input)
      final = applyConfidenceDefaults(final)
      await awaitMinProcessingDisplay()
      if (needsContactPick(final)) {
        setPendingContactPick({ result: final, transcript: input })
      } else if (needsNextStepTargetPick(final)) {
        setPendingTargetPick({ result: final, transcript: input })
      } else if (needsContactCompanyPick(final)) {
        setPendingCompanyPick({ result: final, transcript: input })
      } else if (needsNextStepClarifyPick(final)) {
        setPendingNextStepClarifyPick({ result: final, transcript: input })
      } else if (needsNextStepDatePick(final)) {
        setPendingDatePick({ result: final, transcript: input })
      } else {
        setResult(final)
        await saveNote(final, input).catch((err) => {
          console.error('Save failed:', err)
        })
      }
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
    setPendingDatePick(null)
    setPendingContactPick(null)
    setPendingTargetPick(null)
    setPendingCompanyPick(null)
    setPendingNextStepClarifyPick(null)
    setError('')
    setTranscript('')
    setCopied(false)
    setSelectedNote(null)
    setShowEditArea(false)
    setShowCalendarToast(false)
    setPrimaryAdded(false)
    setSupportingAdded({})
  }

  /** One click: Google Calendar when signed in with Google; otherwise download ICS. */
  const addResultToCalendar = (r: StructureResult, opts?: { noteId?: string | null }) => {
    if (isNoClearFollowUpResult(r)) return
    if (navigator.vibrate) navigator.vibrate(10)
    const calendarOpts = buildCalendarOpenOptsFromResult(r)
    const range = buildGoogleCalendarDateRangeParts(calendarOpts.dateMmddyyyy, calendarOpts.time)
    if (!range) {
      setError('Could not build the event. Check date and time in the note.')
      return
    }
    setPrimaryAdded(true)

    if (session?.user) {
      openGoogleCalendarWindow(calendarOpts)
      setShowCalendarToast(true)
      return
    }
    const ok = openAppleCalendarFromOpts(calendarOpts)
    if (ok) {
      setShowCalendarToast(true)
    } else {
      setPrimaryAdded(false)
      setError('Could not create the calendar file.')
    }
  }

  const addSupportingStepToCalendar = (
    r: StructureResult,
    step: AdditionalStep,
    index: number,
    opts?: { noteId?: string | null },
  ) => {
    if (isNoClearFollowUpResult(r)) return
    if (navigator.vibrate) navigator.vibrate(10)
    const calendarOpts = buildCalendarOpenOptsForSupportingStep(r, step)
    const range = buildGoogleCalendarDateRangeParts(calendarOpts.dateMmddyyyy, calendarOpts.time)
    if (!range) {
      setError('Could not build the event. Check date and time for this action.')
      return
    }
    const stepId = supportingCalendarStepId(index)
    setSupportingAdded((prev) => ({ ...prev, [stepId]: true }))

    if (session?.user) {
      openGoogleCalendarWindow(calendarOpts)
      setShowCalendarToast(true)
      return
    }
    const ok = openAppleCalendarFromOpts(calendarOpts)
    if (ok) {
      setShowCalendarToast(true)
    } else {
      setSupportingAdded((prev) => {
        const next = { ...prev }
        delete next[stepId]
        return next
      })
      setError('Could not create the calendar file.')
    }
  }

  if (!mounted) return null

  if (status === 'loading') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-white text-[#111111] antialiased">
        <p className="text-[14px] text-[#6b7280]">Loading…</p>
      </main>
    )
  }

  const isDemo = typeof window !== 'undefined' && window.location.pathname.startsWith('/try')
  if (status === 'unauthenticated' && !isDemo) {
    return (
      <main className="flex min-h-[100dvh] flex-col bg-white px-6 pb-10 text-[#111111] antialiased sm:px-8 sm:pb-12">
        <div className="mx-auto w-full max-w-[19rem] pt-[4.25rem] pb-[min(7.5rem,22vh)] sm:max-w-[20rem] sm:pt-[4.75rem]">
          <div className="flex flex-col items-center text-center">
            <div className="mb-8 flex w-full justify-center">
              <FolupLogo
                src="/folup_logo.png"
                width={3077}
                height={1200}
                className="flex justify-center"
                imgClassName="h-10 w-auto max-w-[min(100%,14rem)] object-contain sm:h-11"
              />
            </div>
            <h1 className="max-w-[16rem] text-balance text-[1.375rem] font-bold leading-snug tracking-[-0.012em] text-zinc-950 sm:max-w-[17rem] sm:text-[1.5rem] sm:leading-tight">
              Just left a client visit?
            </h1>
            <p className="mt-2.5 max-w-[18rem] text-pretty text-[0.875rem] font-medium leading-relaxed text-zinc-600 sm:text-[0.9375rem]">
              Record 30 seconds and never forget a follow-up again. Get your next step, calendar event, and CRM note — ready to use.
            </p>
            <button
              type="button"
              onClick={signInWithGoogle}
              className="mt-9 flex w-full max-w-[14.125rem] items-center justify-center gap-1.5 self-center rounded-lg bg-[#4F46E5] px-4 py-2 text-[0.9375rem] font-semibold text-white shadow-sm transition-[transform,box-shadow,background-color] hover:bg-[#4338CA] hover:shadow-md active:scale-[0.99]"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" className="shrink-0" aria-hidden>
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Continue with Google
            </button>
          </div>
        </div>
      </main>
    )
  }

  const userImage = session?.user?.image
  const userName = session?.user?.name?.trim() || session?.user?.email || 'Account'
  const userInitial = (session?.user?.name?.trim()?.[0] || session?.user?.email?.[0] || '?').toUpperCase()

  return (
    <main className="flex min-h-screen flex-col bg-white text-[#111111] antialiased select-none">

      {/* Header */}
      <header className="relative flex items-center border-b border-[#e5e7eb] bg-white px-5 pb-2 pt-8">
        <div className="relative z-10 flex min-w-0 flex-1 items-center">
          <FolupHeaderBrand />
        </div>
        <div className="relative z-10 ml-auto shrink-0">
        {userImage ? (
          <img
            src={userImage}
            alt=""
            width={28}
            height={28}
            className="h-7 w-7 rounded-full object-cover ring-2 ring-zinc-200 shadow-sm"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div
            className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold text-white"
            style={{ backgroundColor: '#4F46E5' }}
            aria-hidden
          >
            {userInitial}
          </div>
        )}
        </div>
      </header>

      {/* Full-screen processing — single calm state */}
      {loading && (
        <div
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-zinc-900/45 px-8 backdrop-blur-[3px]"
          style={{
            animation: 'processingOverlayIn 0.48s cubic-bezier(0.4, 0, 0.2, 1) forwards',
            backgroundColor: 'rgba(255,255,255,0.96)',
            WebkitBackdropFilter: 'blur(8px)',
            backdropFilter: 'blur(8px)',
          }}
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <div className="flex flex-col items-center gap-0">
            <div style={{position:'relative',width:68,height:68}}>
              <svg width="68" height="68" viewBox="0 0 68 68" style={{position:'absolute',top:0,left:0}}>
                <circle cx="34" cy="34" r="26" fill="none" stroke="rgba(0,0,0,0.06)" strokeWidth="1.2"/>
              </svg>
              <svg width="68" height="68" viewBox="0 0 68 68" style={{position:'absolute',top:0,left:0,transformOrigin:'34px 34px',animation:'processingRingSpin 1.6s linear infinite'}}>
                <circle cx="34" cy="34" r="26" fill="none"
                  stroke="#4F46E5"
                  strokeWidth="1.4" strokeLinecap="round" strokeDasharray="32 132"
                />
              </svg>
              <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center'}}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="rgba(0,0,0,0.6)">
                  <path d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4z"/>
                  <path d="M19 10a1 1 0 0 0-2 0 5 5 0 0 1-10 0 1 1 0 0 0-2 0 7 7 0 0 0 6 6.92V19H9a1 1 0 0 0 0 2h6a1 1 0 0 0 0-2h-2v-2.08A7 7 0 0 0 19 10z"/>
                </svg>
              </div>
            </div>

            <p style={{
              marginTop:28,
              fontSize:15,
              fontWeight:500,
              color:'#111111',
              letterSpacing:'-0.01em',
              transition:'opacity 0.35s ease',
              textAlign:'center'
            }}>
              {loadingMessages[loadingMsgIndex]}
            </p>

            <div style={{display:'flex',gap:7,marginTop:18}}>
              {[0,1,2].map(i => (
                <span key={i} style={{
                  width:5, height:5, borderRadius:'50%', display:'inline-block',
                  transition:'background 0.4s ease, transform 0.3s ease',
                  transform: i === loadingMsgIndex % 3 ? 'scale(1.5)' : 'scale(1)',
                  background: i === loadingMsgIndex % 3 ? '#4F46E5' : 'rgba(0,0,0,0.15)'
                }}/>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Contact missing — same sheet pattern as date picker */}
      {pendingContactPick && !loading && (
        <div
          className="fixed inset-0 z-[99] flex flex-col justify-end bg-black/35 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-10 backdrop-blur-[2px]"
          style={{ animation: 'processingOverlayIn 0.48s cubic-bezier(0.4, 0, 0.2, 1) forwards' }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="contact-pick-title"
        >
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="Skip without contact"
            onClick={() => {
              if (navigator.vibrate) navigator.vibrate(6)
              commitPendingContactSaltar()
            }}
          />
          <div className="relative z-[1] mx-auto w-full max-w-md rounded-2xl border border-[#e5e7eb] bg-[#f8f8f8] p-4 shadow-[0_8px_32px_rgba(0,0,0,0.06)]">
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <p id="contact-pick-title" className="text-[15px] font-bold leading-snug text-[#111111]">
                  Who did you speak with?
                </p>
                <p className="mt-0.5 text-[12px] leading-snug text-[#6b7280]">
                  We couldn&apos;t detect a contact name in the note
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (navigator.vibrate) navigator.vibrate(6)
                  commitPendingContactSaltar()
                }}
                className="shrink-0 rounded-full p-1.5 text-[#6b7280] transition-colors hover:bg-zinc-100 hover:text-[#111111]"
                aria-label="Skip"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <label className="sr-only" htmlFor="contact-pick-input">
              Contact name
            </label>
            <input
              id="contact-pick-input"
              type="text"
              value={contactPickInput}
              onChange={(e) => setContactPickInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && contactPickInput.trim()) {
                  e.preventDefault()
                  commitPendingContactContinuar()
                }
              }}
              placeholder="Contact name"
              autoComplete="name"
              autoFocus
              className="mb-3 w-full rounded-xl border border-[#e5e7eb] bg-white px-3.5 py-3 text-[15px] font-medium text-[#111111] outline-none placeholder:text-[#6b7280]/55 focus:border-indigo-500/55 focus:ring-0"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  if (navigator.vibrate) navigator.vibrate(6)
                  commitPendingContactSaltar()
                }}
                className="flex-1 rounded-xl border border-[#e5e7eb] bg-[#f8f8f8] py-3.5 text-[14px] font-semibold text-[#111111] transition-colors hover:bg-zinc-100 active:scale-[0.99]"
              >
                Skip
              </button>
              <button
                type="button"
                disabled={!contactPickInput.trim()}
                onClick={() => {
                  if (navigator.vibrate) navigator.vibrate(8)
                  commitPendingContactContinuar()
                }}
                className="flex-1 rounded-xl py-3.5 text-[14px] font-bold text-white shadow-sm transition-[transform,filter] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
                style={{ backgroundColor: '#4F46E5' }}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Follow-up target — direct contact only (reliability) */}
      {pendingTargetPick && !loading && (
        <div
          className="fixed inset-0 z-[99] flex flex-col justify-end bg-black/35 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-10 backdrop-blur-[2px]"
          style={{ animation: 'processingOverlayIn 0.48s cubic-bezier(0.4, 0, 0.2, 1) forwards' }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="target-pick-title"
        >
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="Use contact as follow-up target"
            onClick={() => {
              if (navigator.vibrate) navigator.vibrate(6)
              commitPendingTargetSaltar()
            }}
          />
          <div className="relative z-[1] mx-auto w-full max-w-md rounded-2xl border border-[#e5e7eb] bg-[#f8f8f8] p-4 shadow-[0_8px_32px_rgba(0,0,0,0.06)]">
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <p id="target-pick-title" className="text-[15px] font-bold leading-snug text-[#111111]">
                  Who is this follow-up for?
                </p>
                <p className="mt-0.5 text-[12px] leading-snug text-[#6b7280]">
                  Must be the person you spoke with directly — not someone only mentioned in passing
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (navigator.vibrate) navigator.vibrate(6)
                  commitPendingTargetSaltar()
                }}
                className="shrink-0 rounded-full p-1.5 text-[#6b7280] transition-colors hover:bg-zinc-100 hover:text-[#111111]"
                aria-label="Skip"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <label className="sr-only" htmlFor="target-pick-input">
              Follow-up contact name
            </label>
            <input
              id="target-pick-input"
              type="text"
              value={targetPickInput}
              onChange={(e) => setTargetPickInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && targetPickInput.trim()) {
                  e.preventDefault()
                  commitPendingTargetContinuar()
                }
              }}
              placeholder="Direct contact name"
              autoComplete="name"
              autoFocus
              className="mb-3 w-full rounded-xl border border-[#e5e7eb] bg-white px-3.5 py-3 text-[15px] font-medium text-[#111111] outline-none placeholder:text-[#6b7280]/55 focus:border-indigo-500/55 focus:ring-0"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  if (navigator.vibrate) navigator.vibrate(6)
                  commitPendingTargetSaltar()
                }}
                className="flex-1 rounded-xl border border-[#e5e7eb] bg-[#f8f8f8] py-3.5 text-[14px] font-semibold text-[#111111] transition-colors hover:bg-zinc-100 active:scale-[0.99]"
              >
                Use saved contact
              </button>
              <button
                type="button"
                disabled={!targetPickInput.trim()}
                onClick={() => {
                  if (navigator.vibrate) navigator.vibrate(8)
                  commitPendingTargetContinuar()
                }}
                className="flex-1 rounded-xl py-3.5 text-[14px] font-bold text-white shadow-sm transition-[transform,filter] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
                style={{ backgroundColor: '#4F46E5' }}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* contactCompany missing — after contact, before date */}
      {pendingCompanyPick && !loading && (
        <div
          className="fixed inset-0 z-[99] flex flex-col justify-end bg-black/35 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-10 backdrop-blur-[2px]"
          style={{ animation: 'processingOverlayIn 0.48s cubic-bezier(0.4, 0, 0.2, 1) forwards' }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="company-pick-title"
        >
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="Continue without company"
            onClick={() => {
              if (navigator.vibrate) navigator.vibrate(6)
              commitPendingCompanySaltar()
            }}
          />
          <div className="relative z-[1] mx-auto w-full max-w-md rounded-2xl border border-[#e5e7eb] bg-[#f8f8f8] p-4 shadow-[0_8px_32px_rgba(0,0,0,0.06)]">
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <p id="company-pick-title" className="text-[15px] font-bold leading-snug text-[#111111]">
                  Which company?
                </p>
                <p className="mt-0.5 text-[12px] leading-snug text-[#6b7280]">
                  We couldn&apos;t detect the contact&apos;s company
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (navigator.vibrate) navigator.vibrate(6)
                  commitPendingCompanySaltar()
                }}
                className="shrink-0 rounded-full p-1.5 text-[#6b7280] transition-colors hover:bg-zinc-100 hover:text-[#111111]"
                aria-label="Skip"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <label className="sr-only" htmlFor="company-pick-input">
              Contact&apos;s company
            </label>
            <input
              id="company-pick-input"
              type="text"
              value={companyPickInput}
              onChange={(e) => setCompanyPickInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && companyPickInput.trim()) {
                  e.preventDefault()
                  commitPendingCompanyContinuar()
                }
              }}
              placeholder="Company name"
              autoComplete="organization"
              autoFocus
              className="mb-3 w-full rounded-xl border border-[#e5e7eb] bg-white px-3.5 py-3 text-[15px] font-medium text-[#111111] outline-none placeholder:text-[#6b7280]/55 focus:border-indigo-500/55 focus:ring-0"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  if (navigator.vibrate) navigator.vibrate(6)
                  commitPendingCompanySaltar()
                }}
                className="flex-1 rounded-xl border border-[#e5e7eb] bg-[#f8f8f8] py-3.5 text-[14px] font-semibold text-[#111111] transition-colors hover:bg-zinc-100 active:scale-[0.99]"
              >
                Skip
              </button>
              <button
                type="button"
                disabled={!companyPickInput.trim()}
                onClick={() => {
                  if (navigator.vibrate) navigator.vibrate(8)
                  commitPendingCompanyContinuar()
                }}
                className="flex-1 rounded-xl py-3.5 text-[14px] font-bold text-white shadow-sm transition-[transform,filter] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
                style={{ backgroundColor: '#4F46E5' }}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Vague next step — after company, before date */}
      {pendingNextStepClarifyPick && !loading && (
        <div
          className="fixed inset-0 z-[99] flex flex-col justify-end bg-black/35 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-10 backdrop-blur-[2px]"
          style={{ animation: 'processingOverlayIn 0.48s cubic-bezier(0.4, 0, 0.2, 1) forwards' }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="next-step-clarify-title"
        >
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="Skip without changing next step"
            onClick={() => {
              if (navigator.vibrate) navigator.vibrate(6)
              commitPendingNextStepClarifySaltar()
            }}
          />
          <div className="relative z-[1] mx-auto w-full max-w-md rounded-2xl border border-[#e5e7eb] bg-[#f8f8f8] p-4 shadow-[0_8px_32px_rgba(0,0,0,0.06)]">
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <p id="next-step-clarify-title" className="text-[15px] font-bold leading-snug text-[#111111]">
                  What exactly?
                </p>
                <p className="mt-0.5 text-[12px] leading-snug text-[#6b7280]">
                  The next step isn&apos;t clear
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (navigator.vibrate) navigator.vibrate(6)
                  commitPendingNextStepClarifySaltar()
                }}
                className="shrink-0 rounded-full p-1.5 text-[#6b7280] transition-colors hover:bg-zinc-100 hover:text-[#111111]"
                aria-label="Skip"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  if (navigator.vibrate) navigator.vibrate(8)
                  commitPendingNextStepClarifyQuick('call')
                }}
                className="rounded-xl border border-[#e5e7eb] bg-white py-3 px-3 text-left text-[13px] font-semibold leading-snug text-[#111111] transition-colors active:scale-[0.99] hover:bg-zinc-100"
              >
                📞 Call
              </button>
              <button
                type="button"
                onClick={() => {
                  if (navigator.vibrate) navigator.vibrate(8)
                  commitPendingNextStepClarifyQuick('send')
                }}
                className="rounded-xl border border-[#e5e7eb] bg-white py-3 px-3 text-left text-[13px] font-semibold leading-snug text-[#111111] transition-colors active:scale-[0.99] hover:bg-zinc-100"
              >
                📧 Send info
              </button>
              <button
                type="button"
                onClick={() => {
                  if (navigator.vibrate) navigator.vibrate(8)
                  commitPendingNextStepClarifyQuick('visit')
                }}
                className="rounded-xl border border-[#e5e7eb] bg-[#f8f8f8] py-3 px-3 text-left text-[13px] font-semibold leading-snug text-[#111111] transition-colors active:scale-[0.99] hover:bg-zinc-100"
              >
                🚗 Visit
              </button>
              <button
                type="button"
                onClick={() => {
                  if (navigator.vibrate) navigator.vibrate(8)
                  commitPendingNextStepClarifyQuick('samples')
                }}
                className="rounded-xl border border-[#e5e7eb] bg-[#f8f8f8] py-3 px-3 text-left text-[13px] font-semibold leading-snug text-[#111111] transition-colors active:scale-[0.99] hover:bg-zinc-100"
              >
                📦 Send materials
              </button>
            </div>
            <label className="sr-only" htmlFor="next-step-clarify-input">
              Other next step
            </label>
            <input
              id="next-step-clarify-input"
              type="text"
              value={nextStepClarifyInput}
              onChange={(e) => setNextStepClarifyInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && nextStepClarifyInput.trim()) {
                  e.preventDefault()
                  commitPendingNextStepClarifyCustom()
                }
              }}
              placeholder="Or type another action…"
              autoComplete="off"
              className="mb-3 w-full rounded-xl border border-[#e5e7eb] bg-white px-3.5 py-3 text-[15px] font-medium text-[#111111] outline-none placeholder:text-[#6b7280]/55 focus:border-indigo-500/55 focus:ring-0"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  if (navigator.vibrate) navigator.vibrate(6)
                  commitPendingNextStepClarifySaltar()
                }}
                className="flex-1 rounded-xl border border-[#e5e7eb] bg-[#f8f8f8] py-3.5 text-[14px] font-semibold text-[#111111] transition-colors hover:bg-zinc-100 active:scale-[0.99]"
              >
                Skip
              </button>
              <button
                type="button"
                disabled={!nextStepClarifyInput.trim()}
                onClick={() => {
                  if (navigator.vibrate) navigator.vibrate(8)
                  commitPendingNextStepClarifyCustom()
                }}
                className="flex-1 rounded-xl py-3.5 text-[14px] font-bold text-white shadow-sm transition-[transform,filter] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
                style={{ backgroundColor: '#4F46E5' }}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick date when model left nextStepDate empty */}
      {pendingDatePick && !loading && (
        <div
          className="fixed inset-0 z-[99] flex flex-col justify-end bg-black/35 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-10 backdrop-blur-[2px]"
          style={{ animation: 'processingOverlayIn 0.48s cubic-bezier(0.4, 0, 0.2, 1) forwards' }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="date-pick-title"
        >
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="Close and use tomorrow as default"
            onClick={() => commitPendingDatePick(dateOptionTomorrow())}
          />
          <div className="relative z-[1] mx-auto w-full max-w-md rounded-2xl border border-[#e5e7eb] bg-[#f8f8f8] p-4 shadow-[0_8px_32px_rgba(0,0,0,0.06)]">
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <p id="date-pick-title" className="text-[15px] font-bold leading-snug text-[#111111]">
                  When is the next step?
                </p>
                <p className="mt-0.5 text-[12px] leading-snug text-[#6b7280]">
                  We couldn&apos;t detect a date in the note. Pick one or close to use tomorrow.
                </p>
              </div>
              <button
                type="button"
                onClick={() => commitPendingDatePick(dateOptionTomorrow())}
                className="shrink-0 rounded-full p-1.5 text-[#6b7280] transition-colors hover:bg-zinc-100 hover:text-[#111111]"
                aria-label="Close"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2">
              <button
                type="button"
                onClick={() => {
                  if (navigator.vibrate) navigator.vibrate(8)
                  commitPendingDatePick(dateOptionToday())
                }}
                className="rounded-xl border border-[#e5e7eb] bg-white py-3.5 text-left px-4 text-[14px] font-semibold text-[#111111] transition-colors active:scale-[0.99] hover:bg-zinc-100"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => {
                  if (navigator.vibrate) navigator.vibrate(8)
                  commitPendingDatePick(dateOptionTomorrow())
                }}
                className="rounded-xl border border-emerald-200 bg-emerald-50 py-3.5 text-left px-4 text-[14px] font-semibold text-[#111111] transition-colors active:scale-[0.99] hover:bg-emerald-100/90"
              >
                Tomorrow
              </button>
              <button
                type="button"
                onClick={() => {
                  if (navigator.vibrate) navigator.vibrate(8)
                  commitPendingDatePick(dateOptionThisWeekFriday())
                }}
                className="rounded-xl border border-[#e5e7eb] bg-[#f8f8f8] py-3.5 text-left px-4 text-[14px] font-semibold text-[#111111] transition-colors active:scale-[0.99] hover:bg-zinc-100"
              >
                This week <span className="font-medium text-[#6b7280]">(Friday)</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (navigator.vibrate) navigator.vibrate(8)
                  commitPendingDatePick(dateOptionNextWeekMonday())
                }}
                className="rounded-xl border border-[#e5e7eb] bg-[#f8f8f8] py-3.5 text-left px-4 text-[14px] font-semibold text-[#111111] transition-colors active:scale-[0.99] hover:bg-zinc-100"
              >
                Next week <span className="font-medium text-[#6b7280]">(Monday)</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Note saved — floating toast; no layout shift */}
      {noteSaved && (
        <div
          className="pointer-events-none fixed left-1/2 z-[95] flex max-w-[min(20rem,90vw)] -translate-x-1/2 items-center gap-2 rounded-full border border-[#e5e7eb] bg-white/95 px-3.5 py-2 pl-2.5 text-[13px] font-medium text-[#111111] shadow-[0_4px_24px_rgba(0,0,0,0.08)] backdrop-blur-sm"
          style={{
            top: 'calc(env(safe-area-inset-top, 8px) + 3.25rem)',
            animation: 'noteSavedToast 2.1s cubic-bezier(0.4, 0, 0.2, 1) forwards',
          }}
          role="status"
          aria-live="polite"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#10b981]/95">
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
          className="pointer-events-none fixed left-1/2 z-[96] flex max-w-[min(18rem,92vw)] -translate-x-1/2 items-center gap-2 rounded-full border border-[#e5e7eb] bg-white/96 px-3.5 py-2 pl-2.5 text-[13px] font-medium text-[#111111] shadow-[0_4px_24px_rgba(0,0,0,0.08)] backdrop-blur-sm"
          style={{
            bottom: 'calc(env(safe-area-inset-bottom, 10px) + 5.5rem)',
            animation: 'calendarEventToast 2s cubic-bezier(0.4, 0, 0.2, 1) forwards',
          }}
          role="status"
          aria-live="polite"
        >
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#10b981]">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.6">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </span>
          Event created
        </div>
      )}

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-5 pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))]">

        {/* ── RECORD TAB ── */}
        {activeTab === 'record' && (
          <div
            className="relative flex flex-col"
            style={
              result || pendingDatePick || pendingContactPick || pendingTargetPick || pendingCompanyPick || pendingNextStepClarifyPick
                ? undefined
                : { minHeight: 'calc(100vh - 132px)' }
            }
          >

            {/* SCREEN 1 — Record (hidden when result exists) */}
            <div
              className="absolute inset-0 flex flex-col items-center justify-center gap-0 px-4 py-5 transition-[opacity,transform] duration-[450ms] ease-[cubic-bezier(0.4,0,0.2,1)]"
              style={{
                opacity:
                  result || loading || pendingDatePick || pendingContactPick || pendingTargetPick || pendingCompanyPick || pendingNextStepClarifyPick ? 0 : 1,
                transform: result ? 'translateY(-16px)' : loading ? 'translateY(-8px) scale(0.985)' : 'translateY(0)',
                pointerEvents:
                  result || loading || pendingDatePick || pendingContactPick || pendingTargetPick || pendingCompanyPick || pendingNextStepClarifyPick
                    ? 'none'
                    : 'auto',
              }}
            >
              <div className="mb-6 max-w-[20rem] text-center">
                <h2 className="text-2xl font-bold leading-tight tracking-tight text-[#111111] sm:text-[1.65rem]">
                  Tap to record your visit
                </h2>
              </div>
              {/* Mic button */}
              <button
                onClick={toggleRecording}
                disabled={loading}
                className="relative z-[1] mb-2 flex h-36 w-36 shrink-0 items-center justify-center rounded-full transition-[transform,box-shadow] duration-200 ease-out active:scale-[0.94] disabled:pointer-events-none disabled:active:scale-100"
                style={{
                  backgroundColor: isRecording ? '#dc2626' : '#4F46E5',
                  boxShadow: isRecording
                    ? '0 8px 32px rgba(220,38,38,0.22), 0 2px 10px rgba(220,38,38,0.11), 0 0 0 1px rgba(220,38,38,0.08)'
                    : '0 12px 40px rgba(79,70,229,0.2), 0 4px 14px rgba(79,70,229,0.11), 0 0 0 1px rgba(79,70,229,0.08)',
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
                    className="text-[48px] font-semibold tabular-nums tracking-tight leading-none text-[#111111] transition-transform duration-300 sm:text-[52px]"
                    style={{ animation: 'recording-timer-breathe 3s ease-in-out infinite' }}
                  >
                    {formatSeconds(recordingSeconds)}
                  </span>
                ) : null}
                {isRecording && showWakeLockFallbackTip ? (
                  <p className="mt-2 max-w-[17rem] px-2 text-center text-[10px] leading-snug text-[#6b7280]/75">
                    Tip: keep your screen on while recording for best results.
                  </p>
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
                  <p className="mb-1.5 text-center text-[9px] font-medium uppercase tracking-[0.12em] text-[#6b7280]/65">Mention in your note</p>
                  <div className="flex flex-wrap justify-center gap-1">
                    {[
                      { icon: '🏢', label: 'Company' },
                      { icon: '👤', label: 'Contact' },
                      { icon: '📦', label: 'Product' },
                      { icon: '📍', label: 'Location' },
                      { icon: '💬', label: 'Key points' },
                      { icon: '📅', label: 'Follow-up date' },
                    ].map((h) => (
                      <span key={h.label} className="flex items-center gap-0.5 rounded-full border px-1 py-px text-[8px] font-medium text-indigo-700 sm:text-[8.5px]" style={{borderColor:'rgba(79,70,229,0.25)',backgroundColor:'rgba(79,70,229,0.08)',animation:'fadeIn 0.4s ease forwards'}}>
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
                    className="mb-3 w-full resize-none rounded-2xl border border-[#e5e7eb] bg-[#f8f8f8] px-3.5 py-3 text-[13px] leading-relaxed text-[#111111] outline-none placeholder:text-[#6b7280]/40 min-h-[68px] shadow-inner shadow-zinc-200/50"
                    placeholder="Or type a note…"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                  />
                  {input.trim() && (
                    <button
                      onClick={processTypedNote}
                      disabled={loading}
                      className="w-full rounded-2xl py-4 text-[15px] font-semibold text-white transition-all active:scale-[0.98]"
                      style={{backgroundColor: '#4F46E5', boxShadow: '0 4px 16px rgba(79,70,229,0.25)'}}
                    >
                      Process Note
                    </button>
                  )}
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="mt-3 w-full rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
                  {error}
                </div>
              )}
            </div>

            {/* SCREEN 2 — Result (slides up when result exists) */}
            {result && (
              <div
                className="flex flex-col px-0 pt-1 pb-0"
                style={{
                  animation: 'slideUp 0.68s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards',
                }}
              >
                {/* 1 — Next step + calendar (sticky) */}
                <div className="sticky top-0 z-20 -mx-5 border-b border-zinc-200/90 bg-white/90 px-5 pb-2 pt-0 backdrop-blur-md supports-[backdrop-filter]:bg-white/85">
                  <div className="mb-1.5 flex justify-end">
                    <button
                      type="button"
                      onClick={handleReset}
                      className="flex shrink-0 items-center gap-0.5 rounded-full border border-[#e5e7eb] bg-[#f8f8f8] py-1.5 pl-2.5 pr-3 text-[11px] font-semibold text-[#6b7280] shadow-sm transition-colors hover:border-zinc-300 hover:bg-zinc-100 active:scale-[0.97]"
                    >
                      <span className="text-[13px] font-semibold leading-none text-[#111111]" aria-hidden>+</span>
                      New
                    </button>
                  </div>

                  {(result.nextStep || result.nextStepTitle) && (
                    <>
                      <div
                        className="rounded-2xl border border-[#e5e7eb] bg-[#f8f8f8] px-4 py-3 text-center ring-1 ring-indigo-500/25 shadow-[0_4px_20px_rgba(0,0,0,0.06)]"
                      >
                        <p className="mb-1 text-[9px] font-semibold uppercase tracking-[0.26em] text-[#4F46E5]">
                          {isNoClearFollowUpResult(result) ? 'Follow-up' : 'NEXT STEP'}
                        </p>
                        <p className="text-[18px] font-black leading-[1.2] tracking-[-0.02em] text-[#111111] antialiased">
                          {buildPrimaryDisplayTitle(primaryTitleForDisplay(result))}
                        </p>
                      </div>

                      {!isNoClearFollowUpResult(result) ? (
                        <button
                          onClick={() => addResultToCalendar(result)}
                          type="button"
                          disabled={primaryAdded}
                          className={`group mt-2.5 inline-flex w-full select-none items-center justify-center gap-1.5 rounded-xl py-3.5 pl-4 pr-4 text-[15px] font-bold leading-none text-white antialiased transition-[transform,box-shadow,filter] duration-200 ease-out ${
                            primaryAdded
                              ? 'cursor-default bg-emerald-600 shadow-[0_4px_18px_-4px_rgba(5,150,105,0.35),0_2px_8px_rgba(5,150,105,0.2)]'
                              : 'shadow-[0_4px_18px_-4px_rgba(79,70,229,0.35),0_2px_8px_rgba(79,70,229,0.2),inset_0_1px_0_rgba(255,255,255,0.18)] hover:shadow-[0_6px_22px_-4px_rgba(79,70,229,0.4),0_2px_10px_rgba(79,70,229,0.22),inset_0_1px_0_rgba(255,255,255,0.2)] hover:brightness-[1.02] active:translate-y-px active:scale-[0.982] active:shadow-[0_3px_12px_-2px_rgba(79,70,229,0.3),inset_0_1px_2px_rgba(0,0,0,0.12)] active:brightness-[0.95]'
                          }`}
                          style={primaryAdded ? undefined : { backgroundColor: '#4F46E5' }}
                        >
                          {primaryAdded ? (
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="block h-4 w-4 shrink-0 opacity-[0.95]" aria-hidden>
                              <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          ) : (
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="block h-4 w-4 shrink-0 opacity-[0.95]" aria-hidden>
                              <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                            </svg>
                          )}
                          <span className="tracking-tight">{primaryAdded ? 'Added' : 'Add to calendar'}</span>
                        </button>
                      ) : null}

                      {!isNoClearFollowUpResult(result) &&
                        (result.additionalSteps || []).length > 0 && (
                          <div className="mt-2.5 rounded-2xl border border-[#e5e7eb] bg-[#fafafa] px-3.5 py-3 text-left ring-1 ring-zinc-200/80 shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
                            <p className="mb-2.5 text-[9px] font-semibold uppercase tracking-[0.22em] text-[#6b7280]">
                              OTHER ACTIONS
                            </p>
                            <ul className="list-none space-y-2.5 pl-0">
                              {(result.additionalSteps || []).map((s, i) => {
                                const sid = supportingCalendarStepId(i)
                                return (
                                <li
                                  key={sid}
                                  className="flex items-start justify-between gap-2 border-b border-zinc-100 pb-2.5 last:border-0 last:pb-0"
                                >
                                  <span className="min-w-0 flex-1 text-left text-[14px] font-semibold leading-snug tracking-tight text-[#374151]">
                                    <span className="select-none text-[#6b7280]">- </span>
                                    {buildSupportingDisplayTitle({
                                      action: s.action,
                                      resolvedDate: s.resolvedDate,
                                      timeHint: s.timeHint,
                                      langEs:
                                        detectNoteLanguage(
                                          [result.nextStep, result.crmText, result.summary]
                                            .filter(Boolean)
                                            .join(' '),
                                        ).toLowerCase() === 'spanish',
                                    })}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => addSupportingStepToCalendar(result, s, i)}
                                    disabled={!!supportingAdded[sid]}
                                    className={`shrink-0 rounded-lg border px-2.5 py-1 text-[11px] font-semibold leading-none shadow-sm transition-[transform,background-color] active:scale-[0.97] ${
                                      supportingAdded[sid]
                                        ? 'cursor-default border-emerald-200 bg-emerald-50 text-emerald-700'
                                        : 'border-indigo-200/90 bg-white text-[#4F46E5] hover:bg-indigo-50'
                                    }`}
                                  >
                                    {supportingAdded[sid] ? (
                                      <span className="inline-flex items-center gap-1">
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                                          <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                        Added
                                      </span>
                                    ) : (
                                      '+ Add'
                                    )}
                                  </button>
                                </li>
                                )
                              })}
                            </ul>
                          </div>
                        )}
                    </>
                  )}
                </div>

                {/* Contact & company → Key insights → actions */}
                <div className="mt-4 flex flex-col gap-6">
                  {(result.contact || result.customer || result.location || result.crop || result.product) && (
                    <div className="rounded-2xl border border-zinc-200/90 bg-[#fafafa] px-4 py-3.5">
                      {result.contact ? (
                        <p className="text-[16px] font-bold leading-snug tracking-tight text-[#111111]">
                          {result.contact}
                        </p>
                      ) : (
                        <p
                          className={`text-[16px] font-bold leading-snug tracking-tight ${result.customer ? 'text-[#111111]' : 'text-[#6b7280]'}`}
                        >
                          {result.customer || '—'}
                        </p>
                      )}
                      {result.contactCompany ? (
                        <p className="mt-0.5 text-[13px] font-medium leading-snug text-[#6b7280]">
                          {result.contactCompany}
                        </p>
                      ) : null}
                      {(result.location || productDisplayItems(result.crop, result.product).length > 0) && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {result.location ? (
                            <span className="inline-flex max-w-full items-center rounded-full border border-zinc-200/90 bg-white px-2.5 py-1 text-[11px] font-medium text-[#6b7280]">
                              📍 {result.location}
                            </span>
                          ) : null}
                          {productDisplayItems(result.crop, result.product).map((p, i) => (
                            <span
                              key={`${p}-${i}`}
                              className="inline-flex max-w-full min-w-0 items-center rounded-full border border-zinc-200/90 bg-white px-2.5 py-1 text-[11px] font-medium text-[#6b7280]"
                            >
                              📦 {p}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {filterKeyInsightsForDisplay(result.crmFull).length > 0 && (
                    <div className="rounded-2xl border border-zinc-200/80 bg-[#fafafa] px-4 py-3.5">
                      <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#6b7280]">
                        KEY INSIGHTS
                      </p>
                      <KeyInsightsList
                        lines={filterKeyInsightsForDisplay(result.crmFull)}
                        gapClass="gap-2"
                        lineClassName="rounded-lg px-2 py-1.5 text-[12px] font-medium leading-[1.5] tracking-tight"
                        expanded={resultInsightsExpanded}
                        onToggle={() => setResultInsightsExpanded((e) => !e)}
                        buttonMarginClass="mt-3"
                        buttonTextClass="text-[11px]"
                      />
                    </div>
                  )}

                  {/* Copy / Share / Correct — inline, directly under content */}
                  <div className="flex items-center gap-2 border-t border-zinc-200/60 pt-4 pb-0">
                    <button
                      type="button"
                      onClick={() => {
                        if (navigator.vibrate) navigator.vibrate(5)
                        handleCopy()
                      }}
                      className="flex h-10 min-w-0 flex-1 items-center justify-center gap-1 rounded-xl border border-[#e5e7eb] bg-[#f8f8f8] text-[11px] font-medium text-[#6b7280] transition-all hover:border-zinc-300 hover:bg-zinc-100 hover:text-[#111111] active:scale-[0.98]"
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
                      className="flex h-10 w-11 shrink-0 items-center justify-center rounded-xl border border-[#e5e7eb] bg-[#f8f8f8] text-[#6b7280] transition-all hover:border-zinc-300 hover:bg-zinc-100 hover:text-[#111111] active:scale-[0.98]"
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
                  className="mb-4 flex items-center gap-2 text-[13px] text-[#6b7280] hover:text-[#111111]"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M15 18l-6-6 6-6"/>
                  </svg>
                  Back to history
                </button>

                <div className="space-y-7">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6b7280]">{formatDate(selectedNote.date)}</p>

                  <div className="rounded-2xl border border-zinc-200/90 bg-[#fafafa] px-4 py-4">
                    <div className="flex items-center gap-3.5">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-zinc-200/70 text-[13px] font-bold text-[#111111]">
                        {selectedNote.result.contact ? getInitials(selectedNote.result.contact) : 'NA'}
                      </div>
                      <div>
                        <p className="text-[20px] font-bold text-[#111111]">{selectedNote.result.contact || '—'}</p>
                        {selectedNote.result.contactCompany ? (
                          <p className="text-[13px] text-[#6b7280] mt-0.5">{selectedNote.result.contactCompany}</p>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {(selectedNote.result.location ||
                    productDisplayItems(selectedNote.result.crop, selectedNote.result.product).length > 0) && (
                    <div className="flex flex-wrap gap-1.5">
                      {selectedNote.result.location ? (
                        <span className="inline-flex max-w-full items-center rounded-full border border-zinc-200/90 bg-[#fafafa] px-3 py-1.5 text-[11px] text-[#6b7280]">
                          📍 {selectedNote.result.location}
                        </span>
                      ) : null}
                      {productDisplayItems(selectedNote.result.crop, selectedNote.result.product).map((p, i) => (
                        <span
                          key={`${p}-${i}`}
                          className="inline-flex max-w-full min-w-0 items-center rounded-full border border-zinc-200/90 bg-[#fafafa] px-3 py-1.5 text-[11px] text-[#6b7280]"
                        >
                          📦 {p}
                        </span>
                      ))}
                    </div>
                  )}

                  {filterKeyInsightsForDisplay(selectedNote.result.crmFull).length > 0 && (
                    <div className="rounded-2xl border border-zinc-200/80 bg-[#fafafa] px-4 py-4">
                      <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#6b7280]">
                        KEY INSIGHTS
                      </p>
                      <KeyInsightsList
                        lines={filterKeyInsightsForDisplay(selectedNote.result.crmFull)}
                        gapClass="gap-4"
                        lineClassName="rounded-lg px-3 py-2.5 text-[15px] font-medium leading-[1.65] tracking-tight"
                        expanded={historyInsightsExpanded}
                        onToggle={() => setHistoryInsightsExpanded((e) => !e)}
                        buttonMarginClass="mt-3"
                        buttonTextClass="text-[12px]"
                      />
                    </div>
                  )}

                  {(selectedNote.result.nextStep || selectedNote.result.nextStepTitle) && (
                    <>
                      <div className="rounded-2xl border border-[#e5e7eb] bg-[#f8f8f8] px-4 py-4 ring-1 ring-indigo-500/20">
                        <div className="mb-2 flex items-center gap-2">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="#818cf8">
                            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                          </svg>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#4F46E5]">
                            {isNoClearFollowUpResult(selectedNote.result) ? 'Follow-up' : 'NEXT STEP'}
                          </p>
                        </div>
                        <p className="text-[19px] font-bold leading-snug text-[#111111]">
                          {buildPrimaryDisplayTitle(primaryTitleForDisplay(selectedNote.result))}
                        </p>
                      </div>

                      {!isNoClearFollowUpResult(selectedNote.result) ? (
                        <button
                          type="button"
                          onClick={() => addResultToCalendar(selectedNote.result, { noteId: selectedNote.id })}
                          disabled={primaryAdded}
                          className={`group mt-2.5 inline-flex w-full select-none items-center justify-center gap-1.5 rounded-xl py-3.5 pl-4 pr-4 text-[15px] font-bold leading-none text-white antialiased transition-[transform,box-shadow,filter] duration-200 ${
                            primaryAdded
                              ? 'cursor-default bg-emerald-600 shadow-[0_4px_18px_-4px_rgba(5,150,105,0.35),0_2px_8px_rgba(5,150,105,0.2)]'
                              : 'shadow-[0_4px_18px_-4px_rgba(79,70,229,0.35),0_2px_8px_rgba(79,70,229,0.2),inset_0_1px_0_rgba(255,255,255,0.18)] hover:brightness-[1.02] active:translate-y-px active:scale-[0.982] active:brightness-[0.95]'
                          }`}
                          style={primaryAdded ? undefined : { backgroundColor: '#4F46E5' }}
                        >
                          {primaryAdded ? (
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="block h-4 w-4 shrink-0 opacity-[0.95]" aria-hidden>
                              <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          ) : (
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="block h-4 w-4 shrink-0 opacity-[0.95]" aria-hidden>
                              <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                            </svg>
                          )}
                          <span className="tracking-tight">{primaryAdded ? 'Added' : 'Add to calendar'}</span>
                        </button>
                      ) : null}

                      {!isNoClearFollowUpResult(selectedNote.result) &&
                        (selectedNote.result.additionalSteps || []).length > 0 && (
                          <div className="mt-2.5 rounded-2xl border border-[#e5e7eb] bg-[#fafafa] px-3.5 py-3 ring-1 ring-zinc-200/80">
                            <p className="mb-2.5 text-[9px] font-semibold uppercase tracking-[0.22em] text-[#6b7280]">
                              OTHER ACTIONS
                            </p>
                            <ul className="list-none space-y-2.5 pl-0">
                              {(selectedNote.result.additionalSteps || []).map((s, i) => {
                                const sid = supportingCalendarStepId(i)
                                return (
                                <li
                                  key={sid}
                                  className="flex items-start justify-between gap-2 border-b border-zinc-100 pb-2.5 last:border-0 last:pb-0"
                                >
                                  <span className="min-w-0 flex-1 text-left text-[14px] font-semibold leading-snug tracking-tight text-[#374151]">
                                    <span className="select-none text-[#6b7280]">- </span>
                                    {buildSupportingDisplayTitle({
                                      action: s.action,
                                      resolvedDate: s.resolvedDate,
                                      timeHint: s.timeHint,
                                      langEs:
                                        detectNoteLanguage(
                                          [
                                            selectedNote.result.nextStep,
                                            selectedNote.result.crmText,
                                            selectedNote.result.summary,
                                          ]
                                            .filter(Boolean)
                                            .join(' '),
                                        ).toLowerCase() === 'spanish',
                                    })}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      addSupportingStepToCalendar(selectedNote.result, s, i, {
                                        noteId: selectedNote.id,
                                      })
                                    }
                                    disabled={!!supportingAdded[sid]}
                                    className={`shrink-0 rounded-lg border px-2.5 py-1 text-[11px] font-semibold leading-none shadow-sm transition-[transform,background-color] active:scale-[0.97] ${
                                      supportingAdded[sid]
                                        ? 'cursor-default border-emerald-200 bg-emerald-50 text-emerald-700'
                                        : 'border-indigo-200/90 bg-white text-[#4F46E5] hover:bg-indigo-50'
                                    }`}
                                  >
                                    {supportingAdded[sid] ? (
                                      <span className="inline-flex items-center gap-1">
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                                          <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                        Added
                                      </span>
                                    ) : (
                                      '+ Add'
                                    )}
                                  </button>
                                </li>
                                )
                              })}
                            </ul>
                          </div>
                        )}
                    </>
                  )}

                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={handleCopy}
                      className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-[#e5e7eb] bg-[#f8f8f8] py-3.5 text-[13px] font-medium text-[#6b7280] shadow-sm transition-all hover:text-[#111111] active:scale-[0.98]"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="9" y="9" width="13" height="13" rx="2"/>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                      </svg>
                      {copied ? 'Copied!' : 'Copy for CRM'}
                    </button>
                    <button
                      onClick={() => handleShare(selectedNote.result)}
                      className="flex items-center justify-center gap-1.5 rounded-2xl border border-[#e5e7eb] bg-[#f8f8f8] px-3.5 py-3.5 text-[#6b7280] shadow-sm transition-all active:scale-[0.98]"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>
                      </svg>
                    </button>
                    <button
                      onClick={() => deleteNote(selectedNote.id)}
                      className="rounded-2xl border border-red-200 bg-red-50 px-4 text-[13px] text-red-600 transition-all hover:bg-red-100 active:scale-[0.98]"
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
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#6b7280]">
                    <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
                  </svg>
                  <input
                    type="text"
                    placeholder="Search notes..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full rounded-2xl border border-[#e5e7eb] bg-[#f8f8f8] py-3 pl-9 pr-4 text-[14px] text-[#111111] outline-none shadow-sm placeholder:text-[#6b7280]"
                  />
                </div>
                <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6b7280]">
                  {savedNotes.length} {savedNotes.length === 1 ? 'note' : 'notes'} saved
                </p>
                {savedNotes.length === 0 ? (
                  <div className="flex flex-col items-center justify-center pt-12 text-center">
                    <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#f8f8f8] ring-1 ring-zinc-200">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="1.5" opacity="0.65">
                        <path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="10"/>
                      </svg>
                    </div>
                    <p className="text-[13px] text-[#6b7280]">No notes yet</p>
                    <p className="mt-1 text-[11px] text-[#111111]">Record your first visit to get started</p>
                  </div>
                ) : (
                  <ul className="space-y-1.5">
                    {savedNotes.filter((note) => {
                      if (!searchQuery.trim()) return true
                      const q = searchQuery.toLowerCase()
                      return (
                        note.result.contact?.toLowerCase().includes(q) ||
                        note.result.contactCompany?.toLowerCase().includes(q) ||
                        note.result.customer?.toLowerCase().includes(q) ||
                        note.result.product?.toLowerCase().includes(q) ||
                        note.result.crop?.toLowerCase().includes(q) ||
                        note.result.location?.toLowerCase().includes(q) ||
                        note.result.nextStep?.toLowerCase().includes(q) ||
                        note.result.nextStepTitle?.toLowerCase().includes(q) ||
                        note.result.crmFull.some((line) => line.toLowerCase().includes(q)) ||
                        note.result.crmText?.toLowerCase().includes(q) ||
                        note.result.calendarDescription?.toLowerCase().includes(q)
                      )
                    }).map((note) => {
                      const ac = historyActionCount(note.result)
                      const contactLine =
                        note.result.contact || note.result.customer || '—'
                      const stepLine =
                        note.result.nextStep || note.result.nextStepTitle
                          ? buildPrimaryDisplayTitle(primaryTitleForDisplay(note.result))
                          : '—'
                      return (
                        <li key={note.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedNote(note)}
                            className="w-full rounded-xl border border-zinc-200/80 bg-white px-3 py-2.5 text-left transition-colors hover:bg-[#fafafa] active:scale-[0.995]"
                          >
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="text-[11px] tabular-nums text-[#6b7280]">
                                {formatDate(note.date)}
                              </span>
                              <span className="shrink-0 text-[10px] font-medium tabular-nums text-[#6b7280]">
                                {ac} {ac === 1 ? 'action' : 'actions'}
                              </span>
                            </div>
                            <p className="mt-1 truncate text-[13px] font-semibold leading-tight text-[#111111]">
                              {contactLine}
                            </p>
                            <p
                              className="mt-0.5 truncate text-[12px] leading-snug text-[#4F46E5]"
                              title={stepLine}
                            >
                              {stepLine}
                            </p>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── SETTINGS TAB ── */}
        {activeTab === 'settings' && (
          <div className="pt-2 space-y-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6b7280]">Account</p>
            <div className="rounded-2xl border border-[#e5e7eb]/70 bg-[#f8f8f8] px-4 py-4 shadow-sm">
              <div className="flex items-center gap-3">
                {userImage ? (
                  <img
                    src={userImage}
                    alt=""
                    width={40}
                    height={40}
                    className="h-10 w-10 rounded-full object-cover ring-2 ring-zinc-200"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-full text-[13px] font-bold text-white"
                    style={{ backgroundColor: '#4F46E5' }}
                    aria-hidden
                  >
                    {userInitial}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-[#111111]">{userName}</p>
                  <p className="truncate text-[12px] text-[#6b7280]">
                    {session?.user?.email || 'Signed in with Google'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => signOut({ callbackUrl: '/' })}
                className="mt-4 w-full rounded-xl border border-[#e5e7eb] bg-white py-3 text-[13px] font-medium text-[#111111] transition-colors hover:bg-zinc-100"
              >
                Sign out
              </button>
            </div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6b7280]">Data</p>
            <button
              onClick={async () => {
                if (!confirm('Delete all saved notes?')) return
                setSavedNotes([])
                try {
                  if (notesStorageKey) localStorage.removeItem(notesStorageKey)
                } catch {}
                if (sessionEmail && isSupabaseConfigured) {
                  try {
                    const { error } = await supabase.from('notes').delete().eq('user_id', sessionEmail)
                    if (error) {
                      console.error('[clearAllNotes] Supabase delete failed:', error.message, error)
                    }
                  } catch (e) {
                    console.error('[clearAllNotes] Unexpected error:', e)
                  }
                }
              }}
              className="w-full rounded-2xl border border-red-200 bg-red-50 py-3.5 text-[13px] font-medium text-red-600 transition-all hover:bg-red-100"
            >
              Clear all notes
            </button>
          </div>
        )}

      </div>

      {/* ── BOTTOM NAV ── */}
      <nav className="fixed bottom-0 left-0 right-0 flex items-center justify-around border-t border-[#e5e7eb] bg-white/95 px-2 pb-safe pt-2 backdrop-blur-md">
        <NavBtn
          active={activeTab === 'record'}
          onClick={() => { setActiveTab('record'); setSelectedNote(null) }}
          label="Record"
          activeColor="#4F46E5"
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
          activeColor="#4F46E5"
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
          activeColor="#4F46E5"
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
          0%, 100% { box-shadow: 0 0 0 0 rgba(79, 70, 229, 0); opacity: 1; }
          50% { box-shadow: 0 0 28px 4px rgba(79, 70, 229, 0.1); opacity: 1; }
        }
        .pb-safe { padding-bottom: env(safe-area-inset-bottom, 12px); }
      `}</style>
      {showPaywall && (
        <div className="fixed inset-0 z-[110] flex flex-col items-center justify-center bg-black/50 px-6 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="mb-2 text-center text-[20px] font-bold text-[#111111]">
              You've used your 10 free notes
            </h2>
            <p className="mb-6 text-center text-[14px] text-[#6b7280]">
              Subscribe to Folup Pro to keep recording and never forget a follow-up again.
            </p>
            <button
              type="button"
              onClick={async () => {
                const res = await fetch('/api/stripe/checkout', { method: 'POST' })
                const data = await res.json()
                if (data.url) window.location.href = data.url
              }}
              className="w-full rounded-xl py-4 text-[15px] font-bold text-white"
              style={{ backgroundColor: '#4F46E5' }}
            >
              Subscribe — $19/month
            </button>
            <button
              type="button"
              onClick={() => setShowPaywall(false)}
              className="mt-3 w-full rounded-xl py-3 text-[13px] font-medium text-[#6b7280]"
            >
              Maybe later
            </button>
          </div>
        </div>
      )}
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
      style={{color: active ? activeColor : '#6b7280'}}
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
