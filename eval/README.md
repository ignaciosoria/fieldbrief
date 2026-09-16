# Folup extraction evaluations

## September 15: 100 messy TEXT notes

No audio was generated, uploaded or transcribed in this exercise. `messy-text-corpus.ts`
defines 100 fictional inputs (25 families × 4 variants, 50 Spanish / 50 English).
Inputs are 713–1,034 characters and deliberately explicit about some cancellations
and ownership. These are templated stress cases, not 100 independent real visits or
a statistical estimate of production accuracy. The user's exact example was not sent.

The same production extraction function and pinned `gpt-5.4-2026-03-05` model ran
three times against the unchanged input/expectation corpus. Original result files
are immutable. Each run records the prompt and corpus hashes, output, usage and time.
No app notes, Google events or customer records were created by these runs.

- Round 1 (`messy-text-1.jsonl`): 94/100 original contract checks. Missing specialist
  consultation once; capitalization-only evidence rejection once; missing report
  geography in four calendar descriptions.
- Round 2: 100/100 original checks. Manual inspection found failures outside that
  rubric: unreported purchases turned into denials and a past non-promise turned
  into a future prohibition. Do not present that 100/100 as complete correctness.
- Round 3: 99/100 original checks; the flag is `father` versus the whitelist's
  `the father`, not a switch to the son. The role remains less self-contained than
  `Ana's father`, so this wording is still a UX improvement opportunity.
- Added factuality audit, reapplied equally offline to all three recorded rounds:
  73/100 → 90/100 → 98/100 pass the combined checks. It uses narrow patterns and
  needs manual interpretation. This audit was authored after rounds 1/2, not blindly.
  Its initial false positive for “No hubo compra reportada” was fixed without
  modifying recorded outputs. The final real residual is `messy-05-3`: “no purchase
  was mentioned” becomes “no purchase happened” in CRM prose. Actions remain correct.
- The original 25 held-out variants passed 24/25 then 25/25 on the original checks.
  Their outputs were subsequently inspected, so round 3 is NOT a new blind holdout.
- Old regression suite: round 13 is 42/42; round 14 is 41/42 raw checks. The latter
  flags `es-past-and-future` merely for mentioning Z9. Manual review: input explicitly
  says the warranty has not been discussed; output repeats that negative, with
  correct action/date/recipient. Keep this distinction visible instead of claiming
  42/42 automated or changing an assertion just to obtain a green score.

Measured median extraction latency: 5.219 s baseline, 4.976 s round 2, 5.258 s final.
P95: 7.894 s, 7.014 s, 8.485 s. These are local SDK round-trip times with batched
concurrency, not mobile recording-to-screen latency. There is no demonstrated speedup.

384 paid text calls total: 300 stress calls + two 42-case regression runs.
Conservative usage cost: $5.1873025; using reported cached-input tokens: $3.6753025.
Neither is an invoice reconciliation. This fits the $1.6958655 previous balance plus
the explicitly approved $5 addition. Conservative remaining ledger balance: $1.508563.
At the final run's mean usage, 100 similar text notes cost about $1.48 without cache
discount, 1,000 about $14.81. Audio, hosting, taxes and future retries are excluded.
No model migration, extra inference call, schema change or UI redesign was introduced.

Offline summary (does not consume API):

```sh
node --import tsx eval/summarize-messy-text.ts messy-text-1 messy-text-2 messy-text-3
```

Paid reruns require a new, explicitly budgeted reservation in `api-budget.json` and
a fresh `FOLUP_EVAL_RUN=messy-text-N`. The runner refuses an existing output path,
checks the reservation before each four-request batch, holds $0.09 for unknown-cost
failures and does not retry automatically. Do not run it as part of CI or `npm test`.
Recorded replay tests are offline and validate downstream behavior, not future AI accuracy.

Official references checked: [GPT-5.4 rates](https://developers.openai.com/api/docs/models/gpt-5.4),
[model-specific prompting](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.4),
[evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices).
These informed bounded, task-specific checks, baseline comparison and manual review.

## Historical output-quality baseline — block 0

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
