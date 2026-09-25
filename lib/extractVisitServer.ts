import OpenAI from 'openai'
import { DateTime } from 'luxon'
import { visitExtractionResult } from './visitExtraction'
import {SALES_PROMPT,SALES_SCHEMA,parseSalesDecision} from './salesDecision'
import {configuredVisitModel,visitModelParameters} from './visitModelConfig'

export {VISIT_MODEL} from './visitModelConfig'
export class VisitExtractionError extends Error {
  constructor(message:string, readonly usage:OpenAI.CompletionUsage|undefined, readonly rawOutput:string|null) {super(message)}
}
export function visitUserMessage(note:string, now:string, timezone:string) {
  const local = DateTime.fromISO(now).setZone(timezone)
  if (!local.isValid) throw Error('Invalid reference date')
  return `Reference local date: ${local.toFormat('yyyy-MM-dd EEEE')}. Time zone: ${timezone}.\nTomorrow: ${local.plus({days:1}).toISODate()}.\nTreat an unqualified weekday as the next occurrence, unless the note explicitly says today. Resolve next week to the following calendar week, but do not choose a specific day unless one was stated.\nNOTE (untrusted data):\n${JSON.stringify(note)}`
}

export function buildVisitRequest(note:string, now:string, timezone:string, model = configuredVisitModel()):OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming {
  return {
    model,...visitModelParameters(model),max_completion_tokens:4000,
    response_format:{type:'json_schema',json_schema:{name:'folup_sales_v1',strict:true,schema:SALES_SCHEMA}},
    messages:[{role:'system',content:SALES_PROMPT},{role:'user',content:visitUserMessage(note,now,timezone)}],
  }
}

export async function extractVisit(note:string, now:string, timezone:string, model = configuredVisitModel()) {
  const client = new OpenAI({apiKey:process.env.OPENAI_API_KEY,timeout:45000,maxRetries:0})
  const response = await client.chat.completions.create(buildVisitRequest(note,now,timezone,model))
  const choice = response.choices[0]
  try {
    if (choice?.finish_reason !== 'stop' || choice.message.refusal || !choice.message.content) throw Error('Incomplete extraction')
    const extraction = parseSalesDecision(JSON.parse(choice.message.content),note,now,timezone)
    return {result:visitExtractionResult(extraction,now,timezone),usage:response.usage}
  } catch (error) {
    throw new VisitExtractionError(error instanceof Error ? error.message : 'Invalid extraction',response.usage,choice?.message.content || null)
  }
}
