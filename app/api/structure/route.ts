import OpenAI from 'openai'
import { NextResponse } from 'next/server'
import { resolveContactCompany } from '../../../lib/contactAffiliation'
import { dedupeConsecutiveRepeatedWords } from '../../../lib/stringDedupe'
import {
  stripDealerClosingFromCrmText,
  stripDealerLinesFromCrmFull,
} from '../../../lib/dealerField'
import { normalizeProductField, productFieldToList } from '../../../lib/productField'
import { detectNoteLanguage } from '../../../lib/detectNoteLanguage'

type MentionedEntity = { name: string; type: string }

type AdditionalStep = { action: string; date: string; time: string }

type StructureBody = {
  customer: string
  contact: string
  contactCompany: string
  summary: string
  nextStep: string
  nextStepTitle: string
  nextStepAction: string
  nextStepTarget: string
  nextStepDate: string
  nextStepTimeHint: string
  nextStepConfidence: 'high' | 'medium' | 'low'
  ambiguityFlags: string[]
  mentionedEntities: MentionedEntity[]
  notes: string
  crop: string
  product: string
  location: string
  acreage: string
  crmText: string
  crmFull: string[]
  additionalSteps: AdditionalStep[]
}

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

const SYSTEM_PROMPT = `You are a CRM assistant for a B2B field sales rep. The rep may work in any industry (pharma, real estate, agriculture, tech, CPG, services, industrial, etc.) — never assume a specific vertical.

The rep dictates quick voice notes after each visit — informal, spoken, may have noise or incomplete sentences.

Return ONLY valid JSON. No markdown. No explanation.

---

LANGUAGE:
A MANDATORY block at the very start of this system message names the note's language. Every string VALUE in the JSON (summary, nextStep, crm lines, etc.) MUST use that language only. Never mix languages. JSON keys stay in English as specified.

---

INDUSTRY EXAMPLES (accounts / buyers — non-exhaustive):

The rep could be selling to stakeholders in any B2B vertical, for example:
- Pharma: doctors, clinics, hospitals
- Real estate: brokers, developers, property managers
- Tech: IT managers, CTOs, operations teams
- CPG: retail buyers, store managers
- Agriculture: growers, farm managers
- Any other B2B industry

Never assume a single vertical; extract only what the note states.

---

ROLES (UNDERSTAND THESE BEFORE EXTRACTING):

There are 3 possible people in a note:
1. THE REP — always "I/yo". Never extract as contact.
2. CONTACT — the person the rep DIRECTLY spoke to. This is who nextStep targets.
3. THIRD PARTY — someone mentioned but not present (e.g. "her colleague Luis who wasn't in the meeting"). Never the nextStep target.

- contact = person directly spoken to
- customer = named client / account ORGANIZATION only (legal entity, site, brand unit, clinic, buyer company). Must be a real organization name when filled — not a role label alone.

contactCompany (MANDATORY — where the DIRECT CONTACT works or operates):
Add field contactCompany = the company where the contact directly works or operates. This is NOT necessarily the same as customer — it is simply where the person the rep spoke to belongs.

Rules:
- If the rep spoke to someone who works for the client's organization → contactCompany = that organization (may match customer when appropriate).
- If the rep spoke to someone who works for a partner, vendor, or intermediary org → contactCompany = that organization's name.
- If the rep spoke to an independent consultant or similar (no single employer org named) → contactCompany = "".
- contactCompany is always the direct employer / company of the contact person — one organization name or empty. Never concatenate multiple companies.

CUSTOMER — NEVER RELATIONAL LABELS ALONE:
- If the note only describes someone by relationship or generic role (e.g. "their neighbor", "his client" with no actual company name), set customer to "" (empty string).
- Do NOT use customer for "who they are to someone" — only for a concrete account you can name as an organization.

CRITICAL: If rep says "Tyler told me about the issue at Acme Corp" → contact=Tyler, customer=Acme Corp, contactCompany=Tyler's employer org if named, else "".

---

ABSOLUTE RULE — THIRD PARTIES (NEVER BREAK):

nextStepTitle AND nextStep MUST NEVER contain names of third parties (people the rep did NOT directly speak to in this visit).

- If Luis was not present in the conversation, his name MUST NOT appear in nextStepTitle or nextStep under any circumstance — not in the verb line, not in parentheses, not as "context".
- ONLY the direct contact's name may appear in nextStep and nextStepTitle (nextStepTitle MUST also always include exactly one company in parentheses — see nextStepTitle COMPANY RULE below).
- Third-party names may appear in summary, crmText, crmFull, mentionedEntities — but NEVER in nextStep or nextStepTitle. Put named end-account organizations in customer only (never relational labels alone — see CUSTOMER rules above).

---

NEXT STEP — ABSOLUTE RULES:

STEP 1: Extract ALL actions from the note with their dates/times.
STEP 2: Sort them chronologically — earliest first.
STEP 3: The PRIMARY nextStep is ALWAYS the earliest action in time.

Examples:
- "Le mando muestras esta semana y la llamo el jueves" → PRIMARY = enviar muestras (before Thursday)
- "La llamo el jueves y si quiere le mando info el viernes" → PRIMARY = llamar el jueves
- "Hoy le mando precios y la llamo mañana" → PRIMARY = enviar precios (today)
- "Le mando muestras la próxima semana y la llamo el jueves" → PRIMARY = Llamar el jueves. Reason: Thursday comes BEFORE "next week". "La próxima semana" = next week = after Thursday.

Rule (chronology): "esta semana" and specific weekdays (lunes, martes, jueves, etc.) are always BEFORE "la próxima semana" or "next week" when comparing action times.

NEVER choose a later action over an earlier one.
NEVER choose based on importance — ONLY chronological order.
The earliest action = the nextStep. Always.

nextStepTitle format: VERB + 'a' + CONTACT + (COMPANY)
Always capitalize first letter.
CORRECT: 'Enviar materiales a Carmen (Pacific Brands)'
CORRECT: 'Llamar a Tyler (Coastal Supplies)'
WRONG: 'enviar muestras Carmen López'

Store every non-primary action in additionalSteps with date/time when known, in chronological order.

NEVER use conditional language ("si puedo", "if I go"). Convert to definitive action.

PASSIVE / WAIT — NEVER AS nextStep:
- NEVER use esperar, wait, or a que me llame as nextStep, nextStepTitle, or nextStepAction (the rep must own a concrete action).
- If the client said they will call back, will reach out, or asked the rep to wait — do NOT encode that as passive waiting. Convert to a proactive action in the SAME language as the note, while keeping nextStepTitle COMPANY RULE (VERB + CONTACT + (COMPANY)):
  - Spanish: Llamar a [contact] ([company]) si no hay respuesta antes de [date]
  - English: Call [contact] ([company]) if no response before [date]
- [company] = org the direct contact belongs to — use **contactCompany** when set; otherwise **customer** when the contact aligns with that end account. [date] = align with nextStepDate. Mirror the same wording in nextStep and nextStepTitle (nextStepAction should be the leading verb phrase, e.g. Llamar / Call).

nextStepTitle — COMPANY RULE (MANDATORY):
- **First word:** nextStepTitle MUST **start with an uppercase letter** (same language as the note).
- Format is ALWAYS: VERB + CONTACT + (COMPANY). Never omit the parentheses; never leave them empty.
- The name in parentheses MUST be the organization the DIRECT CONTACT works for (contactCompany preferred; customer when it is their client's org).
- One org only in parentheses — must match affiliation (who employs the contact or whose account they represent in this visit).

nextStepTitle — GRAMMAR (MANDATORY, same language as the note):
- **Spanish:** The contact name MUST be preceded by **"a"** after the verb phrase. **Never** omit it.
  - Call / follow-up verbs → **"Llamar a [nombre] ([empresa])"** — WRONG: "Llamar Carmen ([empresa])" or any form missing **a** before the contact name.
  - Send / ship / email verbs (enviar, mandar, pasar, reenviar, etc.) → **"Enviar … a [nombre] ([empresa])"** — e.g. "Enviar documentos a Carmen (Pacific Brands)", "Mandar la cotización a Carmen (Pacific Brands)" — WRONG: "Enviar documentos Carmen (…)", "Mandar cotización Carmen (…)".
- **English:** Use natural grammar: **"Call Carmen (Pacific Brands)"**; for send-style verbs use **"to"** before the name when required — e.g. **"Send deck to Carmen (Pacific Brands)"**.
- Mirror the same correct phrasing in **nextStep** and **nextStepAction** / **nextStepTarget** so nothing contradicts the title.

CORRECT: Tyler works for Coastal Supplies → contactCompany=Coastal Supplies → "Llamar a Tyler (Coastal Supplies)".
CORRECT: Alfonso is the buyer at Laguna LLC → contactCompany or customer = Laguna LLC → "Llamar a Alfonso (Laguna LLC)".
CORRECT (Spanish send): "Enviar propuesta a Carmen (Pacific Brands)" — includes **a** before the contact.
WRONG: "Enviar cotización a Tyler" when the parenthetical company is missing or wrong — title must be VERB + **a** + contact + **(CORRECT COMPANY)**; never "Enviar cotización Tyler (…)" (missing **a**).
WRONG: "Llamar Tyler (Coastal Supplies)" — missing **a** before Tyler.
WRONG: "Llamar a Tyler (Luis)" ← Luis is third party, forbidden in BOTH nextStepTitle and nextStep
WRONG: "Llamar a Luis..." when Luis was only mentioned, not spoken to — use the direct contact name only
- NEVER repeat the same word twice in a row in the contact name part of nextStepTitle (WRONG: "Call David David Kim", "Mike Mike", "Llamar a Narciso Narciso Estrada"). nextStepAction + nextStepTarget must not concatenate a duplicated first name.

---

DATE/TIME RULES:

- "mañana por la mañana" → tomorrow 9:00am
- "por la tarde" → 3:00pm
- "al mediodía" → 12:00pm
- "por la mañana" → 9:00am
- Relative dates: calculate from today's date provided
- If no date mentioned → ""

---

SUMMARY RULES:

Extract ALL relevant details as bullet points with emojis.
No prose. No text blocks. Each line = one fact.
Emojis must match the content:
📦 products, services, SKUs, programs, or offerings
📊 volume, quantity, deal size, units, capacity (use for numeric scale — not dollar pricing alone)
💰 price / commercial terms / deal economics
🤝 relationship / new client / stakeholder context
📅 meetings, visits, deadlines
⚠️ problems, risks, blockers
🆕 new opportunity
🏪 channel partner, retailer, or intermediary location (when relevant — optional line)

THIRD-PARTY OPPORTUNITY (summary bullet — when applicable):
- If the note mentions a THIRD person (not the direct contact) who shows potential interest, a problem your solution could address, or could realistically become a future customer, add ONE bullet using this label in the SAME language as the note:
  - Spanish: 🆕 Oportunidad: [descripción breve — quién / interés o problema]
  - English: 🆕 Opportunity: [short description — who / interest or problem]
- Use this for referral-style or overheard leads; do NOT use it for the account you are actually visiting (use 🤝 or other lines for that). If no such third party appears, omit this bullet.

Include everything mentioned: prices, quantities, problems, new clients, market context.
Same language as note.

KEY INSIGHTS — align summary bullets with full detail (same ideas as crmFull below):
- Include **numbers** when stated (headcount, locations, units, revenue, capacity, etc.).
- Include **deadlines** (internal reviews, decision dates, meetings).
- Include **competitive** notes (who they use, dissatisfaction) when mentioned.
- Include **next meetings or events** spelled out in the note.
- Prefer an extra bullet over dropping a business-relevant fact.

---

CRM TEXT:
2-3 natural sentences. No bullets in the main paragraph. Concise. Human tone.
- Do NOT add a dedicated "distributor" or "Distribuidor:" closing line. Do not structure output around a separate distributor field.

CRM FULL (Key insights):
Array of short lines with emojis. All key business details.

KEY INSIGHTS — capture ALL important details (crmFull is the primary checklist):
- Always capture **numbers** when stated: doctors, employees, locations, units, revenue, capacity, seats, doses, headcount, etc. (📊 / 💰 per emoji rules below).
- Always capture **deadlines**: internal meetings, decision dates, review dates, RFP cutoffs (📅).
- Always capture **competitive info**: which competitor they use, why they are unhappy, switching signals (⚠️ / 🤝 as fits).
- Always capture any **next meeting or event** mentioned (📅), even when it is not the rep-owned primary nextStep.
- **Maximum detail** — never skip a business-relevant fact from the note; add lines rather than omit.

Emoji discipline:
- Use **📦** for product/service/program lines (not 🌱). Use **📊** for volume, quantity, capacity, units, or deal scale (not 🌾). Keep **⚠️** problems, **🆕** opportunities, **📅** dates/meetings, **🏪** channel/retail context when relevant.
- Do NOT add a separate legacy "distributor:" closing line; optional **🏪** insight is enough when a channel partner matters.
- If you added a third-party opportunity line in summary (🆕 Oportunidad / 🆕 Opportunity), include the same insight here as one line with the same emoji and wording.

DIRECT CONTACT — NEW OFFERING INTEREST (crmFull + **product** field — **MANDATORY** when applicable):
- When the **direct contact** shows interest in a **new** product, SKU, service, or program **different** from what they already use or buy (explicit contrast in the note):
  - You MUST add **exactly one** dedicated crmFull line using **🆕** in the **same language** as the note (mirror the third-party 🆕 template style but for the direct contact’s interest).
  - You MUST **append that new offering** to the JSON **product** string as a **comma-separated** item with any other offerings already listed — the app builds **product** pills from this field.
- Do not output duplicate identical 🆕 lines.

VOLUME / QUANTITY — **MANDATORY** when mentioned:
- If the note states any **numeric volume, quantity, units, capacity, seats, licenses, square footage, doses, headcount, or deal size**, add **at least one** crmFull line that **starts with 📊** and includes the **number**, **unit**, and brief context in the **same language as the note**.
- **Never omit** this line when such an amount appears.
- Examples: "📊 120 units" · "📊 45% uplift" · "📊 2.4M sq ft" · "📊 500 seats" (adapt to the note’s language).
- Set JSON **acreage** to a short phrase restating that volume/quantity fact (same language), or "" if none was stated. (The key name is legacy; use it for any volume/quantity summary.)

---

PRODUCT FIELD (JSON keys **product** and **crop**):

STRICT — what belongs in **product**:
- Only extract **real products or services being sold** (commercial offerings the rep's company sells or would sell).
- NEVER treat documents, templates, analyses, or internal/marketing **materials** as products (send them via nextStep / summary / crmFull, not as **product** entries).
- Valid **product** examples: 'Salesforce CRM', 'Quantum Flower', 'Patient Scheduling Software'
- Invalid as **product** (use elsewhere): 'ROI Analysis Template', 'price comparison', 'brochure'

FIELD RULES:
- Put **all qualifying** offerings, SKUs, services, programs, and category labels the rep mentioned into **product** as a **comma-separated list** in the same language as the note.
- Set JSON **crop** to **""** (empty). Do not use a separate crop field — all qualifying offerings belong in **product**.
- One offering → single name. When **NEW OFFERING INTEREST** applies, include the new item in **product** only if it is a real offering, not a one-off document.

---

REQUIRED JSON KEYS (single object — include every key):

contact, contactCompany, customer, location, crop, product, acreage,
summary,
nextStep,
nextStepTitle,
nextStepDate,
nextStepTime,
additionalSteps,
crmText,
crmFull,
confidence,
ambiguityFlags,

Also include (same object) for the client app:
nextStepAction,
nextStepTarget,
nextStepTimeHint,
nextStepConfidence,
mentionedEntities,
notes

Rules for the extra keys:
- crop = always "" (empty string). Deprecated key — put all offering labels in **product** only.
- contactCompany = employer / org of the direct contact only (see contactCompany rules above). Independent consultant → "". Not a copy-paste alias of customer unless that truly is their company name.
- nextStepAction = single verb phrase for the PRIMARY next step only
- nextStepTarget = contact name for that action only (never third party) — same ABSOLUTE RULE as nextStep / nextStepTitle
- nextStepTitle must follow the nextStepTitle COMPANY RULE above (VERB + CONTACT + (COMPANY); parenthetical = org the direct contact belongs to; never bare title without parentheses; never mismatch org vs contact affiliation)
- nextStepTimeHint = derive from nextStepTime: use "morning", "afternoon", "noon", or 24h "HH:MM" as appropriate
- nextStepConfidence = same value as confidence (high | medium | low)
- mentionedEntities = JSON array of { "name", "type" } for every person/company named (type: contact | customer | company | other)
- notes = "" or a very short string if needed

additionalSteps = JSON array of objects: { "action", "date", "time" } for every other action mentioned (not the primary). Use "" for unknown date/time.

Return ONLY valid JSON. No backticks. No explanation.`

