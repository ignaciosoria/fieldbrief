import type OpenAI from 'openai'

export const TRANSCRIPTION_PROMPT = 'A field sales representative dictating a visit note in Spanish or English, sometimes mixing both. Names, product numbers, negations, and spoken self-corrections matter. Quantum Flower, Quantum Engorde, Ferbloom Flower, Ferbloom 75. Visita, seguimiento, ficha técnica, presupuesto, pedido, distribuidor, fresa, arándano, frambuesa. Client visit, technical sheet, quote, order, grower, strawberry, blueberry.'

export const WHISPER_CONTEXT_PROMPT = 'Field sales rep voice note after a client visit. May include: company names, grower names, product names like Quantum Flower, Quantum Engorde, Ferbloom Flower, Ferbloom 75, crop terms like fresa, arándano, frambuesa, strawberry, blueberry. Sales terms: seguimiento, visita, prueba, pedido, pallet, aplicación, cosecha, temporada, grower, PCA, distribuidor. Rep may speak in English or Spanish or mix both.'

/** One transcription only: no silent paid retries, translation, or text rewriting. */
export async function transcribeVisitAudio(client:OpenAI,file:File,configuredModel?:string):Promise<string> {
  const model=configuredModel || 'gpt-transcribe'
  if(model!=='gpt-transcribe' && model!=='whisper-1')throw new Error('Unsupported transcription model configuration')
  const response=await client.audio.transcriptions.create({
    file,model,response_format:'json',
    prompt:model==='whisper-1'?WHISPER_CONTEXT_PROMPT:TRANSCRIPTION_PROMPT,
  })
  return response.text
}
