/**
 * Writes screen recording video (base64) to a temp file.
 * Used by renderer after MediaRecorder stops; returns path for 24h retention.
 */

import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PREFIX = 'voicetree-screen-recording-'
const SUFFIX = '.webm'

/**
 * Writes video data to a temp file and returns the absolute path.
 * File is stored in os.tmpdir() for 24h retention (cleanup elsewhere).
 *
 * @param recordingId - Unique id (e.g. timestamp string)
 * @param videoBase64 - Base64-encoded WebM video data
 * @returns Absolute path to the written file
 */
export function writeScreenRecordingVideoToTemp(
  recordingId: string,
  videoBase64: string
): string {
  const buffer = Buffer.from(videoBase64, 'base64')
  const filename = `${PREFIX}${recordingId}${SUFFIX}`
  const fullPath = join(tmpdir(), filename)
  writeFileSync(fullPath, buffer)
  return fullPath
}
