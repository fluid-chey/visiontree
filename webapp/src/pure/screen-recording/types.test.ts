import { describe, it, expect } from 'vitest'
import {
  screenRecordingBaseName,
  screenRecordingMdRelativePath,
  screenRecordingScreenshotsRelativePath,
  screenshotRelativePathFromMd,
  RECORDINGS_SUBFOLDER,
  SCREENSHOTS_FOLDER_SUFFIX,
} from './types'

describe('screen-recording path helpers', () => {
  it('should follow ctx-nodes/recordings/ and _screenshots naming', () => {
    const id = '1705123456789'
    expect(screenRecordingBaseName(id)).toBe('screen_recording_1705123456789')
    expect(screenRecordingMdRelativePath(id)).toBe(
      `ctx-nodes/${RECORDINGS_SUBFOLDER}/screen_recording_1705123456789.md`
    )
    expect(screenRecordingScreenshotsRelativePath(id)).toBe(
      `ctx-nodes/${RECORDINGS_SUBFOLDER}/screen_recording_1705123456789${SCREENSHOTS_FOLDER_SUFFIX}`
    )
  })

  it('should produce correct relative path from .md to screenshot', () => {
    const id = 'abc123'
    const filename = 'screenshot_1.png'
    expect(screenshotRelativePathFromMd(id, filename)).toBe(
      'screen_recording_abc123_screenshots/screenshot_1.png'
    )
  })
})
