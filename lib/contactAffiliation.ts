/**
 * Where the direct contact works: **only** the explicit `contactCompany` from the model
 * (or UI / stored row). Never substitute **customer** (end account) — they differ when
 * the rep met someone at a partner/distributor while **customer** is the buyer org.
 */
export function resolveContactCompany(
  _customer: string,
  _contact: string,
  _nextStepTarget: string,
  modelHint: string,
): string {
  return modelHint.trim()
}
