import OpenAI from 'openai'
import { DateTime } from 'luxon'
import { NextResponse } from 'next/server'
import {
  resolveRelativeDate,
  resolveRelativePhraseToMmdd,
  resolveCalendarTimeHint,
  toUserAnchorDateTime,
} from '../../../lib/calendarResolveDate'
import {
  ACTION_KIND_SCORE,
  inferActionKind,
  isHigherValueKindThanSend,
  type ActionKind,
} from '../../../lib/nextStepActionKind'
import { resolveContactCompany } from '../../../lib/contactAffiliation'
import { dedupeConsecutiveRepeatedWords } from '../../../lib/stringDedupe'
import {
  stripDealerClosingFromCrmText,
  stripDealerLinesFromCrmFull,
} from '../../../lib/dealerField'
import { normalizeProductField, productFieldToList } from '../../../lib/productField'
import { detectNoteLanguage } from '../../../lib/detectNoteLanguage'
import { isNoClearFollowUpLine } from '../../../lib/noFollowUp'

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
  /** Relative time phrase only (tomorrow, next Friday, next week). Server resolves to MM/DD/YYYY. */
  nextStepTimeReference: string
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
  /** 3–5 scannable → lines for calendar event body; separate from crmFull and crmText. */
  calendarDescription: string
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

**nextStep** and **nextStepTitle** — **no exceptions:**
- They MUST be written **entirely** in the **same language as the input note** — character-for-character language match (English note → English only; Spanish note → Spanish only).
- **Never** output Spanish in nextStep or nextStepTitle when the note is English, and **never** the reverse. These two fields are **not** allowed to differ from the note's language.

---

RELIABILITY MANDATE (HIGHEST PRIORITY — OVERRIDES GUESSING):

These JSON fields must be **100% grounded in explicit note wording** or left **empty** (""). **Never invent, assume, or infer** to fill them.

1. **contact** (person name)
   - Fill **only** when the note **explicitly names or clearly identifies** the person the rep spoke with (spoken full name, first name + unmistakable context, or "the buyer at X" only if that person is named elsewhere in the same note).
   - If the note does **not** clearly name the direct contact → **contact = ""** and add **"unclear_contact"** to **ambiguityFlags**.

2. **nextStepTimeReference** and **nextStepDate** (derive **nextStepTime** / hints only when the note anchors time)
   - **nextStepTimeReference** = natural-language timing from the note only — e.g. **tomorrow**, **next Friday**, **next week**, **Thursday**, **mañana**, **el jueves**, **próxima semana**. **Never** put MM/DD/YYYY here. **Do not** compute calendar dates yourself for relative phrases; the **backend** resolves this field to **nextStepDate** using the user's timezone.
   - When timing is relative or weekday-based, **prefer** filling **nextStepTimeReference** and set **nextStepDate** to **""** (the server fills the exact date).
   - Fill **nextStepDate** (MM/DD/YYYY) in the model output **only** for unambiguous explicit numeric anchors (e.g. **3/15**, **April 9**) when you are not using **nextStepTimeReference** for that same timing — otherwise leave **nextStepDate** empty and let the server resolve from **nextStepTimeReference**.
   - **Never** infer a date from tone alone ("soon", "follow up", "I'll call her", no time stated) or from **voicemail / no-answer** patterns unless the note literally says **tomorrow** / a day / a date (or equivalent phrase for **nextStepTimeReference**).
   - If no explicit day or date for the follow-up → **nextStepTimeReference** = **""**, **nextStepDate** = **""**, **nextStepTime** = **""** as appropriate, and add **"unclear_date"** to **ambiguityFlags**.

3. **nextStepTarget**
   - Must be the **same person** as the **direct contact** when a person is the object of the next step. **Never** put a third party, dealer's customer, or mentioned-but-not-present person here.
   - If **contact** is empty, **nextStepTarget** must be **""**. If **contact** is set, **nextStepTarget** must match **contact** (same person) or be **""** with **"unclear_target"** in **ambiguityFlags** when disambiguation is needed.
   - If who receives the follow-up is ambiguous → add **"unclear_target"** (and/or keep **multiple_people** / **multiple_people_mentioned** when several names appear).

**ambiguityFlags:** Use short snake_case strings. Whenever you withhold or leave a field empty because of this mandate, include the matching flag: **unclear_contact**, **unclear_date**, **unclear_target**. The app shows validation modals instead of guessing.

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

ROLES (UNDERSTAND THESE BEFORE EXTRACTING — READ THE WHOLE NOTE FIRST):

Before choosing **contact**, **nextStepTarget**, or any next step, infer **who the rep actually interacted with** in this visit/call (voice, in person, live video). Do not treat a lead or account name as the "contact" if the rep only spoke to someone else.

1. THE REP — always "I/yo". Never extract as contact.
2. **DIRECT CONTACT** — the person the rep **directly** spoke with in this interaction (the counterparty in the conversation). **nextStepTarget** must always be this person's name when a person is involved — never an indirect name.
3. **CUSTOMER** — the **account organization** (legal entity, site, buyer company, clinic, farm, brand unit). Not a relationship label alone ("their client") unless a real org name is given.
4. **DEALER / DISTRIBUTOR / CHANNEL** — if the rep met **their** counterpart at a distributor, dealer, agency, or reseller, that person is usually the **direct contact**; the **end customer account** may appear as **customer** or in insights. Do **not** confuse the **end user** mentioned in passing with the person you spoke to — if you did not speak to the grower/doctor/buyer, they are **not** **contact** or **nextStepTarget**.
5. **THIRD PARTY / INDIRECT** — anyone **named or described** but **not** part of this conversation (colleague not in the room, boss to "run it by", a prospect the dealer mentioned). **Never** **nextStepTarget**; capture in **mentionedEntities** / **crmFull** only.

