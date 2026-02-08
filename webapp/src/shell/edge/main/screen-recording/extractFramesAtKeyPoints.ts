/**
 * Extract one PNG frame at each key time from a video file using ffmpeg.
 * Requires ffmpeg to be installed and on PATH.
 */

import { execFile } from 'node:child_process'
import { mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface KeyPointInput {
  timeSeconds: number
  reason: string
}

export interface ScreenshotOutput {
  filename: string
  timeSeconds: number
  reason: string
}

/**
 * Extract one frame at each key point time and save as screenshot_1.png, screenshot_2.png, ...
 * Creates outputDir if needed.
 *
 * @param videoPath - Absolute path to the video file (e.g. .webm)
 * @param outputDir - Absolute path to folder for PNGs
 * @param keyPoints - List of { timeSeconds, reason }
 * @param startIndex - Optional 1-based start index (for "extract more"; default 1)
 * @returns List of { filename, timeSeconds, reason } for each written file
 */
export async function extractFramesAtKeyPoints(
  videoPath: string,
  outputDir: string,
  keyPoints: readonly KeyPointInput[],
  startIndex: number = 1
): Promise<ScreenshotOutput[]> {
  if (keyPoints.length === 0) return []

  if (!existsSync(dirname(outputDir))) {
    mkdirSync(dirname(outputDir), { recursive: true })
  }
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true })
  }

  const results: ScreenshotOutput[] = []

  for (let i = 0; i < keyPoints.length; i++) {
    const { timeSeconds, reason } = keyPoints[i]
    const filename = `screenshot_${startIndex + i}.png`
    const outPath = join(outputDir, filename)

    try {
      await execFileAsync('ffmpeg', [
        '-y',
        '-ss', String(timeSeconds),
        '-i', videoPath,
        '-vframes', '1',
        '-q:v', '2',
        outPath,
      ], { timeout: 15000 })
      results.push({ filename, timeSeconds, reason })
    } catch (err) {
      console.error(`[screen-recording] ffmpeg frame at ${timeSeconds}s failed:`, err)
      // Continue with other frames
    }
  }

  return results
}
