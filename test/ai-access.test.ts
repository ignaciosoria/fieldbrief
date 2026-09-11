import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkAiAccess, type AiAccessDependencies } from '../lib/aiAccess'

test('anonymous calls never reserve usage', async () => {
  const response = await checkAiAccess('structure', {
    getEmail: async () => null,
    reserve: async () => { throw new Error('must not run') },
  })
  assert.equal(response?.status, 401)
})

for (const operation of ['transcribe', 'structure'] as const) {
  test(`${operation}: authenticated identity is forwarded and allowed requests proceed`, async () => {
    const response = await checkAiAccess(operation, {
      getEmail: async () => 'user@example.com',
      reserve: async (email, kind) => {
        assert.equal(email, 'user@example.com')
        assert.equal(kind, operation)
        return 'allowed'
      },
    })
    assert.equal(response, null)
  })
  for (const [decision, status] of [['quota_exceeded', 403], ['rate_limited', 429]] as const) {
    test(`${operation}: ${decision} blocks processing`, async () => {
      const response = await checkAiAccess(operation, {
        getEmail: async () => 'user@example.com', reserve: async () => decision,
      })
      assert.equal(response?.status, status)
      if (status === 429) assert.equal(response?.headers.get('Retry-After'), '60')
    })
  }
}
test('database failures fail closed', async () => {
  const deps: AiAccessDependencies = {
    getEmail: async () => 'user@example.com',
    reserve: async () => { throw new Error('private database details') },
  }
  const response = await checkAiAccess('structure', deps)
  assert.equal(response?.status, 503)
  assert.equal((await response!.text()).includes('private database'), false)
})