- contact = **direct** conversation partner (may work for dealer OR for end account — match the note).
- customer = named **organization** for the **account** being worked (may differ from **contactCompany** when the rep spoke to a channel partner).

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

DISTRIBUTOR / END-ACCOUNT (reference):
- Note: "Met with James at distributor, introduced me to end client Dr. Chen with 15 staff."
- **contact** = **James** (person you met / spoke with — the direct conversation partner).
- **contactCompany** = distributor name if stated, else "".
- **customer** = the **end-account organization** (the named clinic, practice, buyer company, or brand site Dr. Chen represents) if a real org name appears — NOT a relational label alone.
- **Dr. Chen** = third party for this visit if you did **not** speak to Chen directly on this call/visit → Chen in **mentionedEntities** / **crmFull**, **never** in **nextStep** or **nextStepTitle**. If the note only describes Chen without a legal org name for **customer**, leave **customer** "" and capture detail in insights.

---

NO REAL FOLLOW-UP (MANDATORY — ACCURACY OVER OUTPUT):

You are **deciding what to do next**, not summarizing the note.

**Internal pipeline (do not output these steps as text):**
1. **Intent:** Does the note contain a real follow-up — a commitment, a planned action, or clear next-step intention in a business/sales context? If **no** → use the sentinel strings below; **do not invent** actions.
2. **Extract:** If yes, list every forward action (internally).
3. **Rank:** Apply **ACTION PRIORITY** below. When actions fall on **different calendar days**, **earliest day wins** for the **primary** next step (later days → **additionalSteps**) — see **CHRONOLOGY FIRST** below.
4. **One primary:** Output **exactly ONE** action in **nextStep** / **nextStepTitle** — never a list, never multiple verbs in one line.
5. **Timing:** Per the **RELIABILITY MANDATE**: put relative/phrase timing in **nextStepTimeReference**; **do not** output MM/DD/YYYY for those — the **server** resolves exact **nextStepDate** in the user's timezone. **Never** fabricate a calendar date from tone alone.
6. **Person:** **nextStepTarget** = the person who should receive or be part of **that** action (direct-contact rules; **""** when not applicable).

**If there is no clear intent, commitment, or next step** (e.g. pure social chat, internal admin-only, facts with no forward motion, vague pleasantries with no commercial next step) — set **exactly**:
- **nextStep** and **nextStepTitle** to the same string: English → **No follow-up needed** | Spanish → **No se requiere seguimiento**
- **nextStepAction** = "", **nextStepTarget** = "", **nextStepDate** = "", **nextStepTimeReference** = "", **nextStepTime** = "", **nextStepTimeHint** = ""
- **additionalSteps** = [] (empty array)
- **nextStepConfidence** = "low"
- **crmText** / **crmFull** may still describe what was said; **calendarDescription** = "" unless a brief non-actionable context line is needed (no implied meeting).

Do **not** apply voicemail / no-answer "call again" defaults or PASSIVE/WAIT conversion when this rule applies — those require an implied follow-up; this rule means **there is none**.

---

ABSOLUTE RULE — THIRD PARTIES (NEVER BREAK):

nextStepTitle AND nextStep MUST NEVER contain names of third parties (people the rep did NOT directly speak to in this visit).

- If Luis was not present in the conversation, his name MUST NOT appear in nextStepTitle or nextStep under any circumstance — not in the verb line, not after the company em dash, not as "context".
- ONLY the direct contact's name may appear in nextStep and nextStepTitle (nextStepTitle must include the company using the separator " — " (space + em dash U+2014 + space) when the COMPANY RULE applies — see below).
- Third-party names may appear in crmText, crmFull, calendarDescription, mentionedEntities — but NEVER in nextStep or nextStepTitle. Put named end-account organizations in customer only (never relational labels alone — see CUSTOMER rules above).

---

NEXT STEP — ABSOLUTE RULES:

LANGUAGE (nextStep + nextStepTitle) — **MANDATORY:**
- **nextStep** and **nextStepTitle** MUST be in the **exact same language as the input note**. No exceptions — not mixed language, not a "default" language, not Spanish templates for English notes.
- If the note is English, every word of nextStep and nextStepTitle must be English (except proper names and company names as spoken). If the note is Spanish, both fields must be Spanish throughout.

DECISION POLICY — DEAL ADVANCEMENT (NOT SUMMARY, NOT FIRST TASK IN THE NOTE):
- Your job is **not** to summarize the visit. Decide **one** next action: output **exactly ONE** primary next step — the single action that **best moves this opportunity forward** for the rep to execute.
- Do **not** pick the **first** action mentioned in dictation order; do **not** merge multiple actions into one line; do **not** default to generic "send info" when a stronger engagement step exists.
- **Reliability beats polish:** **nextStep** / **nextStepAction** must be **factually aligned** with the note. For **contact**, **nextStepDate**, and **nextStepTarget**, follow the **RELIABILITY MANDATE** above (empty + **ambiguityFlags** instead of guessing).

INTERNAL (reason only — do not output): List candidate forward actions with resolved **calendar day** for each (from note + context). If days differ, **earliest day wins** primary (before tier). If same day, classify by **ACTION PRIORITY** (below), identify who each action targets (must be **direct contact** unless org-only), then pick **one** primary. Secondary actions → **additionalSteps** in chronological order when dated.

