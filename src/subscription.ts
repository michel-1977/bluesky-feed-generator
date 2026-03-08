import {
  OutputSchema as RepoEvent,
  isCommit,
} from './lexicon/types/com/atproto/sync/subscribeRepos'
import { Config } from './config'
import { Database } from './db'
import { FirehoseSubscriptionBase, getOpsByType } from './util/subscription'

export class FirehoseSubscription extends FirehoseSubscriptionBase {
  constructor(db: Database, service: string, private cfg: Config) {
    super(db, service)
  }

  async handleEvent(evt: RepoEvent) {
    if (!isCommit(evt)) return

    const ops = await getOpsByType(evt)

    const postsToDelete = ops.posts.deletes.map((del) => del.uri)
    const postsToCreate = ops.posts.creates
      .filter((create) => {
        return this.matchesFilters(create.record.text, create.record.langs)
      })
      .map((create) => {
        return {
          uri: create.uri,
          cid: create.cid,
          author: create.author,
          text: create.record.text,
          langs: (create.record.langs ?? []).join(','),
          indexedAt: new Date().toISOString(),
        }
      })

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

    if (evt.seq % 200 === 0) {
      await this.prunePosts()
    }
  }

  private matchesFilters(text: string, langs?: string[]) {
    const normalizedText = text.toLowerCase()

    const keywordMatch =
      this.cfg.keywords.length === 0 ||
      this.cfg.keywords.some((term) => normalizedText.includes(term))
    if (!keywordMatch) {
      return false
    }

    if (this.cfg.languageAllowlist.length === 0) {
      return true
    }

    const normalizedLangs = (langs ?? [])
      .map((lang) => lang.toLowerCase())
      .filter(Boolean)

    if (normalizedLangs.length === 0) {
      return false
    }

    return normalizedLangs.some((lang) => {
      return this.cfg.languageAllowlist.some((allowed) => {
        return lang === allowed || lang.startsWith(`${allowed}-`)
      })
    })
  }

  private async prunePosts() {
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
      .orderBy('indexedAt', 'desc')
      .orderBy('cid', 'desc')
      // SQLite requires LIMIT when using OFFSET.
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
}