/**
 * Rich calendar anchors (EN + ES) so the model can resolve "jueves", "próxima semana", etc.
 * Weekday offsets match: next occurrence strictly in the future; if today is that weekday, use +7 days.
 */
function buildStructureUserDateContext(now: Date): string {
  const todayEN = now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
  const todayES = now.toLocaleDateString('es-ES', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const fmtPair = (d: Date) => {
    const en = d.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
    const es = d.toLocaleDateString('es-ES', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
    return `${en} / ${es}`
  }

  const addDays = (base: Date, days: number) => {
    const d = new Date(base)
    d.setDate(base.getDate() + days)
    return d
  }

  const daysUntilNextWeekday = (targetDay: number) => {
    const d = (targetDay - now.getDay() + 7) % 7
    return d === 0 ? 7 : d
  }

  const tomorrow = addDays(now, 1)
  const nextThursday = addDays(now, daysUntilNextWeekday(4))
  const nextFriday = addDays(now, daysUntilNextWeekday(5))
  const nextMonday = addDays(now, daysUntilNextWeekday(1))
  const nextWeekMonday = addDays(now, daysUntilNextWeekday(1) + 7)

  return [
    'Calendar context (use for relative dates in the note):',
    `Today: ${todayEN} / ${todayES}`,
    `Tomorrow: ${fmtPair(tomorrow)}`,
    `This upcoming Thursday: ${fmtPair(nextThursday)}`,
    `This upcoming Friday: ${fmtPair(nextFriday)}`,
    `Upcoming Monday (next calendar Monday): ${fmtPair(nextMonday)}`,
    `Monday in the following week (+7 days after that — aligns with "la próxima semana" when the note means the week after): ${fmtPair(nextWeekMonday)}`,
  ].join('\n')
}

function extractJson(text: string): string {
  // Strip markdown code fences if present
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenceMatch) return fenceMatch[1].trim()

  // Find first { to last } in case there's extra text
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end !== -1) return text.slice(start, end + 1)

  return text.trim()
}

