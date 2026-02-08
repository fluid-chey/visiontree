import { useState } from 'react'
import { useScreenRecording, type CaptureMode } from '@/shell/UI/views/hooks/useScreenRecording'
import getAPIKey from '@/utils/get-api-key'
import { cn } from '@/utils/lib/utils'

export default function ScreenRecordingControls(): JSX.Element {
  const [creatingNode, setCreatingNode] = useState(false)
  const {
    state,
    error,
    startRecording,
    stopRecording,
  } = useScreenRecording({ getApiKey: getAPIKey })

  const isRecording = state === 'recording' || state === 'capturing'
  const isStopping = state === 'stopping' || creatingNode

  const handleStop = async (): Promise<void> => {
    setCreatingNode(true)
    try {
      const result = await stopRecording()
      if (result && window.electronAPI?.main.createScreenRecordingContextNode) {
        const mdPath = await window.electronAPI.main.createScreenRecordingContextNode({
          recordingId: result.recordingId,
          videoPath: result.videoPath,
          transcript: result.transcript,
          captureMode: result.captureMode,
          startedAt: result.startedAt,
          stoppedAt: result.stoppedAt,
        })
        if (mdPath) {
          // Graph will update via file watcher; optional: focus the new node
        }
      }
    } finally {
      setCreatingNode(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      {!isRecording ? (
        <>
          <button
            type="button"
            onClick={() => void startRecording('chrome-tab')}
            disabled={isStopping}
            className={cn(
              'px-2 py-1 text-xs rounded-md border cursor-pointer',
              'bg-background hover:bg-accent border-input'
            )}
            title="Record a browser tab (you will pick which tab)"
          >
            Record tab
          </button>
          <button
            type="button"
            onClick={() => void startRecording('desktop-region')}
            disabled={isStopping}
            className={cn(
              'px-2 py-1 text-xs rounded-md border cursor-pointer',
              'bg-background hover:bg-accent border-input'
            )}
            title="Record screen or window (you will pick)"
          >
            Record screen
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => void handleStop()}
          disabled={isStopping}
          className={cn(
            'px-2 py-1 text-xs rounded-md cursor-pointer',
            'bg-destructive text-destructive-foreground hover:bg-destructive/90'
          )}
        >
          {isStopping ? 'Creating context…' : 'Stop & save'}
        </button>
      )}
      {error && (
        <span className="text-xs text-destructive">{error}</span>
      )}
    </div>
  )
}
