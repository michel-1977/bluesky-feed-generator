import {
  FILTER_VERSION,
  HARD_DENY_PHRASES,
  HAZARD_TERMS,
  INCIDENT_TERMS,
  MOBILITY_TERMS,
  NEGATIVE_CONTEXT_PHRASES,
  SPAIN_GEO_SIGNALS,
  SPAIN_INSTITUTION_SIGNALS,
  SPAIN_ROAD_PATTERN,
  STRONG_TRANSPORT_INCIDENT_PHRASES,
  TRUSTED_LINK_DOMAINS,
} from './spec'

export type SourceTier = 'trusted' | 'boosted' | 'neutral'

export type RuleRejectMetric =
  | 'posts_rejected_language'
  | 'posts_rejected_hard_deny'
  | 'posts_rejected_missing_mobility'
  | 'posts_rejected_missing_spain'
  | 'posts_rejected_low_score'

export type RuleClassification = {
  action: 'accept' | 'review' | 'reject'
  score: number
  sourceTier: SourceTier
  filterVersion: string
  decisionReason: string
  rejectMetric?: RuleRejectMetric
}

export type ClassificationInput = {
  text: string
  langs?: string[]
  authorDid: string
  languageAllowlist: string[]
  extraKeywords: string[]
  trustedAuthorDids: ReadonlySet<string>
  ruleLlmMinScore: number
  ruleAutoAcceptScore: number
}

export const classifyCandidatePost = (
  input: ClassificationInput,
): RuleClassification => {
  const normalizedText = normalizeForMatch(input.text)
  const normalizedLangs = (input.langs ?? [])
    .map((lang) => lang.trim().toLowerCase())
    .filter(Boolean)

  if (input.languageAllowlist.length > 0) {
    const langAllowed = normalizedLangs.some((lang) => {
      return input.languageAllowlist.some((allowed) => {
        return lang === allowed || lang.startsWith(`${allowed}-`)
      })
    })

    if (!langAllowed) {
      return reject('posts_rejected_language', 'language_allowlist_mismatch')
    }
  }

  const domains = extractDomains(normalizedText)
  const hardDenyHits = findMatches(normalizedText, HARD_DENY_PHRASES)
  if (hardDenyHits.length > 0) {
    return reject('posts_rejected_hard_deny', `hard_deny:${hardDenyHits[0]}`)
  }

  const strongPhraseHits = findMatches(normalizedText, STRONG_TRANSPORT_INCIDENT_PHRASES)
  const mobilityHits = findMatches(normalizedText, MOBILITY_TERMS)
  const incidentHits = findMatches(normalizedText, INCIDENT_TERMS)
  const hazardHits = findMatches(normalizedText, HAZARD_TERMS)
  const negativeContextHits = findMatches(normalizedText, NEGATIVE_CONTEXT_PHRASES)
  const geographyHits = findMatches(normalizedText, SPAIN_GEO_SIGNALS)
  const institutionHits = findMatches(normalizedText, SPAIN_INSTITUTION_SIGNALS)
  const trustedDomainHits = domains.filter((domain) => isTrustedDomain(domain))
  const spanishDomainHits = domains.filter((domain) => domain.endsWith('.es'))
  const extraKeywordHits = findMatches(
    normalizedText,
    input.extraKeywords.map((keyword) => normalizeForMatch(keyword)).filter(Boolean),
  )
  const hasRoadPattern = SPAIN_ROAD_PATTERN.test(normalizedText)
  const sourceTier = getSourceTier(
    input.authorDid,
    input.trustedAuthorDids,
    trustedDomainHits,
    institutionHits,
  )

  const hasMobilityImpact =
    strongPhraseHits.length > 0 ||
    (mobilityHits.length > 0 && (incidentHits.length > 0 || hazardHits.length > 0))

  if (!hasMobilityImpact) {
    return reject('posts_rejected_missing_mobility', 'missing_mobility_impact')
  }

  const hasSpainSignal =
    sourceTier === 'trusted' ||
    geographyHits.length > 0 ||
    institutionHits.length > 0 ||
    trustedDomainHits.length > 0 ||
    spanishDomainHits.length > 0 ||
    hasRoadPattern

  if (!hasSpainSignal) {
    return reject('posts_rejected_missing_spain', 'missing_spain_signal')
  }

  const score = clampScore(
    (strongPhraseHits.length > 0 ? 48 : 28) +
      Math.min(14, mobilityHits.length * 4) +
      Math.min(14, incidentHits.length * 5) +
      Math.min(12, hazardHits.length * 4) +
      Math.min(10, geographyHits.length * 4) +
      Math.min(10, institutionHits.length * 5) +
      (hasRoadPattern ? 12 : 0) +
      (trustedDomainHits.length > 0 ? 12 : 0) +
      (spanishDomainHits.length > 0 ? 6 : 0) +
      (sourceTier === 'trusted' ? 30 : sourceTier === 'boosted' ? 20 : 0) +
      Math.min(8, extraKeywordHits.length * 2) -
      Math.min(18, negativeContextHits.length * 9),
  )

  if (score >= input.ruleAutoAcceptScore && negativeContextHits.length === 0) {
    return {
      action: 'accept',
      score,
      sourceTier,
      filterVersion: FILTER_VERSION,
      decisionReason: buildDecisionReason('rule_accept', {
        sourceTier,
        strongPhraseHits,
        institutionHits,
        geographyHits,
      }),
    }
  }

  if (score >= input.ruleLlmMinScore) {
    return {
      action: 'review',
      score,
      sourceTier,
      filterVersion: FILTER_VERSION,
      decisionReason: buildDecisionReason('llm_review', {
        sourceTier,
        strongPhraseHits,
        institutionHits,
        geographyHits,
      }),
    }
  }

  return reject('posts_rejected_low_score', `low_score:${score}`)
}

