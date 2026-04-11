export type DatabaseSchema = {
  post: Post
  sub_state: SubState
  filter_metric: FilterMetric
}

export type SourceTier = 'trusted' | 'boosted' | 'neutral'

export type Post = {
  uri: string
  cid: string
  author: string
  text: string
  langs: string
  indexedAt: string
  score: number
  sourceTier: SourceTier
  decisionReason: string
  filterVersion: string
}

export type SubState = {
  service: string
  cursor: number
}

export type FilterMetric = {
  metric: string
  count: number
}
