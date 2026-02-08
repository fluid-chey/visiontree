import { describe, it, expect } from 'vitest'
import { parseKeyPointsFromJson } from './parseKeyPoints'

describe('parseKeyPointsFromJson', () => {
  it('should parse valid LLM response', () => {
    const json = JSON.stringify([
      { timeSeconds: 0, reason: 'Intro' },
      { timeSeconds: 30.5, reason: 'Topic change' },
    ])
    const result = parseKeyPointsFromJson(json)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ timeSeconds: 0, reason: 'Intro' })
    expect(result[1]).toEqual({ timeSeconds: 30.5, reason: 'Topic change' })
  })

  it('should return empty array for invalid JSON', () => {
    expect(parseKeyPointsFromJson('not json')).toEqual([])
    expect(parseKeyPointsFromJson('')).toEqual([])
    expect(parseKeyPointsFromJson('{')).toEqual([])
  })

  it('should return empty array when root is not array', () => {
    expect(parseKeyPointsFromJson('{}')).toEqual([])
    expect(parseKeyPointsFromJson('null')).toEqual([])
    expect(parseKeyPointsFromJson('"string"')).toEqual([])
  })

  it('should skip entries missing timeSeconds or reason', () => {
    const json = JSON.stringify([
      { timeSeconds: 1, reason: 'OK' },
      { reason: 'Missing time' },
      { timeSeconds: 2 },
      { timeSeconds: -1, reason: 'Negative time skipped' },
      { timeSeconds: 3, reason: '' },
    ])
    const result = parseKeyPointsFromJson(json)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ timeSeconds: 1, reason: 'OK' })
  })
})
