'use client'

import { useSyncExternalStore } from 'react'

function subscribe(onChange: () => void) {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

// A connectivity hint, not a guarantee that the server is reachable.
export function ConnectivityNotice() {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true)
  if (online) return null
  return (
    <div role="status" className="bg-amber-50 px-4 py-2 text-center text-sm text-amber-900">
      You’re offline. Reconnect to process notes or add events to your calendar.
    </div>
  )
}
