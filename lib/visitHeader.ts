import type { VisitExtraction } from './visitExtraction'

/** Display existing identities; never infer associations from array positions. */
export function visitHeader(extraction: VisitExtraction): string {
  const key = (value: string) => value.trim().toLowerCase()
  const unique = (values: string[]) => [...new Map(values.filter(v => v.trim()).map(v => [key(v), v.trim()])).values()]
  const contacts = unique(extraction.contacts)
  const companies = unique(extraction.companies)
  const usedCompanies = new Set<string>()
  const parts = contacts.map(contact => {
    const matches = companies.filter(company => extraction.actions.some((action, index) =>
      key(action.contact) === key(contact) && key(action.company) === key(company) &&
      !extraction.questions.some(q => (q.action_index === index || q.action_index === -1) &&
        (q.field === 'contact' || q.field === 'company'))))
    // Conflicting organizations are not a confirmed identity pairing.
    if (matches.length !== 1) return contact
    usedCompanies.add(key(matches[0]))
    return `${contact} — ${matches[0]}`
  })
  parts.push(...companies.filter(company => !usedCompanies.has(key(company))))
  return parts.join(' / ')
}
