import posthog from 'posthog-js'

// TODO: replace with real PostHog key (set NEXT_PUBLIC_POSTHOG_KEY in .env.local)
const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? ''

export function initPosthog() {
  if (typeof window === 'undefined') return
  if (!POSTHOG_KEY.trim()) return
  posthog.init(phc_rqB59sDuhyRsnaUDNc5jfnt29mbWs3AFs2LiYsKupYT3, {
    api_host: 'https://app.posthog.com',
  })
}

export default posthog
