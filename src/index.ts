import dotenv from 'dotenv'
import FeedGenerator from './server'
import { FILTER_VERSION } from './classifier/spec'

const DEFAULT_KEYWORDS = [
  'accidente',
  'colision',
  'carretera cortada',
  'corte de trafico',
  'retenciones',
  'atropello',
  'incidencia renfe',
  'inundacion',
  'nevadas',
  'granizo',
]

const run = async () => {
  dotenv.config()
  const hostname = maybeStr(process.env.FEEDGEN_HOSTNAME) ?? 'example.com'
  const serviceDid =
    maybeStr(process.env.FEEDGEN_SERVICE_DID) ?? `did:web:${hostname}`
  const feedShortname = (
    maybeStr(process.env.FEEDGEN_FEED_SHORTNAME) ?? 'mobility-risk'
  )
    .trim()
    .toLowerCase()
  const keywords = parseCsv(process.env.FEEDGEN_KEYWORDS, DEFAULT_KEYWORDS)
  const languageAllowlist = parseCsv(process.env.FEEDGEN_LANG_ALLOWLIST)
  const llmFilterEnabled = maybeBool(process.env.FEEDGEN_LLM_FILTER_ENABLED)
  const llmFilterApiKey = maybeStr(process.env.FEEDGEN_LLM_API_KEY)
  const llmFilterConfigured = (llmFilterEnabled ?? false) && !!llmFilterApiKey
  const ruleLlmMinScore = maybeInt(process.env.FEEDGEN_RULE_LLM_MIN_SCORE) ?? 70
  const ruleAutoAcceptScore =
    maybeInt(process.env.FEEDGEN_RULE_AUTO_ACCEPT_SCORE) ?? 85

  if ((llmFilterEnabled ?? false) && !llmFilterApiKey) {
    console.warn(
      'FEEDGEN_LLM_FILTER_ENABLED=true but FEEDGEN_LLM_API_KEY is missing. Ambiguous posts will be rejected.',
    )
  }

  if (ruleAutoAcceptScore < ruleLlmMinScore) {
    throw new Error(
      'FEEDGEN_RULE_AUTO_ACCEPT_SCORE must be greater than or equal to FEEDGEN_RULE_LLM_MIN_SCORE',
    )
  }

  const server = FeedGenerator.create({
    port: maybeInt(process.env.FEEDGEN_PORT) ?? 3000,
    listenhost: maybeStr(process.env.FEEDGEN_LISTENHOST) ?? 'localhost',
    sqliteLocation: maybeStr(process.env.FEEDGEN_SQLITE_LOCATION) ?? ':memory:',
    sqliteBackupLocation: maybeStr(process.env.FEEDGEN_SQLITE_BACKUP_LOCATION),
    sqliteBackupIntervalMs:
      maybeInt(process.env.FEEDGEN_SQLITE_BACKUP_INTERVAL_MS) ?? 15000,
    subscriptionEndpoint:
      maybeStr(process.env.FEEDGEN_SUBSCRIPTION_ENDPOINT) ??
      'wss://bsky.network',
    publisherDid:
      maybeStr(process.env.FEEDGEN_PUBLISHER_DID) ?? 'did:example:alice',
    subscriptionReconnectDelay:
      maybeInt(process.env.FEEDGEN_SUBSCRIPTION_RECONNECT_DELAY) ?? 3000,
    feedShortname,
    keywords,
    languageAllowlist,
    llmFilter: {
      enabled: llmFilterConfigured,
      apiUrl:
        maybeStr(process.env.FEEDGEN_LLM_API_URL) ??
        'https://api.openai.com/v1/chat/completions',
      apiKey: llmFilterApiKey ?? '',
      model: maybeStr(process.env.FEEDGEN_LLM_MODEL) ?? 'gpt-4o-mini',
      timeoutMs: maybeInt(process.env.FEEDGEN_LLM_TIMEOUT_MS) ?? 5000,
      maxInputChars: maybeInt(process.env.FEEDGEN_LLM_MAX_INPUT_CHARS) ?? 500,
      minConfidence: maybeFloat(process.env.FEEDGEN_LLM_MIN_CONFIDENCE) ?? 0.85,
      failOpen: maybeBool(process.env.FEEDGEN_LLM_FAIL_OPEN) ?? false,
    },
    ruleLlmMinScore,
    ruleAutoAcceptScore,
    filterVersion: FILTER_VERSION,
    maxPostAgeHours: maybeInt(process.env.FEEDGEN_MAX_POST_AGE_HOURS) ?? 0,
    maxIndexedPosts: maybeInt(process.env.FEEDGEN_MAX_INDEXED_POSTS) ?? 2500,
    hostname,
    serviceDid,
  })

  let shuttingDown = false
  const shutdown = async (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`Received ${signal}. Shutting down feed generator.`)

    try {
      await server.stop()
      process.exit(0)
    } catch (err) {
      console.error('Failed to stop feed generator cleanly', err)
      process.exit(1)
    }
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void shutdown(signal)
    })
  }

  await server.start()
  console.log(
    `Feed generator listening at http://${server.cfg.listenhost}:${server.cfg.port}`,
  )
  console.log(`Active feed shortname: ${server.cfg.feedShortname}`)
  console.log(`Current filter version: ${server.cfg.filterVersion}`)
  console.log(`Custom keyword count: ${server.cfg.keywords.length}`)
  console.log(
    `LLM semantic filter enabled: ${server.cfg.llmFilter.enabled ? 'yes' : 'no'}`,
  )
}

const maybeStr = (val?: string) => {
  if (!val) return undefined
  return val
}

const maybeInt = (val?: string) => {
  if (!val) return undefined
  const int = parseInt(val, 10)
  if (isNaN(int)) return undefined
  return int
}

const maybeFloat = (val?: string) => {
  if (!val) return undefined
  const float = parseFloat(val)
  if (isNaN(float)) return undefined
  return float
}

const maybeBool = (val?: string) => {
  if (!val) return undefined
  if (val === 'true') return true
  if (val === 'false') return false
  return undefined
}

const parseCsv = (val?: string, fallback: string[] = []) => {
  const source = val ?? fallback.join(',')
  return Array.from(
    new Set(
      source
        .split(',')
        .map((part) => part.trim().toLowerCase())
        .filter(Boolean),
    ),
  )
}

run().catch((err) => {
  console.error('Failed to start feed generator', err)
  process.exit(1)
})
