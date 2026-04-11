import { migrateToLatest, createDb, Database } from '../src/db'
import { Config } from '../src/config'
import { FILTER_VERSION } from '../src/classifier/spec'

export const createTestDb = async (): Promise<Database> => {
  const db = createDb(':memory:')
  await migrateToLatest(db)
  return db
}

export const createTestConfig = (
  overrides: Partial<Config> = {},
): Config => ({
  port: 3000,
  listenhost: 'localhost',
  hostname: 'example.com',
  sqliteLocation: ':memory:',
  subscriptionEndpoint: 'wss://bsky.network',
  serviceDid: 'did:web:example.com',
  publisherDid: 'did:plc:publisher',
  subscriptionReconnectDelay: 3000,
  feedShortname: 'mobility-risk',
  keywords: [],
  languageAllowlist: ['es'],
  llmFilter: {
    enabled: false,
    apiUrl: 'https://api.openai.com/v1/chat/completions',
    apiKey: '',
    model: 'gpt-4o-mini',
    timeoutMs: 5000,
    maxInputChars: 500,
    minConfidence: 0.85,
    failOpen: false,
  },
  ruleLlmMinScore: 60,
  ruleAutoAcceptScore: 85,
  filterVersion: FILTER_VERSION,
  maxPostAgeHours: 48,
  maxIndexedPosts: 2500,
  ...overrides,
})
