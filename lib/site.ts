/** Canonical site origin for absolute OG / metadata URLs. */
export function getMetadataBase(): URL {
  const env = process.env.NEXT_PUBLIC_SITE_URL
  if (env) {
    try {
      return new URL(env)
    } catch {
      /* fall through */
    }
  }
  if (process.env.VERCEL_URL) {
    return new URL(`https://${process.env.VERCEL_URL}`)
  }
  return new URL('http://localhost:3000')
}
