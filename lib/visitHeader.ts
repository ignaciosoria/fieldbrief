import type { VisitExtraction } from './visitExtraction'

/** Display existing identities; never infer associations from array positions. */
export function visitHeader(extraction: VisitExtraction): string {
  const key = (value: string) => value.trim().toLowerCase()
  const unique = (values: string[]) => [...new Map(values.filter(v => v.trim()).map(v => [key(v), v.trim()])).values()]
  const contacts = unique(extraction.contacts)
  const companies = unique(extraction.companies)
  const usedCompanies = new Set<string>()
  const escape = (value:string) => value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
  const parts = contacts.map(contact => {
    const unresolved = extraction.questions.some(q => (q.field==='contact'||q.field==='company') &&
      (q.action_index===-1 || key(extraction.actions[q.action_index]?.contact || '')===key(contact)))
    const matches = companies.filter(company => extraction.actions.some((action, index) =>
      action.origin !== 'recommendation' && key(action.contact) === key(contact) && key(action.company) === key(company) &&
      !extraction.questions.some(q => (q.action_index === index || q.action_index === -1) &&
        (q.field === 'contact' || q.field === 'company'))))
    // A contact with only a proposed action can still have an explicit affiliation
    // in the factual narrative. Accept a direct paragraph-opening attribution only;
    // never pair by array order or use the recommendation itself as evidence.
    if(!unresolved){
      for(const company of companies){
        const affiliation=new RegExp(`^${escape(contact)}\\s*,?\\s+(?:de|from)\\s+${escape(company)}(?=[,.:;!?]|$)`, 'iu')
        if(extraction.summary.split(/\n+/).some(p=>affiliation.test(p.trim())) && !matches.includes(company))matches.push(company)
      }
    }
    // Conflicting organizations are not a confirmed identity pairing.
    if (matches.length !== 1) return contact
    usedCompanies.add(key(matches[0]))
    return `${contact} — ${matches[0]}`
  })
  parts.push(...companies.filter(company => !usedCompanies.has(key(company))))
  return parts.join('\n')
}
