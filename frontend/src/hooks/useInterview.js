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

  // ── Stable refs for WS functions (avoids stale closures in useAudio) ──────
  const { connectionState, sendMessage, sendBinary, onBinary, lastMessage } = useWebSocket(sessionId)
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
    isMuted,
    toggleMute,
    isRecording,
    audioLevel,
  } = useAudio(sendBinaryRef, sendMessageRef)

  useEffect(() => { onBinary(() => { }) }, [onBinary])

  // ── Auto-start listening after AI finishes speaking ────────────────────────
  const doStartListening = useCallback(async () => {
    if (listeningRef.current) return
    if (!startedRef.current) return
    listeningRef.current = true
    // Reset playback cursor so next AI audio plays immediately (not at old offset)
    resetPlaybackCursor()
    try {
      await startRecording()
      setInterviewState(STATES.LISTENING)
      setTranscript('')
    } catch (err) {
      listeningRef.current = false
      setErrorMessage('Microphone error: ' + (err.message || 'unknown'))
      setInterviewState(STATES.ERROR)
    }
  }, [startRecording, resetPlaybackCursor])

  // ── WebSocket message handler ──────────────────────────────────────────────
  useEffect(() => {
    if (!lastMessage) return
    const msg = lastMessage

    switch (msg.type) {
      case 'state_update': {
        setQuestionIndex(msg.current_question_index)
        setTotalQuestions(msg.total_questions)
        if (startedRef.current) {
          if (msg.is_ai_speaking) setInterviewState(STATES.AI_SPEAKING)
        }
        break
      }

      case 'ai_text_chunk': {
        aiTextBufferRef.current += msg.text
        setAiTextStream(aiTextBufferRef.current)
        if (startedRef.current) setInterviewState(STATES.AI_SPEAKING)
        break
      }

      case 'audio_response_chunk': {
        if (msg.audio) playAudioChunk(msg.audio)
        break
      }

      case 'speaking_done': {
        // Backend has sent all audio chunks — give them ~1s to finish playing,
        // then auto-start listening
        setTimeout(() => {
          aiTextBufferRef.current = ''
          listeningRef.current = false
          doStartListening()
        }, 1000)
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
        // Log but don't crash — backend now always follows errors with speaking_done
        // which will trigger doStartListening(). Just surface the message.
        console.warn('WS error:', msg.message)
        setErrorMessage(msg.message)
        // Clear error message after 4s so it doesn't persist on screen
        setTimeout(() => setErrorMessage(''), 4000)
        break
      }

      default: break
    }
  }, [lastMessage, playAudioChunk, doStartListening])

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

  // ── stopListening: user clicks "done speaking" ────────────────────────────
  const stopListening = useCallback(async () => {
    listeningRef.current = false
    setInterviewState(STATES.PROCESSING)
    // stopRecording is now async — it waits for the final chunk before sending audio_end
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