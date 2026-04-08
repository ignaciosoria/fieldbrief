/** True if dealer is a real name, not empty or only punctuation (e.g. "."). */
export function isDealerMeaningful(dealer: string): boolean {
  const t = dealer.trim()
  if (!t) return false
  if (/^[.\u00B7\u2022\-–—•\s]+$/u.test(t)) return false
  return true
}

/** Strip 🏪 Dealer bullets from Key insights when there is no real dealer. */
export function filterCrmFullDealerWhenNoDealer(crmFull: string[], dealer: string): string[] {
  const lines = crmFull.map((s) => s.trim()).filter(Boolean)
  if (isDealerMeaningful(dealer)) return lines
  return lines.filter((line) => !/🏪\s*Dealer\s*:/i.test(line))
}
