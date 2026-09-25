# Stable calendar action identity

Status: implemented and verified locally; not deployed or migrated to production.

## Behavior

- Each extracted action receives a database UUID, independent of its position in the note.
- Unique, exact content matches preserve identity when reordered or rescheduled. Date, time, daypart and explanatory/evidence fields do not determine identity.
- Google event reservations persist before the external write. Retries reuse the same event ID, including when Google succeeds but link confirmation fails.
- Confirmed links retain the submitted draft and source action snapshot. Reopening a note restores Added and the submitted schedule.
- A changed source snapshot requires review rather than an automatic update or duplicate. Unrecognizable changes after potentially scheduled actions also require review.
- All reads and reservations are owner-scoped. Tables have RLS and only restricted service-role access; mutations go through database functions/triggers.

## Compatibility and limits

Existing actions are backfilled with their current index to preserve the previous deterministic Google event ID. Historical exports are not automatically discovered: a verified export retry can adopt the existing event. Reorders predating this migration cannot be reconstructed reliably. Genuine pre-extraction notes retain their legacy export path.

Matching is deliberately conservative, not semantic. Changes to wording, contact or product can require manual Calendar review. This release does not update/delete Calendar events, poll external edits, or track task completion. Deleting a note removes its local metadata, not its Google event.

## Release order

1. Apply `supabase/migrations/20260925000200_stable_calendar_actions.sql` before deploying the application.
2. Verify backfill, owner isolation and restricted privileges.
3. Deploy the application and verify reopening a saved action and a retry with a disposable test event.

## Local verification

- Full suite: 353 passing tests, zero failures.
- TypeScript and production webpack build: passed.
- PGlite integration: identity across reordering/rescheduling, stale snapshots, retry reservations, changed drafts, ambiguous corrections, duplicate actions, owner isolation, privileges and deletion cascade.
- Google mock: deterministic IDs and conflict/retry recovery.
- Browser fixture: reopening restores Added and the stored September 30, 15:30 schedule; a corrected October 1 action shows the mismatch warning and Calendar review link instead.
- Browser checks use `scripts/calendar-identity-ui-fixture.mjs`, which blocks API writes and does not call AI or Google. This is not production end-to-end verification.
