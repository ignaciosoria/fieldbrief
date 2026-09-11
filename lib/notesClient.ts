export async function notesRequest(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Unable to save changes.')
  return data
}
