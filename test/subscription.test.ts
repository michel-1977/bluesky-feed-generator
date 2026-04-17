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
      ruleAutoAcceptScore: 101,
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
      text: 'Atropello en Calahorra con corte parcial y desvios. Mas info en www.larioja.org/emergencias-112',
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
      ruleAutoAcceptScore: 101,
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
      text: 'Atropello en Calahorra con corte parcial y desvios. Mas info en www.larioja.org/emergencias-112',
      langs: ['es'],
    })

    expect(result.post).toBeUndefined()
    expect(result.metricDeltas.posts_sent_to_llm).toBe(1)
    expect(result.metricDeltas.posts_llm_failures).toBe(1)
    expect(result.metricDeltas.posts_rejected_llm).toBe(1)
  })

  it('retains only the newest accepted posts when maxIndexedPosts is exceeded', async () => {
    db = await createTestDb()
    const cfg = createTestConfig({
      maxIndexedPosts: 2,
    })

    const subscription = new FirehoseSubscription(db, cfg.subscriptionEndpoint, cfg)

    await db
      .insertInto('post')
      .values([
        {
          uri: 'at://oldest',
          cid: 'cid-1',
          author: 'did:plc:a',
          text: 'oldest',
          langs: 'es',
          indexedAt: '2026-04-11T10:00:00.000Z',
          score: 100,
          sourceTier: 'trusted',
          decisionReason: 'rule_accept:trusted:test',
          filterVersion: cfg.filterVersion,
        },
        {
          uri: 'at://middle',
          cid: 'cid-2',
          author: 'did:plc:b',
          text: 'middle',
          langs: 'es',
          indexedAt: '2026-04-11T11:00:00.000Z',
          score: 80,
          sourceTier: 'boosted',
          decisionReason: 'rule_accept:boosted:test',
          filterVersion: cfg.filterVersion,
        },
        {
          uri: 'at://newest',
          cid: 'cid-3',
          author: 'did:plc:c',
          text: 'newest',
          langs: 'es',
          indexedAt: '2026-04-11T12:00:00.000Z',
          score: 60,
          sourceTier: 'neutral',
          decisionReason: 'rule_accept:neutral:test',
          filterVersion: cfg.filterVersion,
        },
      ])
      .execute()

    await (subscription as unknown as { prunePosts(): Promise<void> }).prunePosts()

    const rows = await db
      .selectFrom('post')
      .select(['uri', 'indexedAt'])
      .orderBy('indexedAt', 'asc')
      .execute()

    expect(rows.map((row) => row.uri)).toEqual(['at://middle', 'at://newest'])
  })

  it('does not delete posts by age when age pruning is disabled', async () => {
    db = await createTestDb()
    const cfg = createTestConfig({
      maxPostAgeHours: 0,
      maxIndexedPosts: 10,
    })

    const subscription = new FirehoseSubscription(db, cfg.subscriptionEndpoint, cfg)

    await db
      .insertInto('post')
      .values([
        {
          uri: 'at://old-alert',
          cid: 'cid-old',
          author: 'did:plc:a',
          text: 'old alert',
          langs: 'es',
          indexedAt: '2026-04-01T10:00:00.000Z',
          score: 95,
          sourceTier: 'trusted',
          decisionReason: 'rule_accept:trusted:test',
          filterVersion: cfg.filterVersion,
        },
        {
          uri: 'at://fresh-alert',
          cid: 'cid-fresh',
          author: 'did:plc:b',
          text: 'fresh alert',
          langs: 'es',
          indexedAt: '2026-04-15T10:00:00.000Z',
          score: 90,
          sourceTier: 'trusted',
          decisionReason: 'rule_accept:trusted:test',
          filterVersion: cfg.filterVersion,
        },
      ])
      .execute()

    await (subscription as unknown as { prunePosts(): Promise<void> }).prunePosts()

    const rows = await db
      .selectFrom('post')
      .select('uri')
      .orderBy('indexedAt', 'asc')
      .execute()

    expect(rows.map((row) => row.uri)).toEqual([
      'at://old-alert',
      'at://fresh-alert',
    ])
  })

  it('persists a cursor row even when the service has not been seen before', async () => {
    db = await createTestDb()
    const cfg = createTestConfig()
    const subscription = new FirehoseSubscription(db, cfg.subscriptionEndpoint, cfg)

    await subscription.updateCursor(120)

    const row = await db
      .selectFrom('sub_state')
      .selectAll()
      .where('service', '=', cfg.subscriptionEndpoint)
      .executeTakeFirst()

    expect(row).toEqual({
      service: cfg.subscriptionEndpoint,
      cursor: 120,
    })
  })

  it('rejects would-be positives when LLM filtering is disabled', async () => {
    db = await createTestDb()
    const cfg = createTestConfig({
      llmFilter: {
        enabled: false,
        apiUrl: 'https://api.openai.com/v1/chat/completions',
        apiKey: '',
        model: 'gpt-4o-mini',
        timeoutMs: 5000,
        maxInputChars: 500,
        minConfidence: 0.85,
        failOpen: false,
      },
    })

    const subscription = new FirehoseSubscription(db, cfg.subscriptionEndpoint, cfg)
    const result = await subscription.evaluateCreate({
      uri: 'at://candidate-disabled-llm',
      cid: 'cid-disabled-llm',
      author: 'did:plc:test',
      text: 'AEMET activa aviso naranja por lluvias intensas y rachas fuertes en Valencia. Se recomienda evitar desplazamientos y extremar la precaucion.',
      langs: ['es'],
    })

    expect(result.post).toBeUndefined()
    expect(result.metricDeltas.posts_sent_to_llm).toBe(0)
    expect(result.metricDeltas.posts_rejected_low_score).toBe(1)
  })
})