function parseCrmFull(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((s) => s.trim())
    .filter(Boolean)
}

function parseAmbiguityFlags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((s) => s.trim())
    .filter(Boolean)
}

function parseMentionedEntities(value: unknown): MentionedEntity[] {
  if (!Array.isArray(value)) return []
  const out: MentionedEntity[] = []
  for (const item of value) {
    if (item && typeof item === 'object' && 'name' in item) {
      const o = item as Record<string, unknown>
      const name = typeof o.name === 'string' ? o.name.trim() : ''
      const type = typeof o.type === 'string' ? o.type.trim() : 'other'
      if (name) out.push({ name, type: type || 'other' })
    } else if (typeof item === 'string' && item.trim()) {
      out.push({ name: item.trim(), type: 'other' })
    }
  }
  return out
}

function parseConfidence(value: unknown): 'high' | 'medium' | 'low' {
  if (value === 'high' || value === 'medium' || value === 'low') return value
  return 'medium'
}

/** Map nextStepTime strings to hints the client calendar layer understands. */
function normalizeTimeToHint(nextStepTime: string, existingHint: string): string {
  const hint = existingHint.trim()
  if (hint) return hint
  const t = nextStepTime.trim()
  if (!t) return ''
  const lower = t.toLowerCase()
  if (lower === '9:00am' || lower === '9:00 am' || /\bpor la mañana\b/.test(lower)) {
    return 'morning'
  }
  if (
    lower === '3:00pm' ||
    lower === '3:00 pm' ||
    /\bpor la tarde\b/.test(lower) ||
    lower.includes('afternoon')
  ) {
    return 'afternoon'
  }
  if (
    lower === '12:00pm' ||
    lower === '12:00 pm' ||
    /\bmediodía\b/.test(lower) ||
    lower.includes('noon')
  ) {
    return 'noon'
  }
  const m = t.match(/^(\d{1,2}):(\d{2})\s*(am|pm)\b/i)
  if (m) {
    let h = parseInt(m[1], 10)
    const min = m[2]
    const ap = m[3].toLowerCase()
    if (ap === 'pm' && h < 12) h += 12
    if (ap === 'am' && h === 12) h = 0
    return `${String(h).padStart(2, '0')}:${min}`
  }
  if (/^\d{1,2}:\d{2}$/.test(t.trim())) return t.trim()
  return t
}

