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
  return parts.join(', ')
}

/** Labels for UI pills (one pill per product). */
export function productFieldToList(product: string | null | undefined): string[] {
  const n = normalizeProductField(product)
  if (!n) return []
  return n.split(',').map((s) => s.trim()).filter(Boolean)
}
