import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobilityRiskLlmFilter } from '../src/util/llm-filter'

const baseAzureConfig = {
  enabled: true,
  apiUrl: 'https://weo-ai-foundry.openai.azure.com/openai/v1/chat/completions',
  apiKey: 'test-key',
  model: 'gpt-5-nano',
  timeoutMs: 5000,
  maxInputChars: 500,
  minConfidence: 0.85,
  failOpen: false,
}

describe('MobilityRiskLlmFilter', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('omits temperature for Azure GPT-5 chat completions requests', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '{"isMobilityImpactInSpain":true,"confidence":0.91,"reason":"clear incident"}',
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    )

    const filter = new MobilityRiskLlmFilter(baseAzureConfig)
    const result = await filter.review(
      'Atropello en Calahorra con corte parcial y desvios',
      ['es'],
    )

    expect(result.accepted).toBe(true)
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    const [, init] = fetchSpy.mock.calls[0]
    const body = JSON.parse(String(init?.body))

    expect(body.model).toBe('gpt-5-nano')
    expect(body.temperature).toBeUndefined()
  })

  it('includes the response body snippet when Azure returns a non-2xx error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message: "Unsupported parameter: 'temperature'",
          },
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    )

    const filter = new MobilityRiskLlmFilter(baseAzureConfig)
    const result = await filter.review(
      'Atropello en Calahorra con corte parcial y desvios',
      ['es'],
    )

    expect(result).toMatchObject({
      accepted: false,
      failed: true,
      reason: 'llm_error',
    })

    const loggedError = errorSpy.mock.calls[0]?.[1] as Error | undefined
    expect(loggedError?.message).toContain('HTTP 400')
    expect(loggedError?.message).toContain('Unsupported parameter')
  })
})
