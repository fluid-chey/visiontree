/**
 * Shared types for screen recording context feature.
 * Used by Electron webapp and VSCode extension.
 */

/** Single segment of transcript with timestamp (seconds from recording start). */
export interface TranscriptSegment {
  readonly text: string
  readonly timeSeconds: number
  readonly isFinal?: boolean
}

/** One key moment chosen by LLM for a screenshot. */
export interface KeyPoint {
  readonly timeSeconds: number
  readonly reason: string
}

/** Result of a screen recording (before key-point extraction). */
export interface RecordingResult {
  readonly recordingId: string
  readonly videoPath: string
  readonly transcript: readonly TranscriptSegment[]
  readonly captureMode: 'chrome-tab' | 'desktop-region'
  readonly startedAt: number
  readonly stoppedAt: number
}

/** Metadata for a generated screenshot (filename and key point). */
export interface ScreenshotInfo {
  readonly filename: string
  readonly timeSeconds: number
  readonly reason: string
}

/** Folder names under ctx-nodes (plan: ctx-nodes/recordings/). */
export const RECORDINGS_SUBFOLDER = 'recordings' as const

/** Suffix for screenshot folder (plan: screen_recording_<id>_screenshots). */
export const SCREENSHOTS_FOLDER_SUFFIX = '_screenshots' as const

/**
 * Base name for a screen recording node (no path).
 * e.g. screen_recording_1705123456789
 */
export function screenRecordingBaseName(recordingId: string): string {
  return `screen_recording_${recordingId}`
}

/**
 * Relative path from vault write path to the context .md file.
 * e.g. ctx-nodes/recordings/screen_recording_1705123456789.md
 */
export function screenRecordingMdRelativePath(recordingId: string): string {
  return `ctx-nodes/${RECORDINGS_SUBFOLDER}/${screenRecordingBaseName(recordingId)}.md`
}

/**
 * Relative path from vault write path to the screenshot folder for this recording.
 * e.g. ctx-nodes/recordings/screen_recording_1705123456789_screenshots
 */
export function screenRecordingScreenshotsRelativePath(recordingId: string): string {
  return `ctx-nodes/${RECORDINGS_SUBFOLDER}/${screenRecordingBaseName(recordingId)}${SCREENSHOTS_FOLDER_SUFFIX}`
}

/**
 * Relative path from the context .md file to a screenshot in the screenshot folder.
 * The .md is at ctx-nodes/recordings/screen_recording_<id>.md
 * Screenshots are at ctx-nodes/recordings/screen_recording_<id>_screenshots/screenshot_N.png
 * So from the .md's directory, the screenshot is ./screen_recording_<id>_screenshots/screenshot_N.png
 */
export function screenshotRelativePathFromMd(recordingId: string, screenshotFilename: string): string {
  return `${screenRecordingBaseName(recordingId)}${SCREENSHOTS_FOLDER_SUFFIX}/${screenshotFilename}`
}
