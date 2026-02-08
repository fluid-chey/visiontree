/**
 * Creates a screen recording context node: fetches key points, extracts frames, writes .md.
 * Called from main process after recording stops (or on "extract more screenshots").
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import * as O from 'fp-ts/lib/Option'
import { getWritePath } from '@/shell/edge/main/graph/watch_folder/watchFolder'
import { getBackendPort } from '@/shell/edge/main/state/app-electron-state'
import {
  buildScreenRecordingContextMd,
  type BuildScreenRecordingContextMdParams,
} from '@/pure/screen-recording'
import {
  screenRecordingMdRelativePath,
  screenRecordingScreenshotsRelativePath,
} from '@/pure/screen-recording'
import { extractFramesAtKeyPoints } from './extractFramesAtKeyPoints'

/** Serializable shape for IPC (matches RecordingResult). */
export interface RecordingResultInput {
  recordingId: string
  videoPath: string
  transcript: readonly { text: string; timeSeconds: number; isFinal?: boolean }[]
  captureMode: 'chrome-tab' | 'desktop-region'
  startedAt: number
  stoppedAt: number
}

/**
 * Create the context .md and screenshot folder for a screen recording.
 * Fetches key points from backend, extracts frames via ffmpeg, writes .md.
 * Returns the absolute path to the new .md file, or null on failure.
 */
export async function createScreenRecordingContextNode(
  input: RecordingResultInput
): Promise<string | null> {
  const writePathOpt = await getWritePath()
  const writePath = O.getOrElse(() => '')(writePathOpt)
  if (!writePath) return null

  const port = getBackendPort()
  if (port == null) {
    console.error('[screen-recording] No backend port for key-points request')
    return null
  }

  const transcriptText = input.transcript
    .map((s) => `[${s.timeSeconds.toFixed(1)}s] ${s.text.trim()}`)
    .join('\n')

  let keyPoints: { timeSeconds: number; reason: string }[] = []
  try {
    const res = await fetch(`http://127.0.0.1:${port}/screen-recording/key-points`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript: transcriptText }),
    })
    if (res.ok) {
      const data = (await res.json()) as { key_points?: { timeSeconds: number; reason: string }[] }
      keyPoints = data.key_points ?? []
    }
  } catch (e) {
    console.error('[screen-recording] Key-points request failed:', e)
  }

  const screenshotsDir = join(writePath, screenRecordingScreenshotsRelativePath(input.recordingId))
  const screenshotResults = await extractFramesAtKeyPoints(
    input.videoPath,
    screenshotsDir,
    keyPoints
  )

  const mdRelative = screenRecordingMdRelativePath(input.recordingId)
  const mdPath = join(writePath, mdRelative)
  const recordingsDir = join(writePath, 'ctx-nodes', 'recordings')
  if (!existsSync(recordingsDir)) {
    mkdirSync(recordingsDir, { recursive: true })
  }

  const params: BuildScreenRecordingContextMdParams = {
    recordingId: input.recordingId,
    captureMode: input.captureMode,
    transcript: input.transcript,
    screenshots: screenshotResults,
    sourceRecordingPath: input.videoPath,
    createdAt: input.startedAt,
  }
  const content = buildScreenRecordingContextMd(params)
  writeFileSync(mdPath, content, 'utf-8')
  return mdPath
}
