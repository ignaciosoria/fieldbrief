# Model comparison — 2026-09-24

## Decision

GPT-6 Sol at low effort is the leading balanced candidate, not an approved production migration. It reduced observed semantic concerns versus GPT-5.4, with conservative estimated cost 30.4% lower and median latency 11.6% higher. First address its repeated dictation-correction → commercial-cancellation error, then test genuinely new cases. Astra had the fewest observed concerns, but was not infallible. No deployment or production configuration was changed by this experiment.

## Reproducible evidence

- Corpus: `eval/sales-model-corpus.ts` — 12 synthetic messy text notes, Spanish/English, derived from known failure classes, frozen before calls. Not a pristine holdout.
- Runner: `eval/compare-sales-models.ts`; results: `eval/sales-models-20260924.jsonl`, including frozen prompt/schema, raw responses, usage, request IDs, parsed results, CRM and calendar drafts.
- Checks: `eval/grade-sales-models.ts`, `eval/sales-models-checks.json`.
- Model-masked review: `eval/sales-models-blind.jsonl`, `eval/sales-models-manual-review.json`. Same assistant authored cases and reviewed all 96 outputs; not independent human assessment. Not every rendered calendar draft manually inspected.
- Budget: 96 calls completed; conservative estimate $2.46407275 of newly authorized $6. No unknown-cost requests. Ledger total remaining including earlier funds: $3.61125275. No further paid runs initiated.

## Measured results

All models: same local candidate sales prompt/schema, low reasoning, no temperature, 4,000 output-token cap, standard service, no retries, four requests concurrently per case, two rounds. These are not audio tests or production end-to-end tests.

- GPT-5.4-2026-03-05: 24/24 structurally valid; median 5.651s; p95 9.565s; projected $1.934/100 or $19.338/1,000 text notes.
- GPT-6 Sol: 24/24; median 6.307s; p95 11.061s; $1.346/100 or $13.457/1,000.
- GPT-6 Astra: 24/24; median 7.201s; p95 12.722s; $6.906/100 or $69.061/1,000.
- GPT-6 Luna: 23/24; median 7.513s; p95 15.597s; $0.081/100 or $0.813/1,000.

Latency uses recorded `ms` for all 24 attempts/model, including the rejected response, surrounding SDK call and local processing. Median averages ranks 12/13; nearest-rank p95 is rank 23. Small sample; no significance claim. Prompt cache was active; no cold-start guarantee. Luna's failed parser row lacks `apiMs`, so do not summarize that field across all rows without handling missing data.

Costs use recorded tokens and conservative uncached rates: GPT-5.4 $2.50/$15 input/output per million; Sol $2/$10; Astra $10/$50; Luna $0.10/$0.50, with GPT-6 input multiplied by 1.25 for potential cache-write premium. No cache discounts applied. These are conservative estimates, not invoice reconciliation; exclude audio, hosting and retries. Official source: https://developers.openai.com/api/docs/pricing (checked with OpenAI Docs).

## Content review, not an accuracy leaderboard

Narrow automated checks flagged only Luna's parser failure. Manual review revealed additional issues not measured by those checks:

- GPT-5.4: nine responses with concerns — three factual, two omissions, two precision, two unresolved-date presentation issues. Examples: says customer clarified a dictation correction; converts no past replacement promise into a prohibition on future promises; omits completed label shipment.
- Sol: two responses, same case in both rounds — says quote was canceled when speaker merely corrected the dictated instruction.
- Astra: one factual concern — sent label becomes received label.
- Luna: six responses with utility/usability/style observations, plus one distinct parser rejection. The latter adds a period to a partial evidence quote, causing exact-match failure; this is contract brittleness, not proof the task was invented. Optional omitted recommendation is utility preference, not a broken commitment.

Severity differs, so these counts must not be turned into a unified accuracy percentage. Review is fallible and non-exhaustive. In the tested cases all models preserved father versus son action ownership, multi-contact mapping, no-contact requests and the hypothetical nature of future lab consultation. This is evidence on these examples, not a global bug-resolution claim.

## Before a switch

1. Fix and regression-test dictation correction versus real-world cancellation; sent versus received; unresolved alternatives leaked into CRM.
2. Review the exact-evidence matcher for harmless trailing punctuation without weakening grounding.
3. Test Sol low against none separately on new cases. No speed improvement from that change has been measured yet.
4. Audit production model parameter selection before enabling GPT-6; this runner supplies correct parameters directly rather than using the generic extractor dispatch.
5. Keep the existing one-call flow. Do not add universal second-pass review without proving it is worth the latency.

No model migration, production config change or Calendar event creation took place. Only eval files, review artifacts and the budget ledger were written in this experiment; other existing dirty workspace changes were preserved.
