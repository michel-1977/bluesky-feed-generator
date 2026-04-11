export const FILTER_METRIC_KEYS = [
  'posts_processed',
  'posts_rejected_language',
  'posts_rejected_hard_deny',
  'posts_rejected_missing_mobility',
  'posts_rejected_missing_spain',
  'posts_rejected_low_score',
  'posts_sent_to_llm',
  'posts_rejected_llm',
  'posts_accepted_trusted',
  'posts_accepted_non_trusted',
  'posts_llm_failures',
] as const

export type FilterMetricName = (typeof FILTER_METRIC_KEYS)[number]

export type FilterMetricCounters = Record<FilterMetricName, number>

export const createEmptyFilterMetricCounters = (): FilterMetricCounters => ({
  posts_processed: 0,
  posts_rejected_language: 0,
  posts_rejected_hard_deny: 0,
  posts_rejected_missing_mobility: 0,
  posts_rejected_missing_spain: 0,
  posts_rejected_low_score: 0,
  posts_sent_to_llm: 0,
  posts_rejected_llm: 0,
  posts_accepted_trusted: 0,
  posts_accepted_non_trusted: 0,
  posts_llm_failures: 0,
})
