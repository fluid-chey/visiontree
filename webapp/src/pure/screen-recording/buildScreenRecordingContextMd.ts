/**
 * Builds the markdown content for a screen recording context node.
 * Pure: no side effects; given inputs produce deterministic .md string.
 */

import type { TranscriptSegment, KeyPoint, ScreenshotInfo } from './types'
import { screenRecordingBaseName } from './types'

export interface BuildScreenRecordingContextMdParams {
  readonly recordingId: string
  readonly captureMode: 'chrome-tab' | 'desktop-region'
  readonly transcript: readonly TranscriptSegment[]
  readonly screenshots: readonly ScreenshotInfo[]
  readonly sourceRecordingPath: string
  readonly createdAt: number
}

/**
 * Escape text for safe use in markdown (avoid breaking frontmatter or image refs).
 * Replaces potential YAML/frontmatter issues and backslash-escapes markdown specials in body.
 */
function escapeForMarkdown(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\[/g, '\\[')  // avoid accidental link syntax
    .replace(/\]/g, '\\]')
    .replace(/\n/g, ' ')    // single-line captions
    .trim()
}

function formatDate(ts: number): string {
  return new Date(ts).toISOString().replace('T', ' ').slice(0, 19)
}

/**
 * Build the full markdown string for the screen recording context node.
 */
export function buildScreenRecordingContextMd(params: BuildScreenRecordingContextMdParams): string {
  const {
    recordingId,
    captureMode,
    transcript,
    screenshots,
    sourceRecordingPath,
    createdAt,
  } = params

  const captureLabel = captureMode === 'chrome-tab' ? 'Chrome tab' : 'desktop region'
  const intro = `Screen recording from ${formatDate(createdAt)} — ${captureLabel}.`

  const transcriptSection = transcript.length > 0
    ? transcript
        .map((s) => `[${s.timeSeconds.toFixed(1)}s] ${s.text.trim()}`)
        .join('\n')
    : '(No transcript.)'

  const screenshotsSection =
    screenshots.length > 0
      ? screenshots
          .map((s, i) => {
            const relPath = `${screenRecordingBaseName(recordingId)}_screenshots/${s.filename}`
            const caption = escapeForMarkdown(s.reason)
            return `![Screenshot at ${formatTimeSeconds(s.timeSeconds)} — ${caption}](${relPath})`
          })
          .join('\n\n')
      : '_No key moments extracted._'

  const frontmatter = `---
title: "Screen recording ${recordingId}"
isContextNode: true
sourceRecordingPath: "${sourceRecordingPath.replace(/"/g, '\\"')}"
---
`

  return `${frontmatter}
# ${intro}

## Transcript
${transcriptSection}

## Screenshots
${screenshotsSection}
`
}

function formatTimeSeconds(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
