import posthog from 'posthog-js'
import { privateAnalyticsConfig } from './analyticsPrivacy'

let initialized = false

export function initPosthog() {
  if (typeof window === 'undefined' || initialized) return

  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
  if (!key) return

  posthog.init(key, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
    ...privateAnalyticsConfig(crypto.randomUUID()),
  })
  initialized = true
}

export default posthog
