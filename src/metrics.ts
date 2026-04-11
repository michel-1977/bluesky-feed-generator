import express from 'express'
import { AppContext } from './config'
import { createEmptyFilterMetricCounters, FILTER_METRIC_KEYS, FilterMetricName } from './filter-metrics'

const makeRouter = (ctx: AppContext) => {
  const router = express.Router()

  router.get('/metrics', async (_req, res) => {
    const rows = await ctx.db
      .selectFrom('filter_metric')
      .select(['metric', 'count'])
      .where('metric', 'in', FILTER_METRIC_KEYS as unknown as string[])
      .execute()

    const counters = createEmptyFilterMetricCounters()

    for (const row of rows) {
      const key = row.metric as FilterMetricName
      if (key in counters) {
        counters[key] = row.count
      }
    }

    const acceptedTotal =
      counters.posts_accepted_trusted + counters.posts_accepted_non_trusted
    const rejectedTotal =
      counters.posts_rejected_language +
      counters.posts_rejected_hard_deny +
      counters.posts_rejected_missing_mobility +
      counters.posts_rejected_missing_spain +
      counters.posts_rejected_low_score +
      counters.posts_rejected_llm
    const processed = counters.posts_processed

    return res.json({
      generatedAt: new Date().toISOString(),
      filterVersion: ctx.cfg.filterVersion,
      counters: {
        ...counters,
        posts_accepted_total: acceptedTotal,
        posts_rejected_total: rejectedTotal,
      },
      rates: {
        acceptance_ratio: processed > 0 ? acceptedTotal / processed : 0,
        rejection_ratio: processed > 0 ? rejectedTotal / processed : 0,
      },
    })
  })

  return router
}

export default makeRouter
