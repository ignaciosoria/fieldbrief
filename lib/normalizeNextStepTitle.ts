import { buildPrimaryBaseTitle, type ActionStructuredFields } from './actionTitleContract'
import { hasExplicitMeetScheduleIntent, isNarrativeMeetingDiscussionContext } from './actionIntentGuard'
import { isNoClearFollowUpLine } from './noFollowUp'

const EM_DASH = '\u2014'

/** English titles must start with one of these. */
const VERBS_EN = ['Call', 'Send', 'Email', 'Meet'] as const

/** Spanish parallel (same language as note). */
const VERBS_ES = ['Llamar', 'Enviar', 'Email', 'Reunirse'] as const

type VerbEn = (typeof VERBS_EN)[number]
type VerbEs = (typeof VERBS_ES)[number]

function isSpanish(noteLanguage: string): boolean {
  return noteLanguage.trim().toLowerCase() === 'spanish'
}

/** Phrases that indicate narrative / full-sentence output — strip or trigger rewrite. */
const EN_JUNK_PATTERNS: RegExp[] = [
  /\bwe agreed\b/gi,
  /\bwe have agreed\b/gi,
  /\bi will\b/gi,
  /\bwe will\b/gi,
  /\bwe'?ll\b/gi,
  /\bi'?ll\b/gi,
  /\bplan to\b/gi,
  /\bplanning to\b/gi,
  /\bwe are going to\b/gi,
  /\bwe'?re going to\b/gi,
  /\bi am going to\b/gi,
  /\bi'?m going to\b/gi,
  /\bgoing to\b/gi,
  /\bagreed to\b/gi,
  /\bin order to\b/gi,
  /\bneed to\b/gi,
  /\bwanted to\b/gi,
  /\bthe plan is\b/gi,
  /\bmake sure to\b/gi,
  /\bremember to\b/gi,
  /\btry to\b/gi,
  /\bhave to\b/gi,
  /\bsupposed to\b/gi,
]

const ES_JUNK_PATTERNS: RegExp[] = [
  /\bacordamos\b/gi,
  /\bacordé\b/gi,
  /\bacordamos que\b/gi,
  /\bvoy a\b/gi,
  /\bvamos a\b/gi,
  /\bplaneo\b/gi,
  /\bplaneamos\b/gi,
  /\bpienso\b/gi,
  /\btengo que\b/gi,
  /\bhay que\b/gi,
  /\bdebo\b/gi,
  /\bdebería\b/gi,
  /\bpara poder\b/gi,
]

function stripBoilerplate(s: string, spanish: boolean): string {
  let t = s
  const patterns = spanish ? [...EN_JUNK_PATTERNS, ...ES_JUNK_PATTERNS] : EN_JUNK_PATTERNS
  for (const p of patterns) {
    t = t.replace(p, ' ')
  }
  return t.replace(/\s+/g, ' ').trim()
}

function stripLeadingNoise(s: string): string {
  let t = s.trim()
  for (let i = 0; i < 6; i++) {
    const next = t
      .replace(/^(to|that|and|then|so|also|just|que|a|el|la)\s+/i, '')
      .trim()
    if (next === t) break
    t = next
  }
  return t
}

function wordCount(s: string): number {
  const w = s.trim().split(/\s+/).filter(Boolean)
  return w.length
}

function normalizeEmDashSeparators(s: string): string {
  return s
    .replace(/\s*[\u2013\u2014]\s*/g, ` ${EM_DASH} `)
    .replace(/\s+-\s+/g, ` ${EM_DASH} `)
    .replace(/\s+/g, ' ')
    .trim()
}

function parseCompanySuffix(title: string): string {
  const t = title.trim()
  const idx = t.lastIndexOf(` ${EM_DASH} `)
  if (idx === -1) return ''
  return t.slice(idx + 3).trim()
}

function parseBeforeDash(title: string): string {
  const t = title.trim()
  const idx = t.lastIndexOf(` ${EM_DASH} `)
  if (idx === -1) return t
  return t.slice(0, idx).trim()
}

