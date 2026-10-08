'use client'

import { useEffect, useRef, useState } from 'react'
import { FolupLogo } from '../../components/folup-branding'
import { demoSamples, sampleCrm } from '../../lib/publicDemoSamples'

export const DEMO_CRM = sampleCrm(demoSamples[0])

export default function PublicDemo({ onSignIn, onStart, onComplete }: {
  onSignIn: () => void; onStart: () => void; onComplete: () => void
}) {
  const [index, setIndex] = useState(0)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  const viewedSample = useRef<string | null>(null)
  const sample = demoSamples[index]
  useEffect(() => {
    // Prepared results are visible immediately; count each selected sample once,
    // not every parent render or Strict Mode effect replay.
    if (viewedSample.current === sample.id) return
    viewedSample.current = sample.id
    onStart()
    onComplete()
  }, [sample.id, onStart, onComplete])
  return <div className="marketing">
    <header className="mk-nav">
      {/* Full navigation resets the shared page's pathname-derived demo state. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/" aria-label="Folup home"><FolupLogo src="/folup_logo.png" width={3077} height={1200} imgClassName="h-9 w-auto" /></a>
      <span className="mk-nav-caption">Product walkthrough</span>
      <button onClick={onSignIn} className="mk-text-button">Sign in</button>
    </header>
    <main className="mk-demo-main">
      <div className="mk-demo-heading"><h1>Your recap.<span> Your next moves.</span></h1><p>Three sample visits. See the follow-through, not just the summary.</p></div>
      <div className="mk-tabs" role="group" aria-label="Sample visits">{demoSamples.map((item, i) => <button key={item.id} aria-pressed={index===i} onClick={() => {setIndex(i);setCopied(false);setCopyError(false)}}><span>0{i+1}</span>{item.label}</button>)}</div>
      <div className="mk-workbench" key={sample.id}>
        <section className="mk-source mk-highlighted" aria-label="Sample field note">
          <div className="mk-panel-label"><span>Your recap</span><span className="mk-sample-badge">Illustrative sample</span></div>
          <p className="mk-context">{sample.context}</p>
          <blockquote>“{sample.fragments.map((fragment,i) => <mark key={i} data-kind={fragment.kind}>{fragment.text}</mark>)}”</blockquote>
          <p className="mk-fine">Prepared example. No recording, AI request or account needed.</p>
        </section>
        <section className="mk-output" aria-label="Sample visit result">
          <div className="mk-panel-label"><span>Your next moves</span><span aria-hidden="true">→</span></div>
          <div className="mk-result-reveal">
            <p className="mk-contact">{sample.contact}</p>
            {sample.commitment ? <article className="mk-action"><p className="mk-eyebrow">AGREED NEXT STEP</p><h2>{sample.commitment.title}</h2><p>{sample.commitment.detail}</p><div className="mk-when">{sample.commitment.when}</div></article> : <p className="mk-no-action">No follow-up was agreed. Folup keeps it that way.</p>}
            {sample.recommendation ? <article className="mk-smart"><div className="mk-smart-label">SMART NEXT STEP <span className="mk-pill">Proposed</span></div><h2>{sample.recommendation.title}</h2><p>{sample.recommendation.detail}</p><div className="mk-reason"><strong>Why this move</strong> {sample.recommendation.why}</div><div className="mk-when">{sample.recommendation.when}</div></article> : <div className="mk-restraint"><strong>Sometimes, the smart move is to wait.</strong><p>No extra task here. Respect Elena’s request and send only what you promised.</p></div>}
            <details className="mk-crm"><summary>CRM note, ready to go <span aria-hidden="true">+</span></summary><p>{sampleCrm(sample)}</p><button className="mk-text-button" onClick={async () => { try {await navigator.clipboard.writeText(sampleCrm(sample));setCopied(true);setCopyError(false)} catch {setCopyError(true)} }}>{copied ? 'Copied ✓' : 'Copy sample CRM note'}</button>{copyError && <p role="alert">Please select and copy the text above.</p>}</details>
          </div>
          <span className="sr-only" role="status">Result ready for {sample.contact}.</span>
        </section>
      </div>
      <section className="mk-demo-convert"><div><h2>Your next visit, sorted.</h2><p>14 days free · No credit card</p></div><button onClick={onSignIn} className="mk-primary">Try with your own visit</button><p className="mk-fine">Up to 100 notes. Your trial starts with your first processed note.</p></section>
    </main>
  </div>
}
