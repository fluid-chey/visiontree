/**
 * Parses LLM response into key points (timeSeconds, reason).
 * Returns empty array on invalid/malformed input; no throw.
 */

import type { KeyPoint } from './types'

interface KeyPointRaw {
  timeSeconds?: number
  reason?: string
}

/**
 * Parse JSON response from LLM into KeyPoint[].
 * Expects array of { timeSeconds: number, reason: string }.
 */
export function parseKeyPointsFromJson(json: string): readonly KeyPoint[] {
  try {
    const parsed: unknown = JSON.parse(json)
    if (!Array.isArray(parsed)) return []
    const result: KeyPoint[] = []
    for (const item of parsed) {
      const raw = item as KeyPointRaw
      const timeSeconds = typeof raw.timeSeconds === 'number' ? raw.timeSeconds : undefined
      const reason = typeof raw.reason === 'string' ? raw.reason.trim() : undefined
      if (timeSeconds !== undefined && timeSeconds >= 0 && reason !== undefined && reason.length > 0) {
        result.push({ timeSeconds, reason })
      }
    }
    return result
  } catch {
    return []
  }
}
