'use client'
import {useEffect,useState} from 'react'

export default function AudioRecovery({blob,busy,onRetry,onDiscard}: {
  blob:Blob;busy:boolean;onRetry:()=>void;onDiscard:()=>void
}) {
  const [url,setUrl]=useState('')
  useEffect(()=>{
    const next=URL.createObjectURL(blob);setUrl(next)
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue=''}
    window.addEventListener('beforeunload',warn)
    return ()=>{URL.revokeObjectURL(next);window.removeEventListener('beforeunload',warn)}
  },[blob])
  const extension=blob.type.includes('mp4')?'m4a':blob.type.includes('ogg')?'ogg':'webm'
  return <section aria-label="Recover recording" className="mt-4 w-full max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-gray-900">
    <h2 className="font-semibold">Your recording is still here</h2>
    <p className="mt-1">Retry without recording again, or download a copy. This audio is kept only in this tab; download it before closing or refreshing.</p>
    <div className="mt-3 flex flex-wrap gap-3">
      <button type="button" disabled={busy} onClick={onRetry} className="rounded-xl bg-indigo-600 px-4 py-3 text-white disabled:opacity-50">Retry recording</button>
      {url && <a href={url} download={`folup-recording.${extension}`} className="rounded-xl border border-gray-300 px-4 py-3">Download audio</a>}
      <button type="button" disabled={busy} onClick={()=>{if(window.confirm('Discard this recording? Download it first if you want to keep a copy.'))onDiscard()}} className="px-2 py-3 text-gray-600">Discard recording</button>
    </div>
  </section>
}
