import { LlmFilterConfig } from '../config'

type OpenAiChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | null
    }
  }>
}

type LlmDecision = {
  isMobilityImpactInSpain: boolean
  confidence: number
  reason: string
}

export type LlmReviewResult = {
  accepted: boolean
  confidence: number
  reason: string
  failed: boolean
}

export interface LlmReviewer {
  review(text: string, langs?: string[]): Promise<LlmReviewResult>
}

const SYSTEM_PROMPT = `You classify Bluesky posts for a feed.
Return ONLY valid JSON with this exact shape:
{"isMobilityImpactInSpain":boolean,"confidence":number,"reason":string}

Accept only when the post is clearly about mobility impact in Spain.
Valid positives include traffic incidents, road closures, transport service disruption, pedestrian collisions, or weather hazards that directly affect movement in Spain.
Reject these failure classes:
- legal or administrative backlog such as "atasco judicial"
- medical topics such as "retencion de liquidos" or "atencion medica"
- sports commentary such as "desastre de temporada"
- generic politics, diplomacy, or crisis language without direct transport impact
- general danger or weather commentary if mobility impact is not explicit
confidence must be a number from 0 to 1.`

export class MobilityRiskLlmFilter implements LlmReviewer {
  constructor(private cfg: LlmFilterConfig) {}

  async review(text: string, langs?: string[]): Promise<LlmReviewResult> {
    if (!this.cfg.enabled) {
      return {
        accepted: false,
        confidence: 0,
        reason: 'llm_disabled',
        failed: false,
      }
    }

    const normalizedText = text.trim()
    if (!normalizedText) {
      return {
        accepted: false,
        confidence: 0,
        reason: 'empty_text',
        failed: false,
      }
    }

    const trimmedText = normalizedText.slice(0, this.cfg.maxInputChars)
    const langList = (langs ?? []).filter(Boolean)

    try {
      const decision = await this.classify(trimmedText, langList)
      const confidence = clampConfidence(decision.confidence)
      return {
        accepted:
          decision.isMobilityImpactInSpain && confidence >= this.cfg.minConfidence,
        confidence,
        reason: decision.reason,
        failed: false,
      }
    } catch (err) {
      console.error('LLM semantic filter failed', err)
      return {
        accepted: this.cfg.failOpen,
        confidence: 0,
        reason: 'llm_error',
        failed: true,
      }
    }
  }

  private async classify(text: string, langs: string[]): Promise<LlmDecision> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.cfg.timeoutMs)

    try {
      const apiUrl = normalizeApiUrl(this.cfg.apiUrl)
      const requestBody = buildRequestBody(apiUrl, this.cfg.model, text, langs)
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: buildHeaders(apiUrl, this.cfg.apiKey),
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorBody = compactErrorBody(await response.text())
        throw new Error(
          `LLM request failed with HTTP ${response.status}${
            errorBody ? `: ${errorBody}` : ''
          }`,
        )
      }

      const payload = (await response.json()) as OpenAiChatResponse
      const rawContent = payload.choices?.[0]?.message?.content
      if (!rawContent) {
        throw new Error('LLM response does not include message content')
      }

      return parseDecision(rawContent)
    } finally {
      clearTimeout(timeout)
    }
  }
}

const buildHeaders = (apiUrl: string, apiKey: string) => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (isAzureOpenAiUrl(apiUrl)) {
    headers['api-key'] = apiKey
  } else {
    headers.Authorization = `Bearer ${apiKey}`
  }

  return headers
}

const buildRequestBody = (
  apiUrl: string,
  model: string,
  text: string,
  langs: string[],
) => {
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Text: ${text}\nLangs: ${
          langs.length > 0 ? langs.join(', ') : 'unknown'
        }`,
      },
    ],
  }

  if (!shouldOmitTemperature(apiUrl, model)) {
    body.temperature = 0
  }

  return body
}

const normalizeApiUrl = (rawApiUrl: string) => {
  const trimmed = rawApiUrl.trim()
  if (!trimmed) {
    return trimmed
  }

  const normalized = trimmed.replace(/\/+$/, '')
  if (!isAzureOpenAiUrl(normalized)) {
    return normalized
  }

  if (normalized.includes('/chat/completions') || normalized.includes('/responses')) {
    return normalized
  }

  if (normalized.endsWith('/openai/v1')) {
    return `${normalized}/chat/completions`
  }

  if (normalized.endsWith('.openai.azure.com')) {
    return `${normalized}/openai/v1/chat/completions`
  }

  return normalized
}

const isAzureOpenAiUrl = (value: string) => {
  return value.includes('.openai.azure.com')
}

const shouldOmitTemperature = (apiUrl: string, model: string) => {
  return isAzureOpenAiUrl(apiUrl) && /^gpt-5\b/i.test(model.trim())
}

const parseDecision = (rawContent: string): LlmDecision => {
  const rawJson = unwrapJsonBlock(rawContent)
  const parsed = JSON.parse(rawJson) as Partial<LlmDecision>

  if (typeof parsed.isMobilityImpactInSpain !== 'boolean') {
    throw new Error('LLM response missing boolean isMobilityImpactInSpain')
  }

  if (typeof parsed.confidence !== 'number' || Number.isNaN(parsed.confidence)) {
    throw new Error('LLM response missing numeric confidence')
  }

  return {
    isMobilityImpactInSpain: parsed.isMobilityImpactInSpain,
    confidence: parsed.confidence,
    reason: typeof parsed.reason === 'string' ? parsed.reason : '',
  }
}

const unwrapJsonBlock = (rawContent: string): string => {
  let value = rawContent.trim()

  if (value.startsWith('```')) {
    value = value.replace(/^```json\s*/i, '')
    value = value.replace(/^```\s*/i, '')
    value = value.replace(/\s*```$/, '')
  }

  const firstBrace = value.indexOf('{')
  const lastBrace = value.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace) {
    return value.slice(firstBrace, lastBrace + 1)
  }

  return value
}

const clampConfidence = (value: number): number => {
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

const compactErrorBody = (value: string) => {
  const trimmed = value.replace(/\s+/g, ' ').trim()
  if (!trimmed) return ''
  return trimmed.slice(0, 240)
}