/** YYYY-MM-DD → MM/DD/YYYY for client calendar fields. */
function normalizeNextStepDate(d: string): string {
  const t = d.trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) {
    const [y, m, day] = t.slice(0, 10).split('-')
    return `${m}/${day}/${y}`
  }
  return t
}

/**
 * customer must be a real organization name. If the model returns only a relational
 * description ("their neighbor", "his client" with no company), treat as empty.
 */
function isRelationalCustomerOnly(value: string): boolean {
  const t = value.trim().replace(/\s+/g, ' ')
  if (!t) return false
  const lower = t.toLowerCase()

  const singleTokens = new Set([
    'cliente',
    'client',
    'clientes',
    'clients',
    'vecino',
    'vecina',
    'vecinos',
    'neighbor',
    'neighbors',
    'neighbour',
    'neighbours',
  ])
  if (singleTokens.has(lower)) return true

  const phraseRes = [
    /^su\s+cuñad[oa]$/i,
    /^su\s+cliente$/i,
    /^su\s+vecin[oa]$/i,
    /^un\s+vecin[oa]$/i,
    /^el\s+vecin[oa]$/i,
    /^la\s+vecina$/i,
    /^un\s+cliente$/i,
    /^el\s+cliente$/i,
    /^una\s+clienta$/i,
    /^su\s+herman[oa]$/i,
    /^su\s+primo$/i,
    /^su\s+prima$/i,
    /^su\s+contacto$/i,
    /^su\s+amig[oa]$/i,
    /^su\s+pariente$/i,
    /^su\s+familiar$/i,
    /^his\s+client$/i,
    /^her\s+client$/i,
    /^their\s+client$/i,
    /^a\s+neighbor$/i,
    /^the\s+neighbor$/i,
    /^his\s+brother/i,
    /^her\s+sister/i,
    /^their\s+neighbor$/i,
  ]
  if (phraseRes.some((re) => re.test(t))) return true

  const twoWord = new RegExp(
    `^(su|el|la|un|una|los|las|mi|tu|mis|tus|his|her|their|a|the|my|our)\\s+` +
      `(cuñado|cuñada|vecino|vecina|cliente|clientes|hermano|hermana|primo|prima|tío|tía|amigo|amiga|contacto|referido|referida|pariente|familiar|client|clients|neighbor|neighbours|brother|sister|cousin|friend)s?$`,
    'i',
  )
  if (twoWord.test(lower)) return true

  return false
}