CONFIDENCE + URGENCY MAPPING (use existing confidence / nextStepConfidence only):
- confirmed + clear action/timing + concrete request/agreement → confidence **high** (urgency high/normal based on wording).
- clear action but weak/unclear timing OR inferred follow-up → confidence **medium** (urgency usually normal/low).
- vague/no clear action, hesitation, "later", "busy", "not now", neutral talk → confidence **low** and avoid over-assertive nextStep wording.
- Never treat every note with the same urgency.

---

NEXT STEP — ACTION PRIORITY (WHEN MULTIPLE FORWARD ACTIONS EXIST ON THE **SAME CALENDAR DAY**):

After applying **CHRONOLOGY FIRST** across days, rank same-day candidates:

1. **Highest:** Calls and meetings — live or scheduled calls, callbacks, visits, demos, site walkthroughs, appointments (including scheduling one when that is the clear next commercial move).
2. **Second:** Follow-ups and check-ins — lighter-touch touchpoints when rank 1 (calls/meetings) is not the right primary for the same day.
3. **Third:** Sending information — email, deck, brochure, quote, samples, materials — use as **primary** only when **no** higher-tier action is appropriate **or** the note makes a **time-bound send** the explicit gate (e.g. RFP due before a decision meeting).
4. **Lowest — ignore unless no other option:** Passive or vague actions; **never** as primary if any Tier 1–3 action exists.

**CHRONOLOGY FIRST (MANDATORY — APPLIES BEFORE TIER):**
- When two or more forward actions are anchored to **different calendar days** (using **today** / **tomorrow** / weekday / explicit date from the note + calendar context), the action on the **earliest** calendar day is **always** the **primary** next step, and later-day actions go to **additionalSteps** — **even if** the earlier-day action is Tier 3 (send) and the later-day action is Tier 1 (call).
- **Today always beats tomorrow** (and any later day). Example: "Send market analysis today before 5pm" and "Call tomorrow at 10am" → **primary = send market analysis today** (with **nextStepDate** = today and time hint as needed); **additionalSteps** = call tomorrow at 10am.
- Only when candidates fall on the **same calendar day** does **rank** decide among them (1 > 2 > 3; passive rank-4 never beats 1–3), then buyer preference, then earlier clock time that day.

Rules:
- **Prefer chronology across days**, then **tier within the same day**, not dictation order. Example: "I'll send samples this week and call her Thursday" → if **send** is earlier in the week than **Thursday call**, primary = whichever day is **earlier**; if both land on the same day, **primary = call** (Tier 1 over Tier 3).
- Example: "I'll send samples this week and call her Thursday" when send is Tuesday and call is Thursday → **primary = send Tuesday** (earlier day); call Thursday → **additionalSteps**.
- **Do not** choose a weak Tier 3 send as primary over a Tier 1 call **when both are on the same day** — tier still wins **same day**.
- **Exception:** If the only explicit forward commitments are sends (no call/meeting to book), Tier 3 wins by default — still pick the **single** send that best advances the deal (often the earliest deadline).
- **Among actions on the same calendar day and same tier:** prefer (1) what the buyer **explicitly asked for or confirmed**, then (2) **earlier** clock time, then (3) the action that unlocks the next decision.
- **Past** actions (already done this visit) are **not** the next step — the **next forward** action is.
- If timing is not explicit, do **not** invent an exact date/time in JSON fields.
- If the note signals low urgency ("busy", "not the right moment", "later", neutral interest), keep urgency low and avoid aggressive immediate timing.

WEAK OUTPUTS — NEVER AS PRIMARY nextStep:
- Generic summaries ("Discussed pricing", "Good meeting")
- Multiple actions crammed into one line
- Vague tasks ("Follow up", "Stay in touch" without **who** / **what** / **when** when the note allows specificity)
- **Administrative** work (update CRM, file report, internal email) as the main next step when a **customer-facing** action exists
- Choosing an **indirect** person as **nextStepTarget** when the rep spoke to someone else

