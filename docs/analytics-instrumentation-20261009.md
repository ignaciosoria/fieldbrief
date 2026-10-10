# Folup analytics instrumentation — local changes, not deployed

## Confirmed causes

- `analyticsPrivacy.ts` allowed just three literal campaign names. A valid Apollo link such as `packaging_20261009` was discarded.
- The privacy filter intentionally rebuilt payloads but dropped session and host. No replacement session model existed.
- SDK pageview capture was enabled; the application did not have a single App Router pageview observer. This does not prove the cause of every historical repeated timestamp.
- Login used a boolean pending flag without an attempt ID or expiry. Click handlers could launch two sign-ins. Completion observers existed in both home and guest components.
- Recording had no click/permission outcome events. Processing success was reported before saving; a subsequent save failure could also be reported as processing failure.
- Browser identity was anonymous and device-local. There was no reliable account-based internal-traffic exclusion.

The 19 pageviews / 15 anonymous IDs described by the owner are observations supplied in the request, not independently re-queried here. They do not establish 15 people or email clicks.

## What changed

- One manual route observer (`AnalyticsObserver`); SDK automatic pageviews remain off. Re-rendering the same path does not count another view; navigating A → B → A does. Full reloads are real new pageviews, not removed by a time heuristic.
- An opaque browser UUID lasts up to 30 days; a session UUID rolls after 30 minutes of inactivity. Anonymous IDs are not people. Returning means returning browser/session, not returning customer across devices.
- First source, session source, first/session/last campaign are separate. A direct first visit is not rewritten as Apollo later. Old records without first-source evidence become `unknown`.
- Allowed date-coded campaigns and A/B/C variants survive local navigation and same-origin OAuth redirects. No full URLs, raw referrers or recipient IDs are retained. Referrer is classified into direct / search / referral / unknown; known Google OAuth redirects are not acquisition sources.
- Login has one in-flight click guard; failures unlock it. An attempt ID persists across Google redirects. Completion requires the authenticated NextAuth session. The error route reports a controlled `auth_error`. Expired attempts on an unauthenticated return mean **no result observed**, not proven abandonment. A slow but successful OAuth return still counts as success.
- Recording measures click, permission request/grant/denial, start, completion, interruption/error and component-navigation cancellation. Empty recordings do not count as successful recordings. A browser/process crash cannot reliably emit a final event; absence remains unknown.
- Processing attempts include mode, flow, attempt/request IDs, controlled errors and duration. `note_result_received` is the client receipt after processing, not persistence. Its duration includes client processing/transcription; server `note_processed` measures extraction handling. Never compare the two as the same latency.
- `note_processed` and `try_processing_completed` are emitted from successful server paths, not duplicated by a browser success event of the same name. `note_saved` / `note_updated` follow successful persistence; guest claim has its own event. A save error no longer contradicts a successful processing result.
- Save success UUIDs derive from the existing idempotent write key (hashed, never exported). Request retries retain a logical save ID but get a new request ID. Ingestion deduplication is eventual, not an exactly-once delivery guarantee. Use distinct event UUIDs for diagnostic result-volume queries.
- Calendar remains optional, with its own attempt/outcome/duration. `calendar_saved` is client-delivered after the Calendar endpoint confirms success; it is not a click or guaranteed proof that the user later attended the event.
- Prepared examples use `flow=demo`, live guest visits `flow=guest`, and signed-in notes `flow=app`.

## Internal traffic and identity decision

The server compares the authenticated email against `FOLUP_ANALYTICS_INTERNAL_EMAILS`. Its default is the owner's already-authorized account. **The email never enters the analytics payload.** This marks the owner on every signed-in device without depending on IP or geography. The browser remembers its test designation after the owner is recognized, including logout.

For anonymous QA, open `/try?analytics_test=1` before testing. This marks that browser as internal. `/try?analytics_test=0` removes the manual browser marker (a signed-in internal account is still internal). Use a fresh external test account/browser for external-like staging tests. This marker is an analytics preference, not an authorization control.

Before the first login on a completely new device, Folup cannot know that an anonymous visitor is the owner. Use the QA link first. Previous unmarked anonymous events cannot be retrospectively classified reliably.

**Not enabled:** stable cross-device user identification or PostHog person profiles. Proposed next decision, requiring approval: use an opaque database user UUID (or server HMAC, not a plain email hash), define retention/consent, then link anonymous and authenticated IDs with the appropriate profile policy. Current `person_profiles: never` remains unchanged.

The context request resolves only an internal boolean. Its failure suppresses unresolved telemetry rather than labelling the account external; it never blocks the product. This can undercount during an analytics-context outage and should be considered during diagnosis.

## Apollo links

Example (do not add recipient IDs, emails or contact names):

`https://www.folup.app/try?utm_source=apollo&utm_medium=email&utm_campaign=packaging_20261009&utm_content=a`

