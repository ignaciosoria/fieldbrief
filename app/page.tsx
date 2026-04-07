'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

type StructureResult = {
  customer: string
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
  contact: '',
  summary: '',
  nextStep: '',
  notes: '',
  crop: '',
  product: '',
  location: '',
  crmText: '',
}

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
  const [loadingStage, setLoadingStage] = useState<'transcribing' | 'structuring' | null>(null)
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
  const [lastCalendarUrl, setLastCalendarUrl] = useState<string | null>(null)
  const [calendarSuccessTick, setCalendarSuccessTick] = useState(0)
  const correctTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

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
              crmText: n.crm_text || '',
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
        if (stored) setSavedNotes(JSON.parse(stored))
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
    if (calendarSuccessTick === 0) return
    const t = setTimeout(() => setCalendarSuccessTick(0), 3200)
    return () => clearTimeout(t)
  }, [calendarSuccessTick])

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
    setTimeout(() => setNoteSaved(false), 2000)
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
    if (r.crmText) { lines.push(''); lines.push('─────────────────'); lines.push(r.crmText) }
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
        setLoading(true)
        setLoadingStage('transcribing')
        try {
          const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm'
          const file = new File([blob], `correction.${ext}`, { type: blob.type })
          const fd = new FormData()
          fd.append('file', file)
          const txRes = await fetch('/api/transcribe', { method: 'POST', body: fd })
          const txData = await txRes.json()
          const correction = txData.transcript || txData.text || ''
          setLoadingStage('structuring')
          const combined = `ORIGINAL NOTE: ${originalTranscript}\n\nCORRECTION: ${correction}`
          const strRes = await fetch('/api/structure', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ note: combined }),
          })
          const strData = await strRes.json()
          if (!strRes.ok) throw new Error(strData.error)
          const final = { ...emptyResult, ...strData }
          updateNote(noteId, final, combined)
        } catch (err: any) {
          setError(err?.message || 'Correction failed.')
        } finally {
          setLoading(false)
          setLoadingStage(null)
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
    setLoadingStage('transcribing')
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
      setLoadingStage('structuring')

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
      setLoading(false)
      setLoadingStage(null)
    }
  }

  const processTypedNote = async () => {
    if (!input.trim()) return
    setLoading(true)
    setLoadingStage('structuring')
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
      setLoading(false)
      setLoadingStage(null)
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
    setLastCalendarUrl(null)
    setCalendarSuccessTick(0)
  }

  if (!mounted) return null

  const progressWidth = loadingStage === 'transcribing' ? '55%' : loadingStage === 'structuring' ? '85%' : '0%'

  return (
    <main className="flex min-h-screen flex-col bg-white text-zinc-900 antialiased select-none">

      {/* Header */}
      <header className="flex items-center justify-between px-5 pt-9 pb-2 bg-white">
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

      {/* Progress bar */}
      {loading && (
        <div className="h-[2px] w-full bg-zinc-100 overflow-hidden">
          <div
            className="h-full transition-all duration-700 ease-in-out rounded-full"
            style={{ width: progressWidth, backgroundColor: '#1a4d2e' }}
          />
        </div>
      )}

      {/* Note saved toast */}
      {noteSaved && (
        <div className="mx-5 mt-3 flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-medium text-white" style={{backgroundColor: '#1a4d2e'}}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M20 6L9 17l-5-5"/>
          </svg>
          Note saved
        </div>
      )}

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto pb-28 px-5">

        {/* ── RECORD TAB ── */}
        {activeTab === 'record' && (
          <div className="relative flex flex-col" style={{minHeight: 'calc(100vh - 140px)'}}>

            {/* SCREEN 1 — Record (hidden when result exists) */}
            <div
              className="absolute inset-0 flex flex-col items-center justify-center transition-all duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]"
              style={{
                opacity: result ? 0 : 1,
                transform: result ? 'translateY(-20px)' : 'translateY(0)',
                pointerEvents: result ? 'none' : 'auto',
              }}
            >
              <p className="mb-4 max-w-[280px] text-center text-[13px] font-medium leading-snug text-zinc-500">
                Tap and describe the visit — we will turn it into a follow-up you can run.
              </p>
              {/* Mic button */}
              <button
                onClick={toggleRecording}
                disabled={loading}
                className="relative mb-4 flex h-36 w-36 items-center justify-center rounded-full transition-all duration-300 active:scale-95 disabled:pointer-events-none"
                style={{
                  backgroundColor: isRecording ? '#dc2626' : '#1a4d2e',
                  boxShadow: isRecording
                    ? '0 10px 40px rgba(220,38,38,0.38), 0 0 0 1px rgba(220,38,38,0.15)'
                    : '0 10px 40px rgba(26,77,46,0.32), 0 0 0 1px rgba(26,77,46,0.12)',
                  transform: isRecording ? 'scale(1.02)' : 'scale(1)',
                }}
              >
                {isRecording && (
                  <>
                    <span className="absolute -inset-1 rounded-full opacity-30" style={{ animation: 'mic-ring-pulse 2s ease-out infinite', boxShadow: '0 0 0 3px rgba(220,38,38,0.45)' }} />
                    <span className="absolute inset-0 animate-ping rounded-full opacity-25" style={{backgroundColor: '#dc2626', animationDuration: '1.8s'}} />
                  </>
                )}
                {loading && (
                  <span className="absolute inset-0 rounded-full" style={{border: '4px solid rgba(255,255,255,0.2)', borderTopColor: 'white', animation: 'spin 1s linear infinite'}} />
                )}
                {loading ? null : (
                  <svg width="46" height="46" viewBox="0 0 24 24" fill="white">
                    <path d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4z"/>
                    <path d="M19 10a1 1 0 0 0-2 0 5 5 0 0 1-10 0 1 1 0 0 0-2 0 7 7 0 0 0 6 6.92V19H9a1 1 0 0 0 0 2h6a1 1 0 0 0 0-2h-2v-2.08A7 7 0 0 0 19 10z"/>
                  </svg>
                )}
              </button>

              {/* Timer / status */}
              <div className="mb-3 min-h-[52px] flex flex-col items-center justify-center gap-1">
                {isRecording ? (
                  <>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-red-500/90">Recording</span>
                    <span
                      className="text-[52px] font-bold tabular-nums tracking-tight leading-none text-zinc-900 transition-transform duration-300"
                      style={{ animation: 'recording-timer-breathe 2.2s ease-in-out infinite' }}
                    >
                      {formatSeconds(recordingSeconds)}
                    </span>
                  </>
                ) : loading ? (
                  <span className="text-[14px] font-medium animate-pulse" style={{color: '#1a4d2e'}}>
                    {loadingStage === 'transcribing' ? 'Transcribing...' : 'Structuring...'}
                  </span>
                ) : (
                  <span className="text-[13px] font-medium text-zinc-400">Tap the mic to speak your visit note</span>
                )}
              </div>

              {/* Waveform */}
              {isRecording && (
                <div className="mb-3 flex h-8 items-end justify-center gap-[3px]">
                  {Array.from({ length: 22 }).map((_, i) => (
                    <span key={i} className="w-[3px] rounded-full" style={{backgroundColor: '#dc2626', opacity: 0.85, animation: `pulse-bar ${0.45 + (i % 5) * 0.09}s ease-in-out ${i * 0.035}s infinite alternate`}} />
                  ))}
                </div>
              )}

              {/* Recording hints */}
              {isRecording && (
                <div className="mb-3 w-full px-2">
                  <p className="mb-2 text-center text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-400">Mention in your note</p>
                  <div className="flex flex-wrap justify-center gap-1.5">
                    {[{icon:'🏢',label:'Company'},{icon:'👤',label:'Contact'},{icon:'🌱',label:'Crop'},{icon:'🧪',label:'Product'},{icon:'📍',label:'Location'},{icon:'📅',label:'Next step'}].map((h) => (
                      <span key={h.label} className="flex items-center gap-0.5 rounded-full border px-2 py-0.5 text-[10px] font-medium text-emerald-900/75" style={{borderColor:'rgba(167,243,208,0.55)',backgroundColor:'rgba(236,253,245,0.65)',animation:'fadeIn 0.4s ease forwards'}}>
                        {h.icon} {h.label}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Manual textarea */}
              {!isRecording && !loading && (
                <div className="w-full px-1">
                  <textarea
                    className="mb-3 w-full resize-none rounded-2xl border border-zinc-200 bg-white px-4 py-3.5 text-[14px] leading-relaxed text-zinc-700 outline-none placeholder:text-zinc-300 min-h-[80px] shadow-sm"
                    placeholder="Or type a note..."
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
                className="flex flex-col px-1 pt-0 pb-2"
                style={{
                  animation: 'slideUp 0.55s cubic-bezier(0.22, 1, 0.36, 1) forwards',
                }}
              >
                {/* Sticky stack: actions stay visible on small screens when scrolling context */}
                <div className="sticky top-0 z-20 -mx-5 mb-0.5 border-b border-zinc-100/70 bg-white/92 px-5 pb-1.5 pt-0 backdrop-blur-md supports-[backdrop-filter]:bg-white/85">
                  <div className="mb-1 flex justify-end">
                    <button onClick={handleReset} className="shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 active:scale-95">
                      New
                    </button>
                  </div>

                  {result.nextStep && (
                    <>
                      <div
                        className="rounded-t-[1.25rem] rounded-b-xl px-5 py-[18px] mb-0 shadow-[0_6px_32px_rgba(26,77,46,0.14),0_2px_8px_rgba(26,77,46,0.06),inset_0_1px_0_rgba(255,255,255,0.65)] border border-emerald-200"
                        style={{ background: 'linear-gradient(165deg, #e8f6ee 0%, #dcefe4 100%)' }}
                      >
                        <p className="text-[8px] font-semibold uppercase tracking-[0.22em] mb-2.5 text-emerald-900/55">Next step</p>
                        <p className="text-[23px] min-[390px]:text-[26px] font-black leading-[1.2] tracking-tight antialiased" style={{ color: '#0f3d24' }}>{result.nextStep}</p>
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
                          if (result.crmText) { descLines.push(''); descLines.push(result.crmText) }
                          const details = encodeURIComponent(descLines.join('\n'))
                          const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${startDate}/${endDate}&details=${details}`
                          window.open(url, '_blank')
                          setLastCalendarUrl(url)
                          setCalendarSuccessTick((n) => n + 1)
                        }}
                        className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl rounded-b-2xl py-[17px] min-[400px]:py-[19px] text-[16px] font-extrabold text-white antialiased shadow-[0_14px_40px_rgba(26,77,46,0.42),0_4px_12px_rgba(26,77,46,0.22),inset_0_1px_0_rgba(255,255,255,0.22)] transition-all hover:brightness-110 hover:shadow-[0_16px_44px_rgba(26,77,46,0.45)] active:scale-[0.98] active:brightness-95 min-[400px]:text-[17px]"
                        style={{ backgroundColor: '#1a4d2e' }}
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="opacity-[0.97] shrink-0">
                          <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                        </svg>
                        Add to Calendar
                      </button>

                      {(lastCalendarUrl || calendarSuccessTick > 0) && (
                        <div
                          className="mt-2 overflow-hidden rounded-xl border border-emerald-200/65 bg-emerald-50/95 px-3.5 py-2.5 ring-1 ring-emerald-100/80"
                          style={calendarSuccessTick > 0 ? { animation: 'calendarSuccessIn 0.5s cubic-bezier(0.22, 1, 0.36, 1) forwards' } : undefined}
                        >
                          <div className="flex items-center gap-2.5 text-[13px] font-semibold text-emerald-950">
                            <span
                              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white shadow-md"
                              style={calendarSuccessTick > 0 ? { animation: 'successIconPop 0.55s cubic-bezier(0.34, 1.2, 0.64, 1)' } : undefined}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8">
                                <path d="M20 6L9 17l-5-5"/>
                              </svg>
                            </span>
                            <span>Event created</span>
                          </div>
                          {lastCalendarUrl ? (
                            <a
                              href={lastCalendarUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-2 inline-flex items-center gap-1 rounded-lg text-[12px] font-semibold text-emerald-900 underline decoration-emerald-400/70 underline-offset-[3px] transition-opacity hover:opacity-80 active:opacity-70"
                            >
                              View in Calendar
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/>
                              </svg>
                            </a>
                          ) : null}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Context below fold — metadata de-prioritized */}
                <div className="mt-2.5 space-y-2.5">
                  {(result.contact || result.customer || result.location || result.crop || result.product) && (
                    <div className="rounded-lg border border-zinc-100/80 bg-zinc-50/40 px-2.5 py-1.5 opacity-[0.94]">
                      <p className="text-[7px] font-semibold uppercase tracking-[0.18em] text-zinc-400/75 mb-0.5">Visit</p>
                      <p className="truncate text-[10px] text-zinc-500/90">
                        {result.contact || '—'}
                        {result.customer ? <span className="text-zinc-400/85"> · {result.customer}</span> : null}
                      </p>
                      {(result.location || result.crop || result.product) && (
                        <p className="mt-0.5 line-clamp-2 text-[9px] leading-relaxed text-zinc-400/75">
                          {[result.location && `📍 ${result.location}`, result.crop && `🌱 ${result.crop}`, result.product && `🧪 ${result.product}`].filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </div>
                  )}

                  {result.summary && (
                    <div className="rounded-lg border border-zinc-100/80 bg-zinc-50/55 px-2.5 py-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                      <p className="text-[8px] font-semibold uppercase tracking-[0.14em] text-zinc-400/80 mb-0.5">Summary</p>
                      <p className="text-[11px] leading-snug text-zinc-500/88 line-clamp-6 sm:line-clamp-none">{result.summary}</p>
                    </div>
                  )}
                </div>

                {/* Secondary row — Copy CRM + Share + Correct */}
                <div className="mt-3.5 space-y-2">
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => { if (navigator.vibrate) navigator.vibrate(5); handleCopy() }}
                      className="flex h-[38px] flex-[1.12] items-center justify-center gap-1 rounded-[11px] border border-zinc-100/90 bg-zinc-50 text-[11px] font-normal text-zinc-400 transition-all hover:bg-zinc-100/90 hover:text-zinc-600 active:scale-[0.98]"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="opacity-55">
                        <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                      </svg>
                      {copied ? 'Copied' : 'Copy CRM'}
                    </button>
                    <button
                      onClick={() => result && handleShare(result)}
                      className="flex h-[38px] w-[46px] shrink-0 items-center justify-center rounded-[11px] border border-zinc-100/90 bg-white text-zinc-400 transition-all hover:border-zinc-200 hover:bg-zinc-50/80 hover:text-zinc-500 active:scale-[0.98]"
                      aria-label="Share"
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="opacity-75">
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
                        className="flex h-[38px] w-[46px] shrink-0 items-center justify-center rounded-[11px] border border-amber-200/70 bg-amber-600/88 text-white transition-all hover:bg-amber-600 active:scale-[0.98] active:bg-amber-700 shadow-[0_2px_6px_rgba(217,119,6,0.2)]"
                        aria-label="Correct"
                      >
                        {isCorrectingRecording ? (
                          <span className="flex items-center gap-1 text-white">
                            <span className="text-[10px] tabular-nums">{String(Math.floor(correctingSeconds/60)).padStart(2,'0')}:{String(correctingSeconds%60).padStart(2,'0')}</span>
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="white"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
                          </span>
                        ) : (
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                          </svg>
                        )}
                      </button>
                    )}
                  </div>
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

                <div className="space-y-3">
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

                  {selectedNote.result.summary && (
                    <div className="rounded-2xl border border-zinc-100 bg-white px-4 py-4 shadow-sm">
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-400">Summary</p>
                      <p className="text-[13px] leading-relaxed text-zinc-600">{selectedNote.result.summary}</p>
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
                        note.result.nextStep?.toLowerCase().includes(q)
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
        @keyframes pulse-bar {
          from { height: 3px; opacity: 0.5; }
          to   { height: 20px; opacity: 1; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes calendarSuccessIn {
          from { opacity: 0; transform: translateY(8px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes successIconPop {
          0% { transform: scale(0.5); opacity: 0.6; }
          55% { transform: scale(1.08); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes mic-ring-pulse {
          0%, 100% { transform: scale(1); opacity: 0.35; }
          50% { transform: scale(1.06); opacity: 0.55; }
        }
        @keyframes recording-timer-breathe {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.03); }
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
