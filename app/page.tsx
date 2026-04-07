'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

type StructureResult = {
  customer: string
  dealer: string
  contact: string
  summary: string
  nextStep: string
  notes: string
  crop: string
  product: string
  location: string
  acreage: string
  crmText: string
  crmFull: string[]
}

const emptyResult: StructureResult = {
  customer: '',
  dealer: '',
  contact: '',
  summary: '',
  nextStep: '',
  notes: '',
  crop: '',
  product: '',
  location: '',
  acreage: '',
  crmText: '',
  crmFull: [],
}

function normalizeCrmFull(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    if (typeof raw === 'string' && raw.trim()) {
      try {
        return normalizeCrmFull(JSON.parse(raw))
      } catch {
        return []
      }
    }
    return []
  }
  return raw.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean)
}

/** Only pricing pressure, risk, and blockers/urgency use tinted backgrounds. */
function getInsightTone(text: string): 'negative' | 'neutral' {
  const t = text.trimStart()
  if (
    t.startsWith('💰') ||
    t.startsWith('🌡️') ||
    t.startsWith('🌡') ||
    t.startsWith('❗') ||
    t.startsWith('⚠️')
  ) {
    return 'negative'
  }
  return 'neutral'
}

function getInsightStyle(text: string) {
  const ink = 'text-zinc-900'
  const t = text.trimStart()
  if (getInsightTone(text) === 'negative') {
    if (t.startsWith('💰')) return `${ink} bg-red-50`
    if (t.startsWith('🌡️') || t.startsWith('🌡')) return `${ink} bg-orange-50`
    if (t.startsWith('❗') || t.startsWith('⚠️')) return `${ink} bg-amber-50`
    return `${ink} bg-amber-50`
  }
  return `${ink} bg-transparent`
}

type Tab = 'record' | 'history' | 'settings'

type SavedNote = {
  id: string
  date: string
  result: StructureResult
  transcript: string
}

function isWeakNextStep(nextStep: string) {
  if (!nextStep || !nextStep.trim()) return true

  const weakPatterns = [
    'call again',
    'follow up later',
    'check back',
    'llamar nuevamente',
    'seguir más tarde',
    'ver qué pasa',
  ]

  const lower = nextStep.toLowerCase()
  return weakPatterns.some((pattern) => lower.includes(pattern))
}

function hasStrongVerb(nextStep: string) {
  if (!nextStep || !nextStep.trim()) return false

  const verbs = [
    'call',
    'send',
    'follow up',
    'visit',
    'confirm',
    'review',
    'schedule',
    'llamar',
    'enviar',
    'hacer seguimiento',
    'visitar',
    'confirmar',
    'revisar',
    'agendar',
  ]

  const lower = nextStep.toLowerCase().trim()
  return verbs.some((verb) => lower.startsWith(verb))
}

function enrichNextStep(
  nextStep: string,
  data: { contact?: string; customer?: string; dealer?: string },
) {
  if (!nextStep) return nextStep

  const contact = data.contact || ''
  const company = data.customer || data.dealer || ''

  let enriched = nextStep.trim()

  const hasCompany = enriched.includes(')')
  const hasContact =
    contact && enriched.toLowerCase().includes(contact.toLowerCase())

  if (contact && !hasContact) {
    const parts = enriched.split(' ')
    if (parts.length > 1) {
      enriched = `${parts[0]} ${contact} ${parts.slice(1).join(' ')}`
    }
  }

  if (company && !hasCompany) {
    enriched = `${enriched} (${company})`
  }

  return enriched
}

function isSpanish(text: string) {
  if (!text) return false
  return (
    /[áéíóúñ]/i.test(text) ||
    text.includes(' el ') ||
    text.includes(' la ') ||
    text.includes(' que ')
  )
}

function forceLanguage(nextStep: string, originalText: string) {
  if (!nextStep) return nextStep

  const inputIsSpanish = isSpanish(originalText)
  const outputIsSpanish = isSpanish(nextStep)

  if (inputIsSpanish && !outputIsSpanish) {
    return nextStep
      .replace(/^call/i, 'Llamar')
      .replace(/^send/i, 'Enviar')
      .replace(/^follow up/i, 'Hacer seguimiento')
      .replace(/^schedule/i, 'Agendar')
  }

  if (!inputIsSpanish && outputIsSpanish) {
    return nextStep
      .replace(/^llamar/i, 'Call')
      .replace(/^enviar/i, 'Send')
      .replace(/^hacer seguimiento/i, 'Follow up')
      .replace(/^agendar/i, 'Schedule')
  }

  return nextStep
}

async function fixNextStep(result: {
  nextStep?: string
  customer?: string
  dealer?: string
  contact?: string
}) {
  const prompt = `
Fix this next step so it becomes specific and directly usable as a calendar event title.

Rules:
- Use format: ACTION + TARGET + (COMPANY if available)
- Keep it short
- Use a strong verb
- Avoid generic phrases
- Keep the same language as the original
- Return ONLY valid JSON with:
  { "nextStep": "..." }

Original next step:
"${result.nextStep || ''}"

Context:
Customer: ${result.customer || ''}
Dealer: ${result.dealer || ''}
Contact: ${result.contact || ''}
`

  const res = await fetch('/api/structure', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note: prompt }),
  })

  const data = await res.json()

  if (!res.ok) {
    throw new Error(data.error || 'Failed to fix next step.')
  }

  return data.nextStep || result.nextStep || ''
}

