import OpenAI from 'openai'
import { auth } from '../../../auth'
import { reserveAiUsage } from '../../../lib/aiAccessServer'
import { handleTranscription } from '../../../lib/transcriptionHandler'

export const maxDuration=60

const WHISPER_CONTEXT_PROMPT =
  'Field sales rep voice note after a client visit. May include: company names, grower names, product names like Quantum Flower, Quantum Engorde, Ferbloom Flower, Ferbloom 75, crop terms like fresa, arándano, frambuesa, strawberry, blueberry. Sales terms: seguimiento, visita, prueba, pedido, pallet, aplicación, cosecha, temporada, grower, PCA, distribuidor. Rep may speak in English or Spanish or mix both.'

export async function POST(request: Request) {
  return handleTranscription(request,{
    getEmail:async()=>(await auth())?.user?.email?.trim() || null,
    reserve:reserveAiUsage,
    transcribe:async file=>{
      const client=new OpenAI({apiKey:process.env.OPENAI_API_KEY,timeout:45_000,maxRetries:0})
      const transcription=await client.audio.transcriptions.create({file,model:'whisper-1',prompt:WHISPER_CONTEXT_PROMPT})
      return transcription.text
    },
  })
}
