'use client'

import {useEffect, useId, useRef, useState} from 'react'
import {signIn} from 'next-auth/react'
import {googleCalendarUrl, type CalendarDraft} from '../../lib/calendarDraft'
import {suggestCalendarSchedule} from '../../lib/calendarSuggestion'
import {saveCalendarFromClient} from '../../lib/calendarSaveClient'
import {GOOGLE_CALENDAR_SCOPE} from '../../lib/googleCalendarScope'

type Props = {
  initial: CalendarDraft
  actionNumber?: number
  disabled?: boolean
  onClarify?: () => void
  onOpen?: () => void
  evidence?: string
  referenceAt?: string
  now?: string
  noteId?: string
  actionIndex?: number
  ownerEmail?: string
}

/** Reset local scheduling edits when a corrected action replaces this draft. */
export default function CalendarFollowUp(props: Props) {
  return <CalendarFollowUpFields key={JSON.stringify([props.ownerEmail,props.noteId,props.actionIndex,props.initial])} {...props} />
}

function CalendarFollowUpFields({initial, actionNumber = 1, disabled = false, onClarify, onOpen, evidence, referenceAt, now, noteId, actionIndex = 0, ownerEmail}: Props) {
  const [suggestion] = useState(()=>suggestCalendarSchedule(initial,evidence,referenceAt,now))
  const [date, setDate] = useState(suggestion.date)
  const [time, setTime] = useState(suggestion.time)
  const [dateEdited, setDateEdited] = useState(false)
  const [timeEdited, setTimeEdited] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [busy,setBusy]=useState(false)
  const busyRef=useRef(false)
  const alive=useRef(true)
  const [connectionNeeded,setConnectionNeeded]=useState(false)
  const [savedUrl,setSavedUrl]=useState('')
  const [reviewUrl,setReviewUrl]=useState('')
  const [saveError,setSaveError]=useState('')
  const storageKey=`folup-calendar-draft:${ownerEmail || ''}:${noteId || ''}:${actionIndex}`
  const initialJson=JSON.stringify(initial)
  useEffect(()=>{
    alive.current=true
    try{
      const raw=sessionStorage.getItem(storageKey)
      if(raw){const pending=JSON.parse(raw)
        if(pending.initial===initialJson && Date.now()-pending.at<15*60_000 && typeof pending.date==='string' && typeof pending.time==='string'){
          setDate(pending.date);setTime(pending.time);setDateEdited(true);setTimeEdited(true)
        }
      }
    }catch{/* Storage is optional; the visible draft remains reviewable. */}
    return ()=>{alive.current=false}
  },[storageKey,initialJson])
  const dateInput = useRef<HTMLInputElement>(null)
  const timeInput = useRef<HTMLInputElement>(null)
  const hintId = useId()
  const draft = {...initial, date, time}
  const url = onClarify ? null : googleCalendarUrl(draft)
  const locked=disabled || busy || !!savedUrl || !!onClarify
  const problem = !date ? 'Choose a date for this follow-up.' : !time ? 'Choose a time for this follow-up.' :
    !initial.title.trim() ? 'Correct this action before adding it to your calendar.' :
    'Check the date, time and time zone. Times during a clock change may need adjusting.'
  const fieldClass = 'min-w-0 rounded-lg border border-zinc-200 bg-white p-1.5 text-sm disabled:opacity-50'
  const buttonClass = 'mt-3 block w-full rounded-xl bg-indigo-600 px-4 py-3 text-center text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-50'

  const save=async()=>{
    if(busyRef.current||savedUrl||disabled)return
    if(onClarify){onClarify();return}
    if(!url){setAttempted(true);const field=!date?dateInput.current:timeInput.current;field?.focus();field?.reportValidity();return}
    if(!noteId||!ownerEmail){setSaveError('Save this note before adding its follow-up.');return}
    busyRef.current=true;setBusy(true);setSaveError('');setReviewUrl('')
    try{
      if(connectionNeeded){
        try{sessionStorage.setItem(storageKey,JSON.stringify({initial:initialJson,date,time,at:Date.now()}))}catch{}
        await signIn('google',{redirectTo:`/?calendarNote=${encodeURIComponent(noteId)}`},{
          scope:`openid email profile ${GOOGLE_CALENDAR_SCOPE}`,access_type:'offline',prompt:'consent',login_hint:ownerEmail,
        })
        return
      }
      const response=await saveCalendarFromClient({noteId,actionIndex,draft})
      if(!alive.current)return
      if(response.kind==='connect'){setConnectionNeeded(true);return}
      if(response.kind==='error'){setSaveError(response.message);setReviewUrl(response.url || '');return}
      setSavedUrl(response.url)
      try{sessionStorage.removeItem(storageKey)}catch{}
      onOpen?.()
    }catch{if(alive.current)setSaveError('Could not confirm the event. Retry safely; Folup will not create a duplicate.')}
    finally{busyRef.current=false;if(alive.current)setBusy(false)}
  }
  return <div>
    <p className="mt-1 whitespace-pre-line text-sm text-gray-600">{initial.details}</p>
    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-600">
      <input ref={dateInput} aria-label={`Date for follow-up ${actionNumber}`} aria-describedby={!date ? hintId : undefined}
        type="date" required disabled={locked} value={date}
        onChange={event => {setDate(event.target.value); setDateEdited(true); setAttempted(false)}} className={fieldClass} />
      <input ref={timeInput} aria-label={`Time for follow-up ${actionNumber}`}
        type="time" required disabled={locked} value={time}
        onChange={event => {setTime(event.target.value); setTimeEdited(true); setAttempted(false)}} className={fieldClass} />
      {suggestion.timeSuggested && !timeEdited && <span>suggested</span>}
    </div>
    {suggestion.dateSuggested && !dateEdited && <p className="mt-1 text-xs text-gray-500">{suggestion.suggestionReason} · edit if needed.</p>}
    {!date && <p id={hintId} className="mt-1 text-xs text-gray-500">Date needed — choose it above.</p>}
    <button type="button" disabled={disabled || busy || !!savedUrl} className={buttonClass} onClick={()=>void save()}>
      {savedUrl?'Added ✓':busy?(connectionNeeded?'Connecting…':'Saving…'):connectionNeeded?'Connect Google Calendar':'Add to calendar'}
    </button>
    {connectionNeeded&&!savedUrl&&<p className="mt-2 text-xs text-gray-600">Connect once, then tap Add to calendar to save. No invitations are sent.</p>}
    {savedUrl&&<a className="mt-2 block text-center text-sm text-indigo-700 underline" href={savedUrl} target="_blank" rel="noopener noreferrer">Open in Google Calendar</a>}
    {saveError&&<p role="alert" className="mt-2 text-sm text-red-700">{saveError} {reviewUrl&&<a href={reviewUrl} target="_blank" rel="noopener noreferrer" className="underline">Review in Google Calendar</a>}</p>}
    {attempted && !url && !onClarify && <p role="alert" className="mt-2 text-sm text-red-700">{problem}</p>}
  </div>
}