function sanitizeCustomerField(value: string): string {
  const t = value.trim()
  if (!t) return ''
  return isRelationalCustomerOnly(t) ? '' : t
}

/** Legacy prompts used 🌱/🌾; normalize to industry-agnostic 📦/📊 for key insights. */
function normalizeInsightEmojis(lines: string[]): string[] {
  return lines.map((line) =>
    line
      .replace(/^(\s*)🌱/u, '$1📦')
      .replace(/^(\s*)🌾/u, '$1📊'),
  )
}

function mergeCropIntoProduct(crop: string, product: string): { crop: string; product: string } {
  const c = crop.trim()
  const normalized = normalizeProductField(product)
  if (!c) return { crop: '', product: normalized }
  const parts = productFieldToList(normalized)
  if (parts.some((p) => p.toLowerCase() === c.toLowerCase())) {
    return { crop: '', product: normalized }
  }
  return { crop: '', product: normalizeProductField([c, ...parts].join(', ')) }
}

function parseAdditionalSteps(value: unknown): AdditionalStep[] {
  if (!Array.isArray(value)) return []
  const out: AdditionalStep[] = []
  for (const item of value) {
    if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>
      const action = typeof o.action === 'string' ? o.action.trim() : ''
      if (!action) continue
      out.push({
        action,
        date: typeof o.date === 'string' ? o.date.trim() : '',
        time: typeof o.time === 'string' ? o.time.trim() : '',
      })
    }
  }
  return out
}

