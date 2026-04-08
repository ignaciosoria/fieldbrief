/** Placeholder product words that should be stored and shown as empty. */
const VAGUE_PRODUCT = new Set([
  'algo',
  'something',
  'un producto',
  'a product',
  'product',
  'producto',
])

/** If product is a vague placeholder, return "". Otherwise return trimmed product. */
export function sanitizeProductField(product: string | null | undefined): string {
  const raw = String(product ?? '').trim()
  if (!raw) return ''
  const core = raw.replace(/\.$/, '').trim().toLowerCase()
  if (VAGUE_PRODUCT.has(core)) return ''
  return raw
}
