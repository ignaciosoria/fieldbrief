'use client'
import {useEffect,useRef,useState} from 'react'
import {signIn,useSession} from 'next-auth/react'
import Link from 'next/link'
import {useRouter} from 'next/navigation'
import {FolupHeaderBrand} from '../../components/folup-branding'
import VisitMicrophone from './VisitMicrophone'
import TrialSignInDialog from './TrialSignInDialog'
import CompactVisitResult from './CompactVisitResult'
import PublicDemo from './PublicDemo'
import type {visitExtractionResult} from '../../lib/visitExtraction'
import type {CalendarDraft} from '../../lib/calendarDraft'
import {formatProfessionalCrmNote} from '../../lib/formatCrmSalesNote'
import {fetchWithTimeout} from '../../lib/fetchWithTimeout'
import {initPosthog,track,trackSigninStart} from '../../lib/posthog'

type Preview={previewId:string;note:string;result:ReturnType<typeof visitExtractionResult>;noteId?:string}
export default function LiveTry(){
  const {data:session,status}=useSession()
  const router=useRouter()
  const [text,setText]=useState(''),[preview,setPreview]=useState<Preview|null>(null)
  const [enabled,setEnabled]=useState(false),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false)
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[examples,setExamples]=useState(false)
  const [recording,setRecording]=useState(false),[audio,setAudio]=useState<Blob|null>(null)
  const [drafts,setDrafts]=useState<Record<number,CalendarDraft>>({})
  const [showSignIn,setShowSignIn]=useState(false),[seconds,setSeconds]=useState(0)
  const recorder=useRef<MediaRecorder|null>(null),stream=useRef<MediaStream|null>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null)
  const locked=useRef(false),alive=useRef(true)
  const signin=()=>{trackSigninStart();void signIn('google',{callbackUrl:'/try'})}
  const load=async()=>{
    const response=await fetchWithTimeout('/api/try',{cache:'no-store'},15000)
    const data=await response.json();if(!response.ok)throw Error(data.error)
    if(!alive.current)return
    setEnabled(data.enabled)
    if(data.result){setPreview(data);try{setDrafts(JSON.parse(sessionStorage.getItem('folup-try-drafts:'+data.previewId)||'{}'))}catch{}}
    if(data.state==='running')setNotice('Your note is still processing. Use “Check result” in a moment.')
    if(data.state==='expired'||data.state==='used')setNotice('This preview has ended. Sign in to process more visits.')
  }
  useEffect(()=>{
    alive.current=true;initPosthog()
    void load().catch(()=>{if(alive.current)setError('Could not load the preview. Please retry.')}).finally(()=>{if(alive.current)setLoading(false)})
    return()=>{alive.current=false;if(timer.current)clearTimeout(timer.current);if(recorder.current?.state==='recording')recorder.current.stop();stream.current?.getTracks().forEach(t=>t.stop())}
  // Reload on OAuth return, not on unrelated session renders.
  },[])
  useEffect(()=>{if(!recording)return;setSeconds(0);const interval=setInterval(()=>setSeconds(n=>n+1),1000);return()=>clearInterval(interval)},[recording])
  const process=async(recorded?:Blob)=>{
    if(locked.current)return;locked.current=true;setBusy(true);setError('');setNotice('')
    try{
      const timezone=Intl.DateTimeFormat().resolvedOptions().timeZone
      let body:BodyInit,headers:Record<string,string>|undefined
      const recordingBlob=recorded||audio
      if(recordingBlob){const form=new FormData();form.set('file',recordingBlob,recordingBlob.type.includes('mp4')?'visit.mp4':'visit.webm');form.set('timezone',timezone);body=form}
      else{body=JSON.stringify({note:text,timezone});headers={'Content-Type':'application/json'}}
      const response=await fetchWithTimeout('/api/try',{method:'POST',headers,body},155000)
      const data=await response.json();if(!response.ok)throw Error(data.error)
      if(alive.current){setPreview(data);setAudio(null);track('demo_completed')}
    }catch(e){if(alive.current)setError(e instanceof Error?e.message:'Could not process this visit.')}
    finally{locked.current=false;if(alive.current)setBusy(false)}
  }
  const toggleRecording=async()=>{
    if(recording){recorder.current?.stop();return}
    if(locked.current)return;locked.current=true;setError('')
    try{
      const media=await navigator.mediaDevices.getUserMedia({audio:true});stream.current=media
      if(!alive.current){media.getTracks().forEach(t=>t.stop());return}
      const r=new MediaRecorder(media,{audioBitsPerSecond:64000});recorder.current=r;const chunks:Blob[]=[]
      r.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)}
      r.onstop=()=>{if(timer.current)clearTimeout(timer.current);media.getTracks().forEach(t=>t.stop());if(alive.current){const blob=new Blob(chunks,{type:r.mimeType});setAudio(blob);setRecording(false);void process(blob)}}
      r.onerror=()=>{media.getTracks().forEach(t=>t.stop());if(alive.current){setRecording(false);setError('Recording interrupted. You can paste your recap instead.')}}
      r.start(1000);setRecording(true);setAudio(null)
      timer.current=setTimeout(()=>{if(r.state==='recording')r.stop()},180000)
    }catch{setError('Microphone unavailable. Allow microphone access or paste your recap below.')}
    finally{locked.current=false}
  }
  const keep=async()=>{
    if(status!=='authenticated'){setShowSignIn(true);return}
    if(locked.current||!preview)return
    if(preview.noteId){router.push('/?calendarNote='+preview.noteId);return}
    locked.current=true;setBusy(true);setError('')
    try{
      const response=await fetchWithTimeout('/api/try/claim',{method:'POST'},20000);const data=await response.json()
      if(!response.ok)throw Error(data.error)
      setPreview({...preview,noteId:data.noteId});setNotice('Visit saved. Tap Add to calendar again to connect your calendar or save the event.')
    }catch(e){setError(e instanceof Error?e.message:'Could not save your visit.')}
    finally{locked.current=false;setBusy(false)}
  }
  if(examples)return <><button className="block w-full bg-white p-3 text-sm text-indigo-700" onClick={()=>setExamples(false)}>Back to your own visit</button><PublicDemo onSignIn={signin} onStart={()=>track('demo_started')} onComplete={()=>track('demo_completed')}/></>
  return <main className="folup-shell flex min-h-screen flex-col bg-white text-[#111111] antialiased">
    <header className="folup-header relative flex items-center justify-between border-b border-[#e5e7eb] bg-white px-5 pb-2 pt-8">
      <Link href="/" aria-label="Folup home"><FolupHeaderBrand/></Link>
      {session?<Link href="/" className="text-sm text-indigo-700">Go to app</Link>:<button disabled={busy||recording} onClick={()=>setShowSignIn(true)} className="rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm">Sign in</button>}
    </header>
    <div className="flex-1 px-5 pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))]">
      {preview?<div className="pt-2">
        <CompactVisitResult extraction={preview.result.extraction} timezone={preview.result.noteTimezone} referenceAt={preview.result.capturedAt}
          rawText={preview.note} noteId={preview.noteId} noteVersion={preview.noteId?1:undefined} ownerEmail={session?.user?.email||undefined}
          recording={false} voiceDisabled={busy} saving={busy?'saving':undefined} initialDrafts={drafts}
          onCalendarOpened={()=>setNotice('Added to Google Calendar.')} onVoice={()=>void keep()} onClarify={()=>void keep()}
          onCalendarGate={!preview.noteId?(index,draft)=>{const next={...drafts,[index]:draft};setDrafts(next);try{sessionStorage.setItem('folup-try-drafts:'+preview.previewId,JSON.stringify(next))}catch{}void keep()}:undefined}
          onCopy={async(research='',schedules)=>{await navigator.clipboard.writeText(formatProfessionalCrmNote(preview.result,schedules)+research)}}/>

      </div>:<div className="flex flex-col items-center justify-center px-4 py-5" style={{minHeight:'var(--folup-record-height, calc(100vh - 132px))'}}>
        <p className="mb-6 max-w-[22rem] text-center text-sm leading-relaxed text-gray-500">Tell Folup what happened. See what to do next.</p>
        <h1 className="mb-6 text-center text-2xl font-bold leading-tight tracking-tight text-[#111111] sm:text-[1.65rem]">Tap to record your visit</h1>
        <VisitMicrophone isRecording={recording} processingBusy={busy} disabled={loading||busy||!!audio} onClick={()=>{if(!enabled){setNotice('Live preview is not enabled yet.');return}void toggleRecording()}}/>
        <div className="mb-2 flex min-h-[44px] items-center justify-center">
          {recording&&<span className="text-[48px] font-semibold tabular-nums">{Math.floor(seconds/60)}:{String(seconds%60).padStart(2,'0')}</span>}
          {busy&&<p role="status" className="text-sm text-gray-500">Preparing your next steps…</p>}
        </div>
        {!recording&&!busy&&!audio&&<div className="mt-1.5 w-full max-w-md px-1">
          <textarea aria-label="Visit note" className="mb-3 min-h-[68px] w-full resize-none rounded-2xl border border-[#e5e7eb] bg-[#f8f8f8] px-3.5 py-3 text-[13px] leading-relaxed text-[#111111] outline-none placeholder:text-[#6b7280]/40 shadow-inner shadow-zinc-200/50" placeholder="Or type a note…" maxLength={20000} value={text} onChange={e=>setText(e.target.value)}/>
          {text.trim()&&<button onClick={()=>{if(!enabled){setNotice('Live preview is not enabled yet.');return}track('demo_started');void process()}} disabled={loading} className="w-full rounded-2xl bg-[#4F46E5] py-4 text-[15px] font-semibold text-white shadow-md">Process Note</button>}
        </div>}
        {audio&&!busy&&<button onClick={()=>void process()} className="mt-4 text-sm text-indigo-700 underline">Retry recording</button>}
        <details className="mt-3 text-center text-xs text-gray-500"><summary className="cursor-pointer">About your recording</summary><p className="mt-2 max-w-xs leading-relaxed">Your recap is processed by our AI providers. The preview is available for 24 hours. Avoid sensitive information.</p></details>
      </div>}
      {notice&&<p role="status" className="mt-4 text-sm text-gray-600">{notice}</p>}
      {error&&<p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
      {(error||notice)&&!busy&&<button className="mt-3 text-sm text-indigo-700" onClick={()=>{setError('');void load().catch(()=>setError('Could not load the result. Please retry.'))}}>Check result</button>}
      <button disabled={busy||recording} onClick={()=>setExamples(true)} className="mx-auto mt-4 block text-xs text-indigo-700">Explore an example</button>
    </div>
    <nav className="folup-bottom-nav fixed bottom-0 left-0 right-0 flex items-center justify-around border-t border-[#e5e7eb] bg-white/95 px-2 pb-safe pt-2 backdrop-blur-md">
      {['Record','History','Settings'].map((label,i)=><button key={label} onClick={()=>{if(i===0)return;if(session)router.push('/');else setShowSignIn(true)}} className="relative flex flex-col items-center gap-1 px-5 py-2 transition-all" style={{color:i===0?'#4F46E5':'#6b7280'}}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill={i===0?'currentColor':'none'} stroke={i===0?'none':'currentColor'} strokeWidth="1.8" aria-hidden="true">
          {i===0?<><path d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4z"/><path d="M19 10a1 1 0 0 0-2 0 5 5 0 0 1-10 0 1 1 0 0 0-2 0 7 7 0 0 0 6 6.92V19H9a1 1 0 0 0 0 2h6a1 1 0 0 0 0-2h-2v-2.08A7 7 0 0 0 19 10z"/></>:i===1?<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>:<><circle cx="12" cy="12" r="3"/><path d="M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z"/></>}
        </svg><span className="text-[10px] font-medium">{label}</span>
      </button>)}
    </nav>
    {showSignIn&&<TrialSignInDialog onSignIn={signin} onClose={()=>setShowSignIn(false)}/>}
    <style jsx global>{`
      @keyframes mic-ring-pulse { 0%,100% {opacity:.55} 50% {opacity:.88} }
      @keyframes mic-idle-glow { 0%,100% {box-shadow:0 0 0 0 rgba(79,70,229,0);opacity:1} 50% {box-shadow:0 0 28px 4px rgba(79,70,229,.1);opacity:1} }
      .pb-safe {padding-bottom:env(safe-area-inset-bottom,12px)}
    `}</style>
  </main>
}
