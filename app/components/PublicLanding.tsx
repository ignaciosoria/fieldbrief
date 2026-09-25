import { FolupLogo } from '../../components/folup-branding'

function Arrow({ down = false }: { down?: boolean }) {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className={down ? 'rotate-90' : ''}>
      <path d="M4 12h15m-6-6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function GoogleIcon() {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white" aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 24 24">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
      </svg>
    </span>
  )
}

const steps = [
  { title: 'Say it while it’s fresh.', description: 'Just left a visit? Record what happened in your own words. No forms, no perfect script.' },
  { title: 'Make the next step clear.', description: 'Review the key details and follow-ups. If something needs changing, correct it by voice.' },
  { title: 'Keep things moving.', description: 'Open a follow-up in Google Calendar, ready to save. Copy the visit note into your CRM.' },
]

/** Public-only presentation. Auth stays owned by the existing page callback. */
export default function PublicLanding({ onSignIn }: { onSignIn: () => void }) {
  const focus = 'focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#4f46e5]'

  return (
    <div className="min-h-[100dvh] bg-[#fdfdfb] font-[family-name:var(--font-geist-sans)] text-[#202124] antialiased">
      <a href="#main-content" className={`sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-3 ${focus}`}>
        Skip to content
      </a>
      <header className="mx-auto flex max-w-[1160px] items-center justify-between gap-4 px-6 py-6 sm:px-10 sm:py-7">
        <FolupLogo src="/folup_logo.png" width={3077} height={1200} imgClassName="h-9 w-auto sm:h-10" />
        <nav aria-label="Main navigation" className="flex items-center gap-7 text-[13px] font-medium sm:gap-9">
          <a href="#how-it-works" className={`hidden py-2 text-[#60616a] hover:text-[#4f46e5] sm:inline-flex ${focus}`}>How it works</a>
          <button type="button" onClick={onSignIn} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 hover:text-[#4f46e5] ${focus}`}>
            Sign in <Arrow />
          </button>
        </nav>
      </header>

      <main id="main-content">
        <section aria-labelledby="landing-title" className="mx-auto grid max-w-[1160px] items-center gap-11 px-6 pb-16 pt-10 sm:px-10 sm:pb-20 sm:pt-14 lg:grid-cols-[1fr_1fr] lg:gap-14 lg:pb-24 lg:pt-16">
          <div>
            <p className="mb-5 flex items-center gap-2.5 text-[11px] font-semibold tracking-[0.13em] text-[#625d83] uppercase sm:text-xs">
              <span className="h-1.5 w-1.5 rounded-full bg-[#6759dd]" aria-hidden="true" />
              For the moments after a client visit
            </p>
            <h1 id="landing-title" className="max-w-[550px] text-[clamp(2.5rem,4.4vw,3.75rem)] leading-[1.08] font-semibold tracking-[-0.055em] text-balance">
              Every visit.<br />
              <span className="text-[#4f46e5]">A clear next step.</span>
            </h1>
            <p className="mt-6 max-w-[430px] text-[17px] leading-[1.75] text-[#62636d]">
              You do the talking. Folup turns your voice note into clear follow-ups, calendar events, and a CRM note ready to copy.
            </p>
            <div className="mt-8 flex flex-col items-start gap-3 sm:mt-9">
              <button type="button" onClick={onSignIn} className={`inline-flex min-h-[52px] w-full cursor-pointer items-center justify-center gap-3 rounded-xl bg-[#4f46e5] px-6 py-3 text-[14px] font-semibold text-white shadow-[0_3px_8px_#4f46e51a] transition-colors hover:bg-[#4338ca] sm:w-auto ${focus}`}>
                <GoogleIcon /> Start your 14-day free trial
              </button>
              <p className="text-xs text-[#72737b]">No credit card needed. Starts with your first processed note.</p>
              <a href="/try" className={`inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg px-1 text-[13px] font-medium text-[#52515f] hover:text-[#4f46e5] sm:w-auto ${focus}`}>
                See it in action <Arrow />
              </a>
            </div>
            <p className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[#72737b]">
              <span>Speak English or Spanish</span>
              <span className="h-3 w-px bg-[#dcdce3]" aria-hidden="true" />
              <span>On your phone or desktop</span>
            </p>
          </div>

          <figure aria-labelledby="example-caption" className="min-w-0 rounded-[22px] border border-[#e6e4ee] bg-[#f1f0f7] p-4 sm:p-6">
            <figcaption id="example-caption" className="mb-5 flex items-center justify-between gap-3 text-[11px] font-medium text-[#6d6881]">
              <span>A voice note. A plan.</span>
              <span className="rounded-full border border-[#dedbe9] px-2.5 py-1 text-[10px]">Illustrative example</span>
            </figcaption>
            <div className="px-1 pb-5">
              <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold text-[#6a6385]">
                <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                  <rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8" />
                </svg>
                YOUR WORDS
              </div>
              <blockquote className="text-[14px] leading-[1.8] text-[#625d75]">
                “Just saw Maya at Northstar. Um, she likes the A4, but needs the spec sheet first. Send it tomorrow — no prices. And call her Friday afternoon.”
              </blockquote>
            </div>
            <div className="mb-4 flex justify-center text-[#9890b3]" aria-hidden="true"><Arrow down /></div>
            <div className="rounded-2xl border border-[#e5e3ed] bg-white p-4 shadow-[0_6px_24px_#24203906] sm:p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[14px] font-semibold tracking-[-0.02em]">Maya <span className="font-normal text-[#8d8a96]">/</span> Northstar</p>
                  <p className="mt-1 text-[11px] text-[#706b7b]">Your next steps</p>
                </div>
                <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-full bg-[#f1f9f5] text-[#3b8161]">✓</span>
              </div>
              <ol className="space-y-2.5">
                <li className="rounded-xl border border-[#e6e3f4] bg-[#faf9fe] p-3.5">
                  <p className="text-[12px] font-semibold text-[#393148]">Send spec sheet to Maya — Northstar</p>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-[#7b7488]">A4 specifications only. No prices.</p>
                  <p className="mt-3 flex items-center gap-1.5 text-[10px] font-medium text-[#6355b3]">
                    <CalendarIcon /> Tomorrow · 9:00 AM
                  </p>
                </li>
                <li className="rounded-xl border border-[#e9e7ee] p-3.5">
                  <p className="text-[12px] font-semibold text-[#393148]">Call Maya — Northstar</p>
                  <p className="mt-3 flex items-center gap-1.5 text-[10px] font-medium text-[#6355b3]">
                    <CalendarIcon /> Friday · 3:00 PM
                  </p>
                </li>
              </ol>
              <p className="mt-4 text-[11px] leading-relaxed text-[#7b7488]"><span aria-hidden="true">💡 </span>Needs the spec sheet before moving forward.</p>
              <div className="mt-4 flex items-center gap-2 border-t border-[#eeecf2] pt-3 text-[11px] font-medium text-[#696175]">
                <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="8" y="8" width="12" height="14" rx="2" /><path d="M16 8V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" /></svg>
                CRM note ready to copy
              </div>
            </div>
            <p className="mt-3.5 text-center text-[10px] leading-relaxed text-[#6d657b]">Review the details. You choose what goes into your calendar.</p>
          </figure>
        </section>

        <section id="how-it-works" aria-labelledby="how-title" className="border-y border-[#eae9e5] bg-[#f7f7f4]">
          <div className="mx-auto max-w-[1160px] px-6 py-12 sm:px-10 sm:py-14">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <h2 id="how-title" className="text-[25px] leading-tight font-semibold tracking-[-0.035em] sm:text-[28px]">Leave the visit. Keep the momentum.</h2>
              <p className="text-xs text-[#777770]">From conversation to follow-through.</p>
            </div>
            <ol className="mt-8 grid gap-7 md:grid-cols-3 md:gap-10">
              {steps.map((step, index) => (
                <li key={step.title} className="border-t border-[#deded8] pt-5">
                  <span className="text-[11px] font-medium text-[#6d63ba]">0{index + 1}</span>
                  <h3 className="mt-3 text-[15px] font-semibold tracking-[-0.02em]">{step.title}</h3>
                  <p className="mt-2 max-w-[310px] text-[13px] leading-[1.8] text-[#73736e]">{step.description}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex max-w-[1160px] flex-col items-start justify-between gap-4 px-6 py-7 text-xs text-[#777770] sm:flex-row sm:items-center sm:px-10">
        <p><span className="font-semibold text-[#47473f]">folup</span><span className="mx-3 text-[#c6c6bf]" aria-hidden="true">/</span>Less admin. More follow-through.</p>
        <a href="/try" className={`inline-flex min-h-11 items-center gap-2 rounded-lg hover:text-[#4f46e5] ${focus}`}>Explore the demo <Arrow /></a>
      </footer>
    </div>
  )
}

function CalendarIcon() {
  return <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18" /></svg>
}
