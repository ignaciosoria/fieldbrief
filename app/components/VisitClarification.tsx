'use client'
import { useEffect, useRef, useState } from 'react'
import type { VisitExtraction, VisitQuestion } from '../../lib/visitExtraction'

export default function VisitClarification({extraction,question,onConfirm,onSkip,onCopyPending,savePending=false}: {
  extraction:VisitExtraction; question:VisitQuestion; onConfirm:(answer:string)=>Promise<void>; onSkip:()=>Promise<void>
  onCopyPending?:()=>Promise<void>
  savePending?:boolean
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [value,setValue] = useState('')
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  useEffect(() => { dialog.current?.showModal() }, [])
  const leaveUnresolved = async () => {
    if (busy) return
    setBusy(true); setError('')
    try { await onSkip() } catch(err) {
      setError(err instanceof Error?err.message:'Could not save the changes. Your answers are still here; you can retry.')
    } finally { setBusy(false) }
  }
  return <dialog ref={dialog} onCancel={e => {e.preventDefault();void leaveUnresolved()}} aria-labelledby="visit-question-title" className="m-auto w-[min(94vw,30rem)] rounded-2xl bg-white p-5 text-gray-900 backdrop:bg-black/40">
    <form className="space-y-4" onSubmit={async e => {
      e.preventDefault(); if(busy)return; setBusy(true);setError('')
      try {await onConfirm(value)} catch(err) {setError(err instanceof Error?err.message:'Could not apply the answer. It is still here; you can retry.')} finally {setBusy(false)}
    }}>
      <h2 id="visit-question-title" lang={extraction.language==='Spanish'?'es':'en'} className="text-lg font-semibold">{question.question}</h2>
      {question.action_index >= 0 && <p lang={extraction.language==='Spanish'?'es':'en'} className="text-sm text-gray-600">“{extraction.actions[question.action_index].evidence}”</p>}
      <label className="block text-sm">Your answer<input autoFocus required disabled={busy || savePending} value={value} onChange={e=>setValue(e.target.value)} type={question.field === 'date' ? 'date' : question.field === 'time' ? 'time' : 'text'} className="mt-1 w-full rounded-xl border border-gray-300 p-3 text-base" /></label>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {error && onCopyPending && <button type="button" className="text-sm underline" onClick={async()=>{
        try{await onCopyPending();setError('Pending correction copied. You can reload the latest note.')}catch{setError('Could not copy. Keep this page open and retry.')}
      }}>Copy pending correction</button>}
      <div className="flex justify-end gap-3"><button disabled={busy} type="button" onClick={() => {void leaveUnresolved()}} className="rounded-xl px-4 py-3">{savePending?'Retry saving':'Leave unresolved'}</button>{!savePending && <button disabled={busy} type="submit" className="rounded-xl bg-indigo-600 px-4 py-3 text-white disabled:opacity-50">{busy ? 'Applying…' : 'Confirm'}</button>}</div>
    </form>
  </dialog>
}
