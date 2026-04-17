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
  sqliteBackupIntervalMs: 15000,
  subscriptionEndpoint: 'wss://bsky.network',
  serviceDid: 'did:web:example.com',
  sqliteBackupLocation: undefined,
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
  ruleLlmMinScore: 70,
  ruleAutoAcceptScore: 85,
  filterVersion: FILTER_VERSION,
  maxPostAgeHours: 0,
  maxIndexedPosts: 2500,
  ...overrides,
})
