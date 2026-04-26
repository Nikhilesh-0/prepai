import { useEffect, useState, useCallback, useRef } from 'react'
import useWebSocket from './useWebSocket'
import useAudio from './useAudio'

// Interview states
export const STATES = {
  IDLE: 'idle',
  AI_SPEAKING: 'ai_speaking',
  LISTENING: 'listening',
  PROCESSING: 'processing',
  COMPLETE: 'complete',
  ERROR: 'error',
}

export default function useInterview(sessionId) {
  const [interviewState, setInterviewState] = useState(STATES.IDLE)
  const [currentQuestion, setCurrentQuestion] = useState('')
  const [questionIndex, setQuestionIndex] = useState(0)
  const [totalQuestions, setTotalQuestions] = useState(0)
  const [transcript, setTranscript] = useState('')
  const [aiTextStream, setAiTextStream] = useState('')
  const [sessionComplete, setSessionComplete] = useState(false)
  const [sessionData, setSessionData] = useState(null)
  const [errorMessage, setErrorMessage] = useState('')

  const aiTextBufferRef = useRef('')
  const pendingAudioChunksRef = useRef([])
  const audioFinishedRef = useRef(false)

  const { wsRef, connectionState, sendMessage, sendBinary, onBinary, lastMessage } = useWebSocket(sessionId)

  const { initAudioContext, startRecording, stopRecording, playAudioChunk, resetPlaybackCursor, isMuted, toggleMute, isRecording, audioLevel } = useAudio(sendBinary, sendMessage)

  // Register binary handler for any raw audio from server (unused currently, but available)
  useEffect(() => {
    onBinary((buffer) => {
      // Server sends audio as base64 JSON, not raw binary — but keep handler registered
    })
  }, [onBinary])

  // Handle incoming WebSocket messages
  useEffect(() => {
    if (!lastMessage) return

    const msg = lastMessage

    switch (msg.type) {
      case 'state_update': {
        setQuestionIndex(msg.current_question_index)
        setTotalQuestions(msg.total_questions)
        setSessionData(msg)

        if (msg.is_ai_speaking) {
          setInterviewState(STATES.AI_SPEAKING)
        } else if (msg.is_listening) {
          setInterviewState(STATES.LISTENING)
        }

        // Set current question text from question plan
        if (msg.question_plan && msg.current_question_index < msg.question_plan.length) {
          setCurrentQuestion(msg.question_plan[msg.current_question_index]?.question || '')
        }
        break
      }

      case 'ai_text_chunk': {
        aiTextBufferRef.current += msg.text
        setAiTextStream(aiTextBufferRef.current)
        setInterviewState(STATES.AI_SPEAKING)
        break
      }

      case 'audio_response_chunk': {
        // Decode and play audio
        if (msg.audio) {
          playAudioChunk(msg.audio)
        }
        break
      }

      case 'speaking_done': {
        // AI finished speaking — reset text buffer for next turn
        audioFinishedRef.current = true
        // Small delay to let last audio chunk finish playing
        setTimeout(() => {
          aiTextBufferRef.current = ''
          // Don't clear aiTextStream here — keep it visible until user speaks
        }, 500)
        break
      }

      case 'transcript': {
        setTranscript(msg.text)
        setInterviewState(STATES.PROCESSING)
        // Clear previous AI text for next turn
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
        setErrorMessage(msg.message)
        setInterviewState(STATES.ERROR)
        break
      }

      default:
        break
    }
  }, [lastMessage, playAudioChunk])

  const startListening = useCallback(async () => {
    try {
      resetPlaybackCursor()
      await startRecording()
      setInterviewState(STATES.LISTENING)
      setTranscript('')
    } catch (err) {
      setErrorMessage('Microphone access denied. Please allow microphone access.')
      setInterviewState(STATES.ERROR)
    }
  }, [startRecording, resetPlaybackCursor])

  const stopListening = useCallback(() => {
    stopRecording()
    setInterviewState(STATES.PROCESSING)
  }, [stopRecording])

  const endInterview = useCallback(() => {
    sendMessage({ type: 'end_interview' })
    setSessionComplete(true)
    setInterviewState(STATES.COMPLETE)
  }, [sendMessage])

  return {
    interviewState,
    currentQuestion,
    questionIndex,
    totalQuestions,
    transcript,
    aiTextStream,
    sessionComplete,
    sessionData,
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
  }
}