function titleHasSentenceNoise(s: string): boolean {
  const t = s.trim()
  if (/[.!?]\s+[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(t)) return true
  if (/\b(because|although|however|since|while|after|before)\b/i.test(t)) return true
  if (/\b(porque|aunque|mientras|después|antes)\b/i.test(t)) return true
  return false
}

function matchesLeadingVerb(
  title: string,
  spanish: boolean,
): { verb: VerbEn | VerbEs; rest: string } | null {
  const t = title.trim()
  const verbs = spanish ? VERBS_ES : VERBS_EN
  const lower = t.toLowerCase()
  for (const v of verbs) {
    const vl = v.toLowerCase()
    if (lower.startsWith(vl + ' ') || lower === vl) {
      const rest = t.slice(v.length).trim()
      return { verb: v, rest }
    }
  }
  return null
}

function inferVerb(nextStep: string, title: string, spanish: boolean): VerbEn | VerbEs {
  const combinedRaw = `${nextStep} ${title}`
  const combined = combinedRaw.toLowerCase()
  /** Prefer the first clause so "send today … then … call" does not collapse to Call. */
  const firstSegment = combined.split(/\bthen\b/i)[0].split(/\band then\b/i)[0].trim()

  if (spanish) {
    if (/\b(email|e-mail|correo|mail)\b/.test(firstSegment)) return 'Email'
    if (/\b(enviar|mandar|envío|compartir|entregar)\b/.test(firstSegment)) return 'Enviar'
    if (
      !isNarrativeMeetingDiscussionContext(combinedRaw) &&
      hasExplicitMeetScheduleIntent(combinedRaw) &&
      /\b(reunión|reunirse|cita|visita)\b/.test(firstSegment)
    ) {
      return 'Reunirse'
    }
    if (/\b(llamar|llamada|teléfono|seguimiento|preparar|confirmar|revisar)\b/.test(firstSegment))
      return 'Llamar'
    if (/\b(enviar|mandar|compartir)\b/.test(combined)) return 'Enviar'
    return 'Llamar'
  }
  if (/\b(email|e-mail|mail)\b/.test(firstSegment)) return 'Email'
  if (/\b(send|ship|forward|deliver|share)\b/.test(firstSegment)) return 'Send'
  if (
    !isNarrativeMeetingDiscussionContext(combinedRaw) &&
    hasExplicitMeetScheduleIntent(combinedRaw) &&
    /\b(meet|meeting|visit|lunch|coffee|catch\s*up|site\s+visit)\b/.test(firstSegment)
  ) {
    return 'Meet'
  }
  if (
    /\b(follow[- ]?up|followup|check[- ]?in|call|phone|ring|prepare|confirm|check)\b/.test(
      firstSegment,
    )
  ) {
    return 'Call'
  }
  if (/\b(send|ship|forward|deliver|share)\b/.test(combined)) return 'Send'
  if (
    !isNarrativeMeetingDiscussionContext(combinedRaw) &&
    hasExplicitMeetScheduleIntent(combinedRaw) &&
    /\b(meet|meeting|visit|site\s+visit)\b/.test(combined)
  ) {
    return 'Meet'
  }
  if (
    /\b(follow[- ]?up|followup|check[- ]?in|call|phone|ring|prepare|confirm|check)\b/.test(
      combined,
    )
  ) {
    return 'Call'
  }
  return 'Call'
}

function pickCompany(contactCompany: string, customer: string, titleFallback: string): string {
  const cc = contactCompany.trim()
  if (cc) return cc
  const cu = customer.trim()
  if (cu) return cu
  return parseCompanySuffix(titleFallback).trim()
}

function pickContact(contact: string, titleBeforeDash: string, spanish: boolean): string {
  const c = contact.trim()
  if (c) return c
  const before = stripLeadingNoise(stripBoilerplate(titleBeforeDash, spanish))
  const m = matchesLeadingVerb(before, spanish)
  if (m?.rest) {
    let onlyName = m.rest.replace(/^[,;:]\s*/, '').trim()
    const dashAt = onlyName.indexOf(` ${EM_DASH} `)
    if (dashAt !== -1) onlyName = onlyName.slice(0, dashAt).trim()
    const wc = wordCount(onlyName)
    if (wc >= 1 && wc <= 5) return onlyName
  }
  return ''
}

const MAX_WORDS = 8

function buildTitle(verb: VerbEn | VerbEs, contact: string, company: string): string {
  const v = String(verb).trim()
  const name = contact.trim()
  const org = company.trim()

  const leftWords: string[] = [v]
  if (name) leftWords.push(...name.split(/\s+/).filter(Boolean))
  let rightWords = org ? org.split(/\s+/).filter(Boolean) : []

  const sep = ` ${EM_DASH} `

  const assemble = (lw: string[], rw: string[]) => {
    const left = lw.join(' ')
    if (!rw.length) return left
    return `${left}${sep}${rw.join(' ')}`
  }

  let lw = [...leftWords]
  let rw = [...rightWords]
  let out = assemble(lw, rw)
  while (wordCount(out) > MAX_WORDS && rw.length > 1) {
    rw = rw.slice(0, -1)
    out = assemble(lw, rw)
  }
  while (wordCount(out) > MAX_WORDS && lw.length > 1) {
    lw = lw.slice(0, -1)
    out = assemble(lw, rw)
  }
  if (wordCount(out) > MAX_WORDS) {
    const all = out.split(/\s+/).filter(Boolean)
    return all.slice(0, MAX_WORDS).join(' ')
  }
  return out.trim()
}

function needsRewrite(
  raw: string,
  cleaned: string,
  spanish: boolean,
): boolean {
  if (EN_JUNK_PATTERNS.some((p) => p.test(raw)) || (spanish && ES_JUNK_PATTERNS.some((p) => p.test(raw)))) {
    return true
  }
  if (wordCount(cleaned) > MAX_WORDS) return true
  if (titleHasSentenceNoise(raw)) return true
  if (!matchesLeadingVerb(cleaned, spanish)) return true
  const m = matchesLeadingVerb(cleaned, spanish)
  if (m && wordCount(m.rest) > 6) return true
  return false
}

export type NormalizeNextStepTitleContext = {
  noteLanguage: string
  contact: string
  contactCompany: string
  customer: string
  nextStep: string
  /** When set, title is built only from structured fields (no contact inference from prose). */
  primaryActionStructured?: ActionStructuredFields
}

/**
 * Strict title line: [Verb] [Contact] — [Company], 6–8 words, no narrative phrases.
 * English: Call | Send | Email | Meet. Spanish: Llamar | Enviar | Email | Reunirse.
 */
export function normalizeNextStepTitleStrict(
  title: string,
  ctx: NormalizeNextStepTitleContext,
): string {
  if (ctx.primaryActionStructured) {
    const base = buildPrimaryBaseTitle(ctx.primaryActionStructured, ctx.noteLanguage)
    return normalizeEmDashSeparators(base).trim()
  }

  const raw = String(title ?? '').trim()
  if (!raw || isNoClearFollowUpLine(raw)) return raw

  const spanish = isSpanish(ctx.noteLanguage)
  const normalizedSep = normalizeEmDashSeparators(raw)
  const cleaned = stripLeadingNoise(stripBoilerplate(normalizedSep, spanish))
  const companyFromCtx = pickCompany(ctx.contactCompany, ctx.customer, normalizedSep)
  const beforeDash = parseBeforeDash(cleaned || normalizedSep)

  const shouldRewrite = needsRewrite(raw, cleaned, spanish)
  if (!shouldRewrite) {
    const final = cleaned || normalizedSep
    const wc = wordCount(final)
    if (wc <= MAX_WORDS && matchesLeadingVerb(final, spanish)) return final
  }

  const verb = inferVerb(ctx.nextStep, `${raw} ${cleaned}`, spanish)
  const company = companyFromCtx || parseCompanySuffix(normalizedSep)
  const contactName = pickContact(ctx.contact, beforeDash || normalizedSep, spanish)
  return buildTitle(verb, contactName, company)
}
