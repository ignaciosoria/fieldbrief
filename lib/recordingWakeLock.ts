/**
 * Screen Wake Lock for voice recording — best effort; never throws to callers.
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API
 */

let activeLock: WakeLockSentinel | null = null
let hasLoggedUnsupported = false
const wakeLockReleaseSubscribers = new Set<() => void>()

type WakeLockSkipReason = 'unsupported' | 'denied' | 'error'

/** Optional diagnostics (e.g. unsupported on many iOS/Safari builds). */
export const wakeLockDebug = {
  supported: false as boolean,
  /** Set when API is missing or request failed. */
  lastSkipReason: null as null | WakeLockSkipReason,
}

function logUnavailable(reason: WakeLockSkipReason, detail?: unknown) {
  wakeLockDebug.lastSkipReason = reason
  if (process.env.NODE_ENV === 'development') {
    console.debug('[recording] wake lock skipped:', reason, detail ?? '')
  }
}

function onSentinelReleased() {
  activeLock = null
  wakeLockReleaseSubscribers.forEach((fn) => {
    try {
      fn()
    } catch {
      /* ignore */
    }
  })
}

/** Subscribe to automatic lock release (e.g. tab hidden). No-op for manual releaseWakeLock. */
export function subscribeWakeLockReleased(cb: () => void): () => void {
  wakeLockReleaseSubscribers.add(cb)
  return () => wakeLockReleaseSubscribers.delete(cb)
}

/** True while a screen wake lock is actively held (after successful request). */
export function isWakeLockHeld(): boolean {
  return activeLock !== null
}

/**
 * Acquires a screen wake lock if supported. Safe to call repeatedly (replaces prior lock).
 * Does not throw — failures are logged in development via wakeLockDebug + console.debug.
 */
export async function requestWakeLock(): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.wakeLock?.request) {
    wakeLockDebug.supported = false
    wakeLockDebug.lastSkipReason = 'unsupported'
    if (!hasLoggedUnsupported) {
      hasLoggedUnsupported = true
      if (process.env.NODE_ENV === 'development') {
        console.debug('[recording] wake lock unavailable (API missing)')
      }
    }
    return
  }

  wakeLockDebug.supported = true
  await releaseWakeLock()

  try {
    const sentinel = await navigator.wakeLock.request('screen')
    activeLock = sentinel
    wakeLockDebug.lastSkipReason = null
    sentinel.addEventListener('release', onSentinelReleased, { passive: true })
  } catch (err) {
    const name = err instanceof DOMException ? err.name : ''
    const reason = name === 'NotAllowedError' ? 'denied' : 'error'
    logUnavailable(reason, err)
  }
}

/**
 * Releases the active wake lock if any. Idempotent; safe if the system already released it.
 */
export async function releaseWakeLock(): Promise<void> {
  const lock = activeLock
  if (!lock) return

  activeLock = null
  try {
    lock.removeEventListener('release', onSentinelReleased)
  } catch {
    /* ignore */
  }

  try {
    await lock.release()
  } catch {
    /* already released or invalid — ignore */
  }
}
