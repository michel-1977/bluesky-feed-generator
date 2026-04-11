# Bluesky Feed Generator (Mobility Risk)

This repository runs a Bluesky custom feed generator focused on mobility-impacting posts in Spain.
It ingests the Bluesky firehose, applies a precision-first classifier, stores accepted posts in SQLite, and serves them through `app.bsky.feed.getFeedSkeleton`.

## What Is Included

- TypeScript feed generator server with ATProto lexicons
- Firehose subscription and SQLite indexing
- Precision-first mobility classifier with trusted-source boosts and optional LLM review
- Ranked feed output ordered by score, then recency
- Publish/unpublish scripts for `app.bsky.feed.generator` records
- Metrics endpoint and regression tests

For setup prerequisites, see `REQUIREMENTS.md`.

## 1) Local Setup

```powershell
cd bluesky-feed-generator
Copy-Item .env.example .env
npm.cmd install
```

Edit `.env` and set at least:

- `FEEDGEN_HOSTNAME`: your public HTTPS hostname (for example `feeds.example.com`)
- `FEEDGEN_PUBLISHER_DID`: DID of the account that will own the feed record
- `FEEDGEN_LLM_API_KEY`: only if you want the LLM review band enabled

Start locally:

```powershell
npm.cmd run start
```

## 2) Test The Endpoint

Use your configured values:

```text
http://localhost:3000/xrpc/app.bsky.feed.getFeedSkeleton?feed=at://<FEEDGEN_PUBLISHER_DID>/app.bsky.feed.generator/<FEEDGEN_FEED_SHORTNAME>
```

Default shortname is `mobility-risk`.

## 3) Publish The Feed

Run:

```powershell
npm.cmd run publishFeed
```

When prompted:

- Use your Bluesky handle and app password
- Set `recordName` to the same value as `FEEDGEN_FEED_SHORTNAME` (default: `mobility-risk`)
- Fill display name/description/avatar as needed

To remove the published feed record later:

```powershell
npm.cmd run unpublishFeed
```

## 4) Deploy Requirements

To be visible in clients, the service must be reachable via HTTPS on port 443 at `FEEDGEN_HOSTNAME`.

The generator exposes:

- `/.well-known/did.json`
- `/xrpc/app.bsky.feed.describeFeedGenerator`
- `/xrpc/app.bsky.feed.getFeedSkeleton`
- `/metrics`

## Feed Behavior

Accepted posts must satisfy all of the following:

1. Pass the optional language allowlist (`FEEDGEN_LANG_ALLOWLIST`)
2. Show clear mobility impact through either:
   - a strong transport incident phrase, or
   - co-occurring mobility and disruption/hazard signals
3. Include a Spain signal such as a Spanish institution, geography, road pattern, or trusted domain
4. Reach a rule score band:
   - `< FEEDGEN_RULE_LLM_MIN_SCORE`: reject
   - `FEEDGEN_RULE_LLM_MIN_SCORE .. FEEDGEN_RULE_AUTO_ACCEPT_SCORE-1`: LLM review if enabled, otherwise reject
   - `>= FEEDGEN_RULE_AUTO_ACCEPT_SCORE`: auto-accept if no negative-context hit

The checked-in classifier spec also contains:

- trusted author handles/DIDs resolved to DIDs at startup
- trusted link domains
- Spain geography/institution signals
- hard-deny phrases for known false positives

### LLM Notes

- `FEEDGEN_LLM_FILTER_ENABLED=false` keeps the system fully rule-based
- Ambiguous posts are only sent to the LLM review band
- `FEEDGEN_LLM_MIN_CONFIDENCE=0.85` is the precision-first default
- `FEEDGEN_LLM_FAIL_OPEN=false` rejects ambiguous posts when the LLM call fails

### Ranking And Storage

Accepted posts are stored with:

- `score`
- `sourceTier`
- `decisionReason`
- `filterVersion`

Feed ranking is:

1. `score desc`
2. `indexedAt desc`
3. `cid desc`

Only the current `filterVersion` is served, so stale noisy rows from older classifier versions are hidden immediately after rollout.

### Metrics

`/metrics` returns JSON counters including:

- `posts_processed`
- `posts_rejected_language`
- `posts_rejected_hard_deny`
- `posts_rejected_missing_mobility`
- `posts_rejected_missing_spain`
- `posts_rejected_low_score`
- `posts_sent_to_llm`
- `posts_rejected_llm`
- `posts_llm_failures`
- `posts_accepted_trusted`
- `posts_accepted_non_trusted`

### Retention

- `FEEDGEN_MAX_POST_AGE_HOURS`: drops old rows
- `FEEDGEN_MAX_INDEXED_POSTS`: caps persisted current-version rows to the newest accepted posts, evicting the oldest rows first
- `FEEDGEN_SQLITE_LOCATION`: local runtime SQLite path such as `db.sqlite`
- `FEEDGEN_SQLITE_BACKUP_LOCATION`: optional persisted copy path, for example `/app/data/db.sqlite` on a mounted Azure Files share
- `FEEDGEN_SQLITE_BACKUP_INTERVAL_MS`: debounce interval for flushing dirty SQLite state to the persisted copy

## Useful Commands

```powershell
npm.cmd run build
npm.cmd run test
npm.cmd run start
npm.cmd run publishFeed
npm.cmd run unpublishFeed
```
