# Entity matching in shadow mode

Status: local implementation; migration and deployment pending. No production
matches evaluated or identity-confirmation prompts enabled by this change yet.

## Purpose

Observe what the first deterministic candidate policy would suggest before
introducing a user-facing question. This compares mentions between visits because
production currently has no confirmed canonical entities. A review candidate is
NOT a verified person, an employment relationship, or a probability of identity.

## Runtime

After a successful versioned note save, Next.js `after` invokes the private
`evaluate_folup_entity_shadow(owner,note)` RPC. It is not awaited by the save
response. Scheduling/RPC failures are caught with a generic, non-personal log;
they do not report an already-saved note as failed. The client request to the RPC
has a 3-second timeout. Evaluation locks the source note against concurrent edits
and processes at most 128 current-revision mentions and 21 candidate visits per
mention, retaining up to 20 references. More than 20 causes abstention.

This is best-effort background work, NOT a durable worker or scheduled monitor.
Failed/missed evaluations can be retried with the same owner-scoped RPC. No AI
calls, new paid service, cron job or public matching endpoint is introduced.
The 3-second client timeout is not a guarantee of database-side cancellation.

## Policy exact-context-v1

- Same owner and entity kind; exact normalized name only (case/whitespace).
- Prior visits only; current candidate revision must have been recorded no later
  than the source revision. Superseded candidate identities are not reused.
- Deduplicate repeated action/header mentions to one candidate per prior note.
- Require literal token-bounded name presence in the original text; Ann does not
  qualify just because Joanne appears. This is a guard, not semantic verification
  of negation, roles or attribution.
- Abstain for unresolved identity questions, already-confirmed mentions,
  recommendation-origin action identities and generic relationship/role labels.
- For contacts, matching nonempty action-company context must be literal in both
  notes and not marked uncertain. Different/missing contexts cause abstention.
  Header contact/company arrays are never zipped into affiliations.
- Exact company-name matches may be reviewed, never auto-confirmed. Corporate
  suffix variants, accent variants and first-name expansions are not matched.
- An independent advisor may legitimately appear with multiple customer companies.
  Different contexts cause abstention, not a claim of different people/employers.

## Storage and safety

`folup_entity_shadow` stores the versioned decision, reason, timestamp and candidate
count at evaluation time. `folup_entity_shadow_candidates` references the source
and candidate mentions; their revisions provide provenance. References cascade
when supporting notes are deleted. Historical counts/decisions reflect the original
evaluation; remaining references may shrink after deletion, so these records must
not be treated as a live UI answer. No names/transcripts are duplicated in logs.

RLS is enabled; application code can read but cannot directly write the tables.
Only the service-role evaluation function writes them. No entity IDs, confirmations,
commercial recommendations, notes, Calendar links or prompts are modified.

## Evaluation and next gate

Local verification: 358/358 tests passed; TypeScript and production webpack build
passed. These results do not include production latency or real-note match quality.

Synthetic database tests cover same-context repeat visits, duplicate mentions,
same-name different-company cases, missing context, independent advisors, role and
family references, unclear names, recommendation origin, ungrounded names/company,
substring names, accents, future visits, superseded revisions, candidate caps,
cross-owner isolation, repeat evaluation, permissions and deletion cascades.

Passing these policy tests does NOT establish precision on real users. Before
showing prompts: migrate, collect shadow results, measure coverage and evaluation
failures, manually label candidate pairs (same/different/insufficient evidence),
and inspect the false suggestions and unnecessary interruptions. Keep a held-out
set. Do not compute identity accuracy from deterministic rule-test pass rates.

## Release

Apply `20260925000500_entity_shadow.sql` before deploying the application commit.
The migration is additive and performs no historical evaluation or confirmations.
After release verify a rolled-back synthetic RPC call, permissions, unchanged note
fingerprints, and successful note saves when shadow evaluation is unavailable.
Historical evaluation is an explicit separate operation, not an automatic backfill.
