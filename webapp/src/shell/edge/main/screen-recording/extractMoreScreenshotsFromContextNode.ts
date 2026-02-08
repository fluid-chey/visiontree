/**
 * Append more screenshots to an existing screen recording context node.
 * Reads the .md for sourceRecordingPath and transcript, fetches new key points, extracts frames, appends to file.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getBackendPort } from '@/shell/edge/main/state/app-electron-state'
import { screenRecordingBaseName } from '@/pure/screen-recording'
import { extractFramesAtKeyPoints } from './extractFramesAtKeyPoints'

const RECORDING_PREFIX = 'screen_recording_'

/**
 * Parse recordingId from context node path.
 * e.g. /vault/ctx-nodes/recordings/screen_recording_1705123456789.md -> 1705123456789
 */
function recordingIdFromMdPath(mdPath: string): string | null {
  const base = mdPath.split(/[/\\]/).pop() ?? ''
  if (!base.startsWith(RECORDING_PREFIX) || !base.endsWith('.md')) return null
  return base.slice(RECORDING_PREFIX.length, -3)
}

/**
 * Extract sourceRecordingPath from YAML frontmatter (first --- block).
 */
function parseSourceRecordingPath(content: string): string | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return null
  const yaml = match[1]
  const line = yaml.split('\n').find((l) => l.startsWith('sourceRecordingPath:'))
  if (!line) return null
  const value = line.slice('sourceRecordingPath:'.length).trim().replace(/^["']|["']$/g, '')
  return value || null
}

/**
 * Extract transcript section (between ## Transcript and ## Screenshots or next ##).
 */
function parseTranscriptSection(content: string): string {
  const start = content.indexOf('## Transcript')
  if (start === -1) return ''
  const after = content.slice(start + '## Transcript'.length)
  const end = after.search(/\n## /)
  const block = end === -1 ? after : after.slice(0, end)
  return block.replace(/^\n+/, '').trim()
}

/**
 * Get next screenshot index (max existing screenshot_N.png + 1).
 */
function getNextScreenshotIndex(screenshotsDir: string): number {
  if (!existsSync(screenshotsDir)) return 1
  const files = readdirSync(screenshotsDir)
  let max = 0
  for (const f of files) {
    const m = f.match(/^screenshot_(\d+)\.png$/)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return max + 1
}

/** Append new screenshot image refs at the end of the .md (same ## Screenshots section). */
function appendScreenshotRefsToMd(content: string, newRefs: string[]): string {
  if (newRefs.length === 0) return content
  return content.trimEnd() + '\n\n' + newRefs.join('\n\n') + '\n'
}

/**
 * Extract more screenshots for an existing screen recording context node.
 * Reads .md at contextNodePath, gets sourceRecordingPath and transcript, fetches key points, extracts frames, appends refs.
 * Returns true if at least one new screenshot was added.
 */
export async function extractMoreScreenshotsFromContextNode(
  contextNodePath: string
): Promise<boolean> {
  const recordingId = recordingIdFromMdPath(contextNodePath)
  if (!recordingId) return false

  const content = readFileSync(contextNodePath, 'utf-8')
  const sourceRecordingPath = parseSourceRecordingPath(content)
  if (!sourceRecordingPath || !existsSync(sourceRecordingPath)) {
    console.error('[screen-recording] No sourceRecordingPath or file missing for', contextNodePath)
    return false
  }

  const transcriptText = parseTranscriptSection(content)
  const port = getBackendPort()
  if (port == null) return false

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
    return false
  }

  if (keyPoints.length === 0) return false

  const screenshotsDir = join(dirname(contextNodePath), `${screenRecordingBaseName(recordingId)}_screenshots`)
  const nextIndex = getNextScreenshotIndex(screenshotsDir)
  const results = await extractFramesAtKeyPoints(
    sourceRecordingPath,
    screenshotsDir,
    keyPoints,
    nextIndex
  )
  if (results.length === 0) return false

  const baseName = screenRecordingBaseName(recordingId)
  const newRefs = results.map(
    (r) => `![Screenshot at ${formatTime(r.timeSeconds)} — ${r.reason}](${baseName}_screenshots/${r.filename})`
  )
  const updated = appendScreenshotRefsToMd(content, newRefs)
  writeFileSync(contextNodePath, updated, 'utf-8')
  return true
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
