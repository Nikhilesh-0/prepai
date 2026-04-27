import { useRef, useState, useCallback } from 'react'

const SAMPLE_RATE = 44100
const CHANNELS = 1

export default function useAudio(sendBinary, sendMessage) {
  const audioContextRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const analyserRef = useRef(null)
  const micStreamRef = useRef(null)
  const playbackCursorRef = useRef(0)
  const animFrameRef = useRef(null)
  const suppressSendRef = useRef(false) // when true, don't send chunks to WS

  const [isRecording, setIsRecording] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [audioLevel, setAudioLevel] = useState(0)

  // ── AudioContext init (must be called inside a user gesture) ───────────────
  const initAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: SAMPLE_RATE,
      })
    } else if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume()
    }
    playbackCursorRef.current = audioContextRef.current.currentTime
    return audioContextRef.current
  }, [])

  // ── Level meter ────────────────────────────────────────────────────────────
  const startLevelMeter = useCallback((analyser) => {
    const bufferLength = analyser.fftSize
    const dataArray = new Uint8Array(bufferLength)
    const tick = () => {
      analyser.getByteTimeDomainData(dataArray)
      let sum = 0
      for (let i = 0; i < bufferLength; i++) {
        const v = (dataArray[i] - 128) / 128
        sum += v * v
      }
      setAudioLevel(Math.min(Math.sqrt(sum / bufferLength) * 4, 1))
      animFrameRef.current = requestAnimationFrame(tick)
    }
    animFrameRef.current = requestAnimationFrame(tick)
  }, [])

  const stopLevelMeter = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = null
    }
    setAudioLevel(0)
  }, [])

  // ── requestMicPermission: just opens the mic, immediately closes it ────────
  // Used as a user-gesture to pre-grant mic access without sending audio
  const requestMicPermission = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    // Immediately stop all tracks — we just wanted the permission grant
    stream.getTracks().forEach(t => t.stop())
  }, [])

  // ── startRecording ─────────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    // Stop any existing recording first
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(t => t.stop())
      micStreamRef.current = null
    }

    const ctx = audioContextRef.current
    if (!ctx) throw new Error('AudioContext not initialized. Call initAudioContext first.')

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    micStreamRef.current = stream

    // Level meter
    const source = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    source.connect(analyser)
    analyserRef.current = analyser
    startLevelMeter(analyser)

    // MediaRecorder
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : 'audio/ogg;codecs=opus'

    const recorder = new MediaRecorder(stream, { mimeType })
    mediaRecorderRef.current = recorder

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0 && !isMuted && !suppressSendRef.current) {
        event.data.arrayBuffer().then((buffer) => {
          sendBinary(buffer)
        })
      }
    }

    recorder.start(250)
    setIsRecording(true)
  }, [sendBinary, isMuted, startLevelMeter])

  // ── stopRecording ──────────────────────────────────────────────────────────
  const stopRecording = useCallback((suppress = false) => {
    if (suppress) suppressSendRef.current = true

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(t => t.stop())
      micStreamRef.current = null
    }

    stopLevelMeter()
    setIsRecording(false)

    if (!suppress) {
      sendMessage({ type: 'audio_end' })
    }

    // Reset suppress flag after a tick
    if (suppress) {
      setTimeout(() => { suppressSendRef.current = false }, 100)
    }
  }, [sendMessage, stopLevelMeter])

  // ── playAudioChunk: decode base64 PCM f32le, schedule gapless ─────────────
  const playAudioChunk = useCallback((base64Audio) => {
    const ctx = audioContextRef.current
    if (!ctx) return

    try {
      if (ctx.state === 'suspended') ctx.resume()

      const binary = atob(base64Audio)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

      const float32 = new Float32Array(bytes.buffer)
      if (float32.length === 0) return

      const buffer = ctx.createBuffer(CHANNELS, float32.length, SAMPLE_RATE)
      buffer.getChannelData(0).set(float32)

      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.connect(ctx.destination)

      const now = ctx.currentTime
      const startAt = Math.max(playbackCursorRef.current, now)
      source.start(startAt)
      playbackCursorRef.current = startAt + buffer.duration
    } catch (err) {
      console.error('Audio playback error:', err)
    }
  }, [])

  const resetPlaybackCursor = useCallback(() => {
    if (audioContextRef.current) {
      playbackCursorRef.current = audioContextRef.current.currentTime
    }
  }, [])

  const toggleMute = useCallback(() => setIsMuted(p => !p), [])

  return {
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
  }
}