Use `b` and `c` for the other variants. Allowed dated prefixes: `packaging`, `ag_field`, `field_sales`, `agriculture`, `distribution`, `folup`, followed by `_YYYYMMDD`. Existing `ag_field_pilot`, `field_sales_pilot`, `ag_field_followup` remain valid. Content codes: `a`, `b`, `c`, `followup_1`, `followup_2`. Unknown codes fail closed. Check actual campaign names against this contract before launch; no Apollo links were edited here.

## Privacy and production controls

- No audio, note/CRM/transcription content, names, email, credentials, DOM, raw errors or querystrings. Allowlisted UUIDs, enums, bounded numbers and campaign codes only.
- DNT, GPC and the analytics opt-out remain effective. Client tracking and analytics request headers stop when disabled. In-flight events already submitted cannot be recalled; disabling does not erase previously collected events in PostHog.
- Server telemetry requires the browser's sanitized context header, the production Vercel environment and an approved production hostname. No local/staging server submission to the production collector. Client SDK initialization is restricted to production Folup hosts.
- Nothing proxies requests around browser blocking. Missing events can still reflect opt-out, blockers, connectivity, process termination or an outage.
- SDK replay, autocapture, DOM capture, exceptions, performance capture, remote feature activation and person profiles stay disabled.
- Billing retains its separate signed-webhook verification and skips new internal checkouts. Previously created Stripe analytics metadata is not retroactively rewritten or recalled.

## PostHog setup to apply only after approval

Use `analytics-funnels.json` as a human-readable specification (not a raw PostHog API import). Create acquisition and signed-in voice activation funnels plus the guest-first and text alternatives. Global filters: `environment=production` and `is_internal=false`. Segment by first or session campaign/variant, browser visit type and input mode. Do not require Calendar completion for activation.

Use `America/Los_Angeles` for the campaign analysis. Do not mix pre-change `note_processed` client duration with post-change server duration. Choose a post-deploy cohort/date boundary. Volume diagnostics should group by `attempt_id` for attempts, `request_id` for network retries and distinct event UUID for outcomes. Microphone denial is not commercial disinterest.

For unknown endings, compare starts with outcomes by attempt ID after a documented observation window (e.g. 15 minutes for login, 10 minutes for processing). Label missing outcomes **unobserved**, never automatically abandoned. A guest may finish a note and copy it without signing in; report that value separately.

## Session replay and error tracking proposal — OFF

Start with controlled error codes, not recording sessions. If approved later, first validate replay against synthetic data in a separate staging project: mask every input/text/image, block microphone/output/history/settings and CRM content regions, disable network body/header capture and console content, allow only reviewed public pages, require the approved consent state, short retention, low sampling and internal/test filtering. Do not enable replay merely to debug a missing conversion. For error monitoring, ship only reviewed codes and sanitized stacks; no raw API response or user-generated strings. Existing protections must remain default-off until that review is complete.

## Verification and release checklist

Local tests use in-memory SDK/fetch collectors, synthetic IDs and synthetic note outcomes. They make no OpenAI calls, Google OAuth connections, Calendar writes or production PostHog submissions. They cover campaign/identity restoration, first versus session source, repeated mounts, duplicate login clicks, opt-out/GPC/DNT, internal flags, successful recording, denial, cancellation, failures/retries, server payload privacy and stable outcome UUIDs. The broader app suite and production build must also pass.

Not proven by these tests: real Google redirects, physical iPhone microphone prompts, actual PostHog ingestion, account settings/funnels in the live project, mail-security scanners versus humans, or historical attribution. No deployment, migration, campaign edit or production dashboard/settings change has been made.

After authorized deployment: use the internal QA link and owner account; verify one pageview per navigation, campaign/session continuity, one sign-in attempt and result, mic and processing lifecycle, server-confirmed note save, optional CRM/calendar outcomes, internal filtering and opt-out. Inspect actual payloads for privacy. Then configure and verify the funnels against the production project's schema. Do not describe the release as verified-live before that check.

References: [PostHog capture API](https://posthog.com/docs/api/capture), [anonymous versus identified events](https://posthog.com/docs/product-analytics/capture-events#advanced-anonymous-vs-identified-events), [event deduplication](https://posthog.com/docs/data/events#event-deduplication). The installed SDK's `CaptureOptions.uuid` explicitly documents eventual, not strict immediate, deduplication.

## Local verification results

- Full automated suite: 444 passed, 0 failed. Analytics and launch-readiness subset: 22 passed.
- TypeScript validation and optimized Next.js build passed.
- Built local HTTP smoke: `/`, `/try`, `/auth/error` returned 200 with HTML; `/api/analytics/context` returned 200, `Cache-Control: no-store`, and only the `internal` boolean; unauthenticated `/api/notes` returned 401.
- No paid API calls or production analytics ingestion tests. Test collector was in memory; HTTP smoke was localhost only. Local smoke server was stopped afterwards.
- Deployment and live PostHog ingestion / dashboard validation remain pending explicit authorization.
