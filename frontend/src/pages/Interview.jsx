import React, { useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import useInterview, { STATES } from '../hooks/useInterview'
import AIIndicator from '../components/interview/AIIndicator'
import LiveTranscript from '../components/interview/LiveTranscript'
import WaveformBar from '../components/interview/WaveformBar'
import ProgressBar from '../components/interview/ProgressBar'
import Controls from '../components/interview/Controls'
import Button from '../components/ui/Button'

function orbState(s) {
  if (s === STATES.AI_SPEAKING) return 'speaking'
  if (s === STATES.LISTENING) return 'listening'
  if (s === STATES.PROCESSING || s === STATES.READY) return 'processing'
  return 'idle'
}

function StatusLabel({ state, connectionState }) {
  if (connectionState === 'connecting' || connectionState === 'disconnected') {
    return <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>connecting<span style={{ animation: 'blink 1s step-end infinite' }}>_</span></span>
  }
  switch (state) {
    case STATES.IDLE: return <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>ready to begin</span>
    case STATES.READY: return <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>waiting for interviewer<span style={{ animation: 'blink 1s step-end infinite' }}>_</span></span>
    case STATES.AI_SPEAKING: return <span style={{ color: 'var(--accent)', fontSize: '12px' }}>● alex is speaking</span>
    case STATES.LISTENING: return <span style={{ color: 'var(--accent)', fontSize: '12px' }}>● listening — speak now</span>
    case STATES.PROCESSING: return <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>processing<span style={{ animation: 'blink 1s step-end infinite' }}>_</span></span>
    case STATES.COMPLETE: return <span style={{ color: 'var(--accent)', fontSize: '12px' }}>interview complete</span>
    case STATES.ERROR: return <span style={{ color: 'var(--danger)', fontSize: '12px' }}>[!] error</span>
    default: return null
  }
}

export default function Interview() {
  const { sessionId } = useParams()
  const navigate = useNavigate()

  const {
    interviewState,
    questionIndex,
    totalQuestions,
    transcript,
    aiTextStream,
    sessionComplete,
    errorMessage,
    connectionState,
    beginInterview,
    stopListening,
    endInterview,
    isMuted,
    toggleMute,
    isRecording,
    audioLevel,
  } = useInterview(sessionId)

  // Navigate to scorecard after completion
  useEffect(() => {
    if (sessionComplete && interviewState === STATES.COMPLETE) {
      const t = setTimeout(() => navigate(`/scorecard/${sessionId}`), 2500)
      return () => clearTimeout(t)
    }
  }, [sessionComplete, interviewState, sessionId, navigate])

  const isListening = interviewState === STATES.LISTENING
  const isAiSpeaking = interviewState === STATES.AI_SPEAKING
  const isIdle = interviewState === STATES.IDLE
  const isError = interviewState === STATES.ERROR
  const isComplete = interviewState === STATES.COMPLETE

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--bg)',
      display: 'flex', flexDirection: 'column',
      position: 'relative', overflow: 'hidden',
    }}>
      <div className="scanlines" />

      {/* Top bar */}
      <header style={{
        borderBottom: '1px solid var(--border)',
        padding: '12px 24px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        position: 'relative', zIndex: 1,
      }}>
        <span style={{ fontFamily: 'var(--font)', fontWeight: '700', fontSize: '13px' }}>
          <span style={{ color: 'var(--accent)' }}>prep</span>ai
        </span>
        <ProgressBar current={questionIndex} total={totalQuestions || 8} />
      </header>

      {/* Main */}
      <main style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '40px 24px', gap: '36px',
        position: 'relative', zIndex: 1,
      }}>
        <StatusLabel state={interviewState} connectionState={connectionState} />

        {/* Orb */}
        <AIIndicator state={orbState(interviewState)} />

        {/* AI text stream */}
        <div style={{ maxWidth: '600px', width: '100%', textAlign: 'center', minHeight: '80px' }}>
          <LiveTranscript text={aiTextStream} isStreaming={isAiSpeaking} />
        </div>

        {/* ── IDLE: Begin gate ── */}
        {isIdle && connectionState === 'connected' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', animation: 'slide-up 0.3s ease' }}>
            <Button
              variant="primary"
              onClick={beginInterview}
              style={{ fontSize: '14px', padding: '14px 32px', fontWeight: '700' }}
            >
              Begin Interview
            </Button>
            <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
              Microphone access will be requested
            </span>
          </div>
        )}

        {/* ── IDLE: waiting for WS ── */}
        {isIdle && connectionState !== 'connected' && (
          <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
            connecting to session<span style={{ animation: 'blink 1s step-end infinite' }}>_</span>
          </span>
        )}

        {/* ── LISTENING: waveform + done button ── */}
        {isListening && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px',
            animation: 'slide-up 0.2s ease',
          }}>
            <WaveformBar audioLevel={audioLevel} active={isRecording} />

            {transcript && (
              <div style={{ maxWidth: '500px', color: 'var(--text-muted)', fontSize: '13px', lineHeight: '1.6', textAlign: 'center' }}>
                <span style={{ color: 'var(--border-active)' }}>{'> '}</span>{transcript}
              </div>
            )}

            <Button
              variant="ghost"
              onClick={stopListening}
              style={{ fontSize: '13px', border: '1px solid var(--accent)', color: 'var(--accent)', padding: '10px 28px' }}
            >
              [ done speaking ]
            </Button>
          </div>
        )}

        {/* ── After AI speaks, show last transcript if not currently listening ── */}
        {!isListening && !isAiSpeaking && transcript && interviewState !== STATES.IDLE && interviewState !== STATES.READY && (
          <div style={{
            maxWidth: '500px', color: 'var(--text-muted)', fontSize: '13px',
            lineHeight: '1.6', textAlign: 'center',
            borderTop: '1px solid var(--border)', paddingTop: '12px',
          }}>
            <span style={{ color: 'var(--border-active)' }}>{'> '}</span>{transcript}
          </div>
        )}

        {/* ── COMPLETE ── */}
        {isComplete && (
          <div style={{ textAlign: 'center', animation: 'slide-up 0.3s ease' }}>
            <div style={{ color: 'var(--accent)', fontSize: '14px', marginBottom: '8px' }}>Interview Complete</div>
            <div style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
              Generating your scorecard<span style={{ animation: 'blink 1s step-end infinite' }}>_</span>
            </div>
          </div>
        )}

        {/* ── ERROR ── */}
        {isError && (
          <div style={{
            border: '1px solid var(--danger)', padding: '16px 20px',
            maxWidth: '480px', animation: 'slide-up 0.2s ease',
          }}>
            <div style={{ color: 'var(--danger)', fontSize: '12px', marginBottom: '12px' }}>
              [!] {errorMessage || 'An error occurred'}
            </div>
            <Button variant="ghost" onClick={() => navigate('/dashboard')} style={{ fontSize: '12px' }}>
              ← Back to Dashboard
            </Button>
          </div>
        )}
      </main>

      {/* Footer controls */}
      <footer style={{
        borderTop: '1px solid var(--border)', padding: '16px 24px',
        display: 'flex', justifyContent: 'center',
        position: 'relative', zIndex: 1,
      }}>
        <Controls
          isMuted={isMuted}
          onToggleMute={toggleMute}
          onEndInterview={endInterview}
          disabled={isComplete || isIdle}
        />
      </footer>
    </div>
  )
}