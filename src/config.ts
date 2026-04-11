import { Database } from './db'
import { DidResolver } from '@atproto/identity'

export type AppContext = {
  db: Database
  didResolver: DidResolver
  cfg: Config
}

export type LlmFilterConfig = {
  enabled: boolean
  apiUrl: string
  apiKey: string
  model: string
  timeoutMs: number
  maxInputChars: number
  minConfidence: number
  failOpen: boolean
}

export type Config = {
  port: number
  listenhost: string
  hostname: string
  sqliteLocation: string
  sqliteBackupLocation?: string
  sqliteBackupIntervalMs: number
  subscriptionEndpoint: string
  serviceDid: string
  publisherDid: string
  subscriptionReconnectDelay: number
  feedShortname: string
  keywords: string[]
  languageAllowlist: string[]
  llmFilter: LlmFilterConfig
  ruleLlmMinScore: number
  ruleAutoAcceptScore: number
  filterVersion: string
  maxPostAgeHours: number
  maxIndexedPosts: number
}
