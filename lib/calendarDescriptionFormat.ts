/**
 * Deterministic calendar event body: line 1 = cuenta + problema; line 2 = frase de acción concreta.
 * Sin lenguaje abstracto (desempeño, diferenciación, evaluación).
 */

export type CommercialContextFields = {
  problem: string
  productInterest: string
  barrier: string
}

export type BuildCalendarContextInput = {
  contact?: string
  company?: string
  problem?: string
  productInterest?: string
  barrier?: string
  langEs?: boolean
}

export type FormatForCalendarInput = {
  /** Línea 1: debe ser solo contacto + empresa + problema (vía {@link buildCalendarContext}). */
  contextParagraph: string
  langEs: boolean
  /** Nombre de producto explícito (ej. Quantum Flower) si existe en datos estructurados; prioridad sobre CSV/interest */
  product?: string
  deliverable?: string
  productInterest?: string
  productCsv?: string
}

/** Primary or supporting action kinds accepted by {@link formatForCalendar}. */
export type CalendarFormatActionKind =
  | 'call'
  | 'send'
  | 'meeting'
  | 'follow_up'
  | 'email'
  | 'other'

function normalizeClosingKind(kind: CalendarFormatActionKind): 'send' | 'call' | 'follow_up' | 'meeting' {
  if (kind === 'email') return 'send'
  if (kind === 'other') return 'follow_up'
  return kind
}

function firstProductFromCsv(csv: string): string {
  const parts = csv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return parts[0] || ''
}

function extractProductLabelFromInterest(pi: string): string {
  const t = pi.replace(/\s+/g, ' ').trim()
  if (!t) return ''
  const cut = t.split(/[—–]/)[0].split(/\./)[0].trim()
  const words = cut.split(/\s+/).filter(Boolean)
  return words.slice(0, 8).join(' ')
}

function productLabelForSend(
  input: Pick<FormatForCalendarInput, 'product' | 'productCsv' | 'productInterest'>,
): string {
  const explicit = (input.product || '').replace(/\s+/g, ' ').trim()
  if (explicit) return explicit
  const fromCsv = firstProductFromCsv(input.productCsv || '')
  if (fromCsv) return fromCsv
  return extractProductLabelFromInterest(input.productInterest || '')
}

function stripProblemPrefix(raw: string): string {
  return raw
    .replace(/^Problemas?\s+de\s+/i, '')
    .replace(/^Issues?\s+with\s+/i, '')
    .trim()
}

/**
 * Línea 1 (oraciones completas):
 * ES: {contact} en {company}. Problemas de {problem}.
 * EN: {contact} at {company}. Issues with {problem}.
 * La segunda oración siempre lleva verbo encabezado (Problemas de / Issues with); mayúscula tras el punto.
 */
export function buildCalendarContext(fields: BuildCalendarContextInput): string {
  const problem = stripProblemPrefix((fields.problem || '').trim())
  const contact = (fields.contact || '').trim()
  const company = (fields.company || '').trim()
  const langEs = fields.langEs ?? false

  const c = contact.replace(/\s+/g, ' ').trim()
  const co = company.replace(/\s+/g, ' ').trim()
  let pr = stripProblemPrefix(problem.replace(/\s+/g, ' ').trim())

  const who =
    c && co ? (langEs ? `${c} en ${co}` : `${c} at ${co}`) : c ? c : co ? co : ''
  if (!who && !pr) return ''

  const secondSentence = (() => {
    if (!pr) return ''
    const body = pr.endsWith('.') ? pr.slice(0, -1).trim() : pr
    if (!body) return ''
    return langEs ? `Problemas de ${body}.` : `Issues with ${body}.`
  })()

  if (!secondSentence) {
    const w = who.endsWith('.') ? who.trim() : `${who}.`
    return (w.charAt(0).toUpperCase() + w.slice(1)).replace(
      /\.\s+([a-záéíóúñü])/gi,
      (_, letter: string) => `. ${letter.toUpperCase()}`,
    )
  }

  if (!who) {
    const s = secondSentence
    return (s.charAt(0).toUpperCase() + s.slice(1)).replace(
      /\.\s+([a-záéíóúñü])/gi,
      (_, letter: string) => `. ${letter.toUpperCase()}`,
    )
  }

  const whoPart = who.endsWith('.') ? who.slice(0, -1).trim() : who
  const combined = `${whoPart}. ${secondSentence}`.replace(/\s+/g, ' ').trim()
  return (combined.charAt(0).toUpperCase() + combined.slice(1)).replace(
    /\.\s+([a-záéíóúñü])/gi,
    (_, letter: string) => `. ${letter.toUpperCase()}`,
  )
}

