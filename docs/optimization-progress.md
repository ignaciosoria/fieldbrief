# Folup optimization — sequential evaluation

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
