# Folup optimization — sequential evaluation

## Compact desktop layout — September 15, 2026

Desktop >=1024px uses a centered 560px app shell, matching fixed bottom nav,
slightly shorter header padding and record-stage height capped at 560px (also
bounded by viewport height). Under 1024px the previous CSS values remain intact.
No new controls, colors, data/model/persistence changes or paid API calls.
CUA local synthetic fixture: 1440x900 shell/header/nav all x440 width560; history
and result verified, action card width520. At 390x844 shell/header/nav width390 x0.
At 1024x640 record textarea bottom491 vs nav top574. No horizontal overflow in
these checks. Screenshots reviewed desktop record and mobile result. Viewport
override reset and synthetic tab closed. 136 tests and production build passed.

## Output quality and clarification safety — September 15, 2026

DEPLOYED 6ea76c8, Ready and www.folup.app verified in Vercel details:
https://vercel.com/ignaciosorias-projects/fieldbrief/31vpwyspBsA5JWYUMtq1FVJ3Thw6

No design/model changes. Prompt now prioritizes up to four explicit visit facts
in visible insights, including incidents already in hidden summary, with qualifiers
(damaged package BUT intact product). Removed contradictory additional-context-only
rule. Explicit factuality check prevents future call purposes becoming past discussion
or invented customer needs/requests. Existing action descriptions remain the canonical
Calendar payload; restrictions retained when locally confirming a send deliverable.

Compact Calendar button now routes unresolved questions for THAT action to existing
clarification dialog, prioritizing its question without mutating question order in
the original note. Other clear actions remain available. An absent date with no
question continues to existing calendar review, not a fabricated date. Existing
design/buttons unchanged. Questions aren't fabricated from missing optional fields.

Paid regression: run8 32/34, run9 33/34 (neither deployed); run10 34/34 automated
checks, final priority incident/correction/uncertainty outputs manually reviewed.
Three rounds cost $0.86983 by reported tokens and existing benchmark rates (no cached
discount); not invoice reconciliation. Runs retain failures for audit. New cases
cover ES/EN package damage, correct recipient/company/date/time, retained Q7/no-price
descriptions and actual Calendar URL instants. Two offline voice-pipeline tests use
simulated ASR plus recorded API outputs, verify same note id, CRM and calendar export.
136 local tests and final production webpack build passed. No real microphone or
mobile recordings tested this turn; accents, code switching and field noise remain
unvalidated. No production notes/events created during these tests. These scores
apply to the tested checks, not general semantic accuracy.

## Transcription upgrade — September 15, 2026

DEPLOYED 4b69362, Vercel Ready and current www.folup.app domain verified:
https://vercel.com/ignaciosorias-projects/fieldbrief/9ZqJss2Q1o9AxD5UbZi3BTtKR1aL
Post-deploy homepage 200, anonymous transcription POST 401. Authenticated real
mobile recording not exercised in production this turn.

Default changed to gpt-transcribe with concise bilingual field-sales vocabulary
and context stressing numbers, negations and spoken corrections. No UI, extraction,
quota, auth, upload-limit or retry-policy changes. No forced language or subsequent
LLM transcript rewrite. TRANSCRIPTION_MODEL=whisper-1 restores original model and
prompt; invalid values fail before API calls. New model available on local key.
Official docs checked: https://developers.openai.com/api/docs/models/gpt-transcribe
and https://developers.openai.com/api/docs/guides/speech-to-text . Published cost
$0.0045/min: 100 one-minute notes $0.45; 1,000 $4.50, transcription only.

Evidence: eval/asr-upgrade-1.jsonl (12 calls, four synthetic clean/noisy variants,
current Whisper vs vocabulary-only Whisper vs candidate). Candidate average 1781ms
vs current 2788ms; single samples, not a latency SLA. Candidate corrected Soltec in
clean ES and Northstar clean EN; noisy ES still Soltex, so proper nouns unresolved.
eval/asr-upgrade-safety-1.jsonl adds six calls: messy ES/EN plus silence, two models.
Candidate retains surname/time self-corrections, product numbers and negations;
both models mishear English Send as sent. Candidate returns empty on silence while
Whisper invents a FEMA phrase. Existing no-speech recovery handles empty output.
These are four base TTS utterances, two noise variants and silence, NOT field/audio
accuracy proof. Real-mobile and code-switching validation remain outstanding.
131 tests pass, TypeScript and webpack production build pass. Five new tests check
SDK multipart contract, unchanged audio/text, explicit rollback, empty output,
invalid configuration and no paid fallback. No microphone or interface changes.

## Live messy-text browser trial — September 15, 2026

Same synthetic Spanish scenario entered via visible production UI after user
requested text instead of audio. History 4 to 5 confirms saved note. Three actions:
Jose Martinez/AgroSol technical sheet Sep16 15:00 suggested; Ana Lopez/Campo Verde
call Sep18 11:30 explicit; Pedro/Distribuciones Levante catalog date pending.
Corrected surname/time retained; cancelled meeting and third-party report not
turned into own actions. Jose Google Calendar draft URL verified product Quantum
Flower75, without prices or quote, 22:00Z = 15:00 America/Los_Angeles. No event saved.
Pedro calendar button opens review with blank date and 09:00 suggestion; it did not
ask an automatic post-extraction question. Packaging damage was absent from the
three visible insights; CRM clipboard content not checked. No additional API call
for clarification. $0.10 conservative unknown-cost reservation retained.

## Live messy-audio browser attempt — September 15, 2026

User watched production Folup record microphone audio while local macOS Paulina
played synthetic Spanish speech (corrected Jose surname, two companies, Quantum
Flower 75 not 50, no prices, Ana call corrected to 11:30, cancelled meeting,
third-party report obligation, Pedro catalog without date). Recording started and
stopped through UI. Processing returned "No speech was detected" with retry,
download and discard recovery controls; history stayed at 4. No extraction result
or calendar event. Speaker-to-microphone path did not produce recognizable speech;
precise audio cause unverified. No retry. Budget retains $0.10 unknown-cost bound.
This is a failed audio-input demo, not evidence of extraction accuracy.

## Natural calendar titles — September 15, 2026

User confirmed natural action + person — company format in ES/EN. Shared title
builder now emits Llamar a Maya — Northstar / Call Maya — Northstar; Enviar ficha
técnica a José — AgroSol / Send technical sheet to José — AgroSol. Send uses a/to,
meetings and followups con/with, no connector without person; company suffix only
when present. Short object categories, full descriptions, timing and compact UI
remain unchanged. Both action cards and Google URL use the same builder. Updated
five title expectations; 126 tests pass, TypeScript passes. No paid calls.