REFERENCE CASES (English phrasing — mirror in the note's language):

**CASE 1 — Send / quote with weekday deadline (send is the committed forward beat):**
- Note: "Visited John at Acme Corp, discussed Product X pricing, interested but wants to compare. Sending quote Friday."
- Only explicit forward step is **send quote** → primary = **Send quote to John — Acme Corp**; **nextStepDate** = that Friday; **contact**=John, **customer**/ **contactCompany**=Acme Corp when that is John's org.

**CASE 2 — No answer / voicemail → follow-up call:**
- Note: "Called Sarah, no answer, left voicemail."
- Primary next step = rep-owned **follow-up call**, not passive waiting.
- Example alignment: **nextStep** and **nextStepTitle** → **Call Sarah again**; **nextStepDate** = **""** and **unclear_date** in **ambiguityFlags** unless the note explicitly says **tomorrow**, a **weekday**, or a **date** (never infer "tomorrow" from voicemail alone).
- **Exception — no company suffix:** when the note names **no** employer for the contact, **contactCompany** may be "" and **nextStepTitle** / **nextStep** may be **Call [name] again** **without** a ** — COMPANY** suffix — only for this voicemail / unanswered pattern.

**CASE 3 — Distributor intro, end client named:**
- See DISTRIBUTOR / END-ACCOUNT rule above: **contact** = rep's counterpart (e.g. James at distributor); **customer** = end-account org when named; introduced physician/staff as third party unless they were the party spoken to.

**CASE 4 — Check-in + deferred decision + callback Monday:**
- Note: "Called to check if they received my info. Needs more time. Calling again Monday."
- **Past** check-in is not the primary next step. The **forward** commitment wins: **Call [direct contact's name] Monday** — use the actual **contact** name from the note, not the literal text "[contact]".
- **nextStepDate** = upcoming Monday from calendar context; same wording in **nextStep** and **nextStepTitle** (with ** — COMPANY** when org is known per usual rules).

**CASE 5 — Send today + call tomorrow (chronology beats tier):**
- Note: "Hoy le mando precios y la llamo mañana" / "Sending prices today, call her tomorrow" / "Send market analysis today before 5pm, call tomorrow at 10am."
- **Primary = today's send** (earlier calendar day); **call tomorrow** → **additionalSteps** with tomorrow's date/time. Do **not** pick tomorrow's call as primary just because calls are Tier 1.
- **Same-day** exception: "Send prices this morning and call her this afternoon" (both today) → **primary = call** (Tier 1 over Tier 3 on the **same** day).

**CASE 6 — Two dated send actions (same tier — use deadline order):**
- Note: "Discussed two products. Wants prices Friday, sample next week."
- Both Tier 3 → primary = **earlier** deadline (**Friday** pricing); sample → **additionalSteps** for next week.

**CASE 7 — Samples this week vs call Thursday:**
- Note: "Le mando muestras esta semana y la llamo el jueves."
- If **send** resolves to a **specific calendar day before Thursday**, **primary = send that day** (earlier day wins); **call Thursday** → **additionalSteps**.
- If send has **no day more specific than "this week"** but call is **Thursday**, **primary = call Thursday** (Tier 1); samples → **additionalSteps** when dated.

---

nextStepTitle format: **VERB + CONTACT NAME + em dash separator + COMPANY NAME** (separator is exactly: space, Unicode em dash U+2014, space — never hyphen-minus for the separator).
Always capitalize first letter.
CORRECT: 'Call Ignacio Soria — Agrinova Science'
CORRECT: 'Enviar materiales a Carmen — Pacific Brands'
CORRECT: 'Llamar a Tyler — Coastal Supplies'
WRONG: 'Call Ignacio Soria (Agrinova Science)' ← never parentheses around company
WRONG: 'enviar muestras Carmen López' ← missing company separator when org is known

Store every non-primary action in additionalSteps with date/time when known, in chronological order.

NEVER use conditional language ("si puedo", "if I go"). Convert to definitive action.

PASSIVE / WAIT — NEVER AS nextStep:
- NEVER use esperar, wait, or a que me llame as nextStep, nextStepTitle, or nextStepAction (the rep must own a concrete action).
- If the client said they will call back, will reach out, or asked the rep to wait — do NOT encode that as passive waiting. Convert to a proactive action in the SAME language as the note, while keeping nextStepTitle COMPANY RULE (VERB + CONTACT + em dash + COMPANY):
  - Spanish: Llamar a [contact] — [company] si no hay respuesta antes de [date]
  - English: Call [contact] — [company] if no response before [date]
- [company] = org the direct contact belongs to — use **contactCompany** when set; otherwise **customer** when the contact aligns with that end account. [date] = align with nextStepDate. Mirror the same wording in nextStep and nextStepTitle (nextStepAction should be the leading verb phrase, e.g. Llamar / Call).
- Do **not** default to "Call" unless it is genuinely the best action from the note context (explicit request, failed contact pattern, or strongest implied follow-up).

nextStepTitle — COMPANY RULE (MANDATORY):
- **First word:** nextStepTitle MUST **start with an uppercase letter** (same language as the note).
- Format is ALWAYS: **VERB + CONTACT NAME + " — " + COMPANY NAME** (space + em dash + space). Never use parentheses around the company; never leave the company part empty when **contactCompany** or a clear org for the direct contact exists.
- The segment after the em dash separator MUST be the organization the DIRECT CONTACT works for (contactCompany preferred; customer when it is their client's org).
- One org only after the separator — must match affiliation (who employs the contact or whose account they represent in this visit).
- Wording should be natural and executable; avoid awkward literal phrasing. Prefer concise labels (in note language), e.g. "Send program — …", "Call Juan — …", "Follow up with Marta — …", "Send trial proposal — …".

nextStepTitle — GRAMMAR (MANDATORY, same language as the note):
- **Spanish:** The contact name MUST be preceded by **"a"** after the verb phrase when grammar requires it. **Never** omit it.
  - Call / follow-up verbs → **"Llamar a [nombre] — [empresa]"** — WRONG: "Llamar Carmen — …" or any form missing **a** before the contact name.
  - Send / ship / email verbs (enviar, mandar, pasar, reenviar, etc.) → **"Enviar … a [nombre] — [empresa]"** — e.g. "Enviar documentos a Carmen — Pacific Brands", "Mandar la cotización a Carmen — Pacific Brands" — WRONG: "Enviar documentos Carmen — …", "Mandar cotización Carmen — …".
- **English:** Use natural grammar: **"Call Carmen — Pacific Brands"**; for send-style verbs use **"to"** before the name when required — e.g. **"Send deck to Carmen — Pacific Brands"**.
- Mirror the same correct phrasing in **nextStep** and **nextStepAction** / **nextStepTarget** so nothing contradicts the title.

CORRECT: Tyler works for Coastal Supplies → contactCompany=Coastal Supplies → "Llamar a Tyler — Coastal Supplies".
CORRECT: Alfonso is the buyer at Laguna LLC → contactCompany or customer = Laguna LLC → "Llamar a Alfonso — Laguna LLC".
CORRECT (Spanish send): "Enviar propuesta a Carmen — Pacific Brands" — includes **a** before the contact.
WRONG: "Enviar cotización a Tyler — …" when the company after the em dash is missing or wrong — title must be VERB + **a** + contact + em dash separator + **CORRECT COMPANY**; never "Enviar cotización Tyler — …" (missing **a** before contact).
WRONG: "Llamar Tyler — Coastal Supplies" — missing **a** before Tyler (Spanish).
WRONG: "Llamar a Tyler — Luis" ← Luis is third party, forbidden in BOTH nextStepTitle and nextStep
WRONG: "Llamar a Luis — …" when Luis was only mentioned, not spoken to — use the direct contact name only
- NEVER repeat the same word twice in a row in the contact name part of nextStepTitle (WRONG: "Call David David Kim", "Mike Mike", "Llamar a Narciso Narciso Estrada"). nextStepAction + nextStepTarget must not concatenate a duplicated first name.

---

DATE/TIME RULES (for **nextStepTimeReference**, **nextStepDate**, **nextStepTime** — RELIABILITY MANDATE applies):

- Map **explicit** phrases in the note to **nextStepTimeReference** (phrases) and to **nextStepTime** / **nextStepTimeHint** (wall-clock or period words). **Do not** output MM/DD/YYYY for relative timing — the server resolves **nextStepTimeReference** → **nextStepDate** in the user's timezone.
- "mañana por la mañana" → **nextStepTimeReference** includes **mañana** / **tomorrow**; **nextStepTimeHint** can reflect morning (only when stated for that action)
- "por la tarde" → 3:00pm hint; "al mediodía" → noon; "por la mañana" → 9:00am hint
- When a weekday or relative day is stated, put that wording in **nextStepTimeReference** and leave **nextStepDate** empty unless you also have a separate numeric date anchor.
- If **no** explicit day/date for the follow-up appears in the note → **nextStepTimeReference** = **""**, **nextStepDate** = **""**, and **unclear_date** in **ambiguityFlags**

---

JSON key **summary**:
- Always **""** (empty string). Legacy field — do not put content here.

---

THREE OUTPUT ZONES (distinct purposes — do not duplicate the same sentence across zones):

**1) KEY INSIGHTS — JSON array **crmFull****
- **Maximum 4** lines. No filler. Each line must directly help **execute the next step** or answer **what you must know before doing it** (objection, risk, competitor, quantity/deal size if it changes the pitch, rep offering interest if it drives the ask).
- Do **not** use **📅** here — dates, deadlines, and follow-up timing belong in **calendarDescription** and **nextStep** fields, not in Key Insights (the app hides **📅** lines from this list).
- Short lines with emojis when helpful (same emoji discipline as before):
  - **📦** = rep's own offering only · **📊** = volume/scale · **💰** = pricing/terms · **⚠️** = risk/blocker · **⚔️** = competitor/incumbent product (never in **product** JSON) · **🆕** = direct contact interest in **your** offering (ties to **product** field) · **🏪** channel when relevant.
- If more than four facts compete, keep the four that most affect **how** the rep will run the next call, visit, or send.
- Ruthlessly omit repetition of the next step line and generic pleasantries.

**2) CRM TEXT — JSON string **crmText****
- **Professional sales note** for pasting into a CRM: plain language, **no emojis**, no bullet symbols, no decorative punctuation. Same language as the note.
- Write **one short paragraph** (or two very short paragraphs only if needed) that covers: **interest level / intent**, **what they use today or incumbent solution**, **competition or alternatives mentioned**, and **any critical context** (budget, timing, stakeholders, risk). Nothing important omitted.
- Do **not** repeat the next-step line verbatim here; do **not** label sections with "Topics:"—write flowing prose like a rep's own note.
- Do NOT add a dedicated "distributor" or "Distribuidor:" closing line.
- **Volume / quantity:** If the note states any numeric volume, quantity, units, capacity, seats, headcount, or deal size, **crmText** MUST include it explicitly. Set JSON **acreage** to a short phrase restating that fact (same language), or "" if none stated.

**3) CALENDAR DESCRIPTION — JSON string **calendarDescription****
- **At most 3** lines. Plain sentences only — **no** labels like "Customer:", "Next step:", or field names. No emojis. Same language as the note.
- Each line may start with **→** then a space (optional); the app strips arrows. Line 1 = highest-signal context for the calendar body; lines 2–3 = only if distinct extra facts (deadlines, risk, comparison). Not a duplicate of **crmText**.
- Purpose: snippets the rep can read in **under 5 seconds** in a calendar event — concerns, timing, decision context. Put only the **three** most execution-critical reminders (omit lower-priority context).

