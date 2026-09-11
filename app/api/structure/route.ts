import { NextResponse } from "next/server"
import { DateTime } from "luxon"
import { requireAiAccess } from "../../../lib/aiAccessServer"
import { extractVisit } from "../../../lib/extractVisitServer"

export async function POST(request: Request) {
  const denied = await requireAiAccess("structure")
  if (denied) return denied
  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({error:"Invalid JSON"},{status:400}) }
  if (typeof body?.note !== "string" || !body.note.trim()) return NextResponse.json({error:"Missing note"},{status:400})
  if (body.note.length > 20000) return NextResponse.json({error:"Note is too long"},{status:413})
  const timezone = typeof body.timezone === "string" && DateTime.now().setZone(body.timezone).isValid ? body.timezone : "America/Los_Angeles"
  const supplied = typeof body.clientNow === "string" ? DateTime.fromISO(body.clientNow) : null
  const now = supplied?.isValid ? supplied.toUTC().toISO()! : new Date().toISOString()
  const started = Date.now()
  try {
    const {result,usage} = await extractVisit(body.note,now,timezone)
    // Operational counts only: do not log the transcript, names or extracted prose.
    console.info("folup.structure",{version:2,ms:Date.now()-started,inputTokens:usage?.prompt_tokens,outputTokens:usage?.completion_tokens,actions:result.actions.length,questions:result.extraction.questions.length})
    return NextResponse.json(result,{headers:{"Cache-Control":"no-store"}})
  } catch {
    return NextResponse.json({error:"Could not process this note. Your transcript is available to retry."},{status:502})
  }
}
