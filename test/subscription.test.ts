import { afterEach, describe, expect, it } from 'vitest'
import { FirehoseSubscription } from '../src/subscription'
import { LlmReviewer } from '../src/util/llm-filter'
import { Database } from '../src/db'
import { createTestConfig, createTestDb } from './helpers'

describe('FirehoseSubscription.evaluateCreate', () => {
  let db: Database | undefined

  afterEach(async () => {
    await db?.destroy()
    db = undefined
  })

  it('sends ambiguous posts to the LLM path and returns scored metadata', async () => {
    db = await createTestDb()
    const cfg = createTestConfig({
      llmFilter: {
        enabled: true,
        apiUrl: 'https://api.openai.com/v1/chat/completions',
        apiKey: 'test',
        model: 'gpt-4o-mini',
        timeoutMs: 5000,
        maxInputChars: 500,
        minConfidence: 0.85,
        failOpen: false,
      },
      ruleAutoAcceptScore: 100,
    })

    const llmReviewer: LlmReviewer = {
      review: async () => ({
        accepted: true,
        confidence: 0.93,
        reason: 'Clear road incident in Spain',
        failed: false,
      }),
    }

    const subscription = new FirehoseSubscription(db, cfg.subscriptionEndpoint, cfg, llmReviewer)
    const result = await subscription.evaluateCreate({
      uri: 'at://candidate',
      cid: 'cid-1',
      author: 'did:plc:test',
      text: 'Atropello en Calahorra con corte parcial y desvíos. Más info en www.larioja.org/emergencias-112',
      langs: ['es'],
    })

    expect(result.metricDeltas.posts_sent_to_llm).toBe(1)
    expect(result.post).toMatchObject({
      uri: 'at://candidate',
      score: expect.any(Number),
      sourceTier: 'boosted',
      filterVersion: cfg.filterVersion,
    })
    expect(result.post?.decisionReason).toContain('llm_accept:')
  })

  it('counts LLM failures as rejected ambiguity when fail-open is disabled', async () => {
    db = await createTestDb()
    const cfg = createTestConfig({
      llmFilter: {
        enabled: true,
        apiUrl: 'https://api.openai.com/v1/chat/completions',
        apiKey: 'test',
        model: 'gpt-4o-mini',
        timeoutMs: 5000,
        maxInputChars: 500,
        minConfidence: 0.85,
        failOpen: false,
      },
      ruleAutoAcceptScore: 100,
    })

    const llmReviewer: LlmReviewer = {
      review: async () => ({
        accepted: false,
        confidence: 0,
        reason: 'llm_error',
        failed: true,
      }),
    }

    const subscription = new FirehoseSubscription(db, cfg.subscriptionEndpoint, cfg, llmReviewer)
    const result = await subscription.evaluateCreate({
      uri: 'at://candidate',
      cid: 'cid-2',
      author: 'did:plc:test',
      text: 'Atropello en Calahorra con corte parcial y desvíos. Más info en www.larioja.org/emergencias-112',
      langs: ['es'],
    })

    expect(result.post).toBeUndefined()
    expect(result.metricDeltas.posts_sent_to_llm).toBe(1)
    expect(result.metricDeltas.posts_llm_failures).toBe(1)
    expect(result.metricDeltas.posts_rejected_llm).toBe(1)
  })
})
