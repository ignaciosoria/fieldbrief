'use client'
import { useEffect, useRef, useState } from 'react'
import type { VisitExtraction, VisitQuestion } from '../../lib/visitExtraction'

export default function VisitClarification({extraction,question,onConfirm,onSkip}: {
  extraction:VisitExtraction; question:VisitQuestion; onConfirm:(answer:string)=>Promise<void>; onSkip:()=>void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [value,setValue] = useState('')
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  useEffect(() => { dialog.current?.showModal() }, [])
  const es = extraction.language === 'Spanish'
  return <dialog ref={dialog} onCancel={e => {if(busy)e.preventDefault();else onSkip()}} aria-labelledby="visit-question-title" className="m-auto w-[min(94vw,30rem)] rounded-2xl bg-white p-5 text-gray-900 backdrop:bg-black/40">
    <form className="space-y-4" onSubmit={async e => {
      e.preventDefault(); if(busy)return; setBusy(true);setError('')
      try {await onConfirm(value)} catch {setError(es ? 'No se pudo aplicar la respuesta. Sigue aquí; puedes reintentar.' : 'Could not apply the answer. It is still here; you can retry.')} finally {setBusy(false)}
    }}>
      <h2 id="visit-question-title" className="text-lg font-semibold">{question.question}</h2>
      {question.action_index >= 0 && <p className="text-sm text-gray-600">“{extraction.actions[question.action_index].evidence}”</p>}
      <label className="block text-sm">{es ? 'Tu respuesta' : 'Your answer'}<input autoFocus required value={value} onChange={e=>setValue(e.target.value)} type={question.field === 'date' ? 'date' : question.field === 'time' ? 'time' : 'text'} className="mt-1 w-full rounded-xl border border-gray-300 p-3 text-base" /></label>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex justify-end gap-3"><button disabled={busy} type="button" onClick={onSkip} className="rounded-xl px-4 py-3">{es ? 'Dejar pendiente' : 'Leave unresolved'}</button><button disabled={busy} type="submit" className="rounded-xl bg-indigo-600 px-4 py-3 text-white disabled:opacity-50">{busy ? (es ? 'Aplicando…' : 'Applying…') : (es ? 'Confirmar' : 'Confirm')}</button></div>
    </form>
  </dialog>
}
