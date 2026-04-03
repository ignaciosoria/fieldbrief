'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

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
  crmText: string
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
  crmText: '',
}

type ProcessingStep = 'transcribing' | 'structuring'

type Tab = 'record' | 'history' | 'settings'

type SavedNote = {
  id: string
  date: string
  result: StructureResult
  transcript: string
}

export default function Home() {
  const [mounted, setMounted] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('record')
  const [input, setInput] = useState('')
  const [result, setResult] = useState<StructureResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [processingStep, setProcessingStep] = useState<ProcessingStep | null>(null)
  const [processingLinger, setProcessingLinger] = useState(false)
  const [progressWidth, setProgressWidth] = useState(0)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [transcript, setTranscript] = useState('')
  const [savedNotes, setSavedNotes] = useState<SavedNote[]>([])
  const [selectedNote, setSelectedNote] = useState<SavedNote | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    setMounted(true)
    try {
      const stored = localStorage.getItem('fieldbrief-notes')
      if (stored) setSavedNotes(JSON.parse(stored))
    } catch {}
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
    if (loading) {
      setProcessingLinger(true)
      return
    }
    // Complete to 100% then fade out
    setProgressWidth(100)
    const id = setTimeout(() => setProcessingLinger(false), 600)
    return () => clearTimeout(id)
  }, [loading])

  useEffect(() => {
    if (processingStep === 'transcribing') {
      setProgressWidth(0)
      const raf = requestAnimationFrame(() =>
        requestAnimationFrame(() => setProgressWidth(60))
      )
      return () => cancelAnimationFrame(raf)
    } else if (processingStep === 'structuring') {
      setProgressWidth(95)
    }
  }, [processingStep])

  const saveNote = (res: StructureResult, tx: string) => {
    const note: SavedNote = {
      id: Date.now().toString(),
      date: new Date().toISOString(),
      result: res,
      transcript: tx,
    }
    const updated = [note, ...savedNotes]
    setSavedNotes(updated)
    try { localStorage.setItem('fieldbrief-notes', JSON.stringify(updated)) } catch {}
  }

  const deleteNote = (id: string) => {
    const updated = savedNotes.filter((n) => n.id !== id)
    setSavedNotes(updated)
    try { localStorage.setItem('fieldbrief-notes', JSON.stringify(updated)) } catch {}
    if (selectedNote?.id === id) setSelectedNote(null)
  }

  const activeResult = selectedNote?.result ?? result

  const copyText = useMemo(() => {
    const r = activeResult
    if (!r) return ''
    return r.crmText || ''
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
    setLoading(true)
    setProcessingStep('transcribing')
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

      setProcessingStep('structuring')
      const structureRes = await fetch('/api/structure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: tx }),
      })
      const structureData = await structureRes.json()
      if (!structureRes.ok) throw new Error(structureData.error || 'Failed to structure.')

      const final = { ...emptyResult, ...structureData }
      setResult(final)
      saveNote(final, tx)
    } catch (err: any) {
      setError(err?.message || 'Something went wrong.')
    } finally {
      setProcessingStep(null)
      setLoading(false)
    }
  }

  const processTypedNote = async () => {
    if (!input.trim()) return
    setLoading(true)
    setProcessingStep('structuring')
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
      const final = { ...emptyResult, ...data }
      setResult(final)
      saveNote(final, input)
    } catch (err: any) {
      setError(err?.message || 'Something went wrong.')
    } finally {
      setProcessingStep(null)
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
  }

  if (!mounted) return null

  return (
    <main className="flex min-h-screen flex-col bg-[#0d0d14] text-white antialiased select-none">

      {/* Header */}
      <header className="flex items-center justify-between px-5 pt-5 pb-3">
        <button className="flex flex-col gap-[5px] p-1" aria-label="Menu">
          <span className="block h-[2px] w-5 rounded-full bg-zinc-500" />
          <span className="block h-[2px] w-5 rounded-full bg-zinc-500" />
          <span className="block h-[2px] w-3 rounded-full bg-zinc-500" />
        </button>
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-[12px] font-bold tracking-[0.25em] text-white uppercase">FieldBrief</span>
          <span className="text-[9px] tracking-[0.12em] text-zinc-600 uppercase">Talk. We'll handle the rest.</span>
        </div>
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-500/20 text-[12px] font-semibold text-indigo-300">
          IG
        </div>
      </header>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto pb-28 px-5">

        {/* ── RECORD TAB ── */}
        {activeTab === 'record' && (
          <div className="flex flex-col items-center pt-10">

            {/* Mic button */}
            <button
              onClick={toggleRecording}
              disabled={loading}
              className={`
                relative mb-6 flex h-32 w-32 items-center justify-center rounded-[2rem]
                transition-all duration-300 active:scale-95 disabled:opacity-40
                ${isRecording
                  ? 'bg-rose-600 shadow-[0_12px_50px_rgba(225,29,72,0.5)]'
                  : 'bg-indigo-600 shadow-[0_12px_50px_rgba(99,102,241,0.45)] hover:bg-indigo-500'
                }
              `}
            >
              {isRecording && (
                <span className="absolute inset-0 animate-ping rounded-[2rem] bg-rose-400/20" />
              )}
              <svg width="44" height="44" viewBox="0 0 24 24" fill="white">
                <path d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4z"/>
                <path d="M19 10a1 1 0 0 0-2 0 5 5 0 0 1-10 0 1 1 0 0 0-2 0 7 7 0 0 0 6 6.92V19H9a1 1 0 0 0 0 2h6a1 1 0 0 0 0-2h-2v-2.08A7 7 0 0 0 19 10z"/>
              </svg>
            </button>

            {/* Processing: status + progress (below mic) */}
            {processingLinger && (
              <div
                className={`
                  mb-4 w-full max-w-xs transition-opacity duration-300 ease-out
                  ${loading ? 'opacity-100' : 'opacity-0'}
                `}
              >
                <p className="mb-2 text-center text-[13px] text-zinc-400 transition-all duration-300 ease-out">
                  {processingStep === 'transcribing' ? 'Transcribing your note...' : 'Structuring...'}
                </p>
                <div className="h-[3px] w-full overflow-hidden rounded-full bg-zinc-800/50">
                  <div
                    className="progress-shimmer-fill h-full rounded-full transition-[width] duration-700 ease-out"
                    style={{ width: `${progressWidth}%` }}
                  />
                </div>
              </div>
            )}

            {/* Timer / status */}
            <div className="mb-4 h-12 flex items-center justify-center">
              {isRecording ? (
                <span className="text-[48px] font-bold tabular-nums tracking-tight text-white leading-none">
                  {formatSeconds(recordingSeconds)}
                </span>
              ) : loading ? (
                <span className="sr-only">Processing</span>
              ) : result ? (
                <span className="text-[14px] text-emerald-400">✓ Note saved</span>
              ) : (
                <span className="text-[14px] text-zinc-600">Tap to record</span>
              )}
            </div>

            {/* Waveform — only visible while recording */}
            {isRecording ? (
              <div className="mb-6 flex h-7 items-end justify-center gap-[3px]">
                {Array.from({ length: 22 }).map((_, i) => (
                  <span
                    key={i}
                    className="w-[3px] rounded-full bg-indigo-400"
                    style={{
                      animation: `pulse-bar ${0.5 + (i % 5) * 0.1}s ease-in-out ${i * 0.04}s infinite alternate`,
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className="mb-4" />
            )}

            {/* Textarea */}
            <textarea
              className="mb-4 w-full resize-none rounded-2xl border border-zinc-800 bg-zinc-900/50 px-4 py-3.5 text-[14px] leading-relaxed text-zinc-200 outline-none placeholder:text-zinc-700 focus-visible:border-indigo-500/50 min-h-[90px]"
              placeholder="Add details manually..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            {transcript && (
              <p className="mb-3 w-full text-[12px] text-emerald-500/70">✓ Transcript loaded</p>
            )}

            {/* Buttons */}
            <div className="mb-4 flex w-full gap-2">
              <button
                onClick={processTypedNote}
                disabled={loading || !input.trim()}
                className="flex-1 rounded-2xl bg-indigo-600 py-4 text-[15px] font-semibold text-white shadow-[0_4px_20px_rgba(99,102,241,0.3)] transition-all hover:bg-indigo-500 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
              >
                {loading ? 'Processing...' : 'Process Note'}
              </button>
              {(input || result) && (
                <button
                  onClick={handleReset}
                  className="rounded-2xl border border-zinc-800 px-4 text-[13px] text-zinc-500 transition-all hover:text-zinc-300"
                >
                  Clear
                </button>
              )}
            </div>

            {/* Error */}
            {error && (
              <div className="mb-4 w-full rounded-xl border border-red-900/50 bg-red-950/30 px-4 py-3 text-[13px] text-red-300">
                {error}
              </div>
            )}

            {/* ── OUTPUT ── */}
            {result && (
              <div className="w-full space-y-3">

                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">Analysis result</p>

                {/* Contact + Company card */}
                <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 px-4 py-3.5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-[13px] font-semibold text-indigo-300">
                      {result.contact ? getInitials(result.contact) : result.customer ? getInitials(result.customer) : 'NA'}
                    </div>
                    <div>
                      <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-600">Contact</p>
                      <p className="text-[16px] font-semibold text-white leading-tight">{result.contact || '—'}</p>
                      {result.customer && (
                        <p className="text-[12px] text-zinc-500 mt-0.5">{result.customer}</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Pills row — location, crop, product */}
                {(result.location || result.crop || result.product) && (
                  <div className="flex flex-wrap gap-2">
                    {result.location && (
                      <span className="flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-[11px] text-zinc-400">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
                        </svg>
                        {result.location}
                      </span>
                    )}
                    {result.crop && (
                      <span className="flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-[11px] text-zinc-400">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 2a10 10 0 0 1 10 10c0 5.52-4.48 10-10 10S2 17.52 2 12c0-2.76 1.12-5.26 2.93-7.07"/>
                          <path d="M12 6v6l4 2"/>
                        </svg>
                        {result.crop}
                      </span>
                    )}
                    {result.product && (
                      <span className="flex items-center gap-1.5 rounded-full border border-indigo-800/40 bg-indigo-950/40 px-3 py-1.5 text-[11px] text-indigo-400">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                        </svg>
                        {result.product}
                      </span>
                    )}
                  </div>
                )}

                {/* Summary */}
                {result.summary && (
                  <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 px-4 py-3.5">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">Summary</p>
                    <p className="text-[13px] leading-relaxed text-zinc-300">{result.summary}</p>
                  </div>
                )}

                {/* Next Step */}
                {result.nextStep && (
                  <div className="rounded-2xl border border-indigo-500/20 bg-indigo-950/40 px-4 py-3.5">
                    <div className="mb-2 flex items-center gap-2">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="rgba(165,180,252,0.8)">
                        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                      </svg>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-400/80">Next step</p>
                    </div>
                    <p className="text-[16px] font-semibold text-white leading-snug italic">"{result.nextStep}"</p>
                  </div>
                )}

                {/* Copy button */}
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={handleCopy}
                    className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-900/60 py-3.5 text-[13px] font-medium text-zinc-300 transition-all hover:border-zinc-700 hover:text-white active:scale-[0.98]"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2"/>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                  <button
                    onClick={() => { setActiveTab('history') }}
                    className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-indigo-600 py-3.5 text-[13px] font-medium text-white shadow-[0_4px_16px_rgba(99,102,241,0.3)] transition-all hover:bg-indigo-500 active:scale-[0.98]"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 8v4l3 3"/>
                      <circle cx="12" cy="12" r="10"/>
                    </svg>
                    View history
                  </button>
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
                  className="mb-4 flex items-center gap-2 text-[13px] text-zinc-500 hover:text-zinc-300"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M15 18l-6-6 6-6"/>
                  </svg>
                  Back to history
                </button>

                <div className="space-y-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-600">{formatDate(selectedNote.date)}</p>

                  <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 px-4 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-[13px] font-semibold text-indigo-300">
                        {selectedNote.result.contact ? getInitials(selectedNote.result.contact) : 'NA'}
                      </div>
                      <div>
                        <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-600">Contact</p>
                        <p className="text-[16px] font-semibold text-white">{selectedNote.result.contact || '—'}</p>
                        {selectedNote.result.customer && (
                          <p className="text-[12px] text-zinc-500 mt-0.5">{selectedNote.result.customer}</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Pills en history detail */}
                  {(selectedNote.result.location || selectedNote.result.crop || selectedNote.result.product) && (
                    <div className="flex flex-wrap gap-2">
                      {selectedNote.result.location && (
                        <span className="flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-[11px] text-zinc-400">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
                          </svg>
                          {selectedNote.result.location}
                        </span>
                      )}
                      {selectedNote.result.crop && (
                        <span className="flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-[11px] text-zinc-400">
                          {selectedNote.result.crop}
                        </span>
                      )}
                      {selectedNote.result.product && (
                        <span className="flex items-center gap-1.5 rounded-full border border-indigo-800/40 bg-indigo-950/40 px-3 py-1.5 text-[11px] text-indigo-400">
                          {selectedNote.result.product}
                        </span>
                      )}
                    </div>
                  )}

                  {selectedNote.result.summary && (
                    <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 px-4 py-3.5">
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">Summary</p>
                      <p className="text-[13px] leading-relaxed text-zinc-300">{selectedNote.result.summary}</p>
                    </div>
                  )}

                  {selectedNote.result.nextStep && (
                    <div className="rounded-2xl border border-indigo-500/20 bg-indigo-950/40 px-4 py-3.5">
                      <div className="mb-2 flex items-center gap-2">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="rgba(165,180,252,0.8)">
                          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                        </svg>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-400/80">Next step</p>
                      </div>
                      <p className="text-[16px] font-semibold text-white leading-snug italic">"{selectedNote.result.nextStep}"</p>
                    </div>
                  )}

                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={handleCopy}
                      className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-900/60 py-3.5 text-[13px] font-medium text-zinc-300 transition-all hover:text-white active:scale-[0.98]"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="9" y="9" width="13" height="13" rx="2"/>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                      </svg>
                      {copied ? 'Copied!' : 'Copy for CRM'}
                    </button>
                    <button
                      onClick={() => deleteNote(selectedNote.id)}
                      className="rounded-2xl border border-red-900/40 bg-red-950/30 px-4 text-[13px] text-red-400 transition-all hover:bg-red-950/50 active:scale-[0.98]"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">
                  {savedNotes.length} {savedNotes.length === 1 ? 'note' : 'notes'} saved
                </p>
                {savedNotes.length === 0 ? (
                  <div className="flex flex-col items-center justify-center pt-16 text-center">
                    <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-900">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(99,102,241,0.5)" strokeWidth="1.5">
                        <path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="10"/>
                      </svg>
                    </div>
                    <p className="text-[14px] text-zinc-500">No notes yet</p>
                    <p className="mt-1 text-[12px] text-zinc-700">Record your first visit to get started</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {savedNotes.map((note) => (
                      <button
                        key={note.id}
                        onClick={() => setSelectedNote(note)}
                        className="w-full rounded-2xl border border-zinc-800/60 bg-zinc-900/50 px-4 py-3.5 text-left transition-all hover:border-zinc-700 active:scale-[0.99]"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-[11px] font-semibold text-indigo-300">
                              {note.result.contact ? getInitials(note.result.contact) : 'NA'}
                            </div>
                            <div className="min-w-0">
                              <p className="text-[14px] font-semibold text-white truncate">
                                {note.result.contact || note.result.customer || 'Unnamed'}
                              </p>
                              {note.result.customer && note.result.contact && (
                                <p className="text-[12px] text-zinc-500 truncate">{note.result.customer}</p>
                              )}
                            </div>
                          </div>
                          <p className="shrink-0 text-[11px] text-zinc-600 mt-0.5">{formatDate(note.date)}</p>
                        </div>
                        {note.result.nextStep && (
                          <p className="mt-2 text-[12px] text-indigo-400/80 truncate pl-12">→ {note.result.nextStep}</p>
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
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">Account</p>
            <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 px-4 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-500/20 text-[13px] font-semibold text-indigo-300">IG</div>
                <div>
                  <p className="text-[14px] font-semibold text-white">Ignacio</p>
                  <p className="text-[12px] text-zinc-500">Personal use</p>
                </div>
              </div>
            </div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">Data</p>
            <button
              onClick={() => {
                if (confirm('Delete all saved notes?')) {
                  setSavedNotes([])
                  localStorage.removeItem('fieldbrief-notes')
                }
              }}
              className="w-full rounded-2xl border border-red-900/30 bg-red-950/20 py-3.5 text-[13px] font-medium text-red-400 transition-all hover:bg-red-950/40"
            >
              Clear all notes
            </button>
          </div>
        )}

      </div>

      {/* ── BOTTOM NAV ── */}
      <nav className="fixed bottom-0 left-0 right-0 flex items-center justify-around border-t border-zinc-800/60 bg-[#0d0d14]/95 px-2 pb-safe pt-2 backdrop-blur-md">
        <NavBtn
          active={activeTab === 'record'}
          onClick={() => { setActiveTab('record'); setSelectedNote(null) }}
          label="Record"
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
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          }
        />
      </nav>

      <style jsx global>{`
        @keyframes pulse-bar {
          from { height: 3px; opacity: 0.5; }
          to   { height: 20px; opacity: 1; }
        }
        @keyframes progress-shimmer {
          0% { background-position: -100% 0; }
          100% { background-position: 100% 0; }
        }
        .progress-shimmer-fill {
          background: linear-gradient(
            90deg,
            rgb(49 46 129),
            rgb(129 140 248),
            rgb(49 46 129)
          );
          background-size: 200% 100%;
          animation: progress-shimmer 1.4s linear infinite;
        }
        .pb-safe { padding-bottom: env(safe-area-inset-bottom, 12px); }
      `}</style>
    </main>
  )
}

function NavBtn({
  active, onClick, label, icon, badge
}: {
  active: boolean
  onClick: () => void
  label: string
  icon: React.ReactNode
  badge?: number
}) {
  return (
    <button
      onClick={onClick}
      className="relative flex flex-col items-center gap-1 px-5 py-2 transition-all"
    >
      <span className={active ? 'text-indigo-400' : 'text-zinc-600'}>{icon}</span>
      <span className={`text-[10px] font-medium ${active ? 'text-indigo-400' : 'text-zinc-600'}`}>{label}</span>
      {badge && badge > 0 ? (
        <span className="absolute right-3 top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-indigo-500 px-1 text-[9px] font-bold text-white">
          {badge}
        </span>
      ) : null}
    </button>
  )
}
