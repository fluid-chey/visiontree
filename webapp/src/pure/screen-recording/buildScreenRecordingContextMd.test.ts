import { describe, it, expect } from 'vitest'
import { buildScreenRecordingContextMd } from './buildScreenRecordingContextMd'

describe('buildScreenRecordingContextMd', () => {
  it('should produce valid frontmatter, transcript section, and one image ref per screenshot', () => {
    const md = buildScreenRecordingContextMd({
      recordingId: '1705123456789',
      captureMode: 'chrome-tab',
      transcript: [
        { text: 'Hello world', timeSeconds: 0, isFinal: true },
        { text: 'Key point here.', timeSeconds: 5.2, isFinal: true },
      ],
      screenshots: [
        { filename: 'screenshot_1.png', timeSeconds: 5.2, reason: 'topic change' },
      ],
      sourceRecordingPath: '/tmp/voicetree-screen-recording-1705123456789.webm',
      createdAt: 1705123456789,
    })
    expect(md).toContain('---')
    expect(md).toContain('title: "Screen recording 1705123456789"')
    expect(md).toContain('isContextNode: true')
    expect(md).toContain('sourceRecordingPath:')
    expect(md).toContain('## Transcript')
    expect(md).toContain('[0.0s] Hello world')
    expect(md).toContain('[5.2s] Key point here.')
    expect(md).toContain('## Screenshots')
    expect(md).toContain('![Screenshot at 0:05')
    expect(md).toContain('screen_recording_1705123456789_screenshots/screenshot_1.png')
    expect(md).toContain('topic change')
  })

  it('should handle empty key points with explicit no key moments message', () => {
    const md = buildScreenRecordingContextMd({
      recordingId: '999',
      captureMode: 'desktop-region',
      transcript: [{ text: 'Only one line', timeSeconds: 0 }],
      screenshots: [],
      sourceRecordingPath: '/tmp/rec.webm',
      createdAt: Date.now(),
    })
    expect(md).toContain('## Screenshots')
    expect(md).toContain('_No key moments extracted._')
    expect(md).not.toContain('![')
  })

  it('should escape special characters in reason/caption', () => {
    const md = buildScreenRecordingContextMd({
      recordingId: 'id',
      captureMode: 'chrome-tab',
      transcript: [],
      screenshots: [
        { filename: 's1.png', timeSeconds: 1, reason: 'See [link] and "quote"' },
      ],
      sourceRecordingPath: '/tmp/v.webm',
      createdAt: 0,
    })
    expect(md).toContain('\\[')
    expect(md).toContain('\\]')
  })
})
