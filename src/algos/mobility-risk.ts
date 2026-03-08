import { QueryParams } from '../lexicon/types/app/bsky/feed/getFeedSkeleton'
import { AppContext } from '../config'

export const shortname = 'mobility-risk'

export const handler = async (ctx: AppContext, params: QueryParams) => {
  const limit = sanitizeLimit(params.limit)

  let builder = ctx.db
    .selectFrom('post')
    .select(['uri', 'cid', 'indexedAt'])
    .orderBy('indexedAt', 'desc')
    .orderBy('cid', 'desc')
    .limit(limit)

  if (params.cursor) {
    const timeIso = cursorToIso(params.cursor)
    if (timeIso) {
      builder = builder.where('post.indexedAt', '<', timeIso)
    }
  }

  const res = await builder.execute()

  const feed = res.map((row) => ({
    post: row.uri,
  }))

  let cursor: string | undefined
  const last = res.at(-1)
  if (last) {
    cursor = new Date(last.indexedAt).getTime().toString(10)
  }

  return {
    cursor,
    feed,
  }
}

const sanitizeLimit = (value?: number) => {
  if (!value || value < 1) return 30
  if (value > 100) return 100
  return value
}

const cursorToIso = (cursor: string) => {
  const num = parseInt(cursor, 10)
  if (isNaN(num)) {
    return undefined
  }

  return new Date(num).toISOString()
}
