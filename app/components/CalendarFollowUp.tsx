'use client'

import {useId, useRef, useState} from 'react'
import {googleCalendarUrl, type CalendarDraft} from '../../lib/calendarDraft'

type Props = {
  initial: CalendarDraft
  actionNumber?: number
  disabled?: boolean
  onClarify?: () => void
  onOpen?: () => void
}

/** Reset local scheduling edits when a corrected action replaces this draft. */
export default function CalendarFollowUp(props: Props) {
  return <CalendarFollowUpFields key={JSON.stringify(props.initial)} {...props} />
}

function CalendarFollowUpFields({initial, actionNumber = 1, disabled = false, onClarify, onOpen}: Props) {
  const [date, setDate] = useState(initial.date)
  const [time, setTime] = useState(initial.time)
  const [timeEdited, setTimeEdited] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const dateInput = useRef<HTMLInputElement>(null)
  const timeInput = useRef<HTMLInputElement>(null)
  const hintId = useId()
  const draft = {...initial, date, time}
  const url = onClarify ? null : googleCalendarUrl(draft)
  const problem = !date ? 'Choose a date for this follow-up.' : !time ? 'Choose a time for this follow-up.' :
    !initial.title.trim() ? 'Correct this action before adding it to your calendar.' :
    'Check the date, time and time zone. Times during a clock change may need adjusting.'
  const fieldClass = 'min-w-0 rounded-lg border border-zinc-200 bg-white p-1.5 text-sm disabled:opacity-50'
  const buttonClass = 'mt-3 block w-full rounded-xl bg-indigo-600 px-4 py-3 text-center text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-50'

  return <div>
    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-600">
      <input ref={dateInput} aria-label={`Date for follow-up ${actionNumber}`} aria-describedby={!date ? hintId : undefined}
        type="date" required disabled={disabled || !!onClarify} value={date}
        onChange={event => {setDate(event.target.value); setAttempted(false)}} className={fieldClass} />
      <input ref={timeInput} aria-label={`Time for follow-up ${actionNumber}`}
        type="time" required disabled={disabled || !!onClarify} value={time}
        onChange={event => {setTime(event.target.value); setTimeEdited(true); setAttempted(false)}} className={fieldClass} />
      {initial.timeSuggested && !timeEdited && <span>suggested</span>}
    </div>
    {!date && <p id={hintId} className="mt-1 text-xs text-gray-500">Date needed — choose it above.</p>}
    {url && !disabled ? (
      // A real link works in mobile/in-app browsers without window.open's unreliable
      // popup return value. Google is the only event review/save screen.
      <a href={url} target="_blank" rel="noopener noreferrer" onClick={onOpen} className={buttonClass}>Add to calendar</a>
    ) : (
      <button type="button" disabled={disabled} className={buttonClass} onClick={() => {
        if (onClarify) {onClarify(); return}
        setAttempted(true)
        const input = !date ? dateInput.current : timeInput.current
        input?.focus()
        input?.reportValidity()
      }}>Add to calendar</button>
    )}
    {attempted && !url && !onClarify && <p role="alert" className="mt-2 text-sm text-red-700">{problem}</p>}
  </div>
}
