'use client'

import { useEffect, useState } from 'react'
import { FolupLogo } from '../../components/folup-branding'

export const DEMO_CRM = `Maya — Northstar

Maya is interested in the A4, but her engineer needs to review it before a trial can be approved. She plans to speak with him on Thursday. No trial or order has been agreed.

Next steps:
- Send Maya the A4 spec sheet without pricing — tomorrow, 9:00 AM (proposed time).

Proposed follow-up:
- Check with Maya after Thursday’s conversation to understand what her engineer needs to approve a trial — Friday, 3:00 PM (proposed schedule).`

export default function PublicDemo({ onSignIn, onStart, onComplete }: {
  onSignIn: () => void; onStart: () => void; onComplete: () => void
}) {
  const [shown, setShown] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  useEffect(() => { if (shown) onComplete() }, [shown, onComplete])
  return <main className="min-h-screen bg-[#fdfdfb] px-5 pb-12 text-[#202124]">
    <header className="mx-auto flex max-w-3xl items-center justify-between py-6">
      {/* Full navigation resets the shared page's pathname-derived demo state. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/" aria-label="Folup home"><FolupLogo src="/folup_logo.png" width={3077} height={1200} imgClassName="h-9 w-auto" /></a>
      <button onClick={onSignIn} className="min-h-11 rounded-lg px-3 text-sm font-medium">Sign in</button>
    </header>
    <section className="mx-auto max-w-xl py-6">
      <p className="text-xs font-semibold uppercase tracking-widest text-[#625d83]">Interactive sample · No account needed</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">From messy note to clear next steps.</h1>
      <p className="mt-3 text-sm leading-6 text-gray-500">This is an illustrative example, not a live recording. Your own visits use the details you provide.</p>
      <blockquote className="my-6 rounded-2xl border border-[#e6e4ee] bg-[#f1f0f7] p-5 text-base leading-7 text-[#625d75]">“Just saw Maya at Northstar. Um, she likes the A4, but her engineer needs to review it before a trial. Send her the spec sheet tomorrow — no prices. She’ll talk to him Thursday.”</blockquote>
      {!shown ? <button onClick={() => { onStart(); setShown(true) }} className="min-h-12 w-full rounded-xl bg-[#4f46e5] px-5 py-3 font-semibold text-white">Show the result</button> : <div aria-label="Sample visit result">
        <p className="mb-4 font-medium">Maya — Northstar</p>
        <article className="rounded-2xl border border-gray-200 bg-white p-5">
          <p className="text-xs font-medium text-gray-500">From your note</p>
          <h2 className="mt-2 text-lg font-semibold">Send spec sheet to Maya</h2>
          <p className="mt-2 text-sm leading-6 text-gray-600">A4 specifications only. No prices.</p>
          <p className="mt-3 text-sm">Tomorrow · 9:00 AM <span className="text-gray-500">· proposed time</span></p>
        </article>
        <article className="mt-4 rounded-2xl border border-[#c9dfcf] bg-[#edf6ef] p-5 text-[#244630]">
          <p className="text-xs font-semibold uppercase tracking-wide">Smart Next Step</p>
          <h2 className="mt-2 text-lg font-semibold">Check the technical review with Maya</h2>
          <p className="mt-2 text-sm leading-6">Find out what her engineer needs to approve a trial, after their Thursday conversation.</p>
          <p className="mt-3 text-sm">Friday · 3:00 PM <span className="text-[#476553]">· proposed schedule</span></p>
          <p className="mt-2 text-xs text-[#476553]">A recommendation, not an agreed meeting.</p>
        </article>
        <p className="my-5 text-sm leading-6 text-gray-600">📌 Technical approval needed. No trial or order agreed yet.</p>
        <details className="rounded-xl border border-gray-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-medium">View the CRM note</summary>
          <p className="mt-4 whitespace-pre-line text-sm leading-6 text-gray-600">{DEMO_CRM}</p>
          <button className="mt-4 min-h-11 rounded-lg border px-4 text-sm" onClick={async () => { try { await navigator.clipboard.writeText(DEMO_CRM); setCopied(true); setCopyError(false) } catch { setCopyError(true) } }}>{copied ? 'Copied' : 'Copy sample CRM note'}</button>
          {copyError && <p role="alert" className="mt-2 text-sm">Please select and copy the text above.</p>}
        </details>
        <div className="mt-7 border-t border-gray-200 pt-6 text-center">
          <button onClick={onSignIn} className="min-h-12 w-full rounded-xl bg-[#4f46e5] px-4 py-3 font-semibold text-white">Try it with your own visit</button>
          <p className="mt-3 text-xs text-gray-500">14 days free. No credit card. Starts with your first processed note.</p>
        </div>
      </div>}
    </section>
  </main>
}
