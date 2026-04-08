import OpenAI from 'openai'
import { NextResponse } from 'next/server'
import { resolveContactCompany } from '../../../lib/contactAffiliation'
import { dedupeConsecutiveRepeatedWords } from '../../../lib/stringDedupe'
import { isDealerMeaningful } from '../../../lib/dealerField'

type MentionedEntity = { name: string; type: string }

type AdditionalStep = { action: string; date: string; time: string }

type StructureBody = {
  customer: string
  dealer: string
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

const SYSTEM_PROMPT = `You are a CRM assistant for a B2B field sales rep.

The rep dictates quick voice notes after each visit — informal, spoken, may have noise or incomplete sentences.

Return ONLY valid JSON. No markdown. No explanation.

---

LANGUAGE RULE:
Detect the language of the note. ALL fields must be in that same language. Never mix.

---

ROLES (UNDERSTAND THESE BEFORE EXTRACTING):

There are 3 possible people in a note:
1. THE REP — always "I/yo". Never extract as contact.
2. CONTACT — the person the rep DIRECTLY spoke to. This is who nextStep targets.
3. THIRD PARTY — someone mentioned but not present (e.g. "his grower Luis"). Never the nextStep target.

- contact = person directly spoken to
- dealer = distributor or intermediary visited
- customer = named end-account ORGANIZATION only (grower farm, clinic, business name). Must be a real company/grower name when filled.

contactCompany (MANDATORY — where the DIRECT CONTACT works or operates):
Add field contactCompany = the company where the contact directly works or operates. This is NOT necessarily the same as customer or dealer — it is simply where the person the rep spoke to belongs. This field is separate from customer and dealer.

Rules:
- If the rep spoke to a grower → contactCompany = that grower's farm / operation name (the contact's employer or own farm).
- If the rep spoke to a dealer rep → contactCompany = the dealer name (the distributor they work for).
- If the rep spoke to an independent PCA, consultant, or similar (no single employer org named) → contactCompany = "".
- contactCompany is always the direct employer / company of the contact person — one organization name or empty. Never concatenate multiple companies.

CUSTOMER — NEVER RELATIONAL LABELS ALONE:
- If the note only describes someone by relationship or generic role (e.g. "su cuñado", "su cliente", "un vecino", "their neighbor", "his client" with no actual farm/company name), set customer to "" (empty string).
- Do NOT use customer for "who they are to someone" — only for a concrete end account you can name as an organization.

CRITICAL: If rep says "Tyler told me about the grower at Laguna Farms" → contact=Tyler, customer=Laguna Farms, dealer=Coastal Growers

---

ABSOLUTE RULE — THIRD PARTIES (NEVER BREAK):

nextStepTitle AND nextStep MUST NEVER contain names of third parties (people the rep did NOT directly speak to in this visit).

- If Luis was not present in the conversation, his name MUST NOT appear in nextStepTitle or nextStep under any circumstance — not in the verb line, not in parentheses, not as "context".
- ONLY the direct contact's name may appear in nextStep and nextStepTitle (nextStepTitle MUST also always include exactly one company in parentheses — see nextStepTitle COMPANY RULE below).
- Third-party names may appear in summary, crmText, crmFull, mentionedEntities — but NEVER in nextStep or nextStepTitle. Put named end-account organizations in customer only (never relational labels alone — see CUSTOMER rules above).

---

NEXT STEP RULES:

Extract ALL actions mentioned. Store them in additionalSteps array.

Then choose ONE as the primary nextStep using this priority:
1. Most URGENT action (today/tomorrow beats next week)
2. Calls/follow-ups beat sending info ONLY if they happen at the same time
3. If sending info must happen BEFORE a call → sending info IS the primary nextStep

NEVER pick a later action over an earlier one.
NEVER use conditional language ("si puedo", "if I go"). Convert to definitive action.

nextStepTitle — COMPANY RULE (MANDATORY):
- Format is ALWAYS: VERB + CONTACT + (COMPANY). Never omit the parentheses; never leave them empty.
- The name in parentheses MUST be the organization the DIRECT CONTACT works for — never mix dealer and customer incorrectly.
- If the contact person belongs to the distributor (dealer) → use dealer inside the parentheses.
- If the contact person belongs to the end account (grower / final customer) → use customer inside the parentheses.
- Do NOT put customer in parentheses when the contact is a dealer rep; do NOT put dealer in parentheses when the contact is the grower. One org only, matching affiliation.

CORRECT: Dealer rep Tyler at Coastal → "Llamar a Tyler (Coastal Growers)" when dealer=Coastal Growers and Tyler is the dealer-side contact.
CORRECT: Grower contact Alfonso at Laguna Farms → use (Laguna Farms) from customer when Alfonso is the grower-side contact.
WRONG: "Enviar precios a Tyler" — missing (COMPANY)
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
🌱 crop/product info
💰 price/quantity/deal info
🤝 relationship/new client info
📅 meeting/visit info
⚠️ problem/concern/risk
🆕 new opportunity

THIRD-PARTY OPPORTUNITY (summary bullet — when applicable):
- If the note mentions a THIRD person (not the direct contact) who shows potential interest, a problem your solution could address, or could realistically become a future customer, add ONE bullet using this label in the SAME language as the note:
  - Spanish: 🆕 Oportunidad: [descripción breve — quién / interés o problema]
  - English: 🆕 Opportunity: [short description — who / interest or problem]
- Use this for referral-style or overheard leads; do NOT use it for the account you are actually visiting (use 🤝 or other lines for that). If no such third party appears, omit this bullet.

Include everything mentioned: prices, quantities, problems, new clients, market context.
Same language as note.

---

CRM TEXT:
2-3 natural sentences. No bullets in the main paragraph. Concise. Human tone.
- If dealer is non-empty: you MUST mention the distributor in the prose (e.g. English: "Orders go through Pacific Ag.").
- MANDATORY: always end crmText with a final line (after a blank line) that states the dealer again, in the same language as the note — e.g. English: "Orders go through [dealer]." Spanish: "Distribuidor: [nombre]." Never omit dealer from crmText when dealer exists.

CRM FULL (Key insights):
Array of short lines with emojis. All key business details.
- If dealer is non-empty: you MUST include a separate line exactly in this form (its own bullet): 🏪 Dealer: [dealer name]
- Never omit dealer from the output when dealer is detected.
- If you added a third-party opportunity line in summary (🆕 Oportunidad / 🆕 Opportunity), include the same insight here as one line with the same emoji and wording.

---

REQUIRED JSON KEYS (single object — include every key):

contact, contactCompany, dealer, customer, location, crop, product, acreage,
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
- contactCompany = employer / org of the direct contact only (see contactCompany rules above). Independent PCA or consultant → "". Not a copy-paste alias of customer/dealer unless that truly is their company name.
- nextStepAction = single verb phrase for the PRIMARY next step only
- nextStepTarget = contact name for that action only (never third party) — same ABSOLUTE RULE as nextStep / nextStepTitle
- nextStepTitle must follow the nextStepTitle COMPANY RULE above (VERB + CONTACT + (COMPANY); parenthetical = dealer OR customer only — whichever org the direct contact belongs to; never bare title without parentheses; never mismatch org vs contact affiliation)
- nextStepTimeHint = derive from nextStepTime: use "morning", "afternoon", "noon", or 24h "HH:MM" as appropriate
- nextStepConfidence = same value as confidence (high | medium | low)
- mentionedEntities = JSON array of { "name", "type" } for every person/company named (type: contact | customer | dealer | company | other)
- notes = "" or a very short string if needed

additionalSteps = JSON array of objects: { "action", "date", "time" } for every other action mentioned (not the primary). Use "" for unknown date/time.

Return ONLY valid JSON. No backticks. No explanation.`

function isLikelySpanish(text: string): boolean {
  if (!text.trim()) return false
  return (
    /[áéíóúñ¿¡]/i.test(text) ||
    /\b(el|la|los|las|que|por|para|con|una|este|esta|distribuidor)\b/i.test(text)
  )
}

/** Key insights: 🏪 Dealer line only when dealer is a real name; never for empty/placeholder. */
function ensureDealerInCrmFull(crmFull: string[], dealer: string): string[] {
  const d = dealer.trim()
  const lines = crmFull.map((s) => s.trim()).filter(Boolean)
  if (!isDealerMeaningful(dealer)) {
    return lines.filter((line) => !/🏪\s*Dealer\s*:/i.test(line))
  }
  const dLower = d.toLowerCase()
  const hasDealerBullet = lines.some(
    (line) => /🏪\s*Dealer\s*:/i.test(line) && line.toLowerCase().includes(dLower),
  )
  if (hasDealerBullet) return lines
  return [`🏪 Dealer: ${d}`, ...lines]
}

/** Guarantee crmText ends with a dealer line; prose should already mention dealer per prompt. */
function ensureDealerInCrmText(crmText: string, dealer: string, sourceNote: string): string {
  const d = dealer.trim()
  if (!isDealerMeaningful(dealer)) return crmText.trim()
  const text = crmText.trim()
  const spanish = isLikelySpanish(sourceNote)
  const closing = spanish ? `Distribuidor: ${d}.` : `Orders go through ${d}.`

  if (text.toLowerCase().endsWith(closing.toLowerCase())) return text

  const lineLines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const lastLine = lineLines[lineLines.length - 1] || ''
  if (
    lastLine.toLowerCase().includes(d.toLowerCase()) &&
    (/\borders go through\b/i.test(lastLine) || /^distribuidor\s*:/i.test(lastLine))
  ) {
    return text
  }

  return `${text}\n\n${closing}`
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
 * customer must be a real org/grower name. If the model returns only a relational
 * description ("su cuñado", "un vecino", "their client"), treat as empty.
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
    dealer: typeof parsed.dealer === 'string' ? parsed.dealer : '',
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
    const todayEN = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    const todayES = now.toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Today is ${todayEN} / Hoy es ${todayES}.\n\n${note}` },
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
      dealer: dedupeConsecutiveRepeatedWords(titleCaseWords(result.dealer)),
      summary: result.summary.trim(),
      nextStep: dedupeConsecutiveRepeatedWords(capitalize(result.nextStep)),
      nextStepTitle: dedupeConsecutiveRepeatedWords(capitalize(result.nextStepTitle)),
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
      product: titleCaseWords(result.product),
      location: titleCaseWords(result.location),
      acreage: result.acreage,
      crmText: capitalize(result.crmText),
      additionalSteps: result.additionalSteps.map((s) => ({
        action: capitalize(s.action.trim()),
        date: s.date.trim(),
        time: s.time.trim(),
      })),
    }

    const enriched = {
      ...capitalized,
      contactCompany: dedupeConsecutiveRepeatedWords(
        resolveContactCompany(
          capitalized.dealer,
          capitalized.customer,
          capitalized.contact,
          capitalized.nextStepTarget,
          titleCaseWords(result.contactCompany),
        ),
      ),
      crmFull: ensureDealerInCrmFull(capitalized.crmFull, capitalized.dealer),
      crmText: ensureDealerInCrmText(capitalized.crmText, capitalized.dealer, note),
    }

    return NextResponse.json(enriched)
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Something went wrong' },
      { status: 500 }
    )
  }
}