/** SEND — plantilla fija; producto si existe. */
function closingSendEs(product: string, deliverable?: string): string {
  const d = (deliverable || '').replace(/\s+/g, ' ').trim()
  if (d) return `Enviar ${d}.`
  const p = product.replace(/\s+/g, ' ').trim()
  if (p) return `Enviar ${p}.`
  return 'Enviar información pendiente.'
}

function closingSendEn(product: string, deliverable?: string): string {
  const d = (deliverable || '').replace(/\s+/g, ' ').trim()
  if (d) return `Send ${d}.`
  const p = product.replace(/\s+/g, ' ').trim()
  if (p) return `Send ${p}.`
  return 'Send pending information.'
}

/** CALL — plantilla fija. */
function closingCallEs(): string {
  return 'Llamar para revisar la comparativa y ver próximos pasos.'
}

function closingCallEn(): string {
  return 'Call to review the comparison and see next steps.'
}

/** FOLLOW_UP — plantilla fija. */
function closingFollowUpEs(): string {
  return 'Dar seguimiento para ver interés y próximos pasos.'
}

function closingFollowUpEn(): string {
  return 'Follow up to gauge interest and next steps.'
}

/** MEETING — concreto, sin términos abstractos. */
function closingMeetingEs(): string {
  return 'Reunirse para ver la visita y próximos pasos.'
}

function closingMeetingEn(): string {
  return 'Meet on site to review next steps.'
}

/**
 * Segunda línea: verbo + objeto; plantillas por tipo de acción.
 */
export function buildActionClosingLine(
  kind: 'send' | 'call' | 'follow_up' | 'meeting',
  input: Pick<
    FormatForCalendarInput,
    'langEs' | 'product' | 'productInterest' | 'productCsv' | 'deliverable'
  >,
): string {
  const langEs = input.langEs
  const product = productLabelForSend(input)

  switch (kind) {
    case 'send':
      return langEs ? closingSendEs(product, input.deliverable) : closingSendEn(product, input.deliverable)
    case 'call':
      return langEs ? closingCallEs() : closingCallEn()
    case 'follow_up':
      return langEs ? closingFollowUpEs() : closingFollowUpEn()
    case 'meeting':
      return langEs ? closingMeetingEs() : closingMeetingEn()
  }
}

/** @deprecated Use {@link buildActionClosingLine}. */
export function closingLineFor(
  kind: 'send' | 'call' | 'follow_up' | 'meeting',
  langEs: boolean,
): string {
  return buildActionClosingLine(kind, { langEs })
}

/**
 * Línea 1 = contextParagraph (contacto + empresa + problema). Línea 2 = plantilla de acción.
 */
export function formatForCalendar(
  actionType: CalendarFormatActionKind,
  structured: FormatForCalendarInput,
): string {
  const kind = normalizeClosingKind(actionType)
  const line1 = structured.contextParagraph.replace(/\s+/g, ' ').trim()
  const closing = buildActionClosingLine(kind, {
    langEs: structured.langEs,
    product: structured.product,
    productInterest: structured.productInterest,
    productCsv: structured.productCsv,
  })
  if (!line1) return closing
  return `${line1}\n\n${closing}`.trim()
}