---

DIRECT CONTACT — NEW OFFERING INTEREST (**product** + **crmFull** when space allows):
- When the direct contact shows interest in a **new** rep-offered product/service: append to JSON **product**; if **crmFull** still has room (≤4 lines), add one **🆕** line; otherwise ensure **crmText** still captures the interest in full.
- Competitor/incumbent products: **⚔️** in **crmFull** if it fits the 4-line budget for next-step relevance; always detail in **crmText**.

---

PRODUCT FIELD (JSON keys **product** and **crop**):

**product** = **only** what the **rep's own company** is **pitching, proposing, or selling**. The app renders **product** as pills — **never** put a **competitor's or incumbent vendor's** product there. Competitor / incumbent offerings belong in **crmFull** (Key Insights) with the **⚔️** competitor flag, not in **product**.

STRICT — what belongs in **product**:
- Only extract **real products or services the rep's employer sells or is actively proposing** in this conversation.
- NEVER include **competitor products**, "what they use today" from another vendor, or substitutes sold by rivals — always **⚔️** in **crmFull** instead.

**Documents / deliverables are NEVER products (MANDATORY):**
- **documents**, **templates**, **analyses**, **reports**, **brochures**, **sell sheets**, **one-pagers**, **decks**, **PDFs/spreadsheets** (as deliverables), **comparison sheets**, **marketing collateral** — these are **not** JSON **product** entries under any name (including "ROI Analysis Template", "Market Analysis", "competitive analysis", "QBR deck", "pricing comparison", "product brochure").
- If the **only** offerings mentioned in the note are deliverables of this kind — **nothing** that is a real sold SKU or subscription/service — set **product** to **""** (empty string). Do **not** output a pill for a document.
- Describe sends (e.g. "email the ROI template") in **nextStep**, **crmText**, and **crmFull** (if relevant) only — **never** duplicate that document name into **product**.

