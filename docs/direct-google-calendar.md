# Direct Google Calendar saves

## Contract

The action card is the review screen. Its title, description, date, time and note time zone become a 30-minute event on the signed-in user's primary Google calendar. The API does not ask an AI to rewrite those fields. Success requires Google's response to match those fields, event identity and source marker. No attendees or invitations are created.

Calendar access is optional, requested only from **Connect Google Calendar**. Normal sign-in retains its existing scope. After consent the saved note is reopened; the user taps **Add to calendar** again. Merely signing in or returning from consent never creates an event. Edited date/time survive same-tab consent for 15 minutes when the action is unchanged.

Missing dates get editable, labeled suggestions from action-local timing cues, otherwise the next weekday. Missing times default to the existing daypart policy or 09:00. These suggestions do not rewrite extraction/CRM facts or imply a customer agreed. Explicit dates, including overdue dates, remain unchanged. Invalid time zones, invalid dates, DST gaps and ambiguous DST clock times fail closed.

## Security and operational setup

- Apply `supabase/migrations/20260924000200_google_calendar_connections.sql` before deployment. RLS is enabled; only the service role can access the table.
- Enable Google Calendar API in the existing Google OAuth project. Request `https://www.googleapis.com/auth/calendar.events.owned` when connecting. This Google permission allows seeing/creating/changing/deleting events on owned calendars, even though Folup implements only insert and reading back its own deterministic event IDs.
- Google OAuth verification/consent requirements must be completed before advertising this integration publicly. Enabling the API is not verification and does not grant a user's consent. Do not bypass unverified-app warnings.
- Existing Google OAuth client credentials, Supabase service credentials, and `AUTH_SECRET` (or `NEXTAUTH_SECRET`) are required. Tokens never enter the public session. AES-256-GCM encryption is bound to normalized user email and Google subject. Rotating the auth secret requires calendar reconnection unless old tokens are migrated securely first.
- Refresh tokens remain encrypted server-side. A concurrent reconnect/refresh cannot overwrite a newer connection; the losing request fails safely and can be retried. Revoked/expired grants request reconnection.
- The save endpoint requires authentication, a same-origin JSON POST, a bounded body and ownership of the saved note. Client fields cannot select another calendar, user, attendees or arbitrary provider endpoint.
- Google account permissions can be revoked in the Google account's third-party access settings. A dedicated in-app disconnect control is not included in this release.

## Retries and edits

An event ID is derived from signed-in email, saved note ID and original action index. Repeat clicks, lost acknowledgements and another device target the same ID. On Google 409, Folup reads that ID and verifies its contents. It does not silently update an existing event or create another ID if the draft differs. Instead, it asks the user to review the existing event in Google Calendar. Corrections are intended before saving; rearranged action indices after saving can require manual review.

The UI shows **Added ✓** and an **Open in Google Calendar** link only after verified success. A timeout never implies success. The old mobile template deep link is not used to create events.

## Validation

On 2026-09-24, the isolated release (excluding unrelated extraction experiments) passed 271 local tests, a production webpack build and targeted ESLint checks. Tests include ES/EN suggestions, payload fidelity, time-zone conversion, retries, provider failures/mismatches, ownership/CSRF, encryption and SQL access controls. Provider responses in these tests are mocked. This is not proof of a live Google save or physical iPhone behavior; those require a connected account and separate verification. No paid AI calls are required by these changes/tests.
