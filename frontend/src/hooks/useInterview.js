import { useEffect, useState, useCallback, useRef } from 'react'
import useWebSocket from './useWebSocket'
import useAudio from './useAudio'

export const STATES = {
  IDLE: 'idle',
  READY: 'ready',
  AI_SPEAKING: 'ai_speaking',
  LISTENING: 'listening',
  PROCESSING: 'processing',
  COMPLETE: 'complete',
  ERROR: 'error',
}

export default function useInterview(sessionId) {
  const [interviewState, setInterviewState] = useState(STATES.IDLE)
  const [questionIndex, setQuestionIndex] = useState(0)
  const [totalQuestions, setTotalQuestions] = useState(0)
  const [transcript, setTranscript] = useState('')
  const [aiTextStream, setAiTextStream] = useState('')
  const [sessionComplete, setSessionComplete] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const aiTextBufferRef = useRef('')
  const startedRef = useRef(false)
  const listeningRef = useRef(false)
  const speakingDoneTimerRef = useRef(null)

  const { connectionState, sendMessage, sendBinary, onBinary, onMessage } = useWebSocket(sessionId)
  const sendMessageRef = useRef(sendMessage)
  const sendBinaryRef = useRef(sendBinary)
  useEffect(() => { sendMessageRef.current = sendMessage }, [sendMessage])
  useEffect(() => { sendBinaryRef.current = sendBinary }, [sendBinary])

  const {
    initAudioContext,
    requestMicPermission,
    startRecording,
    stopRecording,
    playAudioChunk,
    resetPlaybackCursor,
    getRemainingPlaybackMs,
    isMuted,
    toggleMute,
    isRecording,
    audioLevel,
  } = useAudio(sendBinaryRef, sendMessageRef)

  // Keep refs so callbacks inside the message handler never close over stale values
  const startRecordingRef = useRef(startRecording)
  const resetPlaybackCursorRef = useRef(resetPlaybackCursor)
  const playAudioChunkRef = useRef(playAudioChunk)
  const getRemainingPlaybackMsRef = useRef(getRemainingPlaybackMs)
  useEffect(() => { startRecordingRef.current = startRecording }, [startRecording])
  useEffect(() => { resetPlaybackCursorRef.current = resetPlaybackCursor }, [resetPlaybackCursor])
  useEffect(() => { playAudioChunkRef.current = playAudioChunk }, [playAudioChunk])
  useEffect(() => { getRemainingPlaybackMsRef.current = getRemainingPlaybackMs }, [getRemainingPlaybackMs])

  useEffect(() => { onBinary(() => { }) }, [onBinary])

  // ── triggerListening: called from setTimeout, uses refs not closures ───────
  const triggerListening = useCallback(() => {
    if (listeningRef.current) return
    if (!startedRef.current) return
    listeningRef.current = true
    resetPlaybackCursorRef.current()
    startRecordingRef.current()
      .then(() => {
        setInterviewState(STATES.LISTENING)
        setTranscript('')
      })
      .catch((err) => {
        listeningRef.current = false
        setErrorMessage('Microphone error: ' + (err.message || 'unknown'))
        setInterviewState(STATES.ERROR)
      })
  }, []) // no dependencies — reads everything via refs

  // ── WebSocket message handler (direct callback — no React batching) ────────
  useEffect(() => {
    onMessage((msg) => {
      switch (msg.type) {
        case 'state_update': {
          setQuestionIndex(msg.current_question_index)
          setTotalQuestions(msg.total_questions)
          break
        }

        case 'ai_text_chunk': {
          aiTextBufferRef.current += msg.text
          setAiTextStream(aiTextBufferRef.current)
          if (startedRef.current) setInterviewState(STATES.AI_SPEAKING)
          break
        }

        case 'audio_response_chunk': {
          if (msg.audio) playAudioChunkRef.current(msg.audio)
          break
        }

        case 'speaking_done': {
          // Clear any pending timer
          if (speakingDoneTimerRef.current) clearTimeout(speakingDoneTimerRef.current)

          // Calculate actual remaining playback time instead of guessing
          const remainingMs = getRemainingPlaybackMsRef.current()
          // Add 800ms buffer after audio finishes, minimum 1200ms total
          const delay = Math.max(remainingMs + 800, 1200)

          speakingDoneTimerRef.current = setTimeout(() => {
            listeningRef.current = false
            triggerListening()
          }, delay)
          break
        }

        case 'transcript': {
          listeningRef.current = false
          setTranscript(msg.text)
          setInterviewState(STATES.PROCESSING)
          setAiTextStream('')
          aiTextBufferRef.current = ''
          break
        }

        case 'processing_start': {
          setInterviewState(STATES.PROCESSING)
          break
        }

        case 'interview_complete': {
          setSessionComplete(true)
          setInterviewState(STATES.COMPLETE)
          break
        }

        case 'error': {
          console.warn('WS error:', msg.message)
          // If the session was lost (server restart), mark it so the UI can redirect
          if (msg.message && msg.message.toLowerCase().includes('session not found')) {
            setErrorMessage('Session expired. Redirecting to dashboard...')
            setInterviewState(STATES.ERROR)
            setSessionComplete(true)  // triggers redirect
          } else {
            setErrorMessage(msg.message)
            setTimeout(() => setErrorMessage(''), 4000)
          }
          break
        }

        default: break
      }
    })
  }, [onMessage, triggerListening])

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (speakingDoneTimerRef.current) clearTimeout(speakingDoneTimerRef.current)
    }
  }, [])

  // ── beginInterview ─────────────────────────────────────────────────────────
  const beginInterview = useCallback(async () => {
    try {
      initAudioContext()
      await requestMicPermission()
      startedRef.current = true
      setInterviewState(STATES.READY)
      sendMessage({ type: 'client_ready' })
    } catch (err) {
      const denied = err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError'
      setErrorMessage(
        denied
          ? 'Microphone access denied. Allow microphone in your browser settings, then reload.'
          : 'Could not start: ' + err.message
      )
      setInterviewState(STATES.ERROR)
    }
  }, [initAudioContext, requestMicPermission, sendMessage])

  // ── stopListening ─────────────────────────────────────────────────────────
  const stopListening = useCallback(async () => {
    listeningRef.current = false
    setInterviewState(STATES.PROCESSING)
    await stopRecording()
  }, [stopRecording])

  // ── endInterview ──────────────────────────────────────────────────────────
  const endInterview = useCallback(() => {
    sendMessage({ type: 'end_interview' })
    setSessionComplete(true)
    setInterviewState(STATES.COMPLETE)
  }, [sendMessage])

  return {
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
  }
}