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
function closingSendEn(product: string, deliverable?: string): string {
  const d = (deliverable || '').replace(/\s+/g, ' ').trim()
  if (d) return `Send ${d}.`
  const p = product.replace(/\s+/g, ' ').trim()
  if (p) return `Send ${p}.`
  return 'Send pending materials.'
}

function closingSendEs(product: string, deliverable?: string): string {
  const d = (deliverable || '').replace(/\s+/g, ' ').trim()
  if (d) return `Enviar ${d}.`
  const p = product.replace(/\s+/g, ' ').trim()
  if (p) return `Enviar ${p}.`
  return 'Enviar materiales pendientes.'
}

function truncateTopic(topic: string, maxWords = 3): string {
  const words = topic.trim().split(/\s+/).filter(Boolean)
  if (words.length <= maxWords) return words.join(' ')
  const stopWords = new Set(['para', 'de', 'en', 'con', 'por', 'a', 'la', 'el', 'los', 'las', 'un', 'una', 'y', 'o', 'the', 'for', 'to', 'of', 'and', 'or', 'in', 'on', 'with'])
  let cutAt = maxWords
  while (cutAt > 1 && stopWords.has(words[cutAt - 1].toLowerCase())) {
    cutAt--
  }
  return words.slice(0, cutAt).join(' ')
}

function closingCallEs(topic?: string): string {
  if (topic) return `Llamar para hablar sobre ${truncateTopic(topic)}.`
  return 'Llamar para ver próximos pasos.'
}

function closingCallEn(topic?: string): string {
  if (topic) return `Call to discuss ${truncateTopic(topic)}.`
  return 'Call to follow up.'
}

function closingFollowUpEs(topic?: string): string {
  if (topic) return `Dar seguimiento sobre ${truncateTopic(topic)}.`
  return 'Dar seguimiento y ver próximos pasos.'
}

function closingFollowUpEn(topic?: string): string {
  if (topic) return `Follow up on ${truncateTopic(topic)}.`
  return 'Follow up on next steps.'
}

function closingMeetingEs(topic?: string): string {
  if (topic) return `Reunirse para revisar ${truncateTopic(topic)}.`
  return 'Reunirse para ver próximos pasos.'
}

function closingMeetingEn(topic?: string): string {
  if (topic) return `Meet to review ${truncateTopic(topic)}.`
  return 'Meet to discuss next steps.'
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

  switch (kind) {
    case 'send':
      return langEs
        ? closingSendEs('', input.deliverable)
        : closingSendEn('', input.deliverable)
    case 'call': {
      const callTopic = (input.productInterest || input.deliverable || '').trim()
      return langEs ? closingCallEs(callTopic || undefined) : closingCallEn(callTopic || undefined)
    }
    case 'follow_up': {
      const fuTopic = (input.productInterest || '').trim()
      return langEs ? closingFollowUpEs(fuTopic || undefined) : closingFollowUpEn(fuTopic || undefined)
    }
    case 'meeting': {
      const meetTopic = (input.productInterest || '').trim()
      return langEs ? closingMeetingEs(meetTopic || undefined) : closingMeetingEn(meetTopic || undefined)
    }
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
    deliverable: structured.deliverable,
  })
  if (!line1) return closing
  return `${line1}\n\n${closing}`.trim()
}