- Valid **product** examples (rep's catalog): 'Salesforce CRM', 'Quantum Flower', 'Patient Scheduling Software'
- Invalid as **product** (use elsewhere): 'ROI Analysis Template', 'price comparison', 'brochure'; **also invalid:** a rival's SKU the account already bought — use **⚔️** line in **crmFull** when that line is one of the four execution-critical insights, and always document in **crmText**.

FIELD RULES:
- Put **all qualifying rep-owned** offerings, SKUs, services, programs, and category labels into **product** as a **comma-separated list** in the same language as the note — **never** a document or template string.
- Set JSON **crop** to **""** (empty). Do not use a separate crop field — all qualifying rep offerings belong in **product**.
- One offering → single name. When **NEW OFFERING INTEREST** applies, include the new item in **product** only if it is **the rep's** real offering, not a one-off document and **not** a competitor product.

---

REQUIRED JSON KEYS (single object — include every key):

contact, contactCompany, customer, location, crop, product, acreage,
summary,
nextStep,
nextStepTitle,
nextStepDate,
nextStepTimeReference,
nextStepTime,
additionalSteps,
crmText,
crmFull,
calendarDescription,
confidence,
ambiguityFlags,

Also include (same object) for the client app:
nextStepAction,
nextStepTarget,
nextStepTimeHint,
nextStepConfidence,
mentionedEntities,
notes

**nextStepTimeReference (timing extraction — server resolves dates):**
- Put **only** natural-language timing from the note (e.g. "tomorrow", "next Friday", "next week", "mañana", "el jueves"). **Never** put MM/DD/YYYY here.
- Prefer **nextStepTimeReference** for any relative timing; set **nextStepDate** to **""** when the reference carries the date — the **backend** fills **nextStepDate** in the user's timezone. Do not invent calendar dates.

Rules for the extra keys:
- crop = always "" (empty string). Deprecated key — put **only the rep's** offering labels in **product**; competitor products → **crmFull** with **⚔️** only.
- contactCompany = employer / org of the direct contact only (see contactCompany rules above). Independent consultant → "". Not a copy-paste alias of customer unless that truly is their company name.
- nextStepAction = single verb phrase for the PRIMARY next step only (one action — no compound "and / or" lists)
- nextStepTarget = the **direct contact's** name for that action (never third party, never dealer's end-customer name if you did not speak to them) — must **match** JSON **contact** whenever the step targets the person you met; same ABSOLUTE RULE as nextStep / nextStepTitle
- nextStepTitle must follow the nextStepTitle COMPANY RULE above (VERB + CONTACT + em dash + COMPANY; company after em dash = org the direct contact belongs to; when org is known never omit the separator + company; never mismatch org vs contact affiliation)
- nextStepTimeHint = derive from nextStepTime: use "morning", "afternoon", "noon", or 24h "HH:MM" as appropriate
- nextStepConfidence = same value as confidence (high | medium | low)
- confidence / nextStepConfidence mapping: confirmed + clear request/timing → high; clear action but timing weak or inferred → medium; vague/hesitant/no clear action → low
- mentionedEntities = JSON array of { "name", "type" } for every person/company named (type: contact | customer | dealer | company | other — use **dealer** for distributor/channel rep or org when relevant)
- notes = "" or a very short string if needed

additionalSteps = JSON array of objects: { "action", "date", "time" } for every other action mentioned (not the primary). Use "" for unknown date/time.

Return ONLY valid JSON. No backticks. No explanation.`

/** Client instant for "now" (ISO or ms); falls back to server time only if missing/invalid. */
function parseUserLocalInstant(body: Record<string, unknown>): Date {
  const raw = body.clientNow ?? body.userLocalTimestamp ?? body.userLocalNow
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const d = new Date(raw)
    if (!Number.isNaN(d.getTime())) return d
  }
  if (typeof raw === 'string' && raw.trim()) {
    const d = new Date(raw)
    if (!Number.isNaN(d.getTime())) return d
  }
  return new Date()
}

/**
 * Rich calendar anchors (EN + ES) so the model can resolve "jueves", "próxima semana", etc.
 * Uses the **user's** request-time instant in their IANA zone (not server local clock).
 * Weekday offsets: **nearest** calendar occurrence of that weekday (0–6 days ahead), with
 * late-night / "next weekday" rules applied in post-processing, not here.
 */
function buildStructureUserDateContext(timeZone: string, userNow: Date): string {
  const z = timeZone.trim() || 'America/Los_Angeles'
  const now = toUserAnchorDateTime(userNow, z)
  const fmtPair = (dt: DateTime) => {
    const en = dt.setLocale('en').toFormat('EEEE, MMMM d, yyyy')
    const es = dt.setLocale('es').toFormat("EEEE, d 'de' MMMM 'de' yyyy")
    return `${en} / ${es}`
  }
  const todayEN = now.setLocale('en').toFormat('EEEE, MMMM d, yyyy')
  const todayES = now.setLocale('es').toFormat("EEEE, d 'de' MMMM 'de' yyyy")
  const tomorrow = now.plus({ days: 1 })
  const nextThursday = now.plus({ days: (4 - now.weekday + 7) % 7 })
  const nextFriday = now.plus({ days: (5 - now.weekday + 7) % 7 })
  const nextMonday = now.plus({ days: (1 - now.weekday + 7) % 7 })
  const upcomingMonday = now.plus({ days: (1 - now.weekday + 7) % 7 })
  const nextWeekMonday = upcomingMonday.plus({ days: 7 })

  return [
    `User calendar timezone for this request: ${z}. The user's local "now" for this note is anchored to their device clock at send time — all relative dates ("today", "tomorrow", weekdays) use that instant in this timezone (not server time or UTC date alone).`,
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