28de01f DEPLOYED: Vercel Ready, exact source and current production domain
www.folup.app verified in deployment details. Local production build passed.
https://vercel.com/ignaciosorias-projects/fieldbrief/8yPR6brgu4x4BxSJMgLXcHZBPZGU
Previously opened Google forms retain their old title; reopen from refreshed Folup.

## CURRENT PRODUCTION — September 15 compact output

ef1d6c7 DEPLOYED, Vercel Ready 26s; exact commit and www.folup.app verified:
https://vercel.com/ignaciosorias-projects/fieldbrief/DDpYY8b1A1F6rji7oFioG6UirPC9
Homepage 200, anonymous structure POST 401. Compact v2 output and direct calendar
opening now live. Existing 124 tests and two new component tests passed; build
passed. No API spending. Local fixture servers stopped and tab closed. Synthetic
Google form was opened but NOT saved. Provider latency benchmarking remains
pending; only artificial UI delay and wait-for-save display latency removed.

## Simplified output requested — September 15, 2026

New shared compact result for v2 recorded/typed output and history: discreet people/
company line, one card per action with inline editable time and calendar button,
up to four existing insights with emoji, and Copy to CRM / Correct by voice footer.
Full CRM narrative remains copy payload, not rendered. No writing/share/duplicate
correction controls in this view. Conditional clarification/save failure recovery
remain. Legacy notes/demo preserved unchanged. Old hidden recording panel is inert
and aria-hidden once result is visible; transcript textarea not rendered there.
Calendar opens directly even for suggested time, with fallback review only when
invalid date/time or blocked popup. Inline hour edits affect the current export,
not persisted original extraction; corrected extraction remounts draft state.
Removed artificial 400ms/550ms/72ms waits. V2 result dismisses loading before note
save finishes, retaining Saving/error+retry; New and voice blocked during save.
No model changes or claim of reduced provider latency; no new paid calls.
124 existing unit tests + two new component-render tests passed; final build passes.
CUA synthetic history view verified minimal controls and Copy success UI; clipboard
readback unavailable. Calendar button opened real Google URL directly with exact
action description, date and 09:00 local. No event saved. Publish confirmation next.

## CURRENT PRODUCTION — daypart defaults verified

7b6b1a2 DEPLOYED on www.folup.app. Vercel Ready 21s, exact source/domain verified:
https://vercel.com/ignaciosorias-projects/fieldbrief/4rd2CDyeKzqWDrH2QQLyBMiuKrRu
124 tests pass and local build passes. Homepage 200, anonymous structure POST401.
No paid calls in this block. See daypart limitations below; only matched action
evidence drives suggested hours, explicit structured clocks retain priority.

## Requested daypart defaults — September 11, 2026

Calendar suggestions now read the action's own exact evidence retained by the v2
adapter: ES morning/afternoon/night and EN morning/afternoon/evening/tonight map
to 09:00/15:00/19:00. Explicit structured HH:mm always wins. Tomorrow/manana alone
does not count as morning wording; date is unchanged. No evidence/window defaults
to 09:00. Multiple matched windows default to reviewable 09:00 rather than picking
one. UI displays actual suggested time, not hardcoded 09:00. No model/prompt or
paid API changes. Three new tests cover bilingual windows, exact-time precedence,
and per-action adapter isolation. 124/124 tests and production build pass. This
does not claim general language understanding of arbitrary daypart paraphrases,
negation or multiple actions within a broad evidence quote. Publish status below.

## CURRENT PRODUCTION — September 11, 2026, 16:40 UTC

0e0a806 DEPLOYED, Vercel Ready 22s, exact source and www.folup.app verified:
https://vercel.com/ignaciosorias-projects/fieldbrief/Agj9Rfc6vrAFe22RJ9sq4hgCygJv
Includes requested compact calendar titles, required time with explicit 09:00
suggestion preview, prominent voice correction, and prior account continuation
guards. 121/121 full unit suite passed, final production build passed, synthetic
browser voice-to-CRM/action/calendar correction verified. Specific account-switch
browser test remains pending, as documented. Homepage 200, unauthenticated notes
GET and structure POST 401. Test servers stopped, test tab closed. No additional
paid calls in this QoL block; earlier visible production demo retained 0.10 USD
unknown-cost allowance. Already-open Calendar forms do not refresh automatically.
Overnight automation PAUSED; future work requires normal user request/resumption.

## Requested calendar/voice UX — September 11, 2026, 16:38 UTC

User explicitly changed requirements: short calendar titles, always a clock time,
voice correction prominent before export. Calendar titles now use compact action
+ person + company; full detail/restrictions stay in description. Unknown send
objects use plain Send rather than guessing a material category. Exact times stay;
missing/invalid times propose 09:00 and require preview with suggested-time notice.
No natural-language daypart inference added; no all-day exports from this helper.
CRM/extraction timing remains untouched so defaults do not become alleged promises.
Voice correction is prominent in both result and history CRM cards, with a stop
button in the same place; writing remains secondary. Existing correction pipeline
regenerates all action drafts. CUA synthetic test verified Maya -> Maia through
voice start/stop, ASR/structure/save retries, CRM/action and Calendar preview title;
09:00 notice and original date/description preserved. No real microphone or paid
API in this test. No Calendar event saved. Full suite 120 before one additional
calendar regression; final focused 6/6 and production build pass. Prior session
switch-specific UI integration remains unverified; no claim of universal isolation.
Overnight heartbeat paused at 16:38 after original deadline; current work explicitly
requested by user continues normally. Production confirmation follows separately.

## Account-switch continuation guards — September 11, 2026, 16:04 UTC

LOCAL ONLY, not deployed. Inspection found typed extraction could finish after a
session switch and reach acceptVisit/saveNote; new-note save acknowledgements also
updated the current history without an owner check. Added owner checks after typed
JSON and legacy display delay, before/after new-note save, after text correction
and clarification responses, and around typed error/finally and saved-toast timer.
Account reset clears loading/saving indicators. No server authorization changes.
Existing 120 tests and TypeScript pass. These are regression checks, NOT a new
browser integration test of session switching. Must verify synthetic delayed
response + switch before deployment. Guards compare email as existing voice flow
does; A-to-B-to-A generations and unobserved cross-tab cookie changes are not fully
covered. In-flight server writes are not cancelled by these UI checks. Do not
claim universal session-race isolation. No paid calls. Production remains 0db80a8.

## CURRENT PRODUCTION — September 11, 2026, 15:15 UTC

