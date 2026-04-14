-- Run in Supabase SQL Editor to inspect `notes` RLS and policies.
-- Compare policy expressions with app behavior: user_id = session email (see saveNote in app/page.tsx).

SELECT c.relname AS table_name,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_force
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'notes';

SELECT schemaname,
       tablename,
       policyname,
       permissive,
       roles,
       cmd,
       qual,
       with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'notes'
ORDER BY policyname;
