// Server-side selection only. Keep the deployed baseline until migration is approved.
export const VISIT_MODEL = 'gpt-5.4-2026-03-05'
export const VISIT_CANDIDATE_MODEL = 'gpt-6-sol'

export function configuredVisitModel(value: string | undefined = process.env.FOLUP_VISIT_MODEL) {
  if (!value?.trim()) return VISIT_MODEL
  const model = value.trim()
  if (model !== VISIT_MODEL && model !== VISIT_CANDIDATE_MODEL) {
    throw Error('Unsupported FOLUP_VISIT_MODEL')
  }
  return model
}

export function visitModelParameters(model: string) {
  // GPT-6 low reasoning must not receive temperature. Explicit model arguments
  // remain available to offline evals; public requests cannot select a model.
  return /^gpt-[56](?:[.-]|$)/.test(model)
    ? {reasoning_effort: 'low' as const}
    : {temperature: 0}
}
