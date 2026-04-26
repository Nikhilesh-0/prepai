import React, { useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import useInterview, { STATES } from '../hooks/useInterview'
import AIIndicator from '../components/interview/AIIndicator'
import LiveTranscript from '../components/interview/LiveTranscript'
import WaveformBar from '../components/interview/WaveformBar'
import ProgressBar from '../components/interview/ProgressBar'
import Controls from '../components/interview/Controls'
import Button from '../components/ui/Button'

function orbState(interviewState) {
  switch (interviewState) {
    case STATES.AI_SPEAKING: return 'speaking'
    case STATES.LISTENING: return 'listening'
    case STATES.PROCESSING: return 'processing'
    default: return 'idle'
  }
}

function StatusLabel({ interviewState, connectionState }) {
  if (connectionState === 'connecting') {
    return (
      <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
        connecting<span style={{ animation: 'blink 1s step-end infinite' }}>_</span>
      </span>
    )
  }
  if (connectionState === 'error') {
    return <span style={{ color: 'var(--danger)', fontSize: '12px' }}>[!] connection error</span>
  }
  switch (interviewState) {
    case STATES.AI_SPEAKING:
      return <span style={{ color: 'var(--accent)', fontSize: '12px' }}>● speaking</span>
    case STATES.LISTENING:
      return <span style={{ color: 'var(--accent)', fontSize: '12px' }}>● listening</span>
    case STATES.PROCESSING:
      return <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>processing<span style={{ animation: 'blink 1s step-end infinite' }}>_</span></span>
    case STATES.COMPLETE:
      return <span style={{ color: 'var(--accent)', fontSize: '12px' }}>interview complete</span>
    case STATES.ERROR:
      return <span style={{ color: 'var(--danger)', fontSize: '12px' }}>[!] error</span>
    default:
      return <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>initializing<span style={{ animation: 'blink 1s step-end infinite' }}>_</span></span>
  }
}

export default function Interview() {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const audioInitRef = useRef(false)

  const {
    interviewState,
    currentQuestion,
    questionIndex,
    totalQuestions,
    transcript,
    aiTextStream,
    sessionComplete,
    errorMessage,
    connectionState,
    startListening,
    stopListening,
    endInterview,
    initAudioContext,
    isMuted,
    toggleMute,
    isRecording,
    audioLevel,
  } = useInterview(sessionId)

  // Initialize AudioContext on first render (needs prior user gesture from JDInput page)
  useEffect(() => {
    if (!audioInitRef.current) {
      audioInitRef.current = true
      try {
        initAudioContext()
      } catch (e) {
        // Will be initialized on first interaction if needed
      }
    }
  }, [initAudioContext])

  // Navigate to scorecard when complete
  useEffect(() => {
    if (sessionComplete && interviewState === STATES.COMPLETE) {
      const timer = setTimeout(() => {
        navigate(`/scorecard/${sessionId}`)
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [sessionComplete, interviewState, sessionId, navigate])

  const isListening = interviewState === STATES.LISTENING
  const isAiSpeaking = interviewState === STATES.AI_SPEAKING
  const isProcessing = interviewState === STATES.PROCESSING

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg)',
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Scanlines */}
      <div className="scanlines" />

      {/* Top bar */}
      <header style={{
        borderBottom: '1px solid var(--border)',
        padding: '12px 24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        position: 'relative',
        zIndex: 1,
      }}>
        <span style={{
          fontFamily: 'var(--font)',
          fontWeight: '700',
          fontSize: '13px',
          color: 'var(--text-primary)',
        }}>
          <span style={{ color: 'var(--accent)' }}>prep</span>ai
        </span>

        <ProgressBar
          current={questionIndex}
          total={totalQuestions || 8}
        />
      </header>

      {/* Main interview area */}
      <main style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 24px',
        gap: '40px',
        position: 'relative',
        zIndex: 1,
      }}>
        {/* Status label */}
        <StatusLabel interviewState={interviewState} connectionState={connectionState} />

        {/* AI Orb — the centerpiece */}
        <AIIndicator state={orbState(interviewState)} />

        {/* AI transcript — streams in character by character */}
        <div style={{ maxWidth: '600px', width: '100%', textAlign: 'center' }}>
          <LiveTranscript
            text={aiTextStream}
            isStreaming={isAiSpeaking}
          />
        </div>

        {/* Waveform — visible when user is recording */}
        {isListening && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '16px',
            animation: 'slide-up 0.2s ease',
          }}>
            <WaveformBar audioLevel={audioLevel} active={isRecording} />

            {/* User transcript preview */}
            {transcript && (
              <div style={{
                maxWidth: '500px',
                color: 'var(--text-muted)',
                fontSize: '13px',
                lineHeight: '1.6',
                textAlign: 'center',
              }}>
                <span style={{ color: 'var(--border-active)' }}>{'>'} </span>
                {transcript}
              </div>
            )}

            {/* Done speaking button */}
            <Button
              variant="ghost"
              onClick={stopListening}
              style={{
                fontSize: '13px',
                letterSpacing: '0.05em',
                border: '1px solid var(--accent)',
                color: 'var(--accent)',
                padding: '10px 24px',
              }}
            >
              [ done ]
            </Button>
          </div>
        )}

        {/* Processing state */}
        {isProcessing && (
          <div style={{
            color: 'var(--text-muted)',
            fontSize: '12px',
            letterSpacing: '0.08em',
            animation: 'slide-up 0.2s ease',
          }}>
            Processing
            <span style={{ animation: 'blink 1s step-end infinite' }}>_</span>
          </div>
        )}

        {/* User's last transcribed response (shown after processing) */}
        {!isListening && !isProcessing && transcript && (
          <div style={{
            maxWidth: '500px',
            color: 'var(--text-muted)',
            fontSize: '13px',
            lineHeight: '1.6',
            textAlign: 'center',
            borderTop: '1px solid var(--border)',
            paddingTop: '16px',
          }}>
            <span style={{ color: 'var(--border-active)' }}>{'>'} </span>
            {transcript}
          </div>
        )}

        {/* Start listening button — shown when AI finishes speaking */}
        {interviewState === STATES.IDLE && connectionState === 'connected' && (
          <Button
            variant="primary"
            onClick={startListening}
            style={{ fontSize: '13px', padding: '12px 24px' }}
          >
            Start Responding
          </Button>
        )}

        {/* Complete state */}
        {interviewState === STATES.COMPLETE && (
          <div style={{
            textAlign: 'center',
            animation: 'slide-up 0.3s ease',
          }}>
            <div style={{ color: 'var(--accent)', fontSize: '14px', marginBottom: '8px' }}>
              Interview Complete
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
              Generating your scorecard
              <span style={{ animation: 'blink 1s step-end infinite' }}>_</span>
            </div>
          </div>
        )}

        {/* Error state */}
        {interviewState === STATES.ERROR && (
          <div style={{
            border: '1px solid var(--danger)',
            padding: '16px 20px',
            maxWidth: '420px',
            animation: 'slide-up 0.2s ease',
          }}>
            <div style={{ color: 'var(--danger)', fontSize: '12px', marginBottom: '8px' }}>
              [!] {errorMessage || 'An error occurred'}
            </div>
            <Button
              variant="ghost"
              onClick={() => navigate('/dashboard')}
              style={{ fontSize: '12px' }}
            >
              ← Back to Dashboard
            </Button>
          </div>
        )}
      </main>

      {/* Bottom controls */}
      <footer style={{
        borderTop: '1px solid var(--border)',
        padding: '16px 24px',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        position: 'relative',
        zIndex: 1,
      }}>
        <Controls
          isMuted={isMuted}
          onToggleMute={toggleMute}
          onEndInterview={endInterview}
          disabled={interviewState === STATES.COMPLETE}
        />
      </footer>
    </div>
  )
}
