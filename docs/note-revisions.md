# Note revisions — first memory foundation

## Scope

Migration `20260925000100_note_revisions.sql` adds server-only snapshots without
changing the current notes API, UI, AI calls, trial accounting or Calendar IDs.
Applied to Supabase production project `iownaoghocmubpxwrnlk` on 2026-09-25
through the SQL editor, with session-local 5s lock and 30s statement timeouts.

`folup_notes` remains the current snapshot. Every meaningful insert/update creates
an immutable application-level revision in the same transaction, with a UUID,
per-note sequence, parent UUID, database recording time, original note creation
time, transcript and complete structured output. Existing capturedAt/timezone
fields remain in the JSON unchanged. The authenticated route's owner is retained;
`source=updated` does not claim the edit came from voice or a particular device.

The migration captures one baseline for existing notes under a write lock and
installs the trigger before releasing it. Baseline time is migration time, NOT
the time of an unrecoverable historical edit. No old versions are fabricated.

## Guarantees and limits

- Equal current transcript + JSONB output: no extra revision on immediate retry.
- A → B → A creates three revisions; do not deduplicate all historical content.
- A delayed stale retry after another edit is still a new revision. This step
  preserves both writes; it does NOT implement optimistic concurrency or prevent
  stale overwrites. Request IDs and expected-revision checks are a separate step.
- Row locking serializes updates of one note. A failed revision insert aborts the
  note update. Composite foreign keys keep parent links within one owner's note.
- The application service role can read but not directly insert/update/delete
  revisions. Only the owner-defined trigger writes them. Privileged database
  administrators can still change data; this is not tamper-proof audit storage.
- RLS and revoked anon/authenticated access match the existing server-only model.
  Service-role reads still require explicit owner filtering in any future route.
- Deleting a note cascades to its revisions. No indefinite retention or public
  revision endpoint is introduced. Calendar events are unchanged.

## Production verification — 2026-09-25

- Before: 18 notes, 42,738 bytes of transcript/JSON payload; revision table absent.
- After: 18 notes, 18 matching baseline revisions. Complete current-row aggregate
  fingerprint unchanged: `e9aea0e27dddac78d8495cc6c5cd5516`.
- A rolled-back production transaction under service_role verified insertion,
  correction, identical retry (two revisions total), parent linkage, same UUID
  under another owner, cascade deletion and preservation of the other owner.
  No synthetic rows retained; no AI or Calendar calls made.
- No historical revisions were recoverable before this migration. Baselines start
  at this release. No new backup was created or restore drill performed.

## Future release/recovery checklist

1. Verify the live base schema, migration history, roles and note count. Confirm
   the current backup/restore path. Estimate baseline JSON volume and lock time.
2. Apply the migration during a quiet period; it is additive but briefly blocks
   writes to folup_notes. Do not run a large backfill blindly.
3. Verify baseline counts and unchanged current rows. In a rolled-back synthetic
   transaction verify create, update, equal retry, tenant separation and deletion.
4. Check normal notes and Calendar still work. There is no application deployment
   required for the existing upsert route to start producing revisions.
5. If needed, disable ONLY the capture trigger after explicit review; keep captured
   history. Do not drop the revisions table as routine rollback. Re-enabling after
   writes creates a coverage gap that must be recorded, not concealed.

Local tests execute the migration in PGlite, including rollback, permissions,
baseline capture, same UUID under two owners and cascade deletion. Real concurrent
connections and production migration latency still need a staging/live rehearsal.
