/**
 * Unit tests for writeScreenRecordingVideoToTemp
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'

const { mockWriteFileSync } = vi.hoisted(() => ({
  mockWriteFileSync: vi.fn() as Mock,
}))

vi.mock('node:fs', () => ({
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  default: { writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args) },
}))

import { writeScreenRecordingVideoToTemp } from './writeScreenRecordingVideoToTemp'

describe('writeScreenRecordingVideoToTemp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should write base64 video to temp file and return path', () => {
    const recordingId = '1705123456789'
    const base64 = Buffer.from('fake-webm-content').toString('base64')
    const path = writeScreenRecordingVideoToTemp(recordingId, base64)
    expect(path).toMatch(/voicetree-screen-recording-1705123456789\.webm$/)
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1)
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      path,
      expect.any(Buffer)
    )
    const buffer = mockWriteFileSync.mock.calls[0][1] as Buffer
    expect(buffer.toString()).toBe('fake-webm-content')
  })
})
