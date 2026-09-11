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
  const es = initial.language === 'Spanish'
  const edit = (field: keyof CalendarDraft, value: string) => {
    setDraft(d => ({...d,[field]:value})); setError('')
  }
  const fieldClass = 'mt-1 w-full rounded-xl border border-gray-300 p-3 text-base text-gray-900'
  return <dialog ref={dialog} onCancel={onClose} aria-labelledby="calendar-preview-title"
    className="m-auto max-h-[90dvh] w-[min(94vw,32rem)] overflow-y-auto rounded-2xl bg-white p-5 text-gray-900 backdrop:bg-black/40">
    <form onSubmit={event => {
      event.preventDefault()
      const url = googleCalendarUrl(draft)
      if (!url) { setError(es ? 'Revisa el título, la fecha y la hora.' : 'Check the title, date and time.'); return }
      const opened = window.open(url, '_blank')
      if (!opened) { setError(es ? 'Permite ventanas emergentes para abrir Google Calendar.' : 'Allow pop-ups to open Google Calendar.'); return }
      opened.opener = null
      onOpened(); onClose()
    }} className="space-y-4">
      <h2 id="calendar-preview-title" className="text-lg font-semibold">{es ? 'Revisar evento' : 'Review calendar event'}</h2>
      <p className="text-sm text-gray-600">{es ? 'Revisa los datos. El evento solo se guardará cuando pulses Guardar en Google Calendar.' : 'Review the details. The event is saved only when you click Save in Google Calendar.'}</p>
      <label className="block text-sm">{es ? 'Título' : 'Title'}<input autoFocus required className={fieldClass} value={draft.title} onChange={e => edit('title',e.target.value)} /></label>
      <label className="block text-sm">{es ? 'Descripción' : 'Description'}<textarea rows={5} className={fieldClass} value={draft.details} onChange={e => edit('details',e.target.value)} /></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">{es ? 'Fecha' : 'Date'}<input required type="date" className={fieldClass} value={draft.date} onChange={e => edit('date',e.target.value)} /></label>
        <label className="block text-sm">{es ? 'Hora (opcional)' : 'Time (optional)'}<input type="time" className={fieldClass} value={draft.time} onChange={e => edit('time',e.target.value)} /></label>
      </div>
      <p className="text-xs text-gray-600">{draft.time ? (es ? 'Duración: 30 minutos.' : 'Duration: 30 minutes.') : (es ? 'Sin hora: evento de todo el día.' : 'No time: all-day event.')} {draft.timezone}</p>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex justify-end gap-3">
        <button type="button" onClick={onClose} className="rounded-xl px-4 py-3">{es ? 'Cancelar' : 'Cancel'}</button>
        <button type="submit" className="rounded-xl bg-indigo-600 px-4 py-3 text-white">{es ? 'Abrir Google Calendar' : 'Open Google Calendar'}</button>
      </div>
    </form>
  </dialog>
}