const reject = (
  metric: RuleRejectMetric,
  decisionReason: string,
): RuleClassification => ({
  action: 'reject',
  score: 0,
  sourceTier: 'neutral',
  filterVersion: FILTER_VERSION,
  decisionReason,
  rejectMetric: metric,
})

const getSourceTier = (
  authorDid: string,
  trustedAuthorDids: ReadonlySet<string>,
  trustedDomainHits: string[],
  institutionHits: string[],
): SourceTier => {
  if (trustedAuthorDids.has(authorDid)) {
    return 'trusted'
  }

  if (trustedDomainHits.length > 0 || institutionHits.length > 0) {
    return 'boosted'
  }

  return 'neutral'
}

const buildDecisionReason = (
  prefix: string,
  signals: {
    sourceTier: SourceTier
    strongPhraseHits: string[]
    institutionHits: string[]
    geographyHits: string[]
  },
) => {
  const strongestSignal =
    signals.strongPhraseHits[0] ?? signals.institutionHits[0] ?? signals.geographyHits[0]
  return `${prefix}:${signals.sourceTier}${strongestSignal ? `:${strongestSignal}` : ''}`
}

const findMatches = (value: string, phrases: readonly string[]) => {
  return phrases.filter((phrase) => phrase && value.includes(phrase))
}

const extractDomains = (value: string) => {
  const matches = value.match(/(?:https?:\/\/)?(?:www\.)?([a-z0-9.-]+\.[a-z]{2,})(?:\/[^\s]*)?/g) ?? []
  return Array.from(
    new Set(
      matches
        .map((match) => match.replace(/^https?:\/\//, '').replace(/^www\./, ''))
        .map((match) => match.split('/')[0])
        .filter(Boolean),
    ),
  )
}

const isTrustedDomain = (domain: string) => {
  return TRUSTED_LINK_DOMAINS.some((trusted) => {
    return domain === trusted || domain.endsWith(`.${trusted}`)
  })
}

const clampScore = (value: number) => {
  if (value < 0) return 0
  if (value > 100) return 100
  return value
}

export const normalizeForMatch = (value: string) => {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}
