/**
 * Screen recording with getDisplayMedia + MediaRecorder + mic transcription.
 * Produces temp video path and timestamped transcript for key-point extraction.
 */

import { useCallback, useRef, useState } from 'react'
import type { Token } from '@soniox/speech-to-text-web'
import { SonioxClient } from '@soniox/speech-to-text-web'
import type { RecordingResult, TranscriptSegment } from '@/pure/screen-recording'

export type CaptureMode = 'chrome-tab' | 'desktop-region'

type RecordingState = 'idle' | 'capturing' | 'recording' | 'stopping' | 'error'

const LIGHTWEIGHT_VIDEO_BITRATE = 1_500_000 // 1.5 Mbps
const LIGHTWEIGHT_AUDIO_BITRATE = 128_000

interface UseScreenRecordingOptions {
  getApiKey: () => Promise<string>
}

export function useScreenRecording({
  getApiKey,
}: UseScreenRecordingOptions): {
  state: RecordingState
  error: string | null
  startRecording: (mode: CaptureMode) => Promise<void>
  stopRecording: () => Promise<RecordingResult | null>
} {
  const [state, setState] = useState<RecordingState>('idle')
  const [error, setError] = useState<string | null>(null)

  const recordingIdRef = useRef<string>('')
  const captureModeRef = useRef<CaptureMode>('chrome-tab')
  const startTimeRef = useRef<number>(0)
  const displayStreamRef = useRef<MediaStream | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const transcriptSegmentsRef = useRef<TranscriptSegment[]>([])
  const lastFinalTextRef = useRef<string>('')
  const sonioxRef = useRef<SonioxClient | null>(null)

  const startRecording = useCallback(
    async (mode: CaptureMode) => {
      setError(null)
      setState('capturing')
      const recordingId = String(Date.now())
      recordingIdRef.current = recordingId
      captureModeRef.current = mode
      startTimeRef.current = Date.now()
      transcriptSegmentsRef.current = []
      lastFinalTextRef.current = ''
      chunksRef.current = []

      try {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            displaySurface: mode === 'chrome-tab' ? 'browser' : 'monitor',
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 15 },
          },
          audio: false,
        })
        displayStreamRef.current = displayStream

        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
        const combined = new MediaStream([
          ...displayStream.getVideoTracks(),
          ...micStream.getAudioTracks(),
        ])

        const mimeType = MediaRecorder.isTypeSupported('video/webm; codecs=vp9')
          ? 'video/webm; codecs=vp9'
          : 'video/webm'
        const recorder = new MediaRecorder(combined, {
          mimeType,
          videoBitsPerSecond: LIGHTWEIGHT_VIDEO_BITRATE,
          audioBitsPerSecond: LIGHTWEIGHT_AUDIO_BITRATE,
        })
        mediaRecorderRef.current = recorder
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data)
        }
        recorder.start(1000)
        setState('recording')

        const apiKey = await getApiKey()
        const soniox = new SonioxClient({ apiKey })
        sonioxRef.current = soniox
        soniox.start({
          model: 'stt-rt-preview',
          onPartialResult(result: { tokens: Token[] }) {
            const finalTokens = result.tokens.filter((t) => t.is_final)
            const cumulative = finalTokens.map((t) => t.text).join('')
            if (cumulative.length > lastFinalTextRef.current.length) {
              const newText = cumulative.slice(lastFinalTextRef.current.length)
              lastFinalTextRef.current = cumulative
              const timeSeconds = (Date.now() - startTimeRef.current) / 1000
              transcriptSegmentsRef.current.push({
                text: newText,
                timeSeconds,
                isFinal: true,
              })
            }
          },
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        setState('error')
        displayStreamRef.current?.getTracks().forEach((t) => t.stop())
      }
    },
    [getApiKey]
  )

  const stopRecording = useCallback(async (): Promise<RecordingResult | null> => {
    if (state !== 'recording' && state !== 'capturing') return null
    setState('stopping')

    const recorder = mediaRecorderRef.current
    const displayStream = displayStreamRef.current
    const soniox = sonioxRef.current
    const recordingId = recordingIdRef.current
    const startedAt = startTimeRef.current
    const stoppedAt = Date.now()

    displayStreamRef.current = null
    mediaRecorderRef.current = null
    sonioxRef.current = null

    if (soniox) soniox.stop()
    displayStream?.getTracks().forEach((t) => t.stop())

    if (!recorder || recorder.state === 'inactive') {
      setState('idle')
      return null
    }

    return new Promise((resolve) => {
      recorder.onstop = async () => {
        const chunks = chunksRef.current
        const blob = new Blob(chunks, { type: 'video/webm' })
        const arrayBuffer = await blob.arrayBuffer()
        const bytes = new Uint8Array(arrayBuffer)
        let binary = ''
        const chunkSize = 8192
        for (let i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
        }
        const base64 = btoa(binary)

        const videoPath = await window.electronAPI?.main.writeScreenRecordingVideoToTemp(
          recordingId,
          base64
        )
        if (!videoPath) {
          setError('Failed to save video to temp')
          setState('error')
          resolve(null)
          return
        }

        setState('idle')
        resolve({
          recordingId,
          videoPath,
          transcript: [...transcriptSegmentsRef.current],
          captureMode: captureModeRef.current,
          startedAt,
          stoppedAt,
        })
      }
      recorder.stop()
    })
  }, [state])

  return {
    state,
    error,
    startRecording,
    stopRecording,
  }
}
