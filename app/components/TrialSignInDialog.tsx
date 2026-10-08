'use client'
import {useEffect,useRef} from 'react'
import {FolupAppIcon} from '../../components/folup-branding'
export default function TrialSignInDialog({onSignIn,onClose}:{onSignIn:()=>void;onClose:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null)
  useEffect(()=>{const element=dialog.current;element?.showModal();return()=>element?.close()},[])
  return <dialog ref={dialog} onCancel={onClose} aria-label="Sign in with Google" className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-[380px] overflow-hidden rounded-[24px] border border-white/80 bg-white p-0 text-center shadow-[0_24px_80px_rgba(24,24,45,0.22)] backdrop:bg-slate-950/35 backdrop:backdrop-blur-sm">
    <div className="px-7 pb-5 pt-8 sm:px-8">
      <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-indigo-100 bg-indigo-50/70"><FolupAppIcon className="h-8 w-8 object-contain"/></div>
      <h2 className="text-[23px] font-semibold tracking-tight text-gray-900">Keep your next moves.</h2>
      <p className="mt-2 text-sm leading-relaxed text-gray-500">Your visit stays with you.</p>
      <button autoFocus type="button" onClick={onSignIn} className="mt-6 flex min-h-14 w-full items-center justify-center gap-3 rounded-xl border border-[#dadce0] bg-white px-4 py-3.5 text-[15px] font-medium text-[#1f1f1f] shadow-[0_2px_4px_rgba(0,0,0,0.04)] transition-colors hover:border-gray-400 hover:bg-gray-50 active:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-600">
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" className="shrink-0">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        Sign in with Google
      </button>
      <p className="mt-4 text-xs text-gray-500"><span className="font-medium text-gray-700">14 days free</span> · No credit card</p>
      <button type="button" onClick={onClose} className="mt-4 min-h-11 rounded-lg px-5 text-sm text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-800 focus-visible:outline-2 focus-visible:outline-indigo-600">Not now</button>
    </div>
  </dialog>
}
