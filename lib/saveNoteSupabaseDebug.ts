import type { PostgrestError } from '@supabase/supabase-js'

/** Log PostgREST / Supabase error fields for insert/select failures. */
export function logPostgrestError(prefix: string, error: PostgrestError | null | undefined): void {
  if (!error) return
  console.error(prefix, {
    message: error.message,
    code: error.code,
    details: error.details,
    hint: error.hint,
  })
}

/**
 * Repo has no SQL migrations enabling RLS on `notes`. This logs what the app assumes so you can
 * compare with Supabase Dashboard → Table Editor → notes → RLS / Policies.
 */
export function logNotesTableRlsAssumptions(ctx: {
  userIdForRow: string
  supabaseUrl: string | undefined
}): void {
  let host = '(unknown)'
  try {
    if (ctx.supabaseUrl) host = new URL(ctx.supabaseUrl).host
  } catch {
    host = '(invalid NEXT_PUBLIC_SUPABASE_URL)'
  }
  console.log('[saveNote] notes table / RLS (codebase assumptions vs Dashboard)', {
    repoMigrationsEnableRlsOnNotes: false,
    userIdColumn: 'notes.user_id is text — set to Google email (sessionEmail), not Supabase auth.uid()',
    client: 'createClient(anon key) only — no supabase.auth in this app; requests use anonymous JWT unless you add Supabase Auth',
    supabaseProjectHost: host,
    userIdForRow: ctx.userIdForRow,
    policyMismatchHints: [
      'If insert fails with RLS: policy may expect auth.uid() (null for anon) or JWT email claim not matching user_id.',
      'If insert "succeeds" but verify returns no row: check you are on the same project URL as Dashboard.',
    ],
  })
}
