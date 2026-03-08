# Bluesky Feed Generator (Mobility Risk)

This folder contains a Bluesky custom feed generator scaffolded from the official template:
`https://github.com/bluesky-social/feed-generator`.

The feed indexes firehose posts that match mobility/disruption keywords (traffic, accidents, road closures, delays) and serves them via `app.bsky.feed.getFeedSkeleton`.

## What Is Included

- TypeScript feed generator server with ATProto lexicons
- Firehose subscription and SQLite indexing
- A production-oriented feed algorithm: `mobility-risk`
- Publish/unpublish scripts for `app.bsky.feed.generator` records

For setup prerequisites, see `REQUIREMENTS.md`.

## 1) Local Setup

```powershell
cd bluesky-feed-generator
Copy-Item .env.example .env
```

Edit `.env` and set at least:

- `FEEDGEN_HOSTNAME`: your public HTTPS hostname (for example `feeds.example.com`)
- `FEEDGEN_PUBLISHER_DID`: DID of the account that will own the feed record

Install dependencies:

```powershell
npm.cmd install
```

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

## Feed Behavior

The indexer stores posts that pass all enabled filters:

1. Keyword match (`FEEDGEN_KEYWORDS`)
2. Optional language allowlist (`FEEDGEN_LANG_ALLOWLIST`)

Retention controls:

- `FEEDGEN_MAX_POST_AGE_HOURS`: drops old rows (default `48`)
- `FEEDGEN_MAX_INDEXED_POSTS`: caps DB size to newest N rows (default `2500`)

Storage:

- SQLite location is controlled by `FEEDGEN_SQLITE_LOCATION`
- `:memory:` is ephemeral
- Set a file path (for example `db.sqlite`) for persistence

## Useful Commands

```powershell
npm.cmd run build
npm.cmd run start
npm.cmd run publishFeed
npm.cmd run unpublishFeed
```
