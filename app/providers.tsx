'use client'

import { SessionProvider } from 'next-auth/react'
import AnalyticsObserver from './components/AnalyticsObserver'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider basePath="/api/auth"><AnalyticsObserver/>{children}</SessionProvider>
  )
}
