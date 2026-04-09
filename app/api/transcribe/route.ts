import OpenAI from 'openai'
import { NextResponse } from 'next/server'

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

const WHISPER_CONTEXT_PROMPT =
  'Field sales rep voice note recorded after a client visit. May include: company names, contact names, product names, sales terminology, informal speech, filler words, pauses, repetitions. Rep may speak in English or Spanish. Common terms: follow-up, next step, quote, proposal, demo, distributor, ROI, pipeline, close the deal.'

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
