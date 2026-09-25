import { auth } from '../auth'
import { createClient } from '@supabase/supabase-js'
import { checkAiAccess, type AiOperation, type AiAccessDecision } from './aiAccess'
import { readStructureInput } from './structureInput'
import { prepareStructure } from './structureAccess'

export async function prepareStructureRequest(request: Request) {
  const email=(await auth())?.user?.email?.trim() || null
  const body=await prepareStructure(request, {
    getEmail: async () => email,
    reserve: reserveAiUsage,
    readInput: readStructureInput,
  })
  return body instanceof Response ? body : {...body,serverEmail:email!}
}

/** Only pass the server-authenticated identity, never a request body field. */
export async function reserveAiUsage(email:string,kind:AiOperation):Promise<AiAccessDecision> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing access database configuration')
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await db.rpc('reserve_ai_usage', { p_user_id: email, p_operation: kind })
  if (error || !['allowed', 'quota_exceeded', 'rate_limited'].includes(data)) throw new Error('Access check failed')
  return data
}

/** Server routes only. Never import privileged credentials into a client component. */
export async function requireAiAccess(operation: AiOperation): Promise<Response | null> {
  return checkAiAccess(operation, {
    getEmail: async () => (await auth())?.user?.email?.trim() || null,
    reserve: reserveAiUsage,
  })
}
