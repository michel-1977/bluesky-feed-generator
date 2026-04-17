import { describe, expect, it } from 'vitest'
import { classifyCandidatePost } from '../src/classifier'
import { FILTER_VERSION } from '../src/classifier/spec'

const baseInput = {
  langs: ['es'],
  authorDid: 'did:plc:test',
  languageAllowlist: ['es'],
  extraKeywords: [],
  trustedAuthorDids: new Set<string>(),
  ruleLlmMinScore: 70,
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

  it('sends trusted weather alerts that explicitly affect travel in Spain to LLM review', () => {
    const result = classifyCandidatePost({
      ...baseInput,
      authorDid: 'did:plc:trusted',
      trustedAuthorDids: new Set(['did:plc:trusted']),
      text: 'Jornada con complicaciones en lo meteorologico. Las lluvias de ayer dan paso a chubascos localmente fuertes y tormentosos, ocasionalmente acompanados de granizo. Tenemos avisos de AEMET en varias provincias andaluzas. Precaucion si te desplazas.',
    })

    expect(result).toMatchObject({
      action: 'review',
      sourceTier: 'trusted',
      filterVersion: FILTER_VERSION,
    })
    expect(result.score).toBeGreaterThanOrEqual(85)
  })

  it('sends Spain-local incident reports like SOS Rioja atropellos to LLM review', () => {
    const result = classifyCandidatePost({
      ...baseInput,
      text: 'Despues de unos dias de mucho ajetreo toca volver a la cruda realidad, el 8 de abril se produjo el 28o atropello informado por SOSRioja en el ano, un senor de 82 anos en Calahorra que se derivo al Hospital de esa localidad www.larioja.org/emergencias-112',
    })

    expect(result).toMatchObject({
      action: 'review',
      sourceTier: 'boosted',
      filterVersion: FILTER_VERSION,
    })
    expect(result.score).toBeGreaterThanOrEqual(85)
  })

  it('sends trusted weather warnings that advise avoiding travel to LLM review', () => {
    const result = classifyCandidatePost({
      ...baseInput,
      authorDid: 'did:plc:trusted',
      trustedAuthorDids: new Set(['did:plc:trusted']),
      text: 'AEMET activa aviso naranja por lluvias intensas y rachas fuertes en Valencia. Se recomienda evitar desplazamientos y extremar la precaucion.',
    })

    expect(result).toMatchObject({
      action: 'review',
      sourceTier: 'trusted',
      filterVersion: FILTER_VERSION,
    })
    expect(result.score).toBeGreaterThanOrEqual(85)
  })

  it('sends clear neutral local reports with a strong incident phrase and Spain-local signal to LLM review', () => {
    const result = classifyCandidatePost({
      ...baseInput,
      text: 'Carretera cortada en la A-8 a la altura de Bilbao por accidente multiple. Desvios habilitados.',
    })

    expect(result).toMatchObject({
      action: 'review',
      sourceTier: 'neutral',
      filterVersion: FILTER_VERSION,
    })
  })

  it('sends the political atropello false positive to LLM review instead of rule accept', () => {
    const result = classifyCandidatePost({
      ...baseInput,
      text: 'Lo del pasado martes en el Pleno de Coslada no es solo un atropello politico: es un ataque a nuestros derechos. En Mas Madrid Coslada no vamos a tolerarlo.',
    })

    expect(result).toMatchObject({
      action: 'review',
      sourceTier: 'neutral',
      filterVersion: FILTER_VERSION,
    })
    expect(result.score).toBeLessThan(70)
  })

  it('rejects vague Spain weather chatter when mobility impact is not explicit', () => {
    const result = classifyCandidatePost({
      ...baseInput,
      text: 'Lluvias y tormenta esta tarde en Madrid. Mucha precaucion por el tiempo.',
    })

    expect(result.action).toBe('reject')
    expect(result.rejectMetric).toBe('posts_rejected_missing_mobility')
  })
})
