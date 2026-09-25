# Versioned note saves

Status: migrated and deployed to production on 2026-09-25.

## Production release verification

- Commit `6afe2e1d560d8b695bd10226e9456d694f118f0b`; Vercel deployment
  `9tMgM1vf3EXPScjPxuSZXgPqa8w9` Ready / Production / www.folup.app (34s build).
- Migration applied through Supabase SQL editor to `iownaoghocmubpxwrnlk` with
  5s lock and 30s statement timeouts.
- All 18 existing notes unchanged apart from version=1. Before/after fingerprint
  excluding the new version column: `19386e9d12959fe8b90969b538e19529`.
- Rolled-back service-role transaction passed create, identical retry, correction,
  stale-version rejection, delayed original retry rejection, owner isolation and
  exactly two semantic revisions. Zero write receipts remained after rollback.
- Direct service-role note UPDATE denied; service save RPC allowed; anon save RPC
  denied. Unauthenticated GET /api/notes returned 401.
- Published authenticated browser loaded the Record screen and all 18 history
  entries. No real AI processing or Calendar writes were performed for this release.
- The browser failure/retry scenarios were tested with local fixtures; no real
  customer note was edited to test the published HTTP write route.

## Contract

GET /api/notes includes a positive `version` for each note. PUT requires an
`expectedVersion` (0 for a new note) and UUID `requestId`. Owner identity comes
only from the server session. Older clients without this contract receive 428.

The database function serializes writers for the owner/note, checks the current
version, binds the trial result, writes the note and stores a receipt in one
transaction. Existing revision and action triggers continue to run. Direct
service-role INSERT/UPDATE on notes is revoked so older code cannot bypass the
check. SELECT and DELETE remain available through the existing owner-scoped API.

Same request, same payload, same current saved version: return the original
success without another write. A reused request with different content, a stale
version, or a delayed retry after a newer write receives 409. No automatic merge
or forced overwrite. Note version counts accepted writes, not semantic revisions.

The client retains the exact pending payload, original expected version and
request ID in owner-scoped tab memory. Double clicks share the in-flight request.
Retries do not regenerate AI output or substitute the older visible result.
Voice and clarification checkpoints retain the version used to start the edit.
Failures offer copying the pending transcript before reloading the latest note.
Pending clarification inputs are locked until that exact save is resolved.

## Limits

- Pending recovery is in memory, not durable offline storage. Keep the page open;
  copy pending text before refreshing. Closing/reloading the tab loses its draft.
- Conflicting versions are not merged automatically. The user must review the
  latest note and reapply the correction. No force-save endpoint is provided.
- Receipts contain the saved payload, are private, and cascade with note deletion.
- No changes to AI prompts/models, calendar mutation logic or the normal layout.

## Release

Apply `20260925000300_note_write_conflicts.sql` then deploy promptly in a quiet
window. Revoking direct writes intentionally makes the previous server's save
route fail closed between migration and deployment. Old browser tabs must reload
after copying unsaved edits. Do not roll back to the old application and expect
its direct upsert path to work without a separately reviewed database change.

After release, verify owner-scoped history includes versions, unauthenticated
requests fail, old clients fail closed, and a rolled-back synthetic transaction
passes create/edit/retry/conflict checks. Do not use real customer edits as tests.

## Verification

- Full local suite: 356/356 passing. Production webpack build and TypeScript passed.
- PGlite integration: create, competing create, edit, timeout retry, stale tab,
  delayed retry after a newer edit, changed request payload, owner isolation,
  unchanged action identity, revision counts, denied bypass writes, deletion and
  denied anon/authenticated access. This is not a multi-connection PostgreSQL
  load test.
- Client tests: exact payload retained after failure, original version retained
  despite newer supplied version, double-click coalescing, owner isolation and
  malformed success response recovery.
- Browser local fixture exercises a failed response followed by identical retry,
  and a 409 conflict with a copy-pending-correction affordance. The fixture blocks
  all unmocked APIs; no paid AI or real Calendar writes are involved.
- Final browser replay confirmed the pending input is locked, Retry saving reuses
  the same payload/version/request, the dialog closes on success and the earlier
  error disappears. Existing Calendar Added state remains intact in the fixture.
