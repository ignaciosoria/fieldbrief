import { NextResponse } from "next/server"
import { DateTime } from "luxon"
import { prepareStructureRequest } from "../../../lib/aiAccessServer"
import {extractVisitWithResearch} from '../../../lib/parallelVisit'
import {checkAiAccess} from '../../../lib/aiAccess'
import {reserveAiUsage} from '../../../lib/aiAccessServer'
import {withTrialNote} from '../../../lib/trialServer'
import {scheduleAnalytics} from '../../../lib/analyticsServer'
export const maxDuration=90

export async function POST(request: Request) {
  const body = await prepareStructureRequest(request)
  if (body instanceof Response) return body
  const timezone = typeof body.timezone === "string" && DateTime.now().setZone(body.timezone).isValid ? body.timezone : "America/Los_Angeles"
  const supplied = typeof body.clientNow === "string" ? DateTime.fromISO(body.clientNow) : null
  const now = supplied?.isValid ? supplied.toUTC().toISO()! : new Date().toISOString()
  const started = Date.now()
  try {
    const processed=await withTrialNote(body.serverEmail,body.note,body.clientNow,()=>extractVisitWithResearch(body.note,now,timezone,
      async()=>!(await checkAiAccess('structure',{getEmail:async()=>body.serverEmail,reserve:reserveAiUsage}))),body.existingNoteId,body.trialNoteKey)
    if(processed instanceof Response) return processed
    const {result,usage} = processed
    // Operational counts only: do not log the transcript, names or extracted prose.
    console.info("folup.structure",{version:2,ms:Date.now()-started,inputTokens:usage?.prompt_tokens,outputTokens:usage?.completion_tokens,actions:result.actions.length,questions:result.extraction.questions.length})
    scheduleAnalytics(request,'note_processed',{stage:'extraction',duration_ms:Date.now()-started,has_smart_step:result.extraction.actions.some(a=>a.origin==='recommendation')},body.serverEmail)
    return NextResponse.json(result,{headers:{"Cache-Control":"no-store"}})
  } catch {
    return NextResponse.json({error:"Could not process this note. Your transcript is available to retry."},{status:502})
  }
}
