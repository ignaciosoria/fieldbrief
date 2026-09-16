'use client'
import { useState } from 'react'

export default function VisitSummary({text,language,hasQuestions,onClarify,onCorrect,onVoiceCorrect,voiceDisabled,voiceRecording}: {
  text:string;language:string;hasQuestions:boolean;onClarify:()=>void;onCorrect:(correction:string)=>Promise<void>;onVoiceCorrect?:()=>void;voiceDisabled?:boolean;voiceRecording?:boolean
}) {
  const [correction,setCorrection] = useState('')
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  return <section className="rounded-2xl border border-zinc-200 bg-white p-4">
    <h2 className="mb-3 text-sm font-semibold">CRM note</h2>
    <p lang={language==='Spanish'?'es':'en'} className="whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-700">{text}</p>
    {onVoiceCorrect && <button type="button" disabled={busy || voiceDisabled} onClick={onVoiceCorrect} className={`mt-4 rounded-xl px-4 py-3 text-base font-semibold text-white disabled:opacity-50 ${voiceRecording?'bg-red-600':'bg-indigo-600'}`}>{voiceRecording ? 'Finish correction' : 'Correct by voice'}</button>}
    {onVoiceCorrect && <p className="mt-2 text-sm text-gray-600">Updates the note, actions and event drafts before adding them to your calendar.</p>}
    {hasQuestions && <button type="button" onClick={onClarify} className="mt-3 rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-900">Resolve unclear details</button>}
    <details className="mt-4 border-t border-zinc-100 pt-3">
      <summary className="cursor-pointer text-sm font-semibold text-indigo-700">Correct in writing</summary>
      <form className="mt-3 space-y-3" onSubmit={async e=>{
        e.preventDefault();if(busy)return;setBusy(true);setError('')
        try {await onCorrect(correction);setCorrection('')} catch {setError('Could not apply. Your correction is still here to retry.')} finally {setBusy(false)}
      }}>
        <label className="block text-sm">What should change?
          <textarea required disabled={busy} value={correction} maxLength={2000} onChange={e=>setCorrection(e.target.value)} rows={3} className="mt-1 w-full rounded-xl border border-gray-300 p-3 text-base" placeholder="For example: the name is Maria and the call is on Thursday." />
        </label>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <button disabled={busy || !correction.trim()} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Applying…' : 'Apply correction'}</button>
      </form>
    </details>
  </section>
}
