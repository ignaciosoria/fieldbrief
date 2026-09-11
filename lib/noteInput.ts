export function parseNoteInput(body: unknown) {
  if (!body || typeof body !== 'object') return null
  const row = body as Record<string, unknown>
  if (typeof row.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.id)) return null
  if (typeof row.transcript !== 'string' || row.transcript.length > 20000) return null
  if (!row.result || typeof row.result !== 'object' || Array.isArray(row.result)) return null
  if (JSON.stringify(row.result).length > 100000) return null
  // Ownership is deliberately not accepted from the request.
  return { id: row.id, raw_text: row.transcript, structured_output: row.result }
}