function parseStructureJson(text: string): StructureBody {
  const clean = extractJson(text)
  const parsed = JSON.parse(clean) as Record<string, unknown>

  const nextStepTimeRaw =
    typeof parsed.nextStepTime === 'string' ? parsed.nextStepTime.trim() : ''
  const nextStepTimeHintRaw =
    typeof parsed.nextStepTimeHint === 'string' ? parsed.nextStepTimeHint.trim() : ''

  return {
    customer: typeof parsed.customer === 'string' ? parsed.customer : '',
    contact: typeof parsed.contact === 'string' ? parsed.contact : '',
    contactCompany:
      typeof parsed.contactCompany === 'string' ? parsed.contactCompany : '',
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    nextStep: typeof parsed.nextStep === 'string' ? parsed.nextStep : '',
    nextStepTitle: typeof parsed.nextStepTitle === 'string' ? parsed.nextStepTitle : '',
    nextStepAction: typeof parsed.nextStepAction === 'string' ? parsed.nextStepAction : '',
    nextStepTarget: typeof parsed.nextStepTarget === 'string' ? parsed.nextStepTarget : '',
    nextStepDate:
      typeof parsed.nextStepDate === 'string'
        ? normalizeNextStepDate(parsed.nextStepDate)
        : '',
    nextStepTimeHint: normalizeTimeToHint(nextStepTimeRaw, nextStepTimeHintRaw),
    nextStepConfidence: parseConfidence(parsed.confidence ?? parsed.nextStepConfidence),
    ambiguityFlags: parseAmbiguityFlags(parsed.ambiguityFlags),
    mentionedEntities: parseMentionedEntities(parsed.mentionedEntities),
    notes: typeof parsed.notes === 'string' ? parsed.notes : '',
    crop: typeof parsed.crop === 'string' ? parsed.crop : '',
    product: typeof parsed.product === 'string' ? parsed.product : '',
    location: typeof parsed.location === 'string' ? parsed.location : '',
    acreage: typeof parsed.acreage === 'string' ? parsed.acreage : '',
    crmText: typeof parsed.crmText === 'string' ? parsed.crmText : '',
    crmFull: parseCrmFull(parsed.crmFull),
    additionalSteps: parseAdditionalSteps(parsed.additionalSteps),
  }
}

