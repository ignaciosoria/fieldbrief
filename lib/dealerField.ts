/** Remove distributor/dealer insight bullets (legacy data + model drift). */
export function stripDealerLinesFromCrmFull(crmFull: string[]): string[] {
  return crmFull.filter((line) => !/^🏪\s*Dealer\s*:/i.test(line.trim()))
}

/** Remove distributor-only closing lines from CRM prose. */
export function stripDealerClosingFromCrmText(crmText: string): string {
  const lines = crmText.split(/\r?\n/)
  const out: string[] = []
  for (const line of lines) {
    const t = line.trim()
    if (/^distribuidor\s*:/i.test(t)) continue
    if (/^orders go through\b/i.test(t)) continue
    out.push(line)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()
}
