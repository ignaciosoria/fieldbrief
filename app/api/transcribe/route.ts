import OpenAI from 'openai'
import { NextResponse } from 'next/server'

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

const WHISPER_CONTEXT_PROMPT =
  'Field sales rep voice note after a client visit. May include: company names, grower names, product names like Quantum Flower, Quantum Engorde, Ferbloom Flower, Ferbloom 75, crop terms like fresa, arándano, frambuesa, strawberry, blueberry. Sales terms: seguimiento, visita, prueba, pedido, pallet, aplicación, cosecha, temporada, grower, PCA, distribuidor. Rep may speak in English or Spanish or mix both.'

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const transcription = await client.audio.transcriptions.create({
      file,
      model: 'whisper-1',
      language: undefined,
      prompt: WHISPER_CONTEXT_PROMPT,
    })

    return NextResponse.json({ transcript: transcription.text })
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to transcribe audio' },
      { status: 500 }
    )
  }
}