/** Sort key: MM/DD/YYYY, ISO date, or missing (missing = last). */
function parseStepDateMs(dateStr: string): number {
  const t = (dateStr || '').trim()
  if (!t) return Number.POSITIVE_INFINITY
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(t)) {
    const [mm, dd, yyyy] = t.split('/').map((x) => parseInt(x, 10))
    if ([mm, dd, yyyy].some((n) => Number.isNaN(n))) return Number.POSITIVE_INFINITY
    return new Date(yyyy, mm - 1, dd).getTime()
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) {
    const d = new Date(t.slice(0, 10) + 'T12:00:00')
    return Number.isNaN(d.getTime()) ? Number.POSITIVE_INFINITY : d.getTime()
  }
  const d = new Date(t)
  return Number.isNaN(d.getTime()) ? Number.POSITIVE_INFINITY : d.getTime()
}

type ChronologicalRow = {
  idx: number
  source: 'primary' | 'additional'
  action: string
  title: string
  date: string
  time: string
}

type ScoredRow = ChronologicalRow & {
  _dateRaw: string
  _timeRaw: string
  _kind: ActionKind
  _base: number
}

/**
 * Pick primary next step by **action kind only** (meeting > call > follow_up > send > other).
 * **Earlier dates or clearer timing never outrank a higher-importance action** — e.g. "Send tomorrow"
 * stays secondary when "Call Friday" exists. **Date/time breaks ties** between rows of the **same**
 * kind (earlier calendar date wins), then stable order.
 *
 * **Send safety net:** If the top row after sorting is still **send** but another row is
 * meeting/call/follow_up, promote the best non-send (same tie-break rules).
 */
function applyRankedNextStepSelection(
  result: StructureBody,
  timeZone: string,
  userNow: Date,
): StructureBody {
  const anchor = toUserAnchorDateTime(userNow, timeZone)
  const rows: ChronologicalRow[] = []
  let idx = 0
  const primaryAction = (result.nextStep || '').trim()
  if (primaryAction) {
    rows.push({
      idx: idx++,
      source: 'primary',
      action: result.nextStep.trim(),
      title: (result.nextStepTitle || result.nextStep).trim(),
      date: (result.nextStepDate || '').trim(),
      time: (result.nextStepTimeHint || '').trim(),
    })
  }
  for (const s of result.additionalSteps || []) {
    const a = (s.action || '').trim()
    if (!a) continue
    rows.push({
      idx: idx++,
      source: 'additional',
      action: s.action.trim(),
      title: s.action.trim(),
      date: (s.date || '').trim(),
      time: (s.time || '').trim(),
    })
  }
  if (rows.length === 0) return result

  console.log(
    '[structure] rank: actions BEFORE resolve (raw model dates)',
    rows.map((r) => ({
      source: r.source,
      action: r.action.slice(0, 120),
      dateRaw: r.date,
      timeRaw: r.time,
    })),
  )

  const resolved: ScoredRow[] = rows.map((r) => {
    const dateTrim = r.date.trim()
    const timeTrim = r.time.trim()
    const rawForResolve = dateTrim || timeTrim
    const mmdd = resolveRelativePhraseToMmdd(rawForResolve, timeZone, anchor)
    const dateForSort = mmdd ?? dateTrim

    const kind = inferActionKind(`${r.action} ${r.title}`)
    const base = ACTION_KIND_SCORE[kind]

    return {
      ...r,
      date: dateForSort,
      _dateRaw: r.date,
      _timeRaw: r.time,
      _kind: kind,
      _base: base,
    }
  })

  console.log(
    '[structure] rank: kind scores (date used only as tie-breaker within same kind)',
    resolved.map((r) => ({
      source: r.source,
      kind: r._kind,
      base: r._base,
      action: r.action.slice(0, 100),
      dateResolved: r.date,
    })),
  )

  resolved.sort((a, b) => {
    if (b._base !== a._base) return b._base - a._base
    const da = parseStepDateMs(a.date)
    const db = parseStepDateMs(b.date)
    if (da !== db) return da - db
    return a.idx - b.idx
  })

  console.log(
    '[structure] rank: order after sort (kind desc, then earliest date, then stable idx)',
    resolved.map((r) => ({
      source: r.source,
      kind: r._kind,
      base: r._base,
      action: r.action.slice(0, 120),
      dateResolved: r.date,
    })),
  )

  const hasHigherValueAction = resolved.some((r) => isHigherValueKindThanSend(r._kind))

  let primary = resolved[0]
  if (hasHigherValueAction && primary._kind === 'send') {
    const nonSend = resolved.filter((r) => r._kind !== 'send')
    const alt = nonSend[0]
    if (alt) {
      console.log('[structure] rank: send blocked as primary — higher-value kind exists', {
        skippedSend: primary.action.slice(0, 100),
        skippedBase: primary._base,
        chosenPrimary: alt.action.slice(0, 100),
        chosenBase: alt._base,
      })
      primary = alt
    }
  }

  const rest = resolved.filter((r) => r.idx !== primary.idx)

  const tRaw = primary.time.trim()
  const hint = tRaw ? normalizeTimeToHint(tRaw, '') : ''
  return {
    ...result,
    nextStep: primary.action,
    nextStepTitle: primary.title || result.nextStepTitle,
    nextStepDate: primary.date,
    nextStepTimeHint: hint,
    additionalSteps: rest.map((r) => ({
      action: r.action,
      date: r.date,
      time: r.time ? normalizeTimeToHint(r.time, '') || r.time : '',
    })),
  }
}

