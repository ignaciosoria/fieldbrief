/** Pure access policy: dependencies are injected so denials can be tested without APIs. */
export type AiOperation = 'transcribe' | 'structure'
export type AiAccessDecision = 'allowed' | 'quota_exceeded' | 'rate_limited'
export type AiAccessDependencies = {
  getEmail: () => Promise<string | null>
  reserve: (email: string, operation: AiOperation) => Promise<AiAccessDecision>
}

export async function checkAiAccess(operation: AiOperation, deps: AiAccessDependencies): Promise<Response | null> {
  try {
    const email = await deps.getEmail()
    if (!email) return Response.json({ error: 'Sign in to process a note.', code: 'AUTH_REQUIRED' }, { status: 401 })
    const decision = await deps.reserve(email, operation)
    if (decision === 'allowed') return null
    if (decision === 'quota_exceeded') {
      return Response.json({ error: "You've reached your free limit. Upgrade to Folup Pro to continue.", code: 'QUOTA_EXCEEDED' }, { status: 403 })
    }
    if (decision === 'rate_limited') {
      return Response.json({ error: 'Too many requests. Try again in a minute.', code: 'RATE_LIMITED' }, { status: 429, headers: { 'Retry-After': '60' } })
    }
    throw new Error('Unknown access decision')
  } catch {
    return Response.json({ error: 'Unable to verify AI access. Please try again later.', code: 'ACCESS_UNAVAILABLE' }, { status: 503 })
  }
}
