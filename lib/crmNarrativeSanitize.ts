/**
 * Remove execution-oriented blocks from CRM narrative prose (legacy model drift).
 * Next steps / scheduling belong in the app UI, not in crm_summary paste text.
 */

const NEXT_STEP_HEADER =
  /^(?:next steps|follow-up(?: actions)?|follow[\s-]?up actions?|próximos pasos|siguientes pasos|acciones de seguimiento)\s*:?\s*$/i

/** Line looks like a task bullet under a "next steps" block. */
function isTaskBulletLine(t: string): boolean {
  const s = t.trim()
  if (!s) return false
  return /^[-•*]\s+/.test(s) || /^\d+[.)]\s+/.test(s)
}

/**
 * Drop a "Next steps:" (or ES equivalent) subsection: header line plus following bullet lines
 * until a blank line or non-bullet paragraph.
 */
export function stripExecutionBlocksFromCrmNarrative(raw: string): string {
  const lines = raw.split(/\r?\n/)
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const t = line.trim()
    if (NEXT_STEP_HEADER.test(t)) {
      i += 1
      while (i < lines.length) {
        const inner = lines[i]
        const it = inner.trim()
        if (!it) {
          i += 1
          break
        }
        if (isTaskBulletLine(inner)) {
          i += 1
          continue
        }
        break
      }
      continue
    }
    out.push(line)
    i += 1
  }
  let s = out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  // Single-line "Next steps: …" tails (EN/ES)
  s = s.replace(
    /(?:^|\n)\s*(?:next steps|follow-up(?: actions)?|próximos pasos|siguientes pasos)\s*:\s*[^\n]+/gi,
    '\n',
  )
  return s.replace(/\n{3,}/g, '\n\n').trim()
}
