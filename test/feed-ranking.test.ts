import { afterEach, describe, expect, it } from 'vitest'
import { handler } from '../src/algos/mobility-risk'
import { createTestConfig, createTestDb } from './helpers'
import { Database } from '../src/db'

describe('mobility-risk feed handler', () => {
  let db: Database | undefined

  afterEach(async () => {
    await db?.destroy()
    db = undefined
  })

  it('orders by recency first, then score, and hides legacy filter versions', async () => {
    db = await createTestDb()
    const cfg = createTestConfig()

    await db
      .insertInto('post')
      .values([
        {
          uri: 'at://post-1',
          cid: 'cid-b',
          author: 'did:plc:a',
          text: 'trusted post',
          langs: 'es',
          indexedAt: '2026-04-11T12:00:00.000Z',
          score: 92,
          sourceTier: 'trusted',
          decisionReason: 'rule_accept:trusted:aemet',
          filterVersion: cfg.filterVersion,
        },
        {
          uri: 'at://post-2',
          cid: 'cid-a',
          author: 'did:plc:b',
          text: 'same score older cid',
          langs: 'es',
          indexedAt: '2026-04-11T12:00:00.000Z',
          score: 92,
          sourceTier: 'boosted',
          decisionReason: 'rule_accept:boosted:atropello',
          filterVersion: cfg.filterVersion,
        },
        {
          uri: 'at://post-3',
          cid: 'cid-c',
          author: 'did:plc:c',
          text: 'lower score newer',
          langs: 'es',
          indexedAt: '2026-04-11T13:00:00.000Z',
          score: 88,
          sourceTier: 'neutral',
          decisionReason: 'llm_accept:clear transport disruption',
          filterVersion: cfg.filterVersion,
        },
        {
          uri: 'at://legacy-post',
          cid: 'cid-z',
          author: 'did:plc:d',
          text: 'legacy noisy row',
          langs: 'es',
          indexedAt: '2026-04-11T14:00:00.000Z',
          score: 100,
          sourceTier: 'neutral',
          decisionReason: 'legacy',
          filterVersion: 'legacy-v0',
        },
      ])
      .execute()

    const firstPage = await handler(
      { db, cfg, didResolver: {} as never },
      { feed: 'at://ignored', limit: 2 },
    )

    expect(firstPage.feed.map((item) => item.post)).toEqual([
      'at://post-3',
      'at://post-1',
    ])
    expect(firstPage.cursor).toBeTruthy()

    const secondPage = await handler(
      { db, cfg, didResolver: {} as never },
      { feed: 'at://ignored', limit: 2, cursor: firstPage.cursor },
    )

    expect(secondPage.feed.map((item) => item.post)).toEqual(['at://post-2'])
  })
})
