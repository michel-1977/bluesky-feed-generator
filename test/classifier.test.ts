import { describe, expect, it } from 'vitest'
import { classifyCandidatePost } from '../src/classifier'
import { FILTER_VERSION } from '../src/classifier/spec'

const baseInput = {
  langs: ['es'],
  authorDid: 'did:plc:test',
  languageAllowlist: ['es'],
  extraKeywords: [],
  trustedAuthorDids: new Set<string>(),
  ruleLlmMinScore: 60,
  ruleAutoAcceptScore: 85,
}

describe('classifyCandidatePost', () => {
  it('rejects legal false positives like atasco judicial', () => {
    const result = classifyCandidatePost({
      ...baseInput,
      text: 'La nueva organizacion de los tribunales consigue reducir el atasco judicial por primera vez en una decada.',
    })

    expect(result.action).toBe('reject')
    expect(result.rejectMetric).toBe('posts_rejected_hard_deny')
  })

  it('rejects medical false positives like retencion de liquidos', () => {
    const result = classifyCandidatePost({
      ...baseInput,
      text: 'Siempre un lacteo de postre si comemos alimentos ricos en hierro para no absorberlo todo. La retencion de liquidos puede ser peligrosa.',
    })

    expect(result.action).toBe('reject')
    expect(result.rejectMetric).toBe('posts_rejected_hard_deny')
  })

  it('rejects sports chatter with disaster language', () => {
    const result = classifyCandidatePost({
      ...baseInput,
      text: 'Milwaukee Bucks (3/10): Desastre de temporada marcado por la ausencia de buena parte de Anteto.',
    })

    expect(result.action).toBe('reject')
    expect(result.rejectMetric).toBe('posts_rejected_hard_deny')
  })

  it('accepts trusted weather alerts that explicitly affect travel in Spain', () => {
    const result = classifyCandidatePost({
      ...baseInput,
      authorDid: 'did:plc:trusted',
      trustedAuthorDids: new Set(['did:plc:trusted']),
      text: 'Jornada con complicaciones en lo meteorologico. Las lluvias de ayer dan paso a chubascos localmente fuertes y tormentosos, ocasionalmente acompanados de granizo. Tenemos avisos de AEMET en varias provincias andaluzas. Precaucion si te desplazas.',
    })

    expect(result).toMatchObject({
      action: 'accept',
      sourceTier: 'trusted',
      filterVersion: FILTER_VERSION,
    })
    expect(result.score).toBeGreaterThanOrEqual(85)
  })

  it('accepts Spain-local incident reports like SOS Rioja atropellos', () => {
    const result = classifyCandidatePost({
      ...baseInput,
      text: 'Despues de unos dias de mucho ajetreo toca volver a la cruda realidad, el 8 de abril se produjo el 28o atropello informado por SOSRioja en el ano, un senor de 82 anos en Calahorra que se derivo al Hospital de esa localidad www.larioja.org/emergencias-112',
    })

    expect(result).toMatchObject({
      action: 'accept',
      sourceTier: 'boosted',
      filterVersion: FILTER_VERSION,
    })
    expect(result.score).toBeGreaterThanOrEqual(85)
  })

  it('accepts trusted weather warnings that advise avoiding travel', () => {
    const result = classifyCandidatePost({
      ...baseInput,
      authorDid: 'did:plc:trusted',
      trustedAuthorDids: new Set(['did:plc:trusted']),
      text: 'AEMET activa aviso naranja por lluvias intensas y rachas fuertes en Valencia. Se recomienda evitar desplazamientos y extremar la precaucion.',
    })

    expect(result).toMatchObject({
      action: 'accept',
      sourceTier: 'trusted',
      filterVersion: FILTER_VERSION,
    })
    expect(result.score).toBeGreaterThanOrEqual(85)
  })
})
