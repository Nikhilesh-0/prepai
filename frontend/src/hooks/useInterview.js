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
  const startedRef = useRef(false)    // user clicked Begin
  const listeningRef = useRef(false)  // currently recording

  const { connectionState, sendMessage, sendBinary, onBinary, lastMessage } = useWebSocket(sessionId)

  const {
    initAudioContext,
    requestMicPermission,
    startRecording,
    stopRecording,
    playAudioChunk,
    isMuted,
    toggleMute,
    isRecording,
    audioLevel,
  } = useAudio(sendBinary, sendMessage)

  useEffect(() => { onBinary(() => { }) }, [onBinary])

  // ── Start recording (auto-called after AI speaks) ──────────────────────────
  const doStartListening = useCallback(async () => {
    if (listeningRef.current) return
    if (!startedRef.current) return  // don't auto-listen before user clicks Begin
    listeningRef.current = true
    try {
      await startRecording()
      setInterviewState(STATES.LISTENING)
      setTranscript('')
    } catch (err) {
      listeningRef.current = false
      setErrorMessage('Microphone error: ' + (err.message || 'unknown'))
      setInterviewState(STATES.ERROR)
    }
  }, [startRecording])

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
          else if (msg.is_listening && !listeningRef.current) doStartListening()
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
        // Wait a beat for last audio chunk to finish playing, then auto-listen
        setTimeout(() => {
          aiTextBufferRef.current = ''
          listeningRef.current = false
          doStartListening()
        }, 800)
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
        // Non-fatal errors: keep going (empty audio, transcription failed)
        const fatal = false
        setErrorMessage(msg.message)
        if (fatal) {
          setInterviewState(STATES.ERROR)
        }
        // Re-enable listening after recoverable errors
        if (startedRef.current && !listeningRef.current) {
          setTimeout(() => doStartListening(), 1000)
        }
        break
      }

      default: break
    }
  }, [lastMessage, playAudioChunk, doStartListening])

  // ── beginInterview: the user-gesture gate ─────────────────────────────────
  const beginInterview = useCallback(async () => {
    try {
      initAudioContext()
      await requestMicPermission()
      startedRef.current = true
      setInterviewState(STATES.READY)
      // Tell backend we're ready — it fires the first AI turn
      sendMessage({ type: 'client_ready' })
    } catch (err) {
      const denied = err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError'
      setErrorMessage(
        denied
          ? 'Microphone access denied. Allow microphone in your browser settings, then reload the page.'
          : 'Could not start: ' + err.message
      )
      setInterviewState(STATES.ERROR)
    }
  }, [initAudioContext, requestMicPermission, sendMessage])

  // ── stopListening: user clicks "done speaking" ────────────────────────────
  const stopListening = useCallback(() => {
    listeningRef.current = false
    stopRecording()           // sends audio_end to backend
    setInterviewState(STATES.PROCESSING)
  }, [stopRecording])

  // ── endInterview: user force-ends ─────────────────────────────────────────
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