import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { checkAiAccess } from '../lib/aiAccess'

test('complimentary access is explicit, isolated, revocable and rate limited; Stripe stays authoritative for paid users', async () => {
  const db = new PGlite()
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE TABLE subscriptions(user_id text PRIMARY KEY, stripe_customer_id text, stripe_subscription_id text, status text);`)
    for (const file of ['20260911000100_ai_usage_limits.sql', '20260911000300_subscription_sync.sql', '20260924000100_complimentary_access.sql']) {
      await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'))
    }
    const access = async (email: string | null) => (await db.query<{allowed:boolean}>(
      'SELECT public.has_unlimited_ai_access($1) AS allowed', [email])).rows[0].allowed
    const reserve = async (email: string, operation = 'structure') => (await db.query<{decision:string}>(
      'SELECT public.reserve_ai_usage($1,$2) AS decision', [email, operation])).rows[0].decision
    for (const email of [null, '', 'owner@example.test', 'other@example.test']) assert.equal(await access(email), false)
    await db.exec(`INSERT INTO ai_usage(user_id,structures,transcriptions) VALUES
      ('owner@example.test',1000,1000), ('other@example.test',10,10);
      INSERT INTO complimentary_access(user_id) VALUES ('owner@example.test');`)
    assert.equal(await access(' OWNER@example.test '), true)
    assert.equal(await access('owner+alias@example.test'), false, 'Do not guess Google aliases')
    assert.equal(await access('other@example.test'), false)
    for (const operation of ['structure', 'transcribe']) {
      assert.equal(await reserve('owner@example.test', operation), 'allowed')
      assert.equal(await reserve('other@example.test', operation), 'quota_exceeded')
    }
    assert.equal((await db.query('SELECT * FROM subscriptions')).rows.length, 0, 'No fake paid subscription')
    const burst = await Promise.all(Array.from({length: 20}, () => reserve('owner@example.test')))
    assert.equal(burst.filter(x => x === 'allowed').length, 18)
    assert.equal(burst.filter(x => x === 'rate_limited').length, 2)
    await db.exec("UPDATE ai_usage SET window_started_at = now() - interval '2 minutes' WHERE user_id = 'owner@example.test'")
    assert.equal(await reserve('owner@example.test'), 'allowed')
    await db.exec("DELETE FROM complimentary_access WHERE user_id = 'owner@example.test'")
    assert.equal(await access('owner@example.test'), false)
    assert.equal(await reserve('owner@example.test'), 'quota_exceeded')
    await db.exec("INSERT INTO subscriptions(user_id,status,paid_until) VALUES ('owner@example.test','active',now()+interval '1 day')")
    assert.equal(await access('owner@example.test'), true)
    assert.equal(await reserve('owner@example.test'), 'allowed')
    await db.exec("UPDATE subscriptions SET paid_until = now() - interval '1 second'")
    assert.equal(await access('owner@example.test'), false)
    assert.equal(await reserve('owner@example.test'), 'quota_exceeded')
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`SET ROLE ${role}`)
      await assert.rejects(() => access('owner@example.test'), /permission denied/)
      await assert.rejects(() => reserve('owner@example.test'), /permission denied/)
      await assert.rejects(() => db.query('SELECT * FROM complimentary_access'), /permission denied/)
      await assert.rejects(() => db.query("INSERT INTO complimentary_access(user_id) VALUES ('attacker@example.test')"), /permission denied/)
      await db.exec('RESET ROLE')
    }
    await db.exec('SET ROLE service_role')
    await db.exec("INSERT INTO complimentary_access(user_id) VALUES ('owner@example.test')")
    assert.equal(await access('owner@example.test'), true)
    assert.equal(await reserve('owner@example.test'), 'allowed')
  } finally { await db.close() }
})

test('quota copy is plain English and the plan endpoint uses the same authenticated entitlement', async () => {
  const response = await checkAiAccess('structure', {
    getEmail: async () => 'free@example.test', reserve: async () => 'quota_exceeded',
  })
  assert.equal(response?.status, 403)
  assert.match((await response!.json()).error,/Your free trial has ended/)
  const page = await readFile('app/page.tsx', 'utf8')
  assert.match(page, /Your free trial has ended/)
  assert.match(page, /Your saved notes and exports are still available\./)
  assert.doesNotMatch(page, /free AI allowance/)
  const route = await readFile('app/api/subscription/route.ts', 'utf8')
  assert.match(route, /get_trial_status/)
  assert.match(route, /p_user_id: session.user.email.trim\(\)/)
  assert.match(route, /typeof data.active !== 'boolean'/)
})
