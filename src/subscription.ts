import {
  OutputSchema as RepoEvent,
  isCommit,
} from './lexicon/types/com/atproto/sync/subscribeRepos'
import { sql } from 'kysely'
import { Config } from './config'
import { Database } from './db'
import { Post } from './db/schema'
import { createEmptyFilterMetricCounters, FilterMetricCounters, FilterMetricName } from './filter-metrics'
import { FirehoseSubscriptionBase, getOpsByType } from './util/subscription'
import { classifyCandidatePost } from './classifier'
import { resolveTrustedAuthorDids } from './classifier/trusted-sources'
import { LlmReviewer, MobilityRiskLlmFilter } from './util/llm-filter'

export type CandidatePost = {
  uri: string
  cid: string
  author: string
  text: string
  langs?: string[]
}

export class FirehoseSubscription extends FirehoseSubscriptionBase {
  private llmFilter: LlmReviewer
  private trustedAuthorDids = new Set<string>()
  private initialized = false

  constructor(
    db: Database,
    service: string,
    private cfg: Config,
    llmFilter?: LlmReviewer,
  ) {
    super(db, service)
    this.llmFilter = llmFilter ?? new MobilityRiskLlmFilter(cfg.llmFilter)
  }

  async init() {
    if (this.initialized) return
    this.trustedAuthorDids = await resolveTrustedAuthorDids()
    this.initialized = true
  }

  async handleEvent(evt: RepoEvent) {
    if (!isCommit(evt)) return

    const ops = await getOpsByType(evt)
    const counters = createEmptyFilterMetricCounters()

    const postsToDelete = ops.posts.deletes.map((del) => del.uri)
    const postsToCreate: Post[] = []

    for (const create of ops.posts.creates) {
      counters.posts_processed += 1
      const decision = await this.evaluateCreate({
        uri: create.uri,
        cid: create.cid,
        author: create.author,
        text: create.record.text,
        langs: create.record.langs,
      })

      applyCounterDelta(counters, decision.metricDeltas)
      if (decision.post) {
        postsToCreate.push(decision.post)
      }
    }

    if (postsToDelete.length > 0) {
      await this.db
        .deleteFrom('post')
        .where('uri', 'in', postsToDelete)
        .execute()
    }

    if (postsToCreate.length > 0) {
      await this.db
        .insertInto('post')
        .values(postsToCreate)
        .onConflict((oc) => oc.doNothing())
        .execute()
    }

    await this.bumpCounters(counters)

    const shouldPrune = postsToCreate.length > 0 || evt.seq % 200 === 0

    if (shouldPrune) {
      await this.prunePosts()
    }

    if (postsToDelete.length > 0 || postsToCreate.length > 0 || hasCounterDelta(counters) || shouldPrune) {
      this.db.scheduleBackup()
    }
  }

  async evaluateCreate(candidate: CandidatePost): Promise<EvaluatedCreate> {
    const metricDeltas = createEmptyFilterMetricCounters()
    const ruleDecision = classifyCandidatePost({
      text: candidate.text,
      langs: candidate.langs,
      authorDid: candidate.author,
      languageAllowlist: this.cfg.languageAllowlist,
      extraKeywords: this.cfg.keywords,
      trustedAuthorDids: this.trustedAuthorDids,
      ruleLlmMinScore: this.cfg.ruleLlmMinScore,
      ruleAutoAcceptScore: this.cfg.ruleAutoAcceptScore,
    })

    if (ruleDecision.action === 'reject') {
      if (ruleDecision.rejectMetric) {
        metricDeltas[ruleDecision.rejectMetric] += 1
      }
      return { metricDeltas }
    }

    if (ruleDecision.action === 'accept') {
      applyAcceptedCounter(metricDeltas, ruleDecision.sourceTier)
      return {
        metricDeltas,
        post: createStoredPost(candidate, ruleDecision.score, ruleDecision.sourceTier, ruleDecision.decisionReason, ruleDecision.filterVersion),
      }
    }

    if (!this.cfg.llmFilter.enabled) {
      metricDeltas.posts_rejected_low_score += 1
      return { metricDeltas }
    }

    metricDeltas.posts_sent_to_llm += 1
    const llmDecision = await this.llmFilter.review(candidate.text, candidate.langs)

    if (llmDecision.failed) {
      metricDeltas.posts_llm_failures += 1
    }

    if (!llmDecision.accepted) {
      metricDeltas.posts_rejected_llm += 1
      return { metricDeltas }
    }

    applyAcceptedCounter(metricDeltas, ruleDecision.sourceTier)
    const llmReason = compactReason(llmDecision.reason)
    return {
      metricDeltas,
      post: createStoredPost(
        candidate,
        ruleDecision.score,
        ruleDecision.sourceTier,
        llmReason ? `llm_accept:${llmReason}` : 'llm_accept',
        ruleDecision.filterVersion,
      ),
    }
  }