0db80a8 is DEPLOYED on www.folup.app. Vercel Ready, Production domain and exact
source commit verified through CUA, build 24s:
https://vercel.com/ignaciosorias-projects/fieldbrief/ER7Jbq1KHKjENda93jAkkVApKPkK
Includes all pending quota validation, per-row history recovery and complete AI
response deadlines. Earlier LOCAL ONLY headings below are historical/superseded.
Local verification: 120 unit tests, TypeScript, production build and browser
history scenario passed. Homepage 200; anonymous notes/subscription GET and
structure/transcribe POST return 401. No paid production test repeated, no
migrations/config changes. Local test servers stopped and synthetic tab closed.
No API spend in this block. Remaining: real mobile/audio and native download/
discard compatibility, full fresh OAuth/test checkout, quota messaging and
broader async account-isolation review. Do not claim the full app audit finished.

## History browser verification — September 11, 2026

CUA verified the real compiled app using the local-only synthetic gateway. A valid
Maya/Northstar note remains visible beside a deliberately malformed v2 note. The
damaged detail displays the original transcript and explicit recovery warning, no
calendar action button. Found and fixed misleading legacy count: recovered note
initially said one action; rebuilt/restarted/reloaded and verified zero actions,
with the healthy neighbour still showing one. Fixture history scenario retained
for repeatable checks. Build passes. Ready to deploy quota/history/AI deadline
changes; deployment confirmation will be recorded separately. No paid APIs or
real data mutations in this browser test.

## AI transport deadline checkpoint — September 11, 2026

LOCAL ONLY. fetchWithTimeout now bounds headers AND full response body, buffers
the small API response before returning, honors caller cancellation, and races
against the deadline even when a transport does not settle on abort. No automatic
retry. All five previously unbounded /api/structure calls now use the same helper,
covering primary recording, typed notes, text correction and clarification refresh.
HTTP status/headers and non-JSON errors are preserved for existing upload recovery.
Not a streaming-response utility; response URL metadata is not preserved or used
by these callers. Five new tests cover hanging bodies/transport, cancellation,
HTTP error preservation and successful timer cleanup. 120/120 unit tests pass;
TypeScript, git diff --check and local production webpack build pass. No API spend.
Not yet deployed: production remains fe04ca3. Next: browser verification of pending
history recovery plus the accumulated transport/quota changes, then deployment.

## History recovery checkpoint — September 11, 2026

LOCAL ONLY. Both initial and paginated history loads now isolate failed row
normalization, validate v2 extraction against its saved transcript, and reject
invalid legacy text field types. A failed row retains its id, date and original
transcript with empty actions, a 'Note needs review' list label and an explicit
detail warning. No database writes, deletion or automatic paid reprocessing.
Keeping the row preserves pagination offsets. Successful explicit correction
clears its recovery flag. Late pagination results/errors are ignored after an
account switch. Three new regression tests cover neighbour isolation, unchanged
source payloads, malformed output and valid v2 extraction. Browser visual checks
and deployment remain pending; production remains fe04ca3.

## Invalid extraction requests — September 11, 2026, 14:40 UTC

LOCAL ONLY, not deployed. Structure now authenticates before parsing, validates
before reserving usage, then uses only the authenticated identity for quota.
Bounded streaming JSON read (256,000 bytes, independent of Content-Length), same
20,000-character note limit; date/timezone fallbacks and model remain unchanged.
Empty, malformed, primitive/array and oversized input no longer burns allowance.
Four new tests cover ordering, owner spoofing, context preservation and closed
quota/database denial; complete unit suite 112/112 passes. No paid calls.
Production remains fe04ca3 until a subsequent verified deployment. Remaining
priorities: malformed history row isolation and full AI response-body timeouts.
Overnight automation remains ACTIVE with original 16:18:51 UTC stop deadline.

## ASR pilot checkpoint — September 11, 2026, 14:34 UTC

NO PRODUCTION CHANGE. Ran 12 real transcription calls on two locally generated
TTS clips (ES 14.15s / EN 13.60s), each clean and with seeded 12dB white noise.
Compared current Whisper agriculture/product prompt, Whisper without prompt,
and pinned gpt-4o-mini-transcribe-2025-12-15 without prompt. All requests completed.
Inputs and synthesis limitations: eval/asr-audio/README.md; raw outputs/usage/latency:
eval/asr-pilot-1.jsonl. Explicit runner requires active reservation; no retries.

Observed: both Whisper arms preserved the two commitments, relative dates, no-price
restriction and no-extra-meeting statement across the four clips. Neither solved
company spelling reliably: Soltec became Soltech or Solset; Northstar became
Northster in clean EN. Current context kept clean ES product spacing better than
no context, but this is one example, not proof of universal benefit or no bias.
Mini's noisy ES output changed Quantum Flower 75 to QuantumFlow X35, mixed language
and changed company names. Its EN output changed "I met" to "I'm at", and noisy
EN also damaged the self-correction phrase. Do not switch production to mini based
on this pilot. Keep current Whisper configuration pending stronger real-audio evals.

Important: Maya/Maia spelling is acoustically ambiguous and NOT scored as a model
failure. Speech errors that confidently produce a wrong name will not necessarily
trigger extraction's textual uncertainty questions. Preserve easy user correction;
do not promise the high/low label measures acoustic confidence. No calibration done.
Two TTS utterances plus white noise do not establish real mobile/field accuracy.
No extraction calls were made on these transcripts in this block.

Cost estimate from returned usage and published rates: Whisper 116 billed seconds
at $0.006/min + mini 554 input/216 output tokens at $1.25/$5 per million = $0.0133725.
Ledger reservation closed, remaining $4.039373; not a billing invoice reconciliation.
Official docs also list gpt-transcribe at estimated $0.0045/min; it was NOT tested.
Sources checked: https://developers.openai.com/api/docs/guides/speech-to-text
https://developers.openai.com/api/docs/models/whisper-1
https://developers.openai.com/api/docs/models/gpt-4o-mini-transcribe
https://developers.openai.com/api/docs/pricing

Next safe block: reject invalid structure requests BEFORE quota reservation, then
isolate malformed history rows. Do not burn the remaining budget on more tiny ASR
variants and claim a winner; collect representative human field audio when available.
Original automation deadline 2026-09-11T16:18:51.084Z stays unchanged.

## CURRENT PRODUCTION CHECKPOINT — September 11, 2026, 13:57 UTC

