import OpenAI from 'openai'
import { auth } from '../../../auth'
import { reserveAiUsage } from '../../../lib/aiAccessServer'
import { handleTranscription } from '../../../lib/transcriptionHandler'
import { transcribeVisitAudio } from '../../../lib/transcriptionModel'

export const maxDuration=60

export async function POST(request: Request) {
  return handleTranscription(request,{
    getEmail:async()=>(await auth())?.user?.email?.trim() || null,
    reserve:reserveAiUsage,
    transcribe:async file=>{
      const client=new OpenAI({apiKey:process.env.OPENAI_API_KEY,timeout:45_000,maxRetries:0})
      return transcribeVisitAudio(client,file,process.env.TRANSCRIPTION_MODEL)
    },
  })
}
