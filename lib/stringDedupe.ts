/**
 * Collapse consecutive identical tokens (case-insensitive), any position.
 * "David David Kim" → "David Kim", "Call David David Kim" → "Call David Kim"
 */
export function dedupeConsecutiveRepeatedWords(s: string): string {
  const parts = s.trim().split(/\s+/)
  if (parts.length === 0) return ''
  const out: string[] = []
  for (const w of parts) {
    if (out.length > 0 && out[out.length - 1].toLowerCase() === w.toLowerCase()) continue
    out.push(w)
  }
  return out.join(' ')
}

/**
 * Join action + target without duplicating where action ends with the first word(s) of target
 * (e.g. "Call David" + "David Kim" → "Call David Kim", not "Call David David Kim").
 */
export function mergeActionTargetAvoidOverlap(action: string, target: string): string {
  const aParts = action.trim().split(/\s+/).filter(Boolean)
  const tParts = target.trim().split(/\s+/).filter(Boolean)
  if (!tParts.length) return action.trim()
  if (!aParts.length) return target.trim()

  let k = 0
  for (let len = Math.min(aParts.length, tParts.length); len >= 1; len--) {
    let ok = true
    for (let j = 0; j < len; j++) {
      if (aParts[aParts.length - len + j].toLowerCase() !== tParts[j].toLowerCase()) {
        ok = false
        break
      }
    }
    if (ok) {
      k = len
      break
    }
  }

  if (k === 0) return `${action.trim()} ${target.trim()}`.replace(/\s+/g, ' ').trim()
  return [...aParts.slice(0, aParts.length - k), ...tParts].join(' ')
}