**fe04ca3 is DEPLOYED** on www.folup.app. Vercel Ready, exact source fe04ca3,
24s build, deployment:
https://vercel.com/ignaciosorias-projects/fieldbrief/9qc9QqD4cW5P4Zu3F4LN2vhMA9cK
Includes correction recovery, bounded notes transport and visible history errors.
Post-deploy: homepage GET 200; anonymous notes/subscription GET and
structure/transcribe POST all 401. No authenticated paid production test repeated.
No configuration/migration changes. The two local fixture server processes were
stopped after testing. Earlier LOCAL ONLY sections are historical for these commits.
Native download/discard compatibility limitations below remain explicitly unverified.

## Correction browser verification — September 11, 2026, 13:55 UTC

CUA drove the REAL local compiled app through scripts/correction-ui-fixture.mjs,
a localhost-only gateway that intercepts ALL /api requests, uses synthetic session/
notes/audio and blocks external connections with CSP. No real microphone, external
API, Supabase or payment was used. Fixture is not imported by production.

At 390x844, history correction encountered ASR 503, then structure 503, then a
saved-but-unacknowledged PUT 503. Each visible retry button matched its stage.
Final CRM/title changed Maya to Maia and History stayed at 1 note. Fixture counters:
2 transcriptions, 2 extractions, 2 saves, one same id synthetic-correction-note.
Both structure attempts used IDENTICAL combined text, original reference
2026-09-10T18:00:00Z, America/Los_Angeles and the same captured correction timestamp.
The original remained visible until save success. Mobile screenshot showed readable
recovery text and accessible retry/download/discard controls without clipping.

Constructor failure released the synthetic stream but exposed an existing UX bug:
the error wasn't visible from history. Added a visible alert for history/results.
Rebuilt, restarted and reloaded; CUA verified the constructor error now appears.
At 1280x900 a non-JSON HTML 413 showed the size/recovery message and retained the
audio link and retry button. 108 unit tests, webpack build and whitespace check pass.

LIMITATION: clicking Download did not produce a download event within 5s in this
in-app browser; actual file download is unverified. Existing native window.confirm
for discard appeared, but the browser tool could not retrieve/dismiss it and that
synthetic tab (5) became blocked. No discard was accepted, no real data involved.
Do not claim download/discard end-to-end verified; unchanged native-confirm/download
behavior remains a manual browser compatibility check. Other tab 4 works normally.
Viewport override reset. No browser restrictions bypassed. Test tab is temporary,
not marked for handoff; cleanup may close it after the turn.

Proceed with deployment of the tested correction/timeout changes and error alert;
check Vercel's default build and anonymous endpoints. No migration/config changes.
Next independent block: ASR context/evaluation, then quota/history hardening within
remaining time. Ledger unchanged $4.0527455. Original cutoff 16:18:51.084Z remains.

## Notes transport checkpoint — September 11, 2026, 13:17 UTC

LOCAL ONLY. Closed the remaining hanging-save limitation from the correction
checkpoint: notesRequest now bounds the ENTIRE request plus JSON body at 60s,
aborts transport, honors caller cancellation, preserves Headers objects and uses
no-store. There are no implicit retries. Non-JSON proxy responses produce a useful
retry message instead of a JSON parsing exception. The timeout explicitly warns
that the save may already have completed; it does not claim the server rolled back.

Four new transport tests cover preserved id/headers, stalled connection/body,
HTTP/non-JSON errors and cancellation. An additional correction integration test
simulates a successful server upsert whose acknowledgement stalls: retry keeps
one note under the SAME id and invokes ASR/extraction only once. This is a mocked
server test, not a new live Supabase write. All 108 unit tests, 33 output-quality
tests, whitespace check and webpack production build pass. No paid API calls.

Not deployed: production stays c4bd917. The next block remains CUA visual/interaction
verification of correction recovery on a local synthetic API fixture, then deploy
the correction and timeout commits together. Do not repeat completed controller
work or the paid prompt corpus. No new authorization needed. Ledger remains
$4.0527455 available; original automation cutoff 2026-09-11T16:18:51.084Z unchanged.

## Correction recovery checkpoint — September 11, 2026, 12:40 UTC

LOCAL ONLY — do not claim deployed or browser-verified yet. Correction recording
now retains a tab-local VoiceCorrectionDraft with audio, original note/owner,
original reference date/zone and a correction timestamp captured at recording start.
resumeVoiceCorrection checkpoints successful transcription and extraction, so
structure retries skip ASR and save retries skip both AI calls. An unsuccessful
save does not replace the visible original. Ambiguous results transfer to the
existing clarification flow. A global recovery dialog offers download, stage-specific
retry, transcript preview and explicitly confirmed discard; audio is not durable
across tab closure. No localStorage audio or production test data was created.

Recording now guards duplicate starts and overlap with main recording/processing,
releases the stream on constructor/start failure and stops the correction recorder
on account change/unmount. Owner checks reject late transcription/extraction
results; updateNote also rejects late UI writes after an account change. Session
change clears visible result/transcript/input and pending clarification/correction.
This is not a full audit of every unrelated async frontend callback.

Five new deterministic tests cover failed ASR, structure retry with stable dates,
save-only retry, account changes at every stage and blank speech. All 103 unit
tests pass; `next build --webpack` passes including TypeScript. No paid API calls;
ledger remains $4.0527455 available. Existing deployed commit remains c4bd917.

NEXT: verify the recovery dialog and the full correction path on mobile/desktop
with synthetic transport failures, including constructor failure, download/discard,
and successful retry targeting the same history note; then deploy this checkpoint.
Do not conflate controller tests with browser/microphone evidence. Browser actions
must use CUA; its current API does not expose route interception. Existing
scripts/ui-smoke.mjs uses standalone Playwright, so it was not rerun under the
current CUA-only computer-interaction instruction. A local mock HTTP gateway can
provide synthetic API failures while CUA drives the actual app if needed.
Remaining limitation: notesRequest save has no timeout yet (offline rejection is
recoverable, but a hanging save can keep its spinner). Address before deployment.
Original overnight stop deadline stays 2026-09-11T16:18:51.084Z.

## CURRENT PRODUCTION CHECKPOINT — September 11, 2026, 12:02 UTC

Code through **c4bd917** is DEPLOYED. Vercel reports Ready / Production / Current
Domains www.folup.app, exact commit c4bd917, build duration 25s, deployment:
https://vercel.com/ignaciosorias-projects/fieldbrief/3b261Ad8gSeMzyubEPhyZCCRQQDX
This includes both action restrictions (e8cbce5) and temporal fidelity (c4bd917).
Default cloud build succeeded despite the local Turbopack worker-port restriction.
Post-deployment HTTP checks: homepage 200; anonymous notes/subscription GET and
structure/transcribe POST all 401. No paid deployed note test repeated in this block.
Earlier local-only notes below are historical; this checkpoint supersedes them.

