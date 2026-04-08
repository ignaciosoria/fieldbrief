/** Loose match: is this contact name tied to this org string (same token / substring)? */
export function contactAlignsWithOrg(contact: string, org: string): boolean {
  const c = contact.trim().toLowerCase()
  const o = org.trim().toLowerCase()
  if (!c || !o) return false
  if (c === o) return true
  if (o.includes(c) || c.includes(o)) return true
  const cWords = c.split(/\s+/).filter((w) => w.length > 2)
  const oWords = o.split(/\s+/).filter((w) => w.length > 2)
  for (const cw of cWords) {
    for (const ow of oWords) {
      if (ow.includes(cw) || cw.includes(ow)) return true
    }
  }
  return false
}

/**
 * Where the direct contact works: prefer API `contactCompany` (separate from customer/dealer).
 * If empty, infer from dealer/customer + name alignment for legacy notes.
 */
export function resolveContactCompany(
  dealer: string,
  customer: string,
  contact: string,
  nextStepTarget: string,
  modelHint: string,
): string {
  const hint = modelHint.trim()
  if (hint) return hint

  const person = (nextStepTarget || contact || '').trim()
  const d = dealer.trim()
  const c = customer.trim()

  if (!d && !c) return ''
  if (d && !c) return d
  if (c && !d) return c

  const alignD = contactAlignsWithOrg(person, d)
  const alignC = contactAlignsWithOrg(person, c)
  if (alignD && !alignC) return d
  if (alignC && !alignD) return c
  return ''
}
