# Bluesky Feed Generator (Mobility Risk)

This repository runs a Bluesky custom feed generator focused on mobility-impacting posts in Spain.
It ingests the Bluesky firehose, applies a precision-first classifier, stores accepted posts in SQLite, and serves them through `app.bsky.feed.getFeedSkeleton`.

## What Is Included

- TypeScript feed generator server with ATProto lexicons
- Firehose subscription and SQLite indexing
- Precision-first mobility classifier with trusted-source boosts and optional LLM review
- Ranked feed output ordered by recency, then score
- Publish/unpublish scripts for `app.bsky.feed.generator` records
- Repo-managed Azure Container Apps deployment script with Azure Files backup
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

The supported Azure release path is the repo-managed PowerShell script:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-azure.ps1
```

The script is designed for the existing Azure target:

- Container App: `app-bluesky-feed`
- Resource group: `rg-bluesky-feed`
- Registry: `ca7300480f77acr`
- Azure Files share: `feeddb`

History-preserving guarantees during deploy:

- creates a timestamped Azure Files backup copy of the persisted `db.sqlite`
- updates only the container image on the existing Container App
- keeps the existing env vars, secrets, hostname, publisher DID, and mounted Azure Files volume
- keeps single-revision / single-replica settings so two firehose consumers do not race on the same SQLite state
- prints the previous image as the rollback target after the deploy completes

## Feed Behavior

Accepted posts must satisfy all of the following:

1. Pass the optional language allowlist (`FEEDGEN_LANG_ALLOWLIST`)
2. Show clear mobility impact through either:
   - a strong transport incident phrase, or
   - co-occurring mobility and disruption/hazard signals
3. Include a Spain signal such as a Spanish institution, geography, road pattern, or trusted domain
4. Reach a rule score band:
  - `< FEEDGEN_RULE_LLM_MIN_SCORE`: reject
  - `>= FEEDGEN_RULE_LLM_MIN_SCORE`: LLM review if enabled, otherwise reject

There is one additional rule path for clearer local reporting:

- neutral sources are sent to LLM review when they include a strong transport-incident phrase plus a Spain-local signal (`geography`, `road pattern`, or `.es` domain) and no negative-context hit

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

1. `indexedAt desc`
2. `score desc`
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

- `FEEDGEN_MAX_POST_AGE_HOURS`: drops old rows when greater than `0`; set `0` to disable age-based pruning and keep only the newest accepted rows
- `FEEDGEN_MAX_INDEXED_POSTS`: caps persisted current-version rows to the newest accepted posts, evicting the oldest rows first
- `FEEDGEN_SQLITE_LOCATION`: local runtime SQLite path such as `db.sqlite`
- `FEEDGEN_SQLITE_BACKUP_LOCATION`: optional persisted copy path, for example `/app/data/db.sqlite` on a mounted Azure Files share
- `FEEDGEN_SQLITE_BACKUP_INTERVAL_MS`: debounce interval for flushing dirty SQLite state to the persisted copy

### Azure Rollout Notes

The deploy script performs this sequence:

1. Verifies Azure login and the expected subscription/resource names
2. Copies the mounted Azure Files SQLite file to `feeddb/backups/db-<timestamp>.sqlite`
3. Builds a new image in ACR with a `release-<gitsha>-<timestamp>` tag
4. Updates only the image on `app-bluesky-feed`
5. Waits for the new revision to become ready and healthy
6. Smoke-tests `/metrics` and the feed endpoint
7. Prints the previous image and a rollback command

Rollback is an image swap back to the previous tag printed by the script. No Git history rewrite or SQLite wipe is part of the release flow.

## Useful Commands

```powershell
npm.cmd run build
npm.cmd run test
npm.cmd run start
npm.cmd run start:prod
npm.cmd run publishFeed
npm.cmd run unpublishFeed
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-azure.ps1
```
