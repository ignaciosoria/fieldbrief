import OpenAI from 'openai'
import { NextResponse } from 'next/server'

type StructureBody = {
  customer: string
  dealer: string
  contact: string
  summary: string
  nextStep: string
  notes: string
  crop: string
  product: string
  location: string
  acreage: string
  crmText: string
}

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

const SYSTEM_PROMPT = `You are a CRM assistant for a B2B agricultural field sales rep based in California.

The rep dictates quick voice notes after each visit. Notes are informal, spoken-style, and may include slang or incomplete sentences.

Your job: extract structured CRM data. Return ONLY valid JSON.

Fields:
- customer
- dealer
- contact
- summary
- nextStep
- notes
- crop
- product
- location
- acreage
- crmText

---

LANGUAGE RULE (STRICT):
- Detect the language of the input note
- ALL output fields MUST be in the SAME language as the input
- NEVER mix languages
- If the input is in Spanish, every field value must be in Spanish
- If the input is in English, every field value must be in English
- This applies to nextStep, summary, notes, crmText, crop, product, and location if generated from the note
- Do not translate company names or product names, but keep surrounding wording in the correct language

---

RULES:

- customer = grower using the product (never dealer)
- dealer = distributor visited (empty if direct grower visit)
- If missing → return ""
- Do NOT invent info

---

SUMMARY:
- 1–2 sentences
- Only what happened in the conversation
- No repetition of crop/location/acreage

---

NEXT STEP RULES:

Format:
ACTION + TARGET + (COMPANY)

Examples (English input):
- "Call Alfonso Paniagua (Laguna Farms)"
- "Send pricing to Tyler (Coastal Growers)"
- "Follow up with Laguna Farms"

Examples (Spanish input):
- "Llamar a Alfonso Paniagua (Laguna Farms)"
- "Enviar precios a Tyler (Coastal Growers)"
- "Hacer seguimiento con Laguna Farms"

Rules:

- Must be short and executable
- Must start with strong verb
- The action verb in nextStep MUST be in the same language as the input note
- Never generic:
  - "call again"
  - "follow up later"

Fallbacks:

1. If contact exists:
   → CONTACT + (COMPANY)

2. If only company:
   → COMPANY only

3. If none:
   → ACTION + OBJECT

Examples:
- "Send proposal"
- "Follow up on pricing"

Verb inference (use equivalents in the input language—never mix):
- no answer → Call / Llamar
- waiting → Follow up / Hacer seguimiento
- sending info → Send / Enviar
- meeting → Schedule / Agendar

Date:
- If explicit → include MM/DD/YYYY
- If relative → convert to exact date

---

CRM TEXT:

- 2–3 short sentences
- Natural, human, CRM-ready
- No labels
- Easy to scan
- crmText must be written fully in the same language as the input note
- Never use English sentence structure for Spanish input
- Never use Spanish verbs or phrasing for English input
- Example style (English input):

"Left a voicemail for Alfonso Paniagua (Laguna Farms). Following up to confirm he received Tyler’s pricing."

---

Return ONLY JSON.`

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

function parseStructureJson(text: string): StructureBody {
  const clean = extractJson(text)
  const parsed = JSON.parse(clean) as Record<string, unknown>

  return {
    customer: typeof parsed.customer === 'string' ? parsed.customer : '',
    dealer: typeof parsed.dealer === 'string' ? parsed.dealer : '',
    contact: typeof parsed.contact === 'string' ? parsed.contact : '',
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    nextStep: typeof parsed.nextStep === 'string' ? parsed.nextStep : '',
    notes: typeof parsed.notes === 'string' ? parsed.notes : '',
    crop: typeof parsed.crop === 'string' ? parsed.crop : '',
    product: typeof parsed.product === 'string' ? parsed.product : '',
    location: typeof parsed.location === 'string' ? parsed.location : '',
    acreage: typeof parsed.acreage === 'string' ? parsed.acreage : '',
    crmText: typeof parsed.crmText === 'string' ? parsed.crmText : '',
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

    const capitalized = {
      ...result,
      contact: result.contact
        .split(' ')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' '),
      customer: result.customer
        .split(' ')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' '),
      dealer: result.dealer
        .split(' ')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' '),
      summary: capitalize(result.summary),
      nextStep: capitalize(result.nextStep),
      notes: capitalize(result.notes),
      crop: result.crop
        .split(' ')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' '),
      product: result.product
        .split(' ')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' '),
      location: result.location
        .split(' ')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' '),
      acreage: result.acreage,
      crmText: capitalize(result.crmText),
    }

    return NextResponse.json(capitalized)
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Something went wrong' },
      { status: 500 }
    )
  }
}