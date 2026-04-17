import { QueryParams } from '../lexicon/types/app/bsky/feed/getFeedSkeleton'
import { AppContext } from '../config'
import { decodeFeedCursor, encodeFeedCursor } from './feed-cursor'

export const shortname = 'mobility-risk'

export const handler = async (ctx: AppContext, params: QueryParams) => {
  const limit = sanitizeLimit(params.limit)
  const cursor = decodeFeedCursor(params.cursor)

  let builder = ctx.db
    .selectFrom('post')
    .select(['uri', 'cid', 'indexedAt', 'score'])
    .where('filterVersion', '=', ctx.cfg.filterVersion)
    .orderBy('indexedAt', 'desc')
    .orderBy('score', 'desc')
    .orderBy('cid', 'desc')
    .limit(limit)

  if (cursor) {
    builder = builder.where((eb) =>
      eb.or([
        eb('post.indexedAt', '<', cursor.indexedAt),
        eb.and([
          eb('post.indexedAt', '=', cursor.indexedAt),
          eb('post.score', '<', cursor.score),
        ]),
        eb.and([
          eb('post.indexedAt', '=', cursor.indexedAt),
          eb('post.score', '=', cursor.score),
          eb('post.cid', '<', cursor.cid),
        ]),
      ]),
    )
  }

  const res = await builder.execute()

  const feed = res.map((row) => ({
    post: row.uri,
  }))

  const last = res.at(-1)
  return {
    cursor: last
      ? encodeFeedCursor({
          score: last.score,
          indexedAt: last.indexedAt,
          cid: last.cid,
        })
      : undefined,
    feed,
  }
}

const sanitizeLimit = (value?: number) => {
  if (!value || value < 1) return 30
  if (value > 100) return 100
  return value
}
