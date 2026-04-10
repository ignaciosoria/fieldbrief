import { dedupeConsecutiveRepeatedWords } from './stringDedupe'

/** Placeholder product words that should be stored and shown as empty. */
const VAGUE_PRODUCT = new Set([
  'algo',
  'something',
  'un producto',
  'a product',
  'product',
  'producto',
])

/** Deliverables / collateral the model must not put in product — defensive filter for pills. */
function isDocumentLikeDeliverableSegment(segment: string): boolean {
  const t = segment.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!t) return false
  if (t === 'roi analysis template' || t.includes('roi analysis template')) return true
  if (/\bmarket\s+analysis\b/.test(t)) return true
  if (/\b(competitive|competitor|industry|feasibility|technical)\s+analysis\b/.test(t)) return true
  if (/\bprice\s+comparison\b/.test(t)) return true
  if (/\b(brochure|brochures|sell\s*sheet|sell\s*sheets|one[- ]pager|one\s+pager)\b/.test(t)) return true
  if (/\b(monthly|weekly|quarterly|annual|sales|market|status|progress)\s+report\b/.test(t))
    return true
  if (/\b(white\s*paper|whitepaper)\b/.test(t)) return true
  if (/\b(slide\s*deck|pitch\s*deck)\b/.test(t)) return true
  if (/\btemplate\b/.test(t) && /\b(analysis|roi|report|budget|proposal|deck|slide|excel)\b/.test(t))
    return true
  if (/\b(analysis|analyses)\b/.test(t) && /\b(roi|template|deck|pdf|market|competitive)\b/.test(t))
    return true
  if (t === 'template' || t === 'templates' || t === 'report' || t === 'analysis' || t === 'brochure')
    return true
  return false
}

function titleCaseSegment(segment: string): string {
  const t = segment.trim()
  if (!t) return ''
  return t
    .split(/\s+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : ''))
    .filter(Boolean)
    .join(' ')
}

/** If product is a vague placeholder, return "". Otherwise return trimmed product. */
export function sanitizeProductField(product: string | null | undefined): string {
  const raw = String(product ?? '').trim()
  if (!raw) return ''
  const core = raw.replace(/\.$/, '').trim().toLowerCase()
  if (VAGUE_PRODUCT.has(core)) return ''
  return raw
}

/**
 * Comma-separated multi-product string: title-case and de-dupe each segment,
 * drop vague-only segments, rejoin for storage.
 */
export function normalizeProductField(raw: string | null | undefined): string {
  const full = String(raw ?? '').trim()
  if (!full) return ''
  const parts = full
    .split(',')
    .map((p) => dedupeConsecutiveRepeatedWords(p.trim()))
    .map((p) => titleCaseSegment(p))
    .map((p) => sanitizeProductField(p))
    .filter(Boolean)
    .filter((p) => !isDocumentLikeDeliverableSegment(p))
  return parts.join(', ')
}

/** Labels for UI pills (one pill per product). */
export function productFieldToList(product: string | null | undefined): string[] {
  const n = normalizeProductField(product)
  if (!n) return []
  return n.split(',').map((s) => s.trim()).filter(Boolean)
}
