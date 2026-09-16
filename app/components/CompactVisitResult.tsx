'use client'

import {useState} from 'react'
import {calendarDraftFromAction,type CalendarDraft} from '../../lib/calendarDraft'
import {visitActionFields,type VisitExtraction} from '../../lib/visitExtraction'

export default function CompactVisitResult({extraction,timezone,onCalendar,onCopy,onVoice,onClarify,recording,voiceDisabled,saving,onRetrySave,onNew}: {
  extraction:VisitExtraction;timezone:string;onCalendar:(draft:CalendarDraft)=>void;onCopy:()=>Promise<void>;
  onVoice:()=>void;onClarify:()=>void;recording:boolean;voiceDisabled:boolean;saving?:string;onRetrySave?:()=>void;onNew?:()=>void
}) {
  const es=extraction.language==='Spanish'
  const [copied,setCopied]=useState(false)
  const [error,setError]=useState('')
  const [times,setTimes]=useState<Record<number,string>>({})
  const actions=extraction.actions.map((action,index)=>({action,index})).sort((a,b)=>(a.action.date||'9999').localeCompare(b.action.date||'9999')||a.index-b.index)
  return <section className="space-y-5" aria-label={es?'Resultado de la visita':'Visit result'}>
    <header className="flex items-start justify-between gap-3">
      <p className="text-sm text-gray-600">{[extraction.contacts.join(', '),extraction.companies.join(', ')].filter(Boolean).join(' · ')}</p>
      {onNew && <button type="button" disabled={saving==='saving' || recording} onClick={onNew} className="shrink-0 text-sm text-indigo-700 disabled:opacity-50">{es?'Nueva nota':'New note'}</button>}
    </header>
    <div className="space-y-3">
      {actions.length===0 && <p className="text-base text-gray-600">{es?'Sin seguimiento acordado.':'No follow-up agreed.'}</p>}
      {actions.map(({action,index})=>{
        const initial=calendarDraftFromAction(visitActionFields(action,extraction.language),extraction.language,timezone)
        const draft={...initial,time:times[index]??initial.time}
        return <article key={index} className="rounded-2xl border border-zinc-200 bg-white p-4">
          <p className="text-base font-semibold text-gray-900">{draft.title}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-600">
            <span>{draft.date ? new Intl.DateTimeFormat(es?'es-ES':'en-US',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(draft.date+'T12:00:00Z')) : (es?'Fecha pendiente':'Date needed')}</span>
            <input aria-label={`${es?'Hora para':'Time for'} ${draft.title}`} type="time" required value={draft.time} onChange={e=>setTimes(prev=>({...prev,[index]:e.target.value}))} className="rounded-lg border border-zinc-200 bg-white p-1.5 text-sm" />
            {initial.timeSuggested && times[index]===undefined && <span>{es?'sugerida':'suggested'}</span>}
          </div>
          <button type="button" disabled={recording} onClick={()=>onCalendar(draft)} className="mt-3 w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{es?'Añadir al calendario':'Add to calendar'}</button>
        </article>
      })}
    </div>
    {extraction.insights.length>0 && <ul aria-label="Key insights" className="space-y-2 text-sm leading-relaxed text-gray-700">{extraction.insights.slice(0,4).map((line,i)=><li key={i}>💡 {line.replace(/^[💡📌⚠️🌱]\s*/u,'')}</li>)}</ul>}
    {extraction.questions.length>0 && <button type="button" onClick={onClarify} className="text-sm text-amber-800 underline">{es?'Revisar datos pendientes':'Review unclear details'}</button>}
    <footer className="grid grid-cols-2 gap-2 border-t border-zinc-100 pt-4">
      <button type="button" onClick={async()=>{try{await onCopy();setCopied(true);setError('')}catch{setError(es?'No se pudo copiar. Inténtalo otra vez.':'Could not copy. Please retry.')}}} className="rounded-xl bg-indigo-600 px-3 py-3 text-sm font-semibold text-white">{copied?(es?'Copiado':'Copied'):(es?'Copiar al CRM':'Copy to CRM')}</button>
      <button type="button" disabled={voiceDisabled} onClick={onVoice} className={`rounded-xl border px-3 py-3 text-sm font-semibold disabled:opacity-50 ${recording?'border-red-300 bg-red-50 text-red-700':'border-zinc-200 text-gray-700'}`}>{recording?(es?'Terminar corrección':'Finish correction'):(es?'Corregir hablando':'Correct by voice')}</button>
    </footer>
    {saving==='saving' && <p role="status" className="text-sm text-gray-500">{es?'Guardando…':'Saving…'}</p>}
    {saving==='error' && <p role="alert" className="text-sm text-red-700">{es?'No se ha guardado. Mantén abierta esta página.':'Not saved. Keep this page open.'} <button onClick={onRetrySave} className="underline">{es?'Reintentar':'Retry'}</button></p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </section>
}
