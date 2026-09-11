import { createClient } from '@supabase/supabase-js'

/** Only import from server routes. Credentials are never sent to the browser. */
export function serverDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Database configuration unavailable')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}
