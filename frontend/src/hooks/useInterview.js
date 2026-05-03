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

// Added on top of the Web Audio scheduler finishing.
// Covers the BT hardware output buffer so the headset finishes
// playing before getUserMedia() triggers HFP profile switch.
const BT_HARDWARE_BUFFER_MS = 500

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
  const pollRef = useRef(null)
  const speakingDoneAtRef = useRef(null)   // timestamp when speaking_done arrived

  const { connectionState, sendMessage, sendBinary, onMessage } = useWebSocket(sessionId)
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
    isPlaybackTrulyDone,
    isMuted,
    toggleMute,
    isRecording,
    audioLevel,
  } = useAudio(sendBinaryRef, sendMessageRef)

  const startRecordingRef = useRef(startRecording)
  const resetPlaybackCursorRef = useRef(resetPlaybackCursor)
  const playAudioChunkRef = useRef(playAudioChunk)
  const getRemainingPlaybackMsRef = useRef(getRemainingPlaybackMs)
  const isPlaybackTrulyDoneRef = useRef(isPlaybackTrulyDone)
  useEffect(() => { startRecordingRef.current = startRecording }, [startRecording])
  useEffect(() => { resetPlaybackCursorRef.current = resetPlaybackCursor }, [resetPlaybackCursor])
  useEffect(() => { playAudioChunkRef.current = playAudioChunk }, [playAudioChunk])
  useEffect(() => { getRemainingPlaybackMsRef.current = getRemainingPlaybackMs }, [getRemainingPlaybackMs])
  useEffect(() => { isPlaybackTrulyDoneRef.current = isPlaybackTrulyDone }, [isPlaybackTrulyDone])

  const cancelPoll = useCallback(() => {
    if (pollRef.current) {
      cancelAnimationFrame(pollRef.current)
      pollRef.current = null
    }
  }, [])

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

  // ── waitForPlaybackThenListen ──────────────────────────────────────────────
  //
  // WHY this exists:
  //   speaking_done is a tiny JSON message. It arrives from the server before
  //   many audio_response_chunk messages do, because those chunks are large
  //   and WebSocket delivery order isn't size-aware. So at speaking_done time,
  //   getRemainingPlaybackMs() often returns 0 — not because audio is done,
  //   but because no audio has arrived yet to schedule.
  //
  // TWO-PHASE POLL:
  //
  //   Phase 1 — wait for audio to START arriving
  //     Poll getRemainingPlaybackMs() each frame. While it stays at 0 and
  //     isPlaybackTrulyDone() is false, audio hasn't arrived yet — keep waiting.
  //     If getRemainingPlaybackMs() goes > 0, audio is now playing → Phase 2.
  //     If isPlaybackTrulyDone() becomes true, a chunk arrived and already
  //     finished (fast network / very short response) → skip to BT wait.
  //     Fallback: if 5s pass with nothing, open mic anyway (don't hang forever).
  //
  //   Phase 2 — wait for audio to FINISH
  //     Poll until getRemainingPlaybackMs() returns 0 again.
  //     Then wait BT_HARDWARE_BUFFER_MS for the headset hardware buffer to drain.
  //     Then open the mic.
  //
  const waitForPlaybackThenListen = useCallback(() => {
    cancelPoll()
    speakingDoneAtRef.current = performance.now()
    const PHASE1_TIMEOUT_MS = 5000

    const poll = () => {
      const remaining = getRemainingPlaybackMsRef.current()
      const elapsed = performance.now() - speakingDoneAtRef.current

      // ── Phase 1: waiting for audio to start ──────────────────────────────
      if (remaining === 0 && !isPlaybackTrulyDoneRef.current()) {
        // Nothing scheduled yet. Did time out?
        if (elapsed > PHASE1_TIMEOUT_MS) {
          // Server may have sent no audio (TTS error). Open mic anyway.
          pollRef.current = null
          listeningRef.current = false
          triggerListening()
          return
        }
        // Keep waiting for first chunk to arrive
        pollRef.current = requestAnimationFrame(poll)
        return
      }

      // ── Phase 2: audio has started (or was instant) ───────────────────────
      if (remaining > 0) {
        // Still playing — keep waiting
        pollRef.current = requestAnimationFrame(poll)
        return
      }

      // remaining === 0 AND isPlaybackTrulyDone() === true → scheduler empty
      pollRef.current = null
      setTimeout(() => {
        listeningRef.current = false
        triggerListening()
      }, BT_HARDWARE_BUFFER_MS)
    }

    pollRef.current = requestAnimationFrame(poll)
  }, [cancelPoll, triggerListening])

  const waitForPlaybackRef = useRef(waitForPlaybackThenListen)
  useEffect(() => { waitForPlaybackRef.current = waitForPlaybackThenListen }, [waitForPlaybackThenListen])

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
          cancelPoll()
          waitForPlaybackRef.current()
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
  }, [onMessage, cancelPoll])

  useEffect(() => () => cancelPoll(), [cancelPoll])

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

  const stopListening = useCallback(async () => {
    listeningRef.current = false
    setInterviewState(STATES.PROCESSING)
    await stopRecording()
  }, [stopRecording])

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