import { afterEach, describe, expect, it, vi } from 'vitest'
import { searchWeb } from './bocha'

describe('Bocha web search', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('validates and formats search results', async () => {
    vi.stubEnv('BOCHA_API_KEY', 'test-key')
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          code: 200,
          data: {
            webPages: {
              value: [
                {
                  name: 'Hono',
                  url: 'https://hono.dev',
                  summary: 'Web framework',
                },
              ],
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(searchWeb('hono', 1)).resolves.toContain(
      'URL: https://hono.dev',
    )
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