export default function Home() {
  const [mounted, setMounted] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('record')
  const [input, setInput] = useState('')
  const [result, setResult] = useState<StructureResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [transcript, setTranscript] = useState('')
  const [savedNotes, setSavedNotes] = useState<SavedNote[]>([])
  const [selectedNote, setSelectedNote] = useState<SavedNote | null>(null)
  const [noteSaved, setNoteSaved] = useState(false)
  const [showEditArea, setShowEditArea] = useState(false)
  const [isCorrectingRecording, setIsCorrectingRecording] = useState(false)
  const [correctingSeconds, setCorrectingSeconds] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [showCalendarToast, setShowCalendarToast] = useState(false)
  const [resultInsightsExpanded, setResultInsightsExpanded] = useState(false)
  const [historyInsightsExpanded, setHistoryInsightsExpanded] = useState(false)
  const [resultSummaryExpanded, setResultSummaryExpanded] = useState(false)
  const [historySummaryExpanded, setHistorySummaryExpanded] = useState(false)
  const correctTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const processingStartedAtRef = useRef(0)

  const awaitMinProcessingDisplay = async () => {
    const minMs = 400
    const elapsed = Date.now() - processingStartedAtRef.current
    if (elapsed < minMs) await new Promise((r) => setTimeout(r, minMs - elapsed))
  }

  useEffect(() => {
    setMounted(true)
    const loadNotes = async () => {
      try {
        const { data, error } = await supabase
          .from('notes')
          .select('*')
          .order('date', { ascending: false })
        if (!error && data && data.length > 0) {
          const mapped: SavedNote[] = data.map((n: any) => ({
            id: n.id,
            date: n.date,
            transcript: n.transcript || '',
            result: {
              contact: n.contact || '',
              customer: n.customer || '',
              dealer: n.dealer || '',
              summary: n.summary || '',
              nextStep: n.next_step || '',
              notes: n.notes || '',
              crop: n.crop || '',
              product: n.product || '',
              location: n.location || '',
              acreage: n.acreage || '',
              crmText: n.crm_text || '',
              crmFull: normalizeCrmFull(n.crm_full),
            },
          }))
          setSavedNotes(mapped)
          try { localStorage.setItem('fieldbrief-notes', JSON.stringify(mapped)) } catch {}
          return
        }
      } catch {}
      // Fallback to localStorage
      try {
        const stored = localStorage.getItem('fieldbrief-notes')
        if (stored) {
          const parsed = JSON.parse(stored) as SavedNote[]
          setSavedNotes(
            parsed.map((n) => ({
              ...n,
              result: {
                ...emptyResult,
                ...n.result,
                crmFull: normalizeCrmFull(n.result.crmFull),
              },
            })),
          )
        }
      } catch {}
    }
    loadNotes()
  }, [])

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(t)
  }, [copied])

  useEffect(() => {
    if (isRecording) {
      setRecordingSeconds(0)
      timerRef.current = setInterval(() => setRecordingSeconds((s) => s + 1), 1000)
    } else {
      if (timerRef.current) clearInterval(timerRef.current)
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [isRecording])

  useEffect(() => {
    if (!showCalendarToast) return
    const t = setTimeout(() => setShowCalendarToast(false), 2100)
    return () => clearTimeout(t)
  }, [showCalendarToast])

  useEffect(() => {
    setResultInsightsExpanded(false)
    setResultSummaryExpanded(false)
  }, [result])

  useEffect(() => {
    setHistoryInsightsExpanded(false)
    setHistorySummaryExpanded(false)
  }, [selectedNote?.id])

  const saveNote = async (res: StructureResult, tx: string) => {
    const note: SavedNote = {
      id: Date.now().toString(),
      date: new Date().toISOString(),
      result: res,
      transcript: tx,
    }
    const updated = [note, ...savedNotes]
    setSavedNotes(updated)
    setNoteSaved(true)
    setTimeout(() => setNoteSaved(false), 2300)
    try { localStorage.setItem('fieldbrief-notes', JSON.stringify(updated)) } catch {}
    try {
      await supabase.from('notes').insert({
        id: note.id,
        date: note.date,
        transcript: tx,
        contact: res.contact,
        customer: res.customer,
        summary: res.summary,
        next_step: res.nextStep,
        notes: res.notes,
        crop: res.crop,
        product: res.product,
        location: res.location,
        crm_text: res.crmText,
        crm_full: res.crmFull,
      })
    } catch {}
  }

  const deleteNote = async (id: string) => {
    const updated = savedNotes.filter((n) => n.id !== id)
    setSavedNotes(updated)
    try { localStorage.setItem('fieldbrief-notes', JSON.stringify(updated)) } catch {}
    if (selectedNote?.id === id) setSelectedNote(null)
    try { await supabase.from('notes').delete().eq('id', id) } catch {}
  }

  const updateNote = async (id: string, res: StructureResult, tx: string) => {
    const updated = savedNotes.map((n) =>
      n.id === id ? { ...n, result: res, transcript: tx } : n
    )
    setSavedNotes(updated)
    try { localStorage.setItem('fieldbrief-notes', JSON.stringify(updated)) } catch {}
    if (selectedNote?.id === id) setSelectedNote({ ...selectedNote, result: res, transcript: tx })
    if (result) setResult(res)
    try {
      await supabase.from('notes').update({
        transcript: tx,
        contact: res.contact,
        customer: res.customer,
        summary: res.summary,
        next_step: res.nextStep,
        notes: res.notes,
        crop: res.crop,
        product: res.product,
        location: res.location,
        crm_text: res.crmText,
        crm_full: res.crmFull,
      }).eq('id', id)
    } catch {}
  }

  const buildShareText = (r: StructureResult) => {
    const lines: string[] = ['📋 FieldBrief Note', '']
    if (r.contact) lines.push(`👤 ${r.contact}${r.customer ? ` — ${r.customer}` : ''}`)
    const pills = [r.location && `📍 ${r.location}`, r.crop && `🌱 ${r.crop}`, r.product && `🧪 ${r.product}`].filter(Boolean)
    if (pills.length) lines.push(pills.join('  '))
    if (r.summary) { lines.push(''); lines.push('SUMMARY'); lines.push(r.summary) }
    if (r.nextStep) { lines.push(''); lines.push('⚡ NEXT STEP'); lines.push(r.nextStep) }
    if (r.crmFull.length > 0) {
      lines.push('')
      lines.push('CRM DETAIL')
      lines.push(...r.crmFull)
    }
    if (r.crmText) {
      lines.push('')
      lines.push('NOTE')
      lines.push(r.crmText)
    }
    return lines.join('\n')
  }

  const handleShare = async (r: StructureResult) => {
    const text = buildShareText(r)
    if (navigator.share) {
      try { await navigator.share({ text }) } catch {}
    } else {
      await navigator.clipboard.writeText(text)
    }
  }

  const correctRecorderRef = useRef<MediaRecorder | null>(null)

  const startCorrectionRecording = async (noteId: string, originalTranscript: string) => {
    try {
      setError('')
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Audio not supported.')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = pickSupportedMimeType()
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      correctRecorderRef.current = recorder
      const chunks: Blob[] = []
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        setIsCorrectingRecording(false)
        clearInterval(correctTimerRef.current!)
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
        if (blob.size === 0) return
        processingStartedAtRef.current = Date.now()
        setLoading(true)
        try {
          const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm'
          const file = new File([blob], `correction.${ext}`, { type: blob.type })
          const fd = new FormData()
          fd.append('file', file)
          const txRes = await fetch('/api/transcribe', { method: 'POST', body: fd })
          const txData = await txRes.json()
          const correction = txData.transcript || txData.text || ''
          const combined = `ORIGINAL NOTE: ${originalTranscript}\n\nCORRECTION: ${correction}`
          const strRes = await fetch('/api/structure', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ note: combined }),
          })
          const strData = await strRes.json()
          if (!strRes.ok) throw new Error(strData.error)
          const merged = { ...emptyResult, ...strData }
          const final = { ...merged, crmFull: normalizeCrmFull(merged.crmFull) }
          await awaitMinProcessingDisplay()
          updateNote(noteId, final, combined)
        } catch (err: any) {
          setError(err?.message || 'Correction failed.')
        } finally {
          await new Promise((r) => setTimeout(r, 72))
          setLoading(false)
        }
      }
      setCorrectingSeconds(0)
      correctTimerRef.current = setInterval(() => setCorrectingSeconds((s) => s + 1), 1000)
      recorder.start()
      setIsCorrectingRecording(true)
    } catch (err: any) {
      setError(err?.message || 'Could not start correction.')
    }
  }

  const stopCorrectionRecording = () => {
    try { correctRecorderRef.current?.stop() } catch {}
    setIsCorrectingRecording(false)
    clearInterval(correctTimerRef.current!)
  }

  const activeResult = selectedNote?.result ?? result

  const copyText = useMemo(() => {
    const r = activeResult
    if (!r) return ''
    const parts: string[] = []
    if (r.crmFull.length > 0) parts.push(...r.crmFull)
    const narrative = r.crmText?.trim()
    if (narrative) {
      if (parts.length) parts.push('')
      parts.push(narrative)
    }
    return parts.join('\n')
  }, [activeResult])

  const formatSeconds = (s: number) => {
    const m = Math.floor(s / 60).toString().padStart(2, '0')
    const sec = (s % 60).toString().padStart(2, '0')
    return `${m}:${sec}`
  }

  const formatDate = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  const getInitials = (name: string) => {
    return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
  }

  const pickSupportedMimeType = () => {
    if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined') return ''
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
    for (const type of candidates) {
      if (MediaRecorder.isTypeSupported(type)) return type
    }
    return ''
  }

  const toggleRecording = async () => {
    if (isRecording) {
      try { mediaRecorderRef.current?.stop() } catch { setIsRecording(false) }
      return
    }
    try {
      setError('')
      setCopied(false)
      setResult(null)
      setTranscript('')
      setInput('')

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Audio recording is not supported on this device/browser.')
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = pickSupportedMimeType()
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)

      chunksRef.current = []
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }

      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        setIsRecording(false)
        stream.getTracks().forEach((t) => t.stop())
        if (blob.size > 0) await processRecordedAudio(blob)
      }

      recorder.start()
      setIsRecording(true)
    } catch (err: any) {
      setError(err?.message || 'Could not start recording.')
      setIsRecording(false)
    }
  }

  const processRecordedAudio = async (blob: Blob) => {
    processingStartedAtRef.current = Date.now()
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const extension = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm'
      const file = new File([blob], `voice-note.${extension}`, { type: blob.type || 'audio/webm' })
      const formData = new FormData()
      formData.append('file', file)

      const transcribeRes = await fetch('/api/transcribe', { method: 'POST', body: formData })
      const transcribeData = await transcribeRes.json()
      if (!transcribeRes.ok) throw new Error(transcribeData.error || 'Failed to transcribe.')

      const tx = transcribeData.transcript || transcribeData.text || ''
      setTranscript(tx)
      setInput(tx)

      const structureRes = await fetch('/api/structure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: tx }),
      })
      
      const structureData = await structureRes.json()
      if (!structureRes.ok) {
        throw new Error(structureData.error || 'Failed to structure.')
      }
      
      const merged = { ...emptyResult, ...structureData }
      const final = { ...merged, crmFull: normalizeCrmFull(merged.crmFull) }

      if (isWeakNextStep(final.nextStep) || !hasStrongVerb(final.nextStep)) {
        try {
          const fixedNextStep = await fixNextStep({
            nextStep: final.nextStep,
            customer: final.customer,
            dealer: final.dealer,
            contact: final.contact,
          })
      
          final.nextStep = fixedNextStep
        } catch (error) {
          console.error('Failed to auto-correct next step:', error)
        }
      }

      final.nextStep = enrichNextStep(final.nextStep, final)
      final.nextStep = forceLanguage(final.nextStep, tx)

      await awaitMinProcessingDisplay()
      setResult(final)
      saveNote(final, tx)
    } catch (err: any) {
      setError(err?.message || 'Something went wrong.')
    } finally {
      await new Promise((r) => setTimeout(r, 72))
      setLoading(false)
    }
  }

  const processTypedNote = async () => {
    if (!input.trim()) return
    processingStartedAtRef.current = Date.now()
    setLoading(true)
    setError('')
    setResult(null)
    setCopied(false)
    try {
      const res = await fetch('/api/structure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: input }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to process note.')
      const merged = { ...emptyResult, ...data }
      const final = { ...merged, crmFull: normalizeCrmFull(merged.crmFull) }
      await awaitMinProcessingDisplay()
      setResult(final)
      saveNote(final, input)
    } catch (err: any) {
      setError(err?.message || 'Something went wrong.')
    } finally {
      await new Promise((r) => setTimeout(r, 72))
      setLoading(false)
    }
  }

  const handleCopy = async () => {
    if (!copyText) return
    try {
      await navigator.clipboard.writeText(copyText)
      setCopied(true)
    } catch {
      setError('Could not copy to clipboard.')
    }
  }

  const handleReset = () => {
    setInput('')
    setResult(null)
    setError('')
    setTranscript('')
    setCopied(false)
    setSelectedNote(null)
    setShowEditArea(false)
    setShowCalendarToast(false)
  }

  if (!mounted) return null

  return (
    <main className="flex min-h-screen flex-col bg-white text-zinc-900 antialiased select-none">

      {/* Header */}
      <header className="flex items-center justify-between px-5 pt-8 pb-2 bg-white">
        <button className="flex flex-col gap-[4px] p-1 opacity-90" aria-label="Menu">
          <span className="block h-[1.5px] w-5 rounded-full bg-zinc-300" />
          <span className="block h-[1.5px] w-5 rounded-full bg-zinc-300" />
          <span className="block h-[1.5px] w-3 rounded-full bg-zinc-300" />
        </button>
        <span className="text-[13px] font-semibold tracking-[0.16em] text-zinc-800 uppercase">FieldBrief</span>
        <div className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold text-white" style={{backgroundColor: '#1a4d2e'}}>
          IG
        </div>
      </header>

      {/* Full-screen processing — single calm state */}
      {loading && (
        <div
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-white/[0.94] px-8 backdrop-blur-[3px]"
          style={{ animation: 'processingOverlayIn 0.48s cubic-bezier(0.4, 0, 0.2, 1) forwards' }}
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <div className="flex flex-col items-center gap-0">
            <svg
              className="text-[#1a4d2e]"
              width="52"
              height="52"
              viewBox="0 0 52 52"
              fill="none"
              aria-hidden
            >
              <circle cx="26" cy="26" r="21.5" stroke="currentColor" strokeOpacity="0.055" strokeWidth="1.05" />
              <g style={{ transformOrigin: '26px 26px', animation: 'processingRingSpin 1.55s linear infinite' }}>
                <circle
                  cx="26"
                  cy="26"
                  r="21.5"
                  stroke="currentColor"
                  strokeOpacity="0.72"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeDasharray="29 106"
                />
              </g>
            </svg>
            <p className="mt-5 max-w-[17rem] text-center text-[14px] font-semibold leading-snug tracking-tight text-zinc-700/95">
              Creating your follow-up
            </p>
          </div>
        </div>
      )}

      {/* Note saved — floating toast; no layout shift */}
      {noteSaved && (
        <div
          className="pointer-events-none fixed left-1/2 z-[95] flex max-w-[min(20rem,90vw)] -translate-x-1/2 items-center gap-2 rounded-full border border-zinc-200/80 bg-white/95 px-3.5 py-2 pl-2.5 text-[13px] font-medium text-zinc-800 shadow-[0_4px_28px_rgba(0,0,0,0.08),0_0_0_1px_rgba(0,0,0,0.03)] backdrop-blur-sm"
          style={{
            top: 'calc(env(safe-area-inset-top, 8px) + 3.25rem)',
            animation: 'noteSavedToast 2.1s cubic-bezier(0.4, 0, 0.2, 1) forwards',
          }}
          role="status"
          aria-live="polite"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#1a4d2e]/95">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.4">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </span>
          Note saved
        </div>
      )}

      {/* Calendar — floating toast; no layout shift */}
      {showCalendarToast && (
        <div
          className="pointer-events-none fixed left-1/2 z-[96] flex max-w-[min(18rem,92vw)] -translate-x-1/2 items-center gap-2 rounded-full border border-zinc-200/85 bg-white/96 px-3.5 py-2 pl-2.5 text-[13px] font-medium text-zinc-800 shadow-[0_4px_28px_rgba(0,0,0,0.1),0_0_0_1px_rgba(0,0,0,0.025)] backdrop-blur-sm"
          style={{
            bottom: 'calc(env(safe-area-inset-bottom, 10px) + 5.5rem)',
            animation: 'calendarEventToast 2s cubic-bezier(0.4, 0, 0.2, 1) forwards',
          }}
          role="status"
          aria-live="polite"
        >
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#1a4d2e]">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.6">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </span>
          Event created
        </div>
      )}

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto pb-28 px-5">

        {/* ── RECORD TAB ── */}
        {activeTab === 'record' && (
          <div className="relative flex flex-col" style={{minHeight: 'calc(100vh - 132px)'}}>

            {/* SCREEN 1 — Record (hidden when result exists) */}
            <div
              className="absolute inset-0 flex flex-col items-center justify-center gap-0 px-4 py-5 transition-[opacity,transform] duration-[450ms] ease-[cubic-bezier(0.4,0,0.2,1)]"
              style={{
                opacity: result || loading ? 0 : 1,
                transform: result ? 'translateY(-16px)' : loading ? 'translateY(-8px) scale(0.985)' : 'translateY(0)',
                pointerEvents: result || loading ? 'none' : 'auto',
              }}
            >
              <div className="mb-4 max-w-[20rem] text-center">
                <h2 className="text-xl font-semibold leading-tight tracking-tight text-zinc-800 sm:text-2xl">
                  Speak your visit
                </h2>
                <p className="mt-2 text-sm leading-snug text-zinc-500/78 sm:text-[15px]">
                  We turn it into a follow-up you can run
                </p>
              </div>
              {/* Mic button */}
              <button
                onClick={toggleRecording}
                disabled={loading}
                className="relative z-[1] mb-2 flex h-36 w-36 shrink-0 items-center justify-center rounded-full transition-[transform,box-shadow] duration-200 ease-out active:scale-[0.94] disabled:pointer-events-none disabled:active:scale-100"
                style={{
                  backgroundColor: isRecording ? '#dc2626' : '#1a4d2e',
                  boxShadow: isRecording
                    ? '0 8px 32px rgba(220,38,38,0.22), 0 2px 10px rgba(220,38,38,0.11), 0 0 0 1px rgba(220,38,38,0.08)'
                    : '0 12px 44px rgba(26,77,46,0.34), 0 4px 16px rgba(26,77,46,0.16), 0 0 0 1px rgba(26,77,46,0.1)',
                  transform: isRecording ? 'scale(1.01)' : 'scale(1)',
                }}
              >
                {!isRecording && !loading && (
                  <span
                    className="pointer-events-none absolute inset-0 rounded-full"
                    style={{ animation: 'mic-idle-glow 3s ease-in-out infinite' }}
                    aria-hidden
                  />
                )}
                {isRecording && (
                  <span
                    className="pointer-events-none absolute rounded-full"
                    style={{
                      inset: '-4px',
                      animation: 'mic-ring-pulse 2.5s ease-in-out infinite',
                      border: '1px solid rgba(248,113,113,0.32)',
                      boxShadow: '0 0 16px 0 rgba(220,38,38,0.07)',
                    }}
                    aria-hidden
                  />
                )}
                <svg width="46" height="46" viewBox="0 0 24 24" fill="white">
                  <path d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4z"/>
                  <path d="M19 10a1 1 0 0 0-2 0 5 5 0 0 1-10 0 1 1 0 0 0-2 0 7 7 0 0 0 6 6.92V19H9a1 1 0 0 0 0 2h6a1 1 0 0 0 0-2h-2v-2.08A7 7 0 0 0 19 10z"/>
                </svg>
              </button>

              {/* Timer / status */}
              <div className="mb-2 min-h-[44px] flex flex-col items-center justify-center">
                {isRecording ? (
                  <span
                    className="text-[48px] font-semibold tabular-nums tracking-tight leading-none text-zinc-900 transition-transform duration-300 sm:text-[52px]"
                    style={{ animation: 'recording-timer-breathe 3s ease-in-out infinite' }}
                  >
                    {formatSeconds(recordingSeconds)}
                  </span>
                ) : null}
              </div>

              {/* Waveform */}
              {isRecording && (
                <div className="mb-2 flex h-6 items-end justify-center gap-0.5">
                  {Array.from({ length: 24 }).map((_, i) => (
                    <span
                      key={i}
                      className="w-[2px] max-w-[2px] rounded-full bg-red-600/55"
                      style={{ animation: `pulse-bar ${0.5 + (i % 5) * 0.08}s ease-in-out ${i * 0.03}s infinite alternate` }}
                    />
                  ))}
                </div>
              )}

              {/* Recording hints */}
              {isRecording && (
                <div className="mb-2 w-full px-2">
                  <p className="mb-1.5 text-center text-[9px] font-medium uppercase tracking-[0.12em] text-zinc-400/65">Mention in your note</p>
                  <div className="flex flex-wrap justify-center gap-1">
                    {[{icon:'🏢',label:'Company'},{icon:'👤',label:'Contact'},{icon:'🌱',label:'Crop'},{icon:'🧪',label:'Product'},{icon:'📍',label:'Location'},{icon:'📅',label:'Next step'}].map((h) => (
                      <span key={h.label} className="flex items-center gap-0.5 rounded-full border px-1 py-px text-[8px] font-medium text-emerald-900/42 sm:text-[8.5px]" style={{borderColor:'rgba(167,243,208,0.28)',backgroundColor:'rgba(236,253,245,0.38)',animation:'fadeIn 0.4s ease forwards'}}>
                        {h.icon} {h.label}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Manual textarea */}
              {!isRecording && !loading && (
                <div className="mt-1.5 w-full max-w-md px-1">
                  <textarea
                    className="mb-3 w-full resize-none rounded-2xl border border-zinc-200/80 bg-zinc-50/40 px-3.5 py-3 text-[13px] leading-relaxed text-zinc-500 outline-none placeholder:text-zinc-400/32 min-h-[68px] shadow-inner shadow-zinc-100/80"
                    placeholder="Or type a note…"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                  />
                  {input.trim() && (
                    <button
                      onClick={processTypedNote}
                      disabled={loading}
                      className="w-full rounded-2xl py-4 text-[15px] font-semibold text-white transition-all active:scale-[0.98]"
                      style={{backgroundColor: '#1a4d2e', boxShadow: '0 4px 16px rgba(26,77,46,0.25)'}}
                    >
                      Process Note
                    </button>
                  )}
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="mt-3 w-full rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-600">
                  {error}
                </div>
              )}
            </div>

            {/* SCREEN 2 — Result (slides up when result exists) */}
            {result && (
              <div
                className="flex flex-col px-0 pt-2 pb-10"
                style={{
                  animation: 'slideUp 0.68s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards',
                }}
              >
                {/* 1 — Next step + calendar (sticky) */}
                <div className="sticky top-0 z-20 -mx-5 border-b border-zinc-100/65 bg-white/93 px-5 pb-4 pt-1 backdrop-blur-md supports-[backdrop-filter]:bg-white/86">
                  <div className="mb-2.5 flex justify-end">
                    <button
                      type="button"
                      onClick={handleReset}
                      className="flex shrink-0 items-center gap-0.5 rounded-full border border-zinc-200/90 bg-white py-1.5 pl-2.5 pr-3 text-[11px] font-semibold text-zinc-600 shadow-sm transition-colors hover:border-zinc-300 hover:bg-zinc-50 active:scale-[0.97]"
                    >
                      <span className="text-[13px] font-semibold leading-none text-zinc-700" aria-hidden>+</span>
                      New
                    </button>
                  </div>

                  {result.nextStep && (
                    <>
                      <div
                        className="rounded-2xl px-5 py-[0.95rem] min-[390px]:px-5 min-[390px]:py-[1.15rem] text-center shadow-[0_6px_28px_rgba(26,77,46,0.09),0_2px_8px_rgba(26,77,46,0.05),inset_0_1px_0_rgba(255,255,255,0.65)] ring-1 ring-emerald-100/40 border border-emerald-200/90"
                        style={{ background: 'linear-gradient(165deg, #e8f6ed 0%, #dbece3 100%)' }}
                      >
                        <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.26em] text-emerald-900/42">
                          Next step
                        </p>
                        <p
                          className="text-[23px] min-[390px]:text-[27px] font-black leading-[1.14] tracking-[-0.02em] antialiased"
                          style={{ color: '#0a2e1a' }}
                        >
                          {result.nextStep}
                        </p>
                      </div>

                      <button
                        onClick={() => {
                          if (navigator.vibrate) navigator.vibrate(10)
                          const text = result.nextStep
                          const dateMatch = text.match(/\d{2}\/\d{2}\/\d{4}/)
                          let startDate = ''
                          if (dateMatch) {
                            const [m, d, y] = dateMatch[0].split('/')
                            startDate = `${y}${m}${d}T090000`
                          } else {
                            const now = new Date()
                            startDate = now.toISOString().replace(/[-:]/g, '').split('.')[0]
                          }
                          const endDate = startDate.replace('T090000', 'T093000')
                          const cleanTitle = text.replace(/\s*(el|on|para el)\s+\d{2}\/\d{2}\/\d{4}.*/i, '').replace(/\s+/g, ' ').trim()
                          const title = encodeURIComponent(cleanTitle)
                          const descLines = []
                          if (result.contact) descLines.push(`👤 ${result.contact}${result.customer ? ' — ' + result.customer : ''}`)
                          const pills = [result.location && '📍 ' + result.location, result.crop && '🌱 ' + result.crop, result.product && '🧪 ' + result.product].filter(Boolean)
                          if (pills.length) descLines.push(pills.join('  '))
                          if (result.crmFull.length > 0) {
                            descLines.push('')
                            descLines.push(...result.crmFull)
                          }
                          if (result.crmText) {
                            descLines.push('')
                            descLines.push(result.crmText)
                          }
                          const details = encodeURIComponent(descLines.join('\n'))
                          const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${startDate}/${endDate}&details=${details}`
                          window.open(url, '_blank')
                          setShowCalendarToast(true)
                        }}
                        type="button"
                        className="group mt-3 inline-flex w-full select-none items-center justify-center gap-1.5 rounded-xl py-3 min-[400px]:py-[0.85rem] pl-4 pr-4 text-[15px] font-bold leading-none text-white antialiased shadow-[0_4px_18px_-4px_rgba(26,77,46,0.28),0_2px_8px_rgba(26,77,46,0.12),inset_0_1px_0_rgba(255,255,255,0.18)] transition-[transform,box-shadow,filter] duration-200 ease-out hover:shadow-[0_6px_22px_-4px_rgba(26,77,46,0.32),0_2px_10px_rgba(26,77,46,0.14),inset_0_1px_0_rgba(255,255,255,0.2)] hover:brightness-[1.02] active:translate-y-px active:scale-[0.982] active:shadow-[0_3px_12px_-2px_rgba(26,77,46,0.22),inset_0_1px_2px_rgba(0,0,0,0.12)] active:brightness-[0.95]"
                        style={{ backgroundColor: '#1a4d2e' }}
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="block h-4 w-4 shrink-0 opacity-[0.95]" aria-hidden>
                          <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                        </svg>
                        <span className="tracking-tight">Add to Calendar</span>
                      </button>
                    </>
                  )}
                </div>

                {/* 2 — Contact & company → 3 — Insights → 4 — Summary */}
                <div className="mt-7 space-y-7">
                  {(result.contact || result.customer || result.location || result.crop || result.product) && (
                    <div className="rounded-2xl border border-zinc-200/85 bg-white px-4 py-4 shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
                      <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-400">
                        Visit
                      </p>
                      {result.contact ? (
                        <p className="text-[17px] font-semibold leading-snug tracking-tight text-zinc-900">
                          {result.contact}
                        </p>
                      ) : (
                        <p
                          className={`text-[17px] font-semibold leading-snug tracking-tight ${result.customer ? 'text-zinc-900' : 'text-zinc-400'}`}
                        >
                          {result.customer || '—'}
                        </p>
                      )}
                      {result.contact && result.customer ? (
                        <p className="mt-2 text-[14px] font-medium leading-snug text-zinc-500">
                          {result.customer}
                        </p>
                      ) : null}
                      {(result.location || result.crop || result.product) && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {result.location ? (
                            <span className="inline-flex items-center rounded-full border border-zinc-200/80 bg-zinc-50/90 px-2.5 py-1 text-[10px] font-medium text-zinc-600">
                              📍 {result.location}
                            </span>
                          ) : null}
                          {result.crop ? (
                            <span className="inline-flex items-center rounded-full border border-zinc-200/80 bg-zinc-50/90 px-2.5 py-1 text-[10px] font-medium text-zinc-600">
                              🌱 {result.crop}
                            </span>
                          ) : null}
                          {result.product ? (
                            <span className="inline-flex items-center rounded-full border border-zinc-200/80 bg-zinc-50/90 px-2.5 py-1 text-[10px] font-medium text-zinc-600">
                              🧪 {result.product}
                            </span>
                          ) : null}
                        </div>
                      )}
                    </div>
                  )}

                  {result.crmFull.length > 0 && (
                    <div className="rounded-2xl border border-zinc-200/40 bg-white px-4 py-4 shadow-[0_1px_2px_rgba(0,0,0,0.02),0_1px_8px_rgba(0,0,0,0.02)]">
                      <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500/90">
                        Key insights
                      </p>
                      <div className="flex flex-col gap-4">
                        {(resultInsightsExpanded
                          ? result.crmFull
                          : result.crmFull.slice(0, 3)
                        ).map((line, i) => (
                          <p
                            key={i}
                            className={`rounded-lg px-3 py-2.5 text-[15px] font-medium leading-[1.65] tracking-tight ${getInsightStyle(line)}`}
                          >
                            {line}
                          </p>
                        ))}
                      </div>
                      {result.crmFull.length > 3 ? (
                        <button
                          type="button"
                          onClick={() => setResultInsightsExpanded((e) => !e)}
                          className="mt-3 text-[12px] font-semibold text-[#1a4d2e] underline decoration-[#1a4d2e]/30 underline-offset-2 hover:decoration-[#1a4d2e]/60"
                        >
                          {resultInsightsExpanded ? 'Show less' : 'Show more'}
                        </button>
                      ) : null}
                    </div>
                  )}

                  {result.summary && (
                    <div className="rounded-xl border border-zinc-100/85 bg-zinc-50/30 px-3.5 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                      <button
                        type="button"
                        onClick={() => setResultSummaryExpanded((e) => !e)}
                        className="text-[12px] font-medium text-zinc-500/90 transition-colors hover:text-zinc-700"
                      >
                        {resultSummaryExpanded ? 'Hide summary' : 'View summary'}
                      </button>
                      <div
                        className={`grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${resultSummaryExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
                      >
                        <div className="min-h-0 overflow-hidden">
                          <div
                            className={`origin-top pt-3 transition-all duration-300 ease-out ${resultSummaryExpanded ? 'translate-y-0 opacity-100' : '-translate-y-1 opacity-0'}`}
                            style={{ pointerEvents: resultSummaryExpanded ? 'auto' : 'none' }}
                          >
                            <p className="whitespace-pre-line text-[12px] font-normal leading-relaxed text-zinc-500/85">
                              {result.summary}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Secondary actions */}
                  <div className="border-t border-zinc-100/90 pt-7">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => { if (navigator.vibrate) navigator.vibrate(5); handleCopy() }}
                        className="flex h-11 flex-[1.12] items-center justify-center gap-1.5 rounded-xl border border-zinc-200/90 bg-white text-[12px] font-medium text-zinc-500 transition-all hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-700 active:scale-[0.98]"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="opacity-50">
                          <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                        </svg>
                        {copied ? 'Copied' : 'Copy CRM'}
                      </button>
                      <button
                        onClick={() => result && handleShare(result)}
                        className="flex h-11 w-12 shrink-0 items-center justify-center rounded-xl border border-zinc-200/90 bg-white text-zinc-500 transition-all hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-600 active:scale-[0.98]"
                        aria-label="Share"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="opacity-60">
                          <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>
                        </svg>
                      </button>
                      {savedNotes.length > 0 && (
                        <button
                          onClick={() => {
                            const latest = savedNotes[0]
                            if (isCorrectingRecording) stopCorrectionRecording()
                            else startCorrectionRecording(latest.id, latest.transcript)
                          }}
                          className="flex h-11 w-12 shrink-0 items-center justify-center rounded-xl border border-amber-200/60 bg-amber-600/90 text-white transition-all hover:bg-amber-600 active:scale-[0.98] active:bg-amber-700 shadow-[0_2px_8px_rgba(217,119,6,0.2)]"
                          aria-label="Correct"
                        >
                          {isCorrectingRecording ? (
                            <span className="flex items-center gap-1 text-white">
                              <span className="text-[10px] tabular-nums">{String(Math.floor(correctingSeconds/60)).padStart(2,'0')}:{String(correctingSeconds%60).padStart(2,'0')}</span>
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="white"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
                            </span>
                          ) : (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                            </svg>
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="min-h-[2rem]" aria-hidden />
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── HISTORY TAB ── */}
        {activeTab === 'history' && (
          <div className="pt-2">
            {selectedNote ? (
              <div>
                <button
                  onClick={() => setSelectedNote(null)}
                  className="mb-4 flex items-center gap-2 text-[13px] text-zinc-400 hover:text-zinc-700"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M15 18l-6-6 6-6"/>
                  </svg>
                  Back to history
                </button>

                <div className="space-y-5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">{formatDate(selectedNote.date)}</p>

                  <div className="rounded-2xl border border-zinc-100 bg-white px-4 py-4 shadow-sm">
                    <div className="flex items-center gap-3.5">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[13px] font-bold text-zinc-700">
                        {selectedNote.result.contact ? getInitials(selectedNote.result.contact) : 'NA'}
                      </div>
                      <div>
                        <p className="text-[20px] font-bold text-zinc-900">{selectedNote.result.contact || '—'}</p>
                        {selectedNote.result.customer && (
                          <p className="text-[13px] text-zinc-400 mt-0.5">{selectedNote.result.customer}</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {(selectedNote.result.location || selectedNote.result.crop || selectedNote.result.product) && (
                    <div className="flex flex-wrap gap-1.5">
                      {selectedNote.result.location && (
                        <span className="flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-[11px] text-zinc-500 shadow-sm">
                          📍 {selectedNote.result.location}
                        </span>
                      )}
                      {selectedNote.result.crop && (
                        <span className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-[11px] text-zinc-500 shadow-sm">
                          🌱 {selectedNote.result.crop}
                        </span>
                      )}
                      {selectedNote.result.product && (
                        <span className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-[11px] text-zinc-500 shadow-sm">
                          🧪 {selectedNote.result.product}
                        </span>
                      )}
                    </div>
                  )}

                  {selectedNote.result.crmFull.length > 0 && (
                    <div className="rounded-2xl border border-zinc-200/40 bg-white px-4 py-4 shadow-[0_1px_2px_rgba(0,0,0,0.02),0_1px_8px_rgba(0,0,0,0.02)]">
                      <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500/90">
                        Key insights
                      </p>
                      <div className="flex flex-col gap-4">
                        {(historyInsightsExpanded
                          ? selectedNote.result.crmFull
                          : selectedNote.result.crmFull.slice(0, 3)
                        ).map((line, i) => (
                          <p
                            key={i}
                            className={`rounded-lg px-3 py-2.5 text-[15px] font-medium leading-[1.65] tracking-tight ${getInsightStyle(line)}`}
                          >
                            {line}
                          </p>
                        ))}
                      </div>
                      {selectedNote.result.crmFull.length > 3 ? (
                        <button
                          type="button"
                          onClick={() => setHistoryInsightsExpanded((e) => !e)}
                          className="mt-3 text-[12px] font-semibold text-[#1a4d2e] underline decoration-[#1a4d2e]/30 underline-offset-2 hover:decoration-[#1a4d2e]/60"
                        >
                          {historyInsightsExpanded ? 'Show less' : 'Show more'}
                        </button>
                      ) : null}
                    </div>
                  )}

                  {selectedNote.result.summary && (
                    <div className="rounded-xl border border-zinc-100/85 bg-zinc-50/30 px-3.5 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                      <button
                        type="button"
                        onClick={() => setHistorySummaryExpanded((e) => !e)}
                        className="text-[12px] font-medium text-zinc-500/90 transition-colors hover:text-zinc-700"
                      >
                        {historySummaryExpanded ? 'Hide summary' : 'View summary'}
                      </button>
                      <div
                        className={`grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${historySummaryExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
                      >
                        <div className="min-h-0 overflow-hidden">
                          <div
                            className={`origin-top pt-3 transition-all duration-300 ease-out ${historySummaryExpanded ? 'translate-y-0 opacity-100' : '-translate-y-1 opacity-0'}`}
                            style={{ pointerEvents: historySummaryExpanded ? 'auto' : 'none' }}
                          >
                            <p className="whitespace-pre-line text-[12px] font-normal leading-relaxed text-zinc-500/85">
                              {selectedNote.result.summary}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {selectedNote.result.nextStep && (
                    <div className="rounded-2xl px-4 py-4" style={{backgroundColor: '#f0f7f2', border: '1px solid #c8e6d0'}}>
                      <div className="mb-2 flex items-center gap-2">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="#1a4d2e">
                          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                        </svg>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{color: '#1a4d2e'}}>Next step</p>
                      </div>
                      <p className="text-[19px] font-bold leading-snug" style={{color: '#1a4d2e'}}>{selectedNote.result.nextStep}</p>
                    </div>
                  )}

                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={handleCopy}
                      className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white py-3.5 text-[13px] font-medium text-zinc-500 shadow-sm transition-all hover:text-zinc-800 active:scale-[0.98]"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="9" y="9" width="13" height="13" rx="2"/>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                      </svg>
                      {copied ? 'Copied!' : 'Copy for CRM'}
                    </button>
                    <button
                      onClick={() => handleShare(selectedNote.result)}
                      className="flex items-center justify-center gap-1.5 rounded-2xl border border-zinc-200 bg-white px-3.5 py-3.5 text-zinc-500 shadow-sm transition-all active:scale-[0.98]"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>
                      </svg>
                    </button>
                    <button
                      onClick={() => deleteNote(selectedNote.id)}
                      className="rounded-2xl border border-red-200 bg-red-50 px-4 text-[13px] text-red-500 transition-all hover:bg-red-100 active:scale-[0.98]"
                    >
                      Delete
                    </button>
                  </div>
                  {/* Correct button in history */}
                  <button
                    onClick={() => {
                      if (isCorrectingRecording) {
                        stopCorrectionRecording()
                      } else {
                        startCorrectionRecording(selectedNote.id, selectedNote.transcript)
                      }
                    }}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-[13px] font-semibold text-white transition-all active:scale-[0.98]"
                    style={{backgroundColor: isCorrectingRecording ? '#dc2626' : '#d97706'}}
                  >
                    {isCorrectingRecording ? (
                      <span className="flex items-center gap-2">
                        <span className="text-[11px] tabular-nums">{String(Math.floor(correctingSeconds/60)).padStart(2,'0')}:{String(correctingSeconds%60).padStart(2,'0')}</span>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="white">
                          <rect x="3" y="3" width="18" height="18" rx="2"/>
                        </svg>
                      </span>
                    ) : (
                      <>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                        Correct with voice
                      </>
                    )}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                {/* Search bar */}
                <div className="relative mb-4">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400">
                    <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
                  </svg>
                  <input
                    type="text"
                    placeholder="Search notes..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full rounded-2xl border border-zinc-200 bg-white py-3 pl-9 pr-4 text-[14px] text-zinc-700 outline-none shadow-sm placeholder:text-zinc-400"
                  />
                </div>
                <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
                  {savedNotes.length} {savedNotes.length === 1 ? 'note' : 'notes'} saved
                </p>
                {savedNotes.length === 0 ? (
                  <div className="flex flex-col items-center justify-center pt-16 text-center">
                    <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full" style={{backgroundColor: '#f0f7f2'}}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#1a4d2e" strokeWidth="1.5" opacity="0.5">
                        <path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="10"/>
                      </svg>
                    </div>
                    <p className="text-[14px] text-zinc-400">No notes yet</p>
                    <p className="mt-1 text-[12px] text-zinc-300">Record your first visit to get started</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {savedNotes.filter((note) => {
                      if (!searchQuery.trim()) return true
                      const q = searchQuery.toLowerCase()
                      return (
                        note.result.contact?.toLowerCase().includes(q) ||
                        note.result.customer?.toLowerCase().includes(q) ||
                        note.result.product?.toLowerCase().includes(q) ||
                        note.result.location?.toLowerCase().includes(q) ||
                        note.result.nextStep?.toLowerCase().includes(q) ||
                        note.result.crmFull.some((line) => line.toLowerCase().includes(q))
                      )
                    }).map((note) => (
                      <button
                        key={note.id}
                        onClick={() => setSelectedNote(note)}
                        className="w-full rounded-2xl border border-zinc-100 bg-white px-4 py-3.5 text-left shadow-sm transition-all hover:border-zinc-200 active:scale-[0.99]"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[11px] font-bold text-zinc-700">
                              {note.result.contact ? getInitials(note.result.contact) : 'NA'}
                            </div>
                            <div className="min-w-0">
                              <p className="text-[14px] font-semibold text-zinc-900 truncate">
                                {note.result.contact || note.result.customer || 'Unnamed'}
                              </p>
                              {note.result.customer && note.result.contact && (
                                <p className="text-[12px] text-zinc-400 truncate">{note.result.customer}</p>
                              )}
                            </div>
                          </div>
                          <p className="shrink-0 text-[11px] text-zinc-400 mt-0.5">{formatDate(note.date)}</p>
                        </div>
                        {note.result.nextStep && (
                          <p className="mt-2 text-[12px] truncate pl-12" style={{color: '#1a4d2e'}}>→ {note.result.nextStep}</p>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── SETTINGS TAB ── */}
        {activeTab === 'settings' && (
          <div className="pt-2 space-y-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-400">Account</p>
            <div className="rounded-2xl border border-zinc-100 bg-white px-4 py-4 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full text-[13px] font-bold text-white" style={{backgroundColor: '#1a4d2e'}}>IG</div>
                <div>
                  <p className="text-[14px] font-semibold text-zinc-900">Ignacio</p>
                  <p className="text-[12px] text-zinc-400">Personal use</p>
                </div>
              </div>
            </div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-400">Data</p>
            <button
              onClick={() => {
                if (confirm('Delete all saved notes?')) {
                  setSavedNotes([])
                  localStorage.removeItem('fieldbrief-notes')
                }
              }}
              className="w-full rounded-2xl border border-red-200 bg-red-50 py-3.5 text-[13px] font-medium text-red-500 transition-all hover:bg-red-100"
            >
              Clear all notes
            </button>
          </div>
        )}

      </div>

      {/* ── BOTTOM NAV ── */}
      <nav className="fixed bottom-0 left-0 right-0 flex items-center justify-around border-t border-zinc-100 bg-white/95 px-2 pb-safe pt-2 backdrop-blur-md">
        <NavBtn
          active={activeTab === 'record'}
          onClick={() => { setActiveTab('record'); setSelectedNote(null) }}
          label="Record"
          activeColor="#1a4d2e"
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4z"/>
              <path d="M19 10a1 1 0 0 0-2 0 5 5 0 0 1-10 0 1 1 0 0 0-2 0 7 7 0 0 0 6 6.92V19H9a1 1 0 0 0 0 2h6a1 1 0 0 0 0-2h-2v-2.08A7 7 0 0 0 19 10z"/>
            </svg>
          }
        />
        <NavBtn
          active={activeTab === 'history'}
          onClick={() => { setActiveTab('history'); setSelectedNote(null) }}
          label="History"
          badge={savedNotes.length}
          activeColor="#1a4d2e"
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="10"/>
            </svg>
          }
        />
        <NavBtn
          active={activeTab === 'settings'}
          onClick={() => setActiveTab('settings')}
          label="Settings"
          activeColor="#1a4d2e"
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          }
        />
      </nav>

      <style jsx global>{`
        @keyframes processingOverlayIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes processingRingSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes noteSavedToast {
          0% { opacity: 0; }
          11% { opacity: 1; }
          84% { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes pulse-bar {
          from { height: 2px; opacity: 0.32; }
          to   { height: 12px; opacity: 0.62; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes calendarEventToast {
          0% { opacity: 0; }
          11% { opacity: 1; }
          84% { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes mic-ring-pulse {
          0%, 100% { opacity: 0.55; }
          50% { opacity: 0.88; }
        }
        @keyframes recording-timer-breathe {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.006); }
        }
        @keyframes mic-idle-glow {
          0%, 100% { box-shadow: 0 0 0 0 rgba(26, 77, 46, 0); opacity: 1; }
          50% { box-shadow: 0 0 28px 4px rgba(26, 77, 46, 0.14); opacity: 1; }
        }
        .pb-safe { padding-bottom: env(safe-area-inset-bottom, 12px); }
      `}</style>
    </main>
  )
}

function NavBtn({
  active, onClick, label, icon, badge, activeColor
}: {
  active: boolean
  onClick: () => void
  label: string
  icon: React.ReactNode
  badge?: number
  activeColor: string
}) {
  return (
    <button
      onClick={onClick}
      className="relative flex flex-col items-center gap-1 px-5 py-2 transition-all"
      style={{color: active ? activeColor : '#a1a1aa'}}
    >
      <span>{icon}</span>
      <span className="text-[10px] font-medium">{label}</span>
      {badge && badge > 0 ? (
        <span className="absolute right-3 top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[9px] font-bold text-white" style={{backgroundColor: activeColor}}>
          {badge}
        </span>
      ) : null}
    </button>
  )
}
