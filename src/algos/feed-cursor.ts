export type FeedCursor = {
  score: number
  indexedAt: string
  cid: string
}

export const encodeFeedCursor = (cursor: FeedCursor): string => {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

export const decodeFeedCursor = (cursor?: string): FeedCursor | undefined => {
  if (!cursor) return undefined

  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8')
    const parsed = JSON.parse(decoded) as Partial<FeedCursor>

    if (
      typeof parsed.score !== 'number' ||
      typeof parsed.indexedAt !== 'string' ||
      typeof parsed.cid !== 'string'
    ) {
      return undefined
    }

    return parsed as FeedCursor
  } catch {
    return undefined
  }
}
