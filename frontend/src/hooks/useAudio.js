import { useRef, useState, useCallback } from 'react'

const SAMPLE_RATE = 44100
const CHANNELS = 1

export default function useAudio(sendBinaryRef, sendMessageRef) {
  const audioContextRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const micStreamRef = useRef(null)
  const playbackCursorRef = useRef(0)
  const animFrameRef = useRef(null)
  const isRecordingRef = useRef(false)  // ref version to avoid stale closures

  const [isRecording, setIsRecording] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [audioLevel, setAudioLevel] = useState(0)

  const isMutedRef = useRef(false)
  const setIsMutedWrapped = useCallback((val) => {
    const next = typeof val === 'function' ? val(isMutedRef.current) : val
    isMutedRef.current = next
    setIsMuted(next)
  }, [])

  // ── AudioContext ───────────────────────────────────────────────────────────
  const initAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: SAMPLE_RATE,
      })
    } else if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume()
    }
    // Reset playback cursor to now so audio plays immediately
    playbackCursorRef.current = audioContextRef.current.currentTime
    return audioContextRef.current
  }, [])

  // ── Level meter ────────────────────────────────────────────────────────────
  const startLevelMeter = useCallback((analyser) => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    const dataArray = new Uint8Array(analyser.fftSize)
    const tick = () => {
      analyser.getByteTimeDomainData(dataArray)
      let sum = 0
      for (let i = 0; i < dataArray.length; i++) {
        const v = (dataArray[i] - 128) / 128
        sum += v * v
      }
      setAudioLevel(Math.min(Math.sqrt(sum / dataArray.length) * 5, 1))
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

  // ── Mic permission pre-grant ───────────────────────────────────────────────
  const requestMicPermission = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    stream.getTracks().forEach(t => t.stop())
  }, [])

  // ── stopCurrentRecorder: cleanly tears down existing recorder ─────────────
  // Returns a Promise that resolves once the final ondataavailable has fired
  const stopCurrentRecorder = useCallback(() => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current
      if (!recorder || recorder.state === 'inactive') {
        resolve()
        return
      }
      // Once onstop fires, all ondataavailable events have finished
      recorder.onstop = () => resolve()
      recorder.stop()
      mediaRecorderRef.current = null
    })
  }, [])

  // ── startRecording ─────────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    const ctx = audioContextRef.current
    if (!ctx) throw new Error('AudioContext not initialized')
    if (ctx.state === 'suspended') await ctx.resume()

    // Fully stop previous recorder and wait for its final chunk
    await stopCurrentRecorder()

    // Stop old mic stream
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(t => t.stop())
      micStreamRef.current = null
    }

    // Open mic
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    micStreamRef.current = stream

    // Level meter
    const source = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    source.connect(analyser)
    startLevelMeter(analyser)

    // MediaRecorder — use refs for sendBinary/isMuted to avoid stale closure
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : 'audio/ogg;codecs=opus'

    const recorder = new MediaRecorder(stream, { mimeType })
    mediaRecorderRef.current = recorder

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0 && !isMutedRef.current) {
        event.data.arrayBuffer().then((buffer) => {
          // Use the ref to always get the current sendBinary function
          sendBinaryRef.current?.(buffer)
        })
      }
    }

    recorder.start(250)
    isRecordingRef.current = true
    setIsRecording(true)
  }, [stopCurrentRecorder, startLevelMeter, sendBinaryRef])

  // ── stopRecording ──────────────────────────────────────────────────────────
  const stopRecording = useCallback(async () => {
    isRecordingRef.current = false
    stopLevelMeter()

    // Stop mic tracks immediately so user sees feedback
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(t => t.stop())
      micStreamRef.current = null
    }

    // Stop recorder and wait for final chunk to flush
    await stopCurrentRecorder()

    setIsRecording(false)

    // Now it's safe to signal end-of-audio — all binary chunks have been sent
    sendMessageRef.current?.({ type: 'audio_end' })
  }, [stopCurrentRecorder, stopLevelMeter, sendMessageRef])

  // ── playAudioChunk ─────────────────────────────────────────────────────────
  const playAudioChunk = useCallback((base64Audio) => {
    const ctx = audioContextRef.current
    if (!ctx) return
    if (ctx.state === 'suspended') ctx.resume()

    try {
      const binary = atob(base64Audio)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

      const float32 = new Float32Array(bytes.buffer)
      if (float32.length === 0) return

      const audioBuffer = ctx.createBuffer(CHANNELS, float32.length, SAMPLE_RATE)
      audioBuffer.getChannelData(0).set(float32)

      const source = ctx.createBufferSource()
      source.buffer = audioBuffer
      source.connect(ctx.destination)

      const now = ctx.currentTime
      // If cursor has drifted too far in the past (e.g. after a pause), reset to now
      if (playbackCursorRef.current < now - 0.1) {
        playbackCursorRef.current = now
      }
      const startAt = Math.max(playbackCursorRef.current, now)
      source.start(startAt)
      playbackCursorRef.current = startAt + audioBuffer.duration
    } catch (err) {
      console.error('Audio playback error:', err)
    }
  }, [])

  // Reset cursor to now — call before each AI turn
  const resetPlaybackCursor = useCallback(() => {
    if (audioContextRef.current) {
      playbackCursorRef.current = audioContextRef.current.currentTime
    }
  }, [])

  const toggleMute = useCallback(() => setIsMutedWrapped(p => !p), [setIsMutedWrapped])

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