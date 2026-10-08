# Live /try — local implementation, not enabled in production

- `/try` is independent of session state. Prepared examples remain optional.
- Same `extractVisitWithResearch` and `transcribeVisitAudio` as the paid flow; no model/prompt downgrade. Same CompactVisitResult and CRM formatter.
- One successful anonymous note per opaque HttpOnly cookie (30 days); a failed request can retry once. All reservations are transactional in Postgres, not process memory.
- Hashed network budget: 3 attempts/day; global circuit breaker: 100 attempts/day. These are request caps, not a guaranteed USD budget. Vercel-controlled network header required in production; localhost only in development. No client-provided identity or arbitrary forwarded IP accepted.
- Origin validation, streamed body cap, service-role-only storage. No guest transcript/output in analytics. Anonymous recordings are bounded by the upload cap; the UI stops at 3 minutes. Upload size does not independently validate audio duration.
- Server result available 24 hours. Expired content is scrubbed on reservations; a scheduled purge is still required before launch to guarantee deletion without subsequent traffic. No raw audio persisted server-side.
- Successful sign-in returns to /try. Cookie shared between www.folup.app and folup.app so the configured Google callback does not lose the result. Calendar draft edits are stored in sessionStorage and may require review if OAuth changes hostname.
- Claim uses server-owned output and authenticated email, saves once through the existing versioned note writer. No automatic Calendar creation: user must press Add to calendar after saving/connecting. Corrections/clarifications continue in the existing authenticated app.
- `GUEST_TRY_ENABLED=true` is required server-side; defaults off, including missing migration/configuration. Missing protection fails closed. Do not enable until migration, retention job and real OAuth tests are verified.

## Before deployment
1. Apply `20261007000100_guest_try.sql` to staging first; verify service-role grants.
2. Schedule `SELECT public.purge_guest_visits()` hourly through the database scheduler to scrub expired content even without subsequent visits. The private function is included in the migration. Do not expose a public cleanup endpoint.
3. Confirm AUTH_SECRET or NEXTAUTH_SECRET and Vercel network header behavior.
4. Enable in staging, run one synthetic text + one audio note with an approved API budget; compare with paid output pipeline.
5. Test OAuth www/root hostname return, claim idempotence, account switch denial, edited calendar schedule and optional calendar connection. Review exact dates before creating an explicitly approved test event.
6. Review anonymous spend and abuse caps before enabling production. A bot challenge can be added if abuse exhausts the global cap.

## Known boundaries
This is not unlimited anonymous Pro access. Quality/pipeline are equal; account-only actions remain gated. Failed research follows the same fallback as paid processing. A worker killed mid-request leaves running state until expiration; it is not automatically replayed (avoids duplicate paid work).

Network header contract checked against https://vercel.com/docs/headers/request-headers#x-vercel-forwarded-for . Real deployment verification remains required.