## Temporal fidelity checkpoint — September 11, 2026, 12:01 UTC

LOCAL ONLY pending deployment verification. Added one focused prompt paragraph
and contrasting examples separating actual visit discussion from future-action
purpose. No model, API, schema, postprocessing, or production configuration change.
The new summary regression catches the saved run-6 es-clear-purpose failure.
Three new synthetic cases cover future-only purpose and actual sample/color
discussion followed by an unrelated future warranty call in ES/EN.

Paid run 7: 30/30 automated checks, $0.222915 conservative uncached GPT-5.4 cost.
Manual review confirms the original Lucía case now says only "Visitó a Lucía de
Beta" in summary; the Q7/price questions and no-send restriction remain in the
call description. Both past/future cases preserve R8/color discussion in summary
and Z9 warranty only in the future call. Both action-constraint cases still pass.
Some other summaries still redundantly mention a promised catalog; not presented
as resolved. This small synthetic corpus does not establish universal accuracy.

98/98 unit tests, 33/33 output-quality tests and whitespace check pass.
Default Turbopack build failed on CSS worker port binding (EPERM), including an
escalated retry. Alternative `next build --webpack` completed successfully with
TypeScript, all routes and prerendering. No build configuration was changed.
Production default build must still be verified on Vercel before claiming deployed.

Current remaining ledger $4.0527455 (including a separate $0.08 hold already
deducted for earlier unknown-cost failures). No ASR calls, notes or calendar writes
in this block. Official guidance and prices checked:
https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.4
https://developers.openai.com/api/docs/models/gpt-5.4

Next independent block: correction recording recovery. Inspection confirmed the
separate correction onstop flow still discards its only Blob after ASR failure,
has no start/concurrency guard and does not stop the acquired stream if recorder
construction fails (app/page.tsx startCorrectionRecording). Reuse recovery concepts
with captured correction timestamp and original note owner; avoid another ASR call
if only structure/save fails. Then neutral/noisy ASR tests and remaining quota/history
hardening. Keep original automation stop deadline 2026-09-11T16:18:51.084Z.

## Action restrictions checkpoint — September 11, 2026, 11:28 UTC

LOCAL ONLY, not deployed. One authenticated synthetic production text note was
processed and survived reload/history reopening: two contacts, two companies,
two actions, correct separate dates/time, no invented meeting. Vercel structure
log at 11:19:24Z: 5236ms, 1387 input / 356 output tokens, estimated $0.0088075
at uncached GPT-5.4 rates. One synthetic note remains in history; no Calendar
save, deletion, or payment. This checks text extraction/persistence, NOT ASR.