const DOCUMENT_KEYWORDS_FOR_PRODUCT = [
  'report',
  'analysis',
  'template',
  'proposal',
  'presentation',
  'brochure',
  'document',
  'study',
  'comparison',
  'plantilla',
  'informe',
  'análisis',
  'estudio',
]

function filterProductDocumentKeywords(product: string): string {
  if (!product?.trim()) return ''
  const products = product.split(',').map((p) => p.trim()).filter(Boolean)
  const filtered = products.filter(
    (p) =>
      !DOCUMENT_KEYWORDS_FOR_PRODUCT.some((keyword) => p.toLowerCase().includes(keyword.toLowerCase())),
  )
  return normalizeProductField(filtered.join(', '))
}

function removeDuplicateWords(str: string): string {
  let s = String(str ?? '').trim()
  let prev = ''
  while (s !== prev) {
    prev = s
    s = s.replace(/\b(\w+)\s+\1\b/gi, '$1').trim()
  }
  return s
}

/** Em dash (U+2014) before company; capitalize first character. */
function formatNextStepTitleEmDash(title: string): string {
  let t = String(title ?? '').trim()
  if (!t) return ''
  t = t.replace(/\(([^)]+)\)/g, ' — $1')
  t = t.replace(/^./, (c) => c.toUpperCase())
  return t
}

function normalizeNoFollowUpStructure(result: StructureBody): StructureBody {
  const line = (result.nextStepTitle || result.nextStep || '').trim()
  if (!isNoClearFollowUpLine(line)) return result
  return {
    ...result,
    nextStep: line,
    nextStepTitle: line,
    nextStepAction: '',
    nextStepTarget: '',
    nextStepDate: '',
    nextStepTimeReference: '',
    nextStepTimeHint: '',
    additionalSteps: [],
    nextStepConfidence: 'low',
  }
}

/** Post-parse fixes before title-case / merge (chronology, product, duplicates, title shape). */
function applyServerCalendarResolution(
  result: StructureBody,
  timeZone: string,
  userNow: Date,
): StructureBody {
  const line = (result.nextStepTitle || result.nextStep || '').trim()
  if (isNoClearFollowUpLine(line)) return result

  const ref = (result.nextStepTimeReference || '').trim()
  let nextDate = (result.nextStepDate || '').trim()

  if (ref) {
    const resolved = resolveRelativeDate(ref, userNow, timeZone)
    if (resolved) nextDate = resolved
  } else if (nextDate && !/^\d{2}\/\d{2}\/\d{4}$/.test(nextDate)) {
    const anchor = toUserAnchorDateTime(userNow, timeZone)
    const resolved = resolveRelativePhraseToMmdd(nextDate, timeZone, anchor)
    if (resolved) nextDate = resolved
  }

  const hint = resolveCalendarTimeHint(
    result.nextStepTimeHint,
    result.nextStep,
    result.nextStepTitle,
    result.nextStepAction,
  )

  return {
    ...result,
    nextStepDate: nextDate,
    nextStepTimeHint: hint,
  }
}

function applyStructureResponsePostProcessing(
  result: StructureBody,
  timeZone: string,
  userNow: Date,
): StructureBody {
  let r = normalizeNoFollowUpStructure(result)
  r = applyRankedNextStepSelection(r, timeZone, userNow)
  r = { ...r, product: filterProductDocumentKeywords(r.product) }
  r = {
    ...r,
    contact: removeDuplicateWords(r.contact),
    nextStepTitle: formatNextStepTitleEmDash(removeDuplicateWords(r.nextStepTitle)),
  }
  return r
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
    nextStepTimeReference:
      typeof parsed.nextStepTimeReference === 'string' ? parsed.nextStepTimeReference : '',
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
    calendarDescription:
      typeof parsed.calendarDescription === 'string' ? parsed.calendarDescription : '',
    additionalSteps: parseAdditionalSteps(parsed.additionalSteps),
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>
    const note = body?.note
    const timeZoneRaw = typeof body?.timezone === 'string' ? body.timezone.trim() : ''
    const tzCandidate = timeZoneRaw || 'America/Los_Angeles'
    const timeZoneProbe = DateTime.now().setZone(tzCandidate)
    const timeZone = timeZoneProbe.isValid ? tzCandidate : 'America/Los_Angeles'
    const userLocalNow = parseUserLocalInstant(body)

    if (!note || typeof note !== 'string') {
      return NextResponse.json({ error: 'Missing note' }, { status: 400 })
    }

    const dateContext = buildStructureUserDateContext(timeZone, userLocalNow)

    const detectedLanguage = detectNoteLanguage(note)
    const languageEnforcement =
      `The input note is in ${detectedLanguage}. ` +
      `ALL output fields MUST be in ${detectedLanguage}. This is mandatory. ` +
      `**nextStep** and **nextStepTitle** MUST be written entirely in ${detectedLanguage} — the same language as the input note — with no exceptions (never Spanish if the note is English, and vice versa).`
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

    result = applyStructureResponsePostProcessing(result, timeZone, userLocalNow)
    result = applyServerCalendarResolution(result, timeZone, userLocalNow)

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
      nextStepTimeReference: (result.nextStepTimeReference || '').trim(),
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
      calendarDescription: result.calendarDescription.trim(),
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
      crmFull: stripDealerLinesFromCrmFull(normalizeInsightEmojis(afterProduct.crmFull)).slice(
        0,
        4,
      ),
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