# Sol migration preparation — 2026-09-24

## Scope and activation

Not deployed. No environment configuration, database, UI, calendar behavior, model API endpoint or schema was changed in production. GPT-5.4-2026-03-05 remains the default in code.

The server-only `FOLUP_VISIT_MODEL` setting accepts exactly `gpt-6-sol` or `gpt-5.4-2026-03-05`. Empty/unset keeps the pinned baseline; invalid values fail before an API call. It is not read from the user's request. Explicit model arguments remain available for internal evals.

To activate after release approval: deploy the reviewed candidate to a preview environment with `FOLUP_VISIT_MODEL=gpt-6-sol`, verify note creation/correction and Calendar payloads there, then promote that configuration. To roll back the model, set `FOLUP_VISIT_MODEL=gpt-5.4-2026-03-05` (or remove the setting) and redeploy/restart the server. This model rollback does not undo prompt changes or previously saved notes. For a full behavior rollback, restore the previous deployment.

Sol preserves low reasoning, strict structured output, one API call, 4,000 output-token limit, 45-second timeout and zero automatic retries. Temperature is omitted for both GPT-5 and GPT-6. The active extractor and the eval use the same request builder and parser. No Responses migration is needed for this tool-free structured-text request. Compatibility checked with OpenAI Docs: https://developers.openai.com/api/docs/guides/latest-model.

## Fix

The sales prompt now explicitly distinguishes the narrator correcting their words from a real commercial cancellation. It retains the corrected instruction without inventing a canceled quote, customer rejection or discussion history. Explicit actual cancellations remain facts, including a cancellation whose quantity is itself corrected. Scope stays with the correct person/item.

There is no regex deletion of cancellation text and no extra inference pass. An additional attribution rule prevents an unattributed no-contact instruction from becoming a request supposedly made by the customer.

## Evidence and limits

First verification: `eval/sol-correction-20260924.jsonl`, 8 cases × 2 calls, one original failing case and seven new focused examples. All 16 passed the frozen narrow cancellation checks and source validation. Cost estimate $0.2021. Manual review caught an additional attribution error in both mixed-scope responses: “Do not contact Nadia” became “Nadia asked not to be contacted.” These responses are preserved, not relabeled as globally correct.

Follow-up after the attribution rule: `eval/sol-correction-attribution-20260924.jsonl`, two targeted cases × two calls. This is not a rerun of all eight cases with the final prompt. New cases were written before this run but directly target known issues: not an independent broad holdout.

All four targeted follow-up responses preserve the distinction: Nadia's instruction remains unattributed, while Alma's explicit customer request is retained. Manual review completed for all 20 outputs. Follow-up estimate $0.04949; combined $0.25159. Remaining authorized budget $3.35966275. No further paid runs performed.

Offline regression tests preserve recorded outputs, action dates and owners for the original two-contact case, source evidence validation, default selection, opt-in configuration, rollback and request parameters. They do not prove future model outputs always satisfy the semantics.

## Release gates

- Review the existing dirty workspace and include only the intended release changes/dependencies. This workspace already contains unrelated trial and output work; do not deploy the whole workspace blindly.
- Resolved the 13 `natural-text-replay` presentation mismatches after individual review. Historical outputs and views remain unchanged; explicit reviewed expectations live in `test/fixtures/natural-rendering-migration.ts`. See the audit below. Full local suite: 316/316; production build passes. This does not certify the archived model prose as factually correct.
- Complete preview end-to-end verification and broader new-case coverage before production activation. No preview deployment, mobile verification or production Calendar write was performed here.
- The broader comparison's unresolved-date CRM presentation issue and model factuality limits remain relevant; this scoped patch is not a claim to fix every output problem.

## Rendering replay audit

All 13 failures were old whole-view expectations, not exceptions in the runtime renderer. Reviewed changes:

- All cases: current concise CRM section headings; compact narrative instead of appended insight paragraphs. Legacy compaction deliberately retains potentially informative repetitions rather than deleting context; new `crmNarrativeVersion=1` records use the complete narrative contract.
- 09, 21, 22, 26, 27, 28, 29, 30: omit repeated action owner when the sole owner is already unambiguous in the header.
- 05, 23, 24, 25, pair-05: current identity separator and action-grounded person/company associations. Do not invent pairings for people without a confirmed action relationship.
- 05, 09, 23, 25, 29, pair-05: omit separate location when already present in narrative/header.
- 05 and pair-05 only: preserve “el padre de Diego” in the meeting title; remove the now-redundant identity prefix in its description. All other calendar fields remain compared with the frozen originals.

Tests still compare every rendered field exactly, preserve frozen action wording/dates/questions/insights, enforce 44-character calendar titles, check no mutation and require one reviewed expectation per archived case. There is no bulk snapshot regeneration. Archived defects in natural-26 (future lab purpose presented as reported issue) and natural-29 (unresolved dates in prose) are explicitly preserved as known bad evidence, not semantically approved gold outputs.

Validation after this repair: `node --import tsx --test test/*.test.ts` 316 passed, zero failed; `npx tsc --noEmit` passed; focused ESLint passed; `npm run build` passed; `git diff --check` passed. No paid API calls, production configuration changes, deployment or Calendar writes in this repair step. Preview end-to-end and broader semantic validation remain release gates.
