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
  crmText: string
}

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

const SYSTEM_PROMPT = `You are a CRM assistant for a B2B agricultural field sales rep based in California.

The rep visits growers and farm operations and dictates quick voice notes after each visit.
Notes are informal, spoken-style, and may include industry slang, filler words, or incomplete sentences.

Your job: extract structured CRM data from the note. Return ONLY valid JSON, no markdown, no explanation.

Fields to extract:
- customer: the GROWER or farm operation that uses the product (e.g. Laguna Farms). Never the distributor — that belongs in dealer.
- dealer: the distributing company or intermediary the rep visited (e.g. Coastal Growers). Empty string if the rep met the grower directly.
- contact: person's name spoken to (first name or full name)
- summary: 1–2 sentences ONLY about what was discussed and any objections or next context. Do NOT repeat location, crop, or acreage — those are separate fields. Focus only on what happened in the conversation.
- nextStep: the single most important action the rep needs to take
- notes: any additional context not covered elsewhere (keep short, optional)
- crop: the crop(s) mentioned (e.g. strawberries, romaine lettuce)
- product: the product(s) discussed
- location: city or region only (e.g. Salinas, Oxnard)
- acreage: number of acres mentioned as a number only (e.g. 200), empty string if not mentioned
- crmText: a clean, well-written paragraph in the SAME language as the input note, ready to paste directly into a CRM

---

GENERAL RULES:

- customer is always the GROWER or farm that uses the product (e.g. Laguna Farms), never the dealer.
- dealer is the distributing company or intermediary the rep visited (e.g. Coastal Growers); leave empty if they visited the grower directly.
- If the rep visited a dealer who mentioned a grower client, put the grower in customer and the visited company in dealer.
- Do NOT invent or assume information not in the note.
- If a field is not mentioned, return "".
- summary must be short, focused, and reflect only the conversation.
- Return valid JSON only.
- IMPORTANT: Always respond in the same language as the input note. If the note is in Spanish, all field values must be in Spanish. Never translate.

---

NEXT STEP RULES:

Format it as:
ACTION + TARGET + (OPTIONAL CONTEXT)

Primary format:
- ACTION + CONTACT + (COMPANY)

Examples:
- "Llamar a Alfonso Paniagua (Laguna Farms)"
- "Enviar oferta a María (Sunset Berry Farms)"
- "Hacer seguimiento con Tyler (Coastal Growers)"

Rules:

1. Keep it short, clear, and directly executable  
- It must be usable as a calendar event title  

2. Always prioritize contact name if available  
- If contact exists → use CONTACT + (COMPANY)  

3. If contact is missing but company exists  
→ use COMPANY only  
Examples:
- "Hacer seguimiento con Laguna Farms"
- "Enviar precios a Coastal Growers"

4. If both contact and company are missing  
→ fallback to ACTION + OBJECT  
Examples:
- "Enviar oferta"
- "Hacer seguimiento de precios"
- "Confirmar pedido"

5. Use strong action verbs depending on context:
- Llamar
- Enviar
- Hacer seguimiento
- Visitar
- Confirmar
- Revisar

6. Infer the correct action from context:
- no contestó → Llamar  
- esperando respuesta → Hacer seguimiento  
- enviar info → Enviar  
- reunión → Agendar reunión  

7. Avoid weak or generic phrases:
- "llamar nuevamente"
- "seguir más tarde"
- "ver qué pasa"

Always make it specific.

8. Date handling:
- If a specific date is clearly mentioned, include it at the end in format MM/DD/YYYY  
Example:
"Llamar a Alfonso Paniagua (Laguna Farms) el 04/08/2026"

- If the note contains relative time (e.g. next week, mañana, early next week), convert it into a specific date in MM/DD/YYYY

Goal:
Generate a nextStep that a real sales rep would put directly in their calendar and execute without thinking.

---

CRM TEXT RULES:

- Write 2–4 sentences maximum
- Natural, professional tone (like a real sales rep)
- No labels, no bullet points
- Mention:
  - who they met
  - what was discussed
  - key relevant details (product, acreage if important)
  - next action

- Do NOT sound robotic or structured
- Do NOT repeat unnecessary data already captured in fields
- Must feel human-written

---

OUTPUT FORMAT:

Return ONLY valid JSON with all fields. No explanation.`

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

    // Capitalize first letter of each field
const capitalize = (s: string) => s ? s.charAt(0).toUpperCase() + s.slice(1) : ''

const capitalized = {
  ...result,
  contact: result.contact.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
  customer: result.customer.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
  dealer: result.dealer.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
  summary: capitalize(result.summary),
  nextStep: capitalize(result.nextStep),
  notes: capitalize(result.notes),
  crop: result.crop.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
  product: result.product.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
  location: result.location.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
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