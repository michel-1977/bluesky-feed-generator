import dotenv from 'dotenv'
import FeedGenerator from './server'

const DEFAULT_KEYWORDS = [
  'accidente',
  'colisión',
  'atasco',
  'carretera cortada',
  'inundación',
  'diluvio',
  'congestión',
  'riesgo',
  'incidente',
  'retención',
  'atención',
  'inundación',
  'inundaciones',
  'corte de tráfico',
  'catástrofe',
  'desastre',
  'cuidado',
  'peligro',
  'precaución',
  'tormenta',
  'emergencia',
  'huracán',
  'tornado',
  'terremoto',
  'avalancha',
  'deslizamiento de tierra',
  'volcán',
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

  const server = FeedGenerator.create({
    port: maybeInt(process.env.FEEDGEN_PORT) ?? 3000,
    listenhost: maybeStr(process.env.FEEDGEN_LISTENHOST) ?? 'localhost',
    sqliteLocation: maybeStr(process.env.FEEDGEN_SQLITE_LOCATION) ?? ':memory:',
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
    maxPostAgeHours: maybeInt(process.env.FEEDGEN_MAX_POST_AGE_HOURS) ?? 48,
    maxIndexedPosts: maybeInt(process.env.FEEDGEN_MAX_INDEXED_POSTS) ?? 2500,
    hostname,
    serviceDid,
  })

  await server.start()
  console.log(
    `Feed generator listening at http://${server.cfg.listenhost}:${server.cfg.port}`,
  )
  console.log(`Active feed shortname: ${server.cfg.feedShortname}`)
  console.log(`Keyword count: ${server.cfg.keywords.length}`)
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
