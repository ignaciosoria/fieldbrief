import posthog from 'posthog-js'

export function initPosthog() {
  if (typeof window === 'undefined') return

  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
  if (!key) {
    console.warn('PostHog key missing')
    return
  }

  posthog.init(key, {
    api_host: 'https://app.posthog.com',
  })
}

export default posthog
