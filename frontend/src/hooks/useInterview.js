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

// Extra silence to add AFTER the Web Audio scheduler finishes.
// This covers the Bluetooth hardware output buffer (100–300ms typical)
// plus a small margin so the user doesn't hear a hard cut-off.
const BT_HARDWARE_BUFFER_MS = 600

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
  const pollRef = useRef(null)          // rAF handle for playback polling

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

  const startRecordingRef = useRef(startRecording)
  const resetPlaybackCursorRef = useRef(resetPlaybackCursor)
  const playAudioChunkRef = useRef(playAudioChunk)
  const getRemainingPlaybackMsRef = useRef(getRemainingPlaybackMs)
  useEffect(() => { startRecordingRef.current = startRecording }, [startRecording])
  useEffect(() => { resetPlaybackCursorRef.current = resetPlaybackCursor }, [resetPlaybackCursor])
  useEffect(() => { playAudioChunkRef.current = playAudioChunk }, [playAudioChunk])
  useEffect(() => { getRemainingPlaybackMsRef.current = getRemainingPlaybackMs }, [getRemainingPlaybackMs])

  useEffect(() => { onBinary(() => { }) }, [onBinary])

  // ── cancelPoll: stop any in-flight playback poll ──────────────────────────
  const cancelPoll = useCallback(() => {
    if (pollRef.current) {
      cancelAnimationFrame(pollRef.current)
      pollRef.current = null
    }
  }, [])

  // ── triggerListening ──────────────────────────────────────────────────────
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
  }, [])

  // ── waitForPlaybackThenListen ─────────────────────────────────────────────
  //
  // The original code called getRemainingPlaybackMs() once at speaking_done
  // and used that as a fixed setTimeout delay. This was wrong: speaking_done
  // arrives from the server as soon as the last TTS chunk is *sent*, but
  // audio chunks are still arriving and being scheduled on the client. So
  // remainingMs at that moment is far smaller than the actual playback time.
  //
  // Fix: poll getRemainingPlaybackMs() on every animation frame until it hits
  // zero (meaning the Web Audio scheduler has finished). Only THEN start the
  // BT_HARDWARE_BUFFER_MS countdown. This guarantees we never open the mic
  // while audio is still scheduled, regardless of network jitter or chunk
  // arrival timing.
  const waitForPlaybackThenListen = useCallback(() => {
    cancelPoll()

    const poll = () => {
      const remaining = getRemainingPlaybackMsRef.current()

      if (remaining > 0) {
        // Still playing — keep polling
        pollRef.current = requestAnimationFrame(poll)
        return
      }

      // Web Audio scheduler is empty. Now wait for the BT hardware buffer
      // to actually push those last samples to the headphone driver.
      pollRef.current = null
      setTimeout(() => {
        listeningRef.current = false
        triggerListening()
      }, BT_HARDWARE_BUFFER_MS)
    }

    pollRef.current = requestAnimationFrame(poll)
  }, [cancelPoll, triggerListening])

  // ── WebSocket message handler ─────────────────────────────────────────────
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
          // Cancel any previous poll (e.g. rapid question transitions)
          cancelPoll()
          // Start polling — don't guess with a fixed delay
          waitForPlaybackThenListen()
          break
        }

        case 'transcript': {
          listeningRef.current = false
          cancelPoll()
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
          if (msg.message && msg.message.toLowerCase().includes('session not found')) {
            setErrorMessage('Session expired. Please start a new interview.')
            setInterviewState(STATES.ERROR)
          } else {
            setErrorMessage(msg.message)
            setTimeout(() => setErrorMessage(''), 4000)
          }
          break
        }

        default: break
      }
    })
  }, [onMessage, triggerListening, waitForPlaybackThenListen, cancelPoll])

  // Cleanup on unmount
  useEffect(() => {
    return () => cancelPoll()
  }, [cancelPoll])

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

  // ── stopListening ──────────────────────────────────────────────────────────
  const stopListening = useCallback(async () => {
    listeningRef.current = false
    setInterviewState(STATES.PROCESSING)
    await stopRecording()
  }, [stopRecording])

  // ── endInterview ───────────────────────────────────────────────────────────
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