  private async prunePosts() {
    await this.db
      .deleteFrom('post')
      .where('filterVersion', '!=', this.cfg.filterVersion)
      .execute()

    const cutoff = new Date(
      Date.now() - this.cfg.maxPostAgeHours * 60 * 60 * 1000,
    ).toISOString()

    await this.db
      .deleteFrom('post')
      .where('indexedAt', '<', cutoff)
      .execute()

    if (this.cfg.maxIndexedPosts <= 0) {
      return
    }

    const overflowRows = await this.db
      .selectFrom('post')
      .select('uri')
      .where('filterVersion', '=', this.cfg.filterVersion)
      .orderBy('indexedAt', 'desc')
      .orderBy('cid', 'desc')
      .limit(2147483647)
      .offset(this.cfg.maxIndexedPosts)
      .execute()

    if (overflowRows.length > 0) {
      await this.db
        .deleteFrom('post')
        .where(
          'uri',
          'in',
          overflowRows.map((row) => row.uri),
        )
        .execute()
    }
  }

  private async bumpCounters(counters: FilterMetricCounters) {
    const entries = Object.entries(counters) as Array<[FilterMetricName, number]>
    for (const [metric, delta] of entries) {
      if (delta <= 0) continue

      await this.db
        .insertInto('filter_metric')
        .values({ metric, count: delta })
        .onConflict((oc) =>
          oc
            .column('metric')
            .doUpdateSet({ count: sql<number>`filter_metric.count + excluded.count` }),
        )
        .execute()
    }
  }
}

type EvaluatedCreate = {
  post?: Post
  metricDeltas: FilterMetricCounters
}

const createStoredPost = (
  candidate: CandidatePost,
  score: number,
  sourceTier: Post['sourceTier'],
  decisionReason: string,
  filterVersion: string,
): Post => ({
  uri: candidate.uri,
  cid: candidate.cid,
  author: candidate.author,
  text: candidate.text,
  langs: (candidate.langs ?? []).join(','),
  indexedAt: new Date().toISOString(),
  score,
  sourceTier,
  decisionReason,
  filterVersion,
})

const applyAcceptedCounter = (
  counters: FilterMetricCounters,
  sourceTier: Post['sourceTier'],
) => {
  if (sourceTier === 'trusted') {
    counters.posts_accepted_trusted += 1
    return
  }

  counters.posts_accepted_non_trusted += 1
}

const applyCounterDelta = (
  counters: FilterMetricCounters,
  delta: FilterMetricCounters,
) => {
  const entries = Object.entries(delta) as Array<[FilterMetricName, number]>
  for (const [metric, value] of entries) {
    counters[metric] += value
  }
}

const hasCounterDelta = (counters: FilterMetricCounters) => {
  return Object.values(counters).some((value) => value > 0)
}

const compactReason = (reason: string) => {
  return reason.replace(/\s+/g, ' ').trim().slice(0, 160)
}
