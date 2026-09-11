# Output-quality baseline — block 0

Created September 11, 2026 against application commit ae631cb. No application or production behavior changed. No external APIs called.

## Block 1 — preserve extracted action intent

The mapper no longer changes action types based on whole-note keyword searches
(send/call order, delivery vocabulary, or meeting discussion heuristics). It preserves
the supplied structured actions; the existing downstream ranking still chooses order.
This does not validate whether the model extracted the correct actions in the first place.
The prompt and model are unchanged, so semantic extraction mistakes remain possible.

`test/action-intent-preservation.test.ts` adds 11 regressions, including Q01 (moved out
of the red suite). Ten exercise the mapper plus shared server pipeline with controlled
JSON; one verifies multiple actions and an unrelated supporting type remain distinct.
Coverage: ES/EN negation, completed email, customer-owned tasks, contextual contract,
meeting/follow-up and positive send/call controls. No paid model or audio calls.

Observed after block 1: 43 normal tests pass; all 5 legacy compatibility scenarios pass;
production build passes. Red quality suite: 2 controls pass, Q02–Q06 still fail (5).
These are the remaining known defects, not regressions hidden by skipped assertions.

Risk: removing the heuristics also removes their attempts to repair incorrect model output.
Rather than inventing replacement commitments, address that in the prompt/contract block
with grounded extraction tests. Full authenticated model→browser evaluation remains pending.

## Commands and observed results

- `npm test`: 32 passed (15 existing + 17 corpus-integrity checks).
- `npm run test:output-quality`: 2 control tests passed, 6 desired-behavior tests failed. Exit code 1 is intentional while those defects remain. They are **not** skipped or asserted as correct behavior.
- `./node_modules/.bin/tsc --noEmit --incremental false`: passed.

The quality command is separate from the green regression command so failures remain explicit without disguising them as successes. Both results must be reported when assessing extraction changes. As defects are fixed, move their tests into the normal regression suite; never change the expected behavior just to make a test green.

## Corpus

`visit-corpus.ts` contains 16 synthetic development notes, 8 ES / 8 EN. Each includes independently authored expectations: actions, quoted evidence, facts for CRM, forbidden claims, and necessary clarifications. It is **not** generated from current model output. Fixed reference time and zone make relative dates reproducible.

The integrity tests verify structure, coverage, quoted evidence and basic dates. They do not prove factual correctness of every expectation or that Folup extracts these notes correctly. CRM facts and forbidden claims are currently a human-review rubric, not an implemented semantic grader. Full model evaluation and audio recordings remain pending. These development examples must not be presented as a held-out evaluation set.

Important semantics:

- No date mentioned is not the same as an ambiguous date: save without a date; ask when needed for calendar export.
- Self-corrections supersede the corrected words; do not create an extra action for the discarded date/person.
- Customer tasks and completed tasks belong in context, not the rep's outstanding actions.
- No agreed follow-up may yield zero actions; do not manufacture a sales task to fill a required primary slot.
- Multiple people/companies must stay attached to their own actions.
- Product names must be preserved even when the surrounding language differs.

## Red tests / planned fix sequence

1. Q01: fixed in block 1; retained in the normal regression suite.
2. Q04: deliverable truncated mid-phrase.
3. Q02 / Q03 / Q06: missing meeting type, company per action, and empty action representation require the contract block.
4. Q05: accented name changes English language classification.

The tests inject controlled structured responses into real parser/mapper functions. They isolate postprocessing, not model accuracy. Q06 currently probes an empty primary representation; update the adapter, not the zero-action requirement, when adopting the canonical actions contract.

The existing `test:structured-ai` harness is retained for legacy compatibility only. Its five hand-authored JSON fixtures include unsupported facts and are **not ground truth for semantic evaluation**. Do not use its passing result to claim no hallucinations.

## Still to add

- Shared clarification logic regression tests after extracting it from the UI; backend confidence flags alone do not reproduce UI behavior.
- Full pipeline and browser assertions: actions on screen, CRM clipboard, correction precedence, and per-action calendar payloads.
- Expand to the planned 40 text notes and a separate reserved set; review the rubric with realistic user vocabulary.
- Audio/noise, perceived quality, latency and cost tests after presenting scope and budget for approval.

Methodology reference: [OpenAI evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices). No paid evaluation was run.
