'use client'

import {useState} from 'react'
import {calendarDraftFromAction} from '../../lib/calendarDraft'
import CalendarFollowUp from './CalendarFollowUp'
import {visitActionFields,type VisitExtraction} from '../../lib/visitExtraction'
import {insightPresentation} from '../../lib/insightPresentation'

export default function CompactVisitResult({extraction,timezone,referenceAt,noteId,ownerEmail,onCalendarOpened,onCopy,onVoice,onClarify,recording,voiceDisabled,saving,onRetrySave,onNew}: {
  extraction:VisitExtraction;timezone:string;onCalendarOpened:()=>void;onCopy:()=>Promise<void>;
  onVoice:()=>void;onClarify:(actionIndex?:number)=>void;recording:boolean;voiceDisabled:boolean;saving?:string;onRetrySave?:()=>void;onNew?:()=>void
  referenceAt?:string
  noteId?:string;ownerEmail?:string
}) {
  const [copied,setCopied]=useState(false)
  const [error,setError]=useState('')
  const actions=extraction.actions.map((action,index)=>({action,index})).sort((a,b)=>(a.action.date||'9999').localeCompare(b.action.date||'9999')||a.index-b.index)
  return <section className="space-y-5" aria-label="Visit result" lang="en">
    <header className="flex items-start justify-between gap-3">
      <p className="text-sm text-gray-600">{[extraction.contacts.join(', '),extraction.companies.join(', ')].filter(Boolean).join(' · ')}</p>
      {onNew && <button type="button" disabled={saving==='saving' || recording} onClick={onNew} className="shrink-0 text-sm text-indigo-700 disabled:opacity-50">New note</button>}
    </header>
    <div className="space-y-3">
      {actions.length===0 && <p className="text-base text-gray-600">No follow-up agreed.</p>}
      {actions.map(({action,index})=>{
        const initial=calendarDraftFromAction(visitActionFields(action,extraction.language),extraction.language,timezone)
        return <article key={index} className="rounded-2xl border border-zinc-200 bg-white p-4">
          <p lang={extraction.language==='Spanish'?'es':'en'} className="text-base font-semibold text-gray-900">{initial.title}</p>
          <CalendarFollowUp initial={initial} actionNumber={index+1} disabled={recording}
            noteId={noteId} actionIndex={index} ownerEmail={ownerEmail}
            evidence={action.evidence} referenceAt={referenceAt}
            onOpen={onCalendarOpened} onClarify={extraction.questions.some(q=>q.action_index===index && q.field!=='date' && q.field!=='time')?()=>onClarify(index):undefined} />
        </article>
      })}
    </div>
    {extraction.insights.length>0 && <ul aria-label="Key insights" className="space-y-2 text-sm leading-relaxed text-gray-700">{extraction.insights.slice(0,4).map((line,i)=>{const insight=insightPresentation(line);return <li lang={extraction.language==='Spanish'?'es':'en'} key={i}><span aria-hidden="true">{insight.icon}</span> {insight.text}</li>})}</ul>}
    {extraction.questions.length>0 && <button type="button" onClick={()=>onClarify()} className="text-sm text-amber-800 underline">Review unclear details</button>}
    <footer className="grid grid-cols-2 gap-2 border-t border-zinc-100 pt-4">
      <button type="button" onClick={async()=>{try{await onCopy();setCopied(true);setError('')}catch{setError('Could not copy. Please retry.')}}} className="rounded-xl bg-indigo-600 px-3 py-3 text-sm font-semibold text-white">{copied?'Copied':'Copy to CRM'}</button>
      <button type="button" disabled={voiceDisabled} onClick={onVoice} className={`rounded-xl border px-3 py-3 text-sm font-semibold disabled:opacity-50 ${recording?'border-red-300 bg-red-50 text-red-700':'border-zinc-200 text-gray-700'}`}>{recording?'Finish correction':'Correct by voice'}</button>
    </footer>
    {saving==='saving' && <p role="status" className="text-sm text-gray-500">Saving…</p>}
    {saving==='error' && <p role="alert" className="text-sm text-red-700">Not saved. Keep this page open. <button onClick={onRetrySave} className="underline">Retry</button></p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </section>
}
