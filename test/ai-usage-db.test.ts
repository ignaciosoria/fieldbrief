import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { test } from 'node:test'

test('PostgreSQL quota, concurrency and role permissions', async () => {
  const db = new PGlite()
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE public.subscriptions(user_id text PRIMARY KEY, status text);`)
    await db.exec(await readFile('supabase/migrations/20260911000100_ai_usage_limits.sql', 'utf8'))
    const reserve = async (email: string, operation = 'structure') => {
      const result = await db.query<{decision:string}>('SELECT public.reserve_ai_usage($1,$2) AS decision', [email,operation])
      return result.rows[0].decision
    }
    const concurrent = await Promise.all(Array.from({length:12}, () => reserve('free@example.com')))
    assert.equal(concurrent.filter(x => x === 'allowed').length, 10)
    assert.equal(concurrent.filter(x => x === 'quota_exceeded').length, 2)
    assert.equal(await reserve('free@example.com', 'transcribe'), 'allowed')
    assert.equal(await reserve('other@example.com'), 'allowed')
    await db.exec("INSERT INTO subscriptions VALUES ('paid@example.com','active')")
    for(let i=0;i<20;i++) assert.equal(await reserve('paid@example.com'), 'allowed')
    assert.equal(await reserve('paid@example.com'), 'rate_limited')
    await db.exec("UPDATE ai_usage SET window_started_at = now() - interval '2 minutes' WHERE user_id = 'paid@example.com'")
    assert.equal(await reserve('paid@example.com'), 'allowed')
    for(const role of ['anon','authenticated']) {
      await db.exec(`SET ROLE ${role}`)
      await assert.rejects(() => reserve('intruder@example.com'), /permission denied/)
      await assert.rejects(() => db.query('SELECT * FROM public.ai_usage'), /permission denied/)
      await db.exec('RESET ROLE')
    }
    await db.exec('SET ROLE service_role')
    assert.equal(await reserve('service@example.com'), 'allowed')
  } finally { await db.close() }
})