That test exposed a missing action constraint: "no enviar precios todavía"
was in CRM prose but absent from the Calendar-bound action description.
Adjusted the prompt to keep explicit restrictions in their own action's
self-contained description, with an example preventing cross-contact leakage.
Added ES/EN regression cases and a deterministic adapter/Calendar URL test.
Verification: 98/98 unit tests, 33/33 output-quality tests, production build,
and git diff whitespace check passed. npm test's tsx CLI IPC was sandbox-blocked;
equivalent node --import tsx --test test/*.test.ts passed without escalation.
Paid run 6: 27 requests, 27/27 automated checks, $0.18838 conservative uncached
cost. Raw outputs: eval/visit-v2-run-6.jsonl. Both new cases keep pricing out
of the send description and preserve the unrelated delivery call at 11:00.
This is a small synthetic sample, not a universal quality guarantee.

Manual review found another remaining issue in es-clear-purpose: summary says
the visit was "para dar seguimiento a la propuesta Q7 y a dudas sobre el precio",
although that purpose was only stated for the FUTURE call. Automated checks
did not catch this. Next block: strengthen temporal factuality regression before
another prompt adjustment; do not call the current output perfect. Also some
outputs still duplicate future commitments in summary. Keep these findings
separate from the successfully tested restriction fix.

Next priorities after temporal factuality: neutral ASR context/noisy ES/EN tests,
correction-audio recovery, invalid-request quota handling, per-row history
validation and account-switch state isolation. Existing overnight heartbeat
remains active, original stop deadline 2026-09-11T16:18:51.084Z; do not extend it.
Ledger remaining $4.2756605 includes $0.08 still held for unknown-cost failures.
Official prompting guidance consulted: https://developers.openai.com/api/docs/guides/prompt-engineering

## CURRENT PRODUCTION CHECKPOINT — September 11, 2026, 10:49 UTC

Code through **9958e55** is now pushed to origin/main and DEPLOYED to production.
Vercel confirmed Ready / Production / Current Domains www.folup.app, build duration 47s:
https://vercel.com/ignaciosorias-projects/fieldbrief/29U36oBecYnFgvvgPghyNDguoxEy
This includes extraction v2, the dependency security update, subscription lifecycle,
partial clarification fix, analytics privacy, primary recording recovery and bounded
transcription uploads. Migration 003 is applied and verified (details below).

Post-deployment checks against https://www.folup.app: homepage 200; anonymous notes,
subscription, structure and transcribe endpoints all 401. An ignored synthetic
customer.created webhook signed with the local test signing secret returned 200;
it performs no subscription/database write or charge. This proves matching deployed
webhook signing configuration, not an end-to-end checkout or live-payment integration.

After that success, updated ONLY the existing TEST Stripe webhook
we_1TNNIO1RBOM3m17AlSzByNAc to https://www.folup.app/api/stripe/webhook and the union
of existing events with all 11 supported checkout/subscription/invoice events. A fresh
Stripe read confirmed enabled, exact www URL, 11 events, unchanged API version
2026-03-25.dahlia. No signing secret, price, plan, payment method or credentials changed.
No subscribers existed in the tested account; no reconciliation was needed.

Still unverified: complete Stripe test checkout/payment-state delivery, production
secret-key mode (key remained masked in Vercel), real Google OAuth after framework
update, actual ASR/noisy mobile microphone and a paid end-to-end deployed note.
Do not describe the tool as fully finished. Next: one controlled deployed text case
within the ledger budget if the user's Folup session is available, then ASR comparison
and correction-audio recovery. All earlier "local only / not deployed" sections below
are historical checkpoints, superseded for code through 9958e55 by this section.

## Deployment preparation — September 11, 2026, 10:45 UTC

Supabase dashboard session verified live; project iownaoghocmubpxwrnlk is healthy.
Before migration: subscriptions had 0 rows / 0 active, paid_until did not exist, ai_usage
existed. Migration 20260911000300_subscription_sync.sql was APPLIED through the SQL
editor in one transaction. A second transaction checked public-role denial/service-role
permission, synthetic paid access above free quota, and expiry revocation, then ROLLED
BACK. Final live query: subscription_rows=0, expiry_column_exists=true,
probe_rows_remaining=0. No user data was deleted and no synthetic rows remain.

Stripe read-only check: local secret key is TEST mode, zero subscriptions, exactly one
enabled test webhook (we_1TNNIO1RBOM3m17AlSzByNAc), still using the non-www URL and
only checkout.session.completed/customer.subscription.deleted. Do not claim this is a
live-payment readiness check. Update this endpoint AFTER successful deployment.

Paid policy tightened locally: latest_invoice is expanded from Stripe and must have
status=paid as well as an active, unpaused correct-price subscription with future period
end. Draft/open/void/uncollectible/missing/unexpanded invoices do not grant paid access.
Tradeoff: a renewal can temporarily show inactive until invoice.paid is delivered;
there is no unpaid grace period. Tests cover this fail-closed behavior. One new route
test verifies actual raw-body Stripe signatures, rejects missing/invalid/tampered ones,
acknowledges a signed irrelevant event without network access and detects missing config.
All 97 tests and production build pass. No new paid API calls.

Vercel session verified, production still 9e5feee when inspected. Required environment
variable names are present for all environments, including Stripe/OpenAI/Supabase/Google.
Public Supabase URL points to the same project. Secrets stayed masked. Vercel warns
that sensitive keys are stored as Config, not its Secret type; do not rotate credentials
unattended through browser UI. Remaining deployment and webhook checks are below.

## Transcription transport checkpoint — September 11, 2026

Local only. Authentication remains first; empty/malformed multipart and oversized files
are now rejected BEFORE quota reservation. Shared server quota reservation uses only
the server-authenticated email. Provider failures still count as attempts; refund or
idempotent retry accounting has NOT been implemented.

Upload cap changed from the ineffective 10 MB to 4,000,000 bytes, leaving multipart
headroom under Vercel's documented 4.5 MB limit. Primary recording checks this locally
and preserves oversized audio for download; server checks both declared request length
and actual file size. This is not a generic streaming parser/slow-upload protection;
production also relies on Vercel's request boundary. Nonempty invalid audio can still
reach the provider, which validates/decodes the actual audio format.

OpenAI client now has 45-second timeout and zero implicit retries, route maxDuration=60.
Browser transcription fetch (primary and correction) uses a single 75-second attempt
with AbortController. The browser timeout covers waiting for response headers, not a
separate body-read deadline. Error responses never echo provider messages; empty text
returns NO_SPEECH instead of being sent on to structure. Successful transcripts are
no-store. Existing whisper-1 model and its domain-biased context prompt remain unchanged
pending a controlled quality comparison; no unsupported claim of improved ASR accuracy.

Eight new tests cover validation-before-quota, anonymous/denied access, database failure,
sanitized provider errors/timeouts, blank transcripts and browser abort without retries.
All 96 tests pass and the production build passes. Local real-route anonymous POST
returns 401 AUTH_REQUIRED. Mocked browser regression also passes at 390px and 1280px,
including audio retries, download, original date anchor and HTTP 413 handling.
No paid API calls or remote writes. Official transport/input
docs checked alongside the installed OpenAI SDK README timeout/retry implementation:
https://developers.openai.com/api/docs/guides/speech-to-text
https://vercel.com/docs/errors/function_payload_too_large

Next prioritize checking the real Supabase/Stripe deployment prerequisites below; avoid
letting verified local checkpoints accumulate indefinitely. If authenticated access is
unavailable, record that and continue correction-audio recovery, duration/bitrate limits,
ASR comparison and account-switch/persistence tests. Hard stop remains 16:18:51 UTC.

## Recording recovery checkpoint — September 11, 2026

Local only. Failed primary-visit transcription now retains the Blob with its original
recording timestamp, time zone and owner. A visible recovery panel offers retry, a local
audio download and explicit confirmed discard. Starting another recording/text note
is blocked while that failed recording awaits a decision. Empty transcripts retain the
audio too. Non-JSON upload failures (including infrastructure HTTP 413) show a useful
recovery message instead of a JSON parse exception.

After successful ASR the editable transcript becomes the recovery path: if structuring
fails, Process Note reuses the original recording date/zone without another ASR request.
New notes reset that date context. Recorder-construction failures release the acquired
microphone tracks; stop also clears chunk/recorder references. Per-operation guards
prevent repeated recording starts and simultaneous audio retries. Owner checks discard
late audio API responses after an account change (broader account-switch flows remain
to be audited).

Limits: this is TAB-MEMORY recovery, not durable offline storage. UI explicitly tells
users to download before refresh/close, and has a best-effort beforeunload warning.
The warning is not guaranteed on mobile. Correction-by-audio uses a separate legacy
pipeline and still needs equivalent recovery; practical recording-duration/bitrate limits
remain pending. Upload bounds and API timeouts were added in the checkpoint above.
No physical microphone or real ASR was used in these tests.

Verification: production build and all 88 unit/database tests pass. Extended browser
smoke passes at 390px and 1280px with a fake MediaRecorder and fully mocked APIs:
failed ASR -> successful local download -> retry -> failed structure -> text-only retry
(exact original timestamp/zone, two ASR attempts total, one note); constructor failure
releases its microphone; HTML 413 retains audio; explicit discard restores recording.
Existing clarification/save/calendar regression cases also pass. No paid API calls,
remote configuration changes, migration or deployment in this block.

## Analytics privacy checkpoint — September 11, 2026

Local only. PostHog now explicitly disables DOM/autocapture, dead/rage clicks, replay,
heatmaps, exceptions, performance capture, surveys, remote feature configuration and
external dependency loading. Anonymous page counts remain: before_send accepts only
$pageview and rebuilds the payload with a coarse allowlisted pathname (/ or /try,
everything else /other), a fresh per-page random ID and required ingestion fields.
Raw URLs, queries, referrers, user identity, person properties and arbitrary event
properties cannot pass through this filter. In-memory identity only; person profiles
and GeoIP processing disabled. This is NOT a claim that the network provider cannot
see connection IP addresses, nor a compliance certification. No vendor data was deleted.

Initialization is guarded against duplicate React effect calls. Default US ingestion
host updated from the app/dashboard hostname to https://us.i.posthog.com; optional
NEXT_PUBLIC_POSTHOG_HOST supports an explicitly configured hosting region. Current
official configuration docs and installed SDK typings were checked before changes:
https://posthog.com/docs/libraries/js/config
https://posthog.com/docs/privacy/data-collection

All 88 tests and production build pass, including three new privacy tests with private
note/contact/URL fixtures and disallowed event types. The mocked browser integration
suite also passes at 390px and 1280px after this build (no JavaScript errors); vendor
requests were intercepted, so actual PostHog ingestion was not verified. No new paid API usage. No production
deploy or migration in this block. Existing product analytics funnels/session replay will
not be available under this policy; add only explicitly reviewed aggregate events later.

## Verified clarification checkpoint — September 11, 2026, 09:00 UTC

Local only. Partial answers are now regenerated into CRM prose when leaving remaining
questions unresolved. Leaving without any answers avoids an extra model call. Escape
uses the same awaitable path; refresh failures keep the dialog, confirmed answers and
retry control. Inputs are disabled during submission to avoid editing an in-flight answer.
Production build passed. Mocked browser smoke passed at 390px and 1280px, including
partial answer + skipped date + injected refresh failure + retry; the saved note retained
María, no stale Marta, no invented date and the unresolved date question. Existing save,
correction, calendar and no-action checks also passed. No paid calls or remote changes.
This checks frontend integration with synthetic responses, not new model accuracy.

Night automation creation timestamp is 1789114731084 (2026-09-11T08:18:51.084Z).
Hard stop/pause due at 2026-09-11T16:18:51.084Z. Do not reset the eight-hour window.

## Overnight checkpoint — subscriptions ready for further integration verification

September 11, 2026. Local only; NOT deployed and migration 003 NOT applied remotely.
The subscription block now includes signature-verified event routing, retrieval of
current Stripe state, database errors returning retryable webhook failures, correct-price
active subscription policy, explicit paid expiry and ordered/idempotent database sync.
Checkout reuses known customers, rejects an existing active plan and has a 15-minute
idempotency key. UI distinguishes an unavailable plan from a free plan, supports retry,
shows checkout errors and disables repeated clicks during checkout creation.

Verification: all 85 unit/database tests and production build pass. Four subscription
tests cover event routing/ownership, access policy/expiry, ordered duplicate events,
database role permissions and expiry enforced by AI quota reservation. These tests
do not prove real webhook delivery, Stripe checkout completion or production access.
No new paid API calls or real charges in this block. API ledger unchanged.

Deployment prerequisites (do not push/deploy this block blindly):
1. Inspect existing subscription counts/statuses without disclosing customer data.
2. Apply `supabase/migrations/20260911000300_subscription_sync.sql` and reconcile any
   legitimate active rows with Stripe before switching expiry-based access on. Legacy
   active rows have NULL paid_until and intentionally fail closed until reconciled.
3. Verify handler signature failures and injected Stripe/database failures locally;
   rerun mocked browser smoke against the latest build including billing error UI.
4. Deploy only after migration verification. Then update the resolved TEST webhook
   `we_1TNNIO1RBOM3m17AlSzByNAc` from folup.app to www.folup.app: the former was
   observed returning HTTP 307, which Stripe treats as a webhook failure. Enable the
   11 event types listed in lib/subscriptionEvent.ts. Never print its signing secret.
5. Local Stripe credentials were confirmed TEST mode; this does not establish the mode
   of Vercel credentials. Verify separately before claiming live billing is ready.

Official Stripe behavior checked: https://docs.stripe.com/billing/subscriptions/webhooks
and https://docs.stripe.com/webhooks. Remaining limitation: the current access policy
uses active status plus correct-price billing-period end, not invoice-paid history;
evaluate finalization failure/unpaid-active edge cases before calling billing complete.

Night continuation created: `pulir-folup-durante-la-noche`, same-thread every 30 minutes,
with instructions to pause after 8 hours from creation. Check its actual saved creation
time when enforcing that cutoff. Continue one tested block at a time; no new tasks or
subagents, no real charges, no plan purchases, no data deletion. If access is blocked,
document it and work on a different safe local block instead of repeatedly requesting it.

Next output/reliability priorities:
- Partial clarifications: local fix verified in the checkpoint above; do not redo.
- Mobile recording: primary recording retry/download is locally verified above. Next:
  correction-audio recovery and practical recording-duration/bitrate limits.
- Transcription: evaluate neutral context against hard-coded crop/product vocabulary;
  compare candidates on synthetic ES/EN audio within the remaining $4.472848 ledger.
- Privacy: local restrictive page-count policy implemented and tested above; do not redo.
- Quotas: invalid/failed attempts and clarifications currently consume the allowance;
  align accounting and UI promises without enabling free unlimited retry abuse.
- Persisted malformed own-note objects, account switches, calendar editing and complete
  end-to-end recording/correction/history tests remain to be reviewed.

## Current work — extraction v2 (local, not yet deployed)

- One versioned action list replaces the legacy primary/supporting extraction contract.
  Every action carries its own type, person, company, full object, brief instruction,
  date, time and verbatim source evidence. Missing actions/timing remain absent.
- Strict JSON schema plus server validation; v2 bypasses legacy semantic rewriting.
  Earliest dated action is displayed first, followed by other actions; none is discarded.
- Targeted questions replace numerical confidence guesses. Answers regenerate the prose
  after the final question so CRM text does not retain the old uncertain name/date.
- Visible CRM copy, written corrections, stable note identity, persistent failed-save
  notice with idempotent retry, and action-specific Calendar titles/descriptions.
- Original note timestamp/time zone retained; appended corrections have their own anchor.
- Google remains the final save/review screen. No false "event created" confirmation.
  Missing date opens an editable draft; no hour means all-day. Invalid/DST-ambiguous
  clocks require review rather than guessing an offset.
- Local verification: 81 tests passed; production build passed. Isolated browser smoke
  passed at 390px and 1280px for save retry, own-company Calendar export, written
  correction without duplicate notes, clarification refresh and no-action visits.
  Browser APIs/OAuth/database/analytics were mocked: this does NOT verify real OAuth,
  Google event persistence, physical mobile recording or production database writes.
- Generated duplicate `* 2.ts` files reappear in `.next/types`; only those three named
  generated copies are excluded from tsc. Original copies were moved recoverably to
  `/private/tmp/folup-generated-types.Axm0yw`. No source type checking is disabled.

### Paid text evaluation and model decision

101 synthetic requests so far. Known estimated cost $0.447152 plus a conservative
$0.08 hold for four validation failures whose token usage was not retained. Remaining
authorized budget $4.472848. Ledger: `eval/api-budget.json`. No audio calls yet.

GPT-4.1 run 2 passed the basic 20-case checks but manual inspection found invented
demonstration/interest details, stale uncertainty in prose and repetition. GPT-5.4 mini
on the same prompt failed five cases (four non-verbatim evidence quotes and one borrowed
date). GPT-5.4 low passed 20/20 on that prompt and was more restrained in prose.
After strengthening fidelity instructions and adding five cases, GPT-5.4 passed 25/25
automated checks including three confirmed-field cases; raw outputs are retained in
`eval/visit-v2-run-5.jsonl`. Selected pinned model: `gpt-5.4-2026-03-05`, low reasoning.

This is a small synthetic evaluation, NOT 100% real-world accuracy. Remaining manual
issues include occasional repetitive commitments in summary and attribution such as
"Ana said" when the original did not explicitly identify who gave the instruction.
No autonomous writes to CRM/Calendar; users review the visible output.

Published rates checked September 11, 2026: GPT-4.1 $2/$8, GPT-5.4 mini $0.75/$4.50,
GPT-5.4 $2.50/$15 per million input/output tokens. Sources:
https://developers.openai.com/api/docs/models/gpt-4.1
https://developers.openai.com/api/docs/models/gpt-5.4-mini
https://developers.openai.com/api/docs/models/gpt-5.4
Run 5 extraction averaged $0.0067995/note before cache discounts: $0.68/100 or
$6.80/1,000 short notes, excluding transcription/hosting/Stripe and additional correction
requests. Pricing is an estimate from usage, not a billing receipt. Do not extrapolate
latency/accuracy to long notes, noisy audio or concurrent production traffic.

### Next sequential blocks

Dependency block completed locally: Next.js 16.3.4, NextAuth 5.0.0-beta.32,
matching eslint-config-next and compatible transitive fixes. `npm audit fix` ran without
`--force` or install scripts. Production build and all 81 tests pass after the upgrade;
the resulting all-dependency audit reports zero known vulnerabilities. This does not
mean the application has no security bugs. Maintainer advisories verified:
https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4
https://github.com/nextauthjs/next-auth/security/advisories/GHSA-8fpg-xm3f-6cx3

1. Security dependencies: production audit currently reports 21 affected packages,
   including 4 critical (severity includes transitive packages, not 21 independent exploits).
2. Stripe lifecycle/reliable paid access and endpoint error handling.
3. Audio transcription context, size/duration boundaries, recovery and mobile lifecycle.
4. Production smoke, real-account persistence and remaining frontend cleanup.

The older entries below are historical snapshots, not current test/spend totals.

## Deployment status — September 11, 2026 UTC

The user authorized production changes and a fresh start without importing legacy history.
Supabase project `iownaoghocmubpxwrnlk` was restored from its paused state.
Migrations 001 and 002 were applied through its SQL editor and succeeded.
Remote checks confirmed RLS on all four tables, no CRUD permissions for anon/authenticated,
and server-role access. The quota function allows 10 free structure attempts and denies
the 11th; this check ran inside a rolled-back transaction. Public roles cannot execute it.
No legacy rows were deleted. Application commit `ae631cb` was deployed to Vercel Production
(`6NLVwBZ65PQzue7X31D4EjHDTD9L`), with Ready status and the www.folup.app domain assigned.
Production smoke checks: homepage 200; anonymous GET/PUT/DELETE notes and POST structure/transcribe
all return 401. No OpenAI calls were needed for these checks.
Browser smoke: Google sign-in returned to the signed-in Record screen, and History
showed an empty new history without an error. Authenticated create/update/delete and
two-account end-to-end isolation still need explicit integration coverage.

Local verification: 15 tests passed, TypeScript passed, production build passed.
These checks do not establish real-model quality or authenticated production UX.
No paid AI tests have been run.

## 1. Server-side AI access (deployed)

- Both AI routes require a session and an atomic database usage reservation.
- Free allowance: 10 transcription attempts and 10 structure attempts per account.
  Corrections count too. Failed or invalid attempts count; deleting notes never refunds usage.
- Active subscriptions bypass the lifetime allowance, but all accounts are limited to
  20 requests per rolling fixed one-minute window per user. This is not a global spend cap.
- Existing accounts start the new counter at zero. No historical consumption is inferred.
- The guided demo stays public; real processing now requires Google sign-in.
- The previous hardcoded owner exemption is removed. The owner needs an active subscription too.
- Missing database configuration or migration returns 503 and does not call OpenAI.
- Audio is limited to 10 MB after multipart parsing, text to 20,000 characters.
  Infrastructure-level upload limits and audio-duration validation remain to be addressed.

### Rollout checklist

1. Apply `supabase/migrations/20260911000100_ai_usage_limits.sql` in a test database.
2. Verify service-role execution succeeds and anon/authenticated execution fails.
3. Verify 10 free calls allowed, 11th denied, independent audio/text counters,
   cross-user isolation, paid access and concurrent reservations at the limit.
4. Apply migration to production and ensure `SUPABASE_SERVICE_ROLE_KEY` is configured.
5. Deploy routes + UI together; verify with mocked AI or approved paid smoke tests.

Do not deploy routes before the migration: they deliberately fail closed.
Subscription integrity still depends on the existing Stripe synchronization; that is a separate fix.

### Local checks

Tests in `test/ai-access.test.ts` exercise anonymous denial, both operation types,
quota denial, rate-limit denial and database outage handling without paid APIs.
`test/ai-usage-db.test.ts` additionally exercises quotas and role permissions in PGlite.

## 2. Private notes (deployed)

New session-authenticated API routes scope every operation to the signed-in email.
The browser cannot supply ownership. Composite keys isolate reused note UUIDs across accounts.
History loads 50 rows at a time; saves/deletes only update UI state after server success.
New notes use `folup_notes`; legacy `notes` remains closed and is not imported.
Tests cover validation, role denial and owner-key separation, not a full logged-in browser flow.

## 3. Calendar dates (deployed)

Next week uses the following calendar week's Monday consistently in prompt context and resolver.
Invalid dates are rejected. Export no longer silently advances overdue dates.
Timed events now carry their 30-minute duration over midnight and year boundaries.
Regression tests cover Spanish/English, leap dates, year rollover and invalid clock values.

### Remaining work, in order

2. Notes ownership and persistence authorization.
3. Canonical date resolution and explicit rescheduling.
4. Action schema, relationships and lossless storage.
5. Extraction prompt, structured outputs and evaluation corpus.
6. Stripe lifecycle and reliable access synchronization.
7. Language, corrections, calendar UX and mobile verification.
8. Save states, modularization and performance measurement.
9. Approved paid model benchmark before selecting replacements.