export async function POST(request: Request) {
  try {
    const { note } = await request.json()

    if (!note || typeof note !== 'string') {
      return NextResponse.json({ error: 'Missing note' }, { status: 400 })
    }

    const now = new Date()
    const dateContext = buildStructureUserDateContext(now)

    const detectedLanguage = detectNoteLanguage(note)
    const languageEnforcement =
      `The input note is in ${detectedLanguage}. ` +
      `ALL output fields MUST be in ${detectedLanguage}. This is mandatory.`
    const systemContent = `${languageEnforcement}\n\n${SYSTEM_PROMPT}`

    console.log('[structure] detected language:', detectedLanguage)
    console.log('[structure] system prompt prefix (200 chars):', systemContent.slice(0, 200))

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      messages: [
        { role: 'system', content: systemContent },
        {
          role: 'user',
          content: `${dateContext}\n\n---\n\n${note}`,
        },
      ],
    })

    const text = response.choices[0]?.message?.content ?? ''

    let result: StructureBody

    try {
      result = parseStructureJson(text)
    } catch {
      return NextResponse.json(
        { error: 'Model did not return valid JSON', raw: text },
        { status: 500 }
      )
    }

    const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '')

    /** Trim leading/trailing space; uppercase the first character of the text (title line must not start lowercase). */
    const capitalizeFirstLetter = (s: string) => {
      const t = String(s ?? '').trim()
      if (!t) return ''
      return t.charAt(0).toUpperCase() + t.slice(1)
    }

    const titleCaseWords = (s: string) =>
      s
        .split(' ')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')

    const capitalized = {
      ...result,
      contact: dedupeConsecutiveRepeatedWords(titleCaseWords(result.contact)),
      customer: dedupeConsecutiveRepeatedWords(
        sanitizeCustomerField(titleCaseWords(result.customer)),
      ),
      summary: result.summary.trim(),
      nextStep: dedupeConsecutiveRepeatedWords(capitalize(result.nextStep)),
      nextStepTitle: dedupeConsecutiveRepeatedWords(capitalizeFirstLetter(result.nextStepTitle)),
      nextStepAction: result.nextStepAction.trim(),
      nextStepTarget: dedupeConsecutiveRepeatedWords(titleCaseWords(result.nextStepTarget)),
      nextStepDate: result.nextStepDate.trim(),
      nextStepTimeHint: result.nextStepTimeHint.trim(),
      nextStepConfidence: result.nextStepConfidence,
      ambiguityFlags: result.ambiguityFlags,
      mentionedEntities: result.mentionedEntities.map((e) => ({
        name: dedupeConsecutiveRepeatedWords(titleCaseWords(e.name)),
        type: e.type,
      })),
      notes: capitalize(result.notes),
      crop: titleCaseWords(result.crop),
      product: normalizeProductField(result.product),
      location: titleCaseWords(result.location),
      acreage: result.acreage,
      crmText: capitalize(result.crmText),
      additionalSteps: result.additionalSteps.map((s) => ({
        action: capitalize(s.action.trim()),
        date: s.date.trim(),
        time: s.time.trim(),
      })),
    }

    const { crop: mergedCrop, product: mergedProduct } = mergeCropIntoProduct(
      capitalized.crop,
      capitalized.product,
    )
    const afterProduct = { ...capitalized, crop: mergedCrop, product: mergedProduct }

    const resolvedContactCompany = dedupeConsecutiveRepeatedWords(
      resolveContactCompany(
        afterProduct.customer,
        afterProduct.contact,
        afterProduct.nextStepTarget,
        titleCaseWords(result.contactCompany),
      ),
    )

    const enriched = {
      ...afterProduct,
      contactCompany: resolvedContactCompany,
      crmFull: stripDealerLinesFromCrmFull(normalizeInsightEmojis(afterProduct.crmFull)),
      crmText: stripDealerClosingFromCrmText(afterProduct.crmText),
    }

    return NextResponse.json(enriched)
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Something went wrong' },
      { status: 500 }
    )
  }
}