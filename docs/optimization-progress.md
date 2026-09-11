# Folup optimization — sequential evaluation

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
pipeline and still needs equivalent recovery; practical duration/upload limits and API
timeouts are also pending. No physical microphone or real ASR was used in these tests.

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
  correction-audio recovery, practical duration/upload bounds and bounded API timeouts.
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
