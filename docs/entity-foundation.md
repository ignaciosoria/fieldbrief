# Contact and company identity foundation

Status: implemented locally; not migrated or deployed.

## Scope and safety boundary

The existing extraction contains parallel contact/company lists and per-action
context, not reliable attendance or employment relationships. It cannot safely
establish that two occurrences of Mike are one person, or that David works at the
customer simply because an action mentions both. This release therefore captures
evidence and prepares explicit identity confirmation; it does NOT automatically
resolve names or supply commercial memory to the model.

- `folup_entities`: private canonical UUIDs, with kind contact/company and a label.
  Names are not unique keys. Identical names may have different IDs.
- `folup_entity_mentions`: original label, normalization, header/action source,
  source index, note revision, action evidence, company context, recommendation
  origin and unresolved-question flag. A company context is NOT an employer.
- Each occurrence starts unresolved. The backfill creates mentions only; it
  creates no canonical entities, aliases, affiliations or inferred meetings.
- Only structured identity fields are captured. Summary/insight names such as a
  competitor or credit approver are not promoted to contacts or companies.
  Incorrect model header fields remain unconfirmed evidence, not verified facts.

## Matching and explicit confirmation

`folup_entity_candidates(owner, mention)` returns owner/kind-scoped candidates
using exact labels or previously explicitly confirmed spellings. Normalization
only collapses whitespace and case. No accent removal, phonetic matching, company
suffix stripping, first-name expansion, cross-owner search or inferred affiliation.
Even one candidate is NOT an automatic match. Historical confirmations may suggest
a candidate but never confirm the identity of a new encounter.

`confirm_folup_entity(owner, mention, target)` is a server-only primitive for a
future explicit confirmation flow. No browser endpoint or UI calls it in this
release. NULL target confirms a new identity; an existing target must belong to
the same owner and entity kind. Ambiguous mentions and old note revisions cannot
be confirmed. Repeating the same confirmation retains its UUID; attempting to
reassign a confirmed mention is rejected. Every newly saved revision starts with
unresolved occurrences; no hidden entity merges happen on correction.

## Persistence and deletion

Capture runs in the note save transaction after the existing revision trigger.
Existing raw text, extraction, action IDs, Calendar links and model prompts are
unchanged. An unchanged semantic snapshot creates no duplicate mentions.
Mentions reference their complete original revision for provenance. Corrections
append evidence rather than overwrite it. RLS and restricted service-role access
prevent client reads/writes. Note deletion cascades to its mentions; an entity is
removed once no supporting mention remains. Deleting all notes therefore leaves
no orphan canonical names. Entities with other supporting visits remain intact.

## Release and follow-up

Apply `20260925000400_entity_foundation.sql` in a quiet window with bounded lock
and statement timeouts. It backfills all retained revisions under a note write
lock. Check revision count/size before applying at larger scale. Verify unchanged
note fingerprints and zero canonical entities before explicit confirmation.
No app deployment is needed to start capture. No migration is applied yet.

Next stage: design a lightweight identity-confirmation interaction and evaluate
candidate precision on real permitted notes before enabling any automatic links.
Do not add opportunity state, outcome tracking or recommendation retrieval yet.

## Tests

Full local suite: 357/357 passing. TypeScript and diff checks passed. Production
concurrency/load behavior has not been tested; deletion cleanup was exercised in
single database transactions, not concurrent independent sessions.

PGlite integration executes all preceding migrations and this one. It checks
unchanged baseline notes; names mentioned only in context; two homonymous Mikes;
case/whitespace candidates; explicit company aliases; cross-kind and cross-owner
rejection; unresolved questions; David as action context rather than employment;
parent/son separation; no zip of parallel lists; corrections and stale confirmations;
idempotent capture/confirmation; malformed/legacy fields; private permissions;
and deletion cleanup. These are deterministic synthetic tests, not production or
paid-model evaluations. No UI/model/Calendar behavior is changed.
