/**
 * Strict display titles for CRM actions: built only from structured fields,
 * not from free-form nextStep / label prose.
 */

const EM = '\u2014'

export type ActionStructuredFields = {
  /** Primary: call | send | meeting | follow_up. Supporting: send | email | call | other */
  type: string
  verb: string
  object: string
  contact: string
  company: string
  date: string
  time: string
}

function isSpanish(noteLanguage: string): boolean {
  return noteLanguage.trim().toLowerCase() === 'spanish'
}

function usesObjectForPrimary(type: string): boolean {
  const t = type.trim().toLowerCase()
  return t === 'send' || t === 'email'
}

function usesContactForPrimary(type: string): boolean {
  const t = type.trim().toLowerCase()
  return t === 'call' || t === 'follow_up' || t === 'meeting'
}

/** Stops "Send Send updated program" when the model repeats the verb inside `object`. */
function stripLeadingVerbFromObjectPhrase(object: string, verb: string, langEs: boolean): string {
  let o = object.trim()
  if (!o) return ''
  const lower = o.toLowerCase()
  const prefixes = [
    verb.toLowerCase(),
    'send',
    'email',
    'mail',
    ...(langEs ? ['enviar', 'correo', 'mandar'] : []),
  ].filter((p, i, a) => p && a.indexOf(p) === i)
  for (const p of prefixes) {
    if (lower.startsWith(p + ' ')) {
      o = o.slice(p.length).trim()
      break
    }
  }
  return o
}

/**
 * For send actions: never treat the contact name as the thing being sent (avoids "Send Sarah").
 */
export function normalizePrimarySendObjectField(
  object: string,
  contact: string,
  verb: string,
  noteLanguage: string,
): string {
  const langEs = isSpanish(noteLanguage)
  let o = object.trim()
  const c = contact.trim()
  if (c && o && o.toLowerCase() === c.toLowerCase()) return ''
  o = stripLeadingVerbFromObjectPhrase(o, verb.trim(), langEs)
  return o.trim()
}

/** Avoids "Call Call Sarah" when the model duplicates the action verb inside `contact`. */
function stripLeadingActionVerbFromContactName(contact: string, langEs: boolean): string {
  const s = contact.trim()
  if (!s) return ''
  const re = langEs
    ? /^(llamar|call|reunirse|seguimiento|phone)\s+/i
    : /^(call|meet|phone|ring|follow[-\s]?up)\s+/i
  const stripped = s.replace(re, '').trim()
  return stripped || s
}

/**
 * Primary next-step line (no calendar date/time suffix).
 * Send/email: Verb + Object — Company (never use contact as the send object).
 * Call / follow_up / meeting: Verb + Contact — Company.
 */
export function buildPrimaryBaseTitle(fields: ActionStructuredFields, noteLanguage: string): string {
  const langEs = isSpanish(noteLanguage)
  const t = fields.type.trim().toLowerCase()
  let verb = fields.verb.trim()
  let object = fields.object.trim()
  const contact = fields.contact.trim()
  const company = fields.company.trim()

  if (usesObjectForPrimary(t)) {
    object = normalizePrimarySendObjectField(object, contact, verb, noteLanguage)
    if (object && company) return `${verb} ${object} ${EM} ${company}`
    if (object) return `${verb} ${object}`
    if (company) return `${verb} ${EM} ${company}`
    return verb || (langEs ? 'Enviar' : 'Send')
  }

  if (usesContactForPrimary(t)) {
    const who = stripLeadingActionVerbFromContactName(contact, langEs)
    if (who && company) return `${verb} ${who} ${EM} ${company}`
    if (who) return `${verb} ${who}`
    if (company) return `${verb} ${EM} ${company}`
    return verb || (langEs ? 'Llamar' : 'Call')
  }

  if (object && company) return `${verb} ${object} ${EM} ${company}`
  if (contact && company)
    return `${verb} ${stripLeadingActionVerbFromContactName(contact, langEs)} ${EM} ${company}`
  if (object) return `${verb} ${object}`
  if (contact) return `${verb} ${stripLeadingActionVerbFromContactName(contact, langEs)}`
  if (company) return `${verb} ${EM} ${company}`
  return verb
}

/**
 * Supporting action line (same rules; supporting uses send | email | call | other).
 * call / other → contact-style; send/email → object-style (object never replaces contact for calls).
 */
export function buildSupportingBaseTitle(fields: ActionStructuredFields, noteLanguage: string): string {
  const t = fields.type.trim().toLowerCase()
  if (t === 'send' || t === 'email') {
    return buildPrimaryBaseTitle({ ...fields, type: 'send' }, noteLanguage)
  }
  if (t === 'call' || t === 'other') {
    return buildPrimaryBaseTitle({ ...fields, type: 'call', object: '' }, noteLanguage)
  }
  return buildPrimaryBaseTitle(fields, noteLanguage)
}

export function verbForSupportingStructuredType(
  type: 'send' | 'email' | 'call' | 'other',
  langEs: boolean,
): string {
  if (langEs) {
    if (type === 'email') return 'Email'
    if (type === 'send') return 'Enviar'
    return 'Llamar'
  }
  if (type === 'email') return 'Email'
  if (type === 'send') return 'Send'
  return 'Call'
}
