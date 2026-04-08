/** True if dealer is a real name, not empty or only punctuation (e.g. "."). */
export function isDealerMeaningful(dealer: string | null | undefined): boolean {
  const t = String(dealer ?? '').trim()
  if (!t) return false
  if (/^[.\u00B7\u2022\-–—•\s]+$/u.test(t)) return false
  return true
}

function contactWorksForDealer(
  dealer: string,
  contact: string | null | undefined,
  contactCompany: string | null | undefined,
): boolean {
  const d = dealer.trim().toLowerCase()
  const cc = String(contactCompany ?? '')
    .trim()
    .toLowerCase()
  const c = String(contact ?? '').trim()
  if (!d || !cc || !c) return false
  return cc === d
}

function lineIsEmptyDealerInsight(line: string): boolean {
  const m = line.match(/^🏪\s*Dealer\s*:\s*(.*)$/i)
  if (!m) return false
  return !isDealerMeaningful(m[1])
}

/** Remove model-added closing lines when there is no real distributor name. */
export function stripInvalidDealerCrmTextLines(crmText: string): string {
  const lines = crmText.split(/\r?\n/)
  const out: string[] = []
  for (const line of lines) {
    const t = line.trim()
    if (/^distribuidor\s*:\s*[.\s]*$/i.test(t)) continue
    if (/^orders go through\s*[.\s]*$/i.test(t)) continue
    out.push(line)
  }
  return out.join('\n').trim()
}

/**
 * Key insights: drop 🏪 Dealer bullets with no real name; drop all such bullets if dealer is empty.
 */
export function filterCrmFullDealerWhenNoDealer(
  crmFull: string[],
  dealer: string | null | undefined,
): string[] {
  const lines = crmFull.map((s) => s.trim()).filter(Boolean)
  const withoutEmptyBullets = lines.filter((line) => !lineIsEmptyDealerInsight(line))
  if (isDealerMeaningful(dealer)) return withoutEmptyBullets
  return withoutEmptyBullets.filter((line) => !/🏪\s*Dealer\s*:/i.test(line))
}

/**
 * Ensure one 🏪 Dealer line when dealer is meaningful; strip bad/empty dealer lines first.
 * When the direct contact works for that dealer (contactCompany === dealer), append " (Contact)" to the dealer bullet if missing.
 */
export function ensureDealerInsightInCrmFull(
  crmFull: string[],
  dealer: string | null | undefined,
  contact?: string | null | undefined,
  contactCompany?: string | null | undefined,
): string[] {
  const d = String(dealer ?? '').trim()
  let lines = crmFull.map((s) => s.trim()).filter(Boolean)
  lines = lines.filter((line) => !lineIsEmptyDealerInsight(line))
  if (!isDealerMeaningful(d)) {
    return lines.filter((line) => !/🏪\s*Dealer\s*:/i.test(line))
  }
  const dLower = d.toLowerCase()
  const c = String(contact ?? '').trim()
  const atDealer = contactWorksForDealer(d, contact, contactCompany)
  const contactSuffix = atDealer && c ? ` (${c})` : ''

  const appendContactToDealerLine = (line: string): string => {
    if (!atDealer || !c) return line
    const m = line.match(/^(\s*🏪\s*Dealer\s*:\s*)(.+)$/i)
    if (!m) return line
    const body = m[2].trim()
    if (body.includes('(') || body.includes(')')) return line
    if (body.toLowerCase().includes(c.toLowerCase())) return line
    return `${m[1]}${body} (${c})`
  }

  lines = lines.map(appendContactToDealerLine)

  const hasDealerBullet = lines.some(
    (line) => /🏪\s*Dealer\s*:/i.test(line) && line.toLowerCase().includes(dLower),
  )
  if (hasDealerBullet) return lines
  return [`🏪 Dealer: ${d}${contactSuffix}`, ...lines]
}

/**
 * Append dealer closing line when meaningful; strip orphan "Distribuidor: ." lines always.
 */
export function ensureDealerInCrmText(
  crmText: string,
  dealer: string | null | undefined,
  spanish: boolean,
): string {
  let text = stripInvalidDealerCrmTextLines(crmText)
  const d = String(dealer ?? '').trim()
  if (!isDealerMeaningful(d)) return text

  const closing = spanish ? `Distribuidor: ${d}.` : `Orders go through ${d}.`

  if (text.toLowerCase().endsWith(closing.toLowerCase())) return text

  const lineLines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const lastLine = lineLines[lineLines.length - 1] || ''
  if (
    lastLine.toLowerCase().includes(d.toLowerCase()) &&
    (/\borders go through\b/i.test(lastLine) || /^distribuidor\s*:/i.test(lastLine))
  ) {
    return text
  }

  return `${text}\n\n${closing}`
}
