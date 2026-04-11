import { describe, expect, it } from 'vitest'
import { decodeFeedCursor, encodeFeedCursor } from '../src/algos/feed-cursor'

describe('feed cursor helpers', () => {
  it('round-trips composite ranking cursors', () => {
    const cursor = {
      score: 91,
      indexedAt: '2026-04-11T10:00:00.000Z',
      cid: 'bafyreia123',
    }

    expect(decodeFeedCursor(encodeFeedCursor(cursor))).toEqual(cursor)
  })

  it('returns undefined for malformed cursors', () => {
    expect(decodeFeedCursor('not-base64')).toBeUndefined()
  })
})
