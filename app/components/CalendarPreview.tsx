'use client'

import { useEffect, useRef, useState } from 'react'
import { googleCalendarUrl, type CalendarDraft } from '../../lib/calendarDraft'

export default function CalendarPreview({ initial, onClose, onOpened }: {
  initial: CalendarDraft; onClose: () => void; onOpened: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [draft, setDraft] = useState(initial)
  const [error, setError] = useState('')
  useEffect(() => { dialog.current?.showModal() }, [])
  const edit = (field: keyof CalendarDraft, value: string) => {
    setDraft(d => ({...d,[field]:value,...(field==='time'?{timeSuggested:false}:{})})); setError('')
  }
  const fieldClass = 'mt-1 w-full rounded-xl border border-gray-300 p-3 text-base text-gray-900'
  return <dialog ref={dialog} onCancel={onClose} aria-labelledby="calendar-preview-title"
    className="m-auto max-h-[90dvh] w-[min(94vw,32rem)] overflow-y-auto rounded-2xl bg-white p-5 text-gray-900 backdrop:bg-black/40">
    <form onSubmit={event => {
      event.preventDefault()
      const url = googleCalendarUrl(draft)
      if (!url) { setError('Check the title, date and time.'); return }
      const opened = window.open(url, '_blank')
      if (!opened) { setError('Allow pop-ups to open Google Calendar.'); return }
      opened.opener = null
      onOpened(); onClose()
    }} className="space-y-4">
      <h2 id="calendar-preview-title" className="text-lg font-semibold">Review calendar event</h2>
      <p className="text-sm text-gray-600">Review the details. The event is saved only when you click Save in Google Calendar.</p>
      <label className="block text-sm">Title<input autoFocus required className={fieldClass} value={draft.title} onChange={e => edit('title',e.target.value)} /></label>
      <label className="block text-sm">Description<textarea rows={5} className={fieldClass} value={draft.details} onChange={e => edit('details',e.target.value)} /></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">Date<input required type="date" className={fieldClass} value={draft.date} onChange={e => edit('date',e.target.value)} /></label>
        <label className="block text-sm">Time<input required type="time" className={fieldClass} value={draft.time} onChange={e => edit('time',e.target.value)} /></label>
      </div>
      {draft.timeSuggested && <p className="text-sm text-amber-800">{draft.time} suggested from the stated time of day; without one we use 09:00. You can change it.</p>}
      <p className="text-sm text-gray-600">Duration: 30 minutes. {draft.timezone}</p>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex justify-end gap-3">
        <button type="button" onClick={onClose} className="rounded-xl px-4 py-3">Cancel</button>
        <button type="submit" className="rounded-xl bg-indigo-600 px-4 py-3 text-white">Open Google Calendar</button>
      </div>
    </form>
  </dialog>
}
