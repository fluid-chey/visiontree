/**
 * Deletes screen recording temp files older than 24 hours.
 * Called on app launch so temp storage stays bounded.
 */

import { readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const PREFIX = 'voicetree-screen-recording-'
const SUFFIX = '.webm'
const MAX_AGE_MS = 24 * 60 * 60 * 1000

/**
 * Removes voicetree-screen-recording-*.webm files in os.tmpdir() that are
 * older than 24 hours. Ignores read/stat/unlink errors so one bad file
 * doesn't break startup.
 */
export function cleanupOldScreenRecordingVideos(): void {
  const dir = tmpdir()
  let deleted = 0
  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    const now = Date.now()
    for (const ent of entries) {
      if (!ent.isFile() || !ent.name.startsWith(PREFIX) || !ent.name.endsWith(SUFFIX)) continue
      try {
        const path = join(dir, ent.name)
        const stat = statSync(path)
        if (now - stat.mtimeMs > MAX_AGE_MS) {
          unlinkSync(path)
          deleted++
        }
      } catch {
        // ignore per-file errors
      }
    }
    if (deleted > 0) {
      console.log(`[ScreenRecording] Cleaned up ${deleted} old temp video(s)`)
    }
  } catch {
    // ignore if tmpdir isn't readable
  }
}
