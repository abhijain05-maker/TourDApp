import cds from '@sap/cds'
import { describe, it, expect } from 'vitest'
import { loadAiCoreKeyFile } from '../../srv/lib/llm/config.js'
import { registerProvider } from '../../srv/lib/llm/provider.js'

const { POST } = cds.test(import.meta.dirname + '/../..')

describe('AICORE_SERVICE_KEY_FILE', () => {
  const key = { clientid: 'c', clientsecret: 's', url: 'https://x', serviceurls: { AI_API_URL: 'https://ai' } }
  const read = (text) => () => text

  it('turns the downloaded key file into the one-line value the SDK reads', () => {
    const env = { AICORE_SERVICE_KEY_FILE: '"C:\keys\aicore.json"' }
    expect(loadAiCoreKeyFile(env, read(`\uFEFF${JSON.stringify(key, null, 2)}`))).toBeNull()
    expect(JSON.parse(env.AICORE_SERVICE_KEY)).toEqual(key)
    expect(env.AICORE_SERVICE_KEY).not.toMatch(/\n/)
  })

  it('leaves a key that is set alone, and says what is wrong otherwise', () => {
    const set = { AICORE_SERVICE_KEY: '{"a":1}', AICORE_SERVICE_KEY_FILE: 'x.json' }
    expect(loadAiCoreKeyFile(set, read('{}'))).toBeNull()
    expect(set.AICORE_SERVICE_KEY).toBe('{"a":1}')
    expect(loadAiCoreKeyFile({ AICORE_SERVICE_KEY_FILE: 'x.json' }, read('not json'))).toMatch(/not a JSON/)
    const missing = () => { throw Object.assign(new Error('nope'), { code: 'ENOENT' }) }
    expect(loadAiCoreKeyFile({ AICORE_SERVICE_KEY_FILE: 'x.json' }, missing)).toMatch(/ENOENT/)
    expect(loadAiCoreKeyFile({}, read(''))).toBeNull()
  })
})

describe('testProvider (QuickTest setup tab)', () => {
  const test = async (provider) => JSON.parse((await POST('/odata/v4/qtest/testProvider', { provider })).data.value)
  const fake = (id, over) => ({ id, label: id, isConfigured: () => true, defaultModel: () => 'm1', complete: async () => ({ text: '{"ok":true}' }), ...over })

  it('says whether the provider answers, and why not', async () => {
    registerProvider(fake('fake-ok'))
    registerProvider(fake('fake-down', { complete: async () => { throw new Error('Gemini rejected the API key') } }))
    registerProvider(fake('fake-off', { isConfigured: () => false }))
    expect(await test('fake-ok')).toMatchObject({ ok: true, model: 'm1' })
    expect(await test('fake-down')).toMatchObject({ ok: false, message: expect.stringMatching(/rejected/) })
    expect(await test('fake-off')).toMatchObject({ ok: false, message: expect.stringMatching(/Not configured/) })
    await expect(POST('/odata/v4/qtest/testProvider', { provider: 'rules' })).rejects.toMatchObject({ response: { status: 400 } })
  })
})
