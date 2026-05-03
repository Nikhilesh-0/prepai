import { useRef, useState, useCallback, useEffect } from 'react'

const SAMPLE_RATE = 44100
const CHANNELS = 1

export default function useAudio(sendBinaryRef, sendMessageRef) {
  const audioContextRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const micStreamRef = useRef(null)
  const playbackCursorRef = useRef(0)
  const hasReceivedAudioRef = useRef(false)  // true once first chunk of current turn is scheduled
  const animFrameRef = useRef(null)
  const isRecordingRef = useRef(false)
  const pendingSendsRef = useRef([])

  const [isRecording, setIsRecording] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [audioLevel, setAudioLevel] = useState(0)

  const isMutedRef = useRef(false)
  const setIsMutedWrapped = useCallback((val) => {
    const next = typeof val === 'function' ? val(isMutedRef.current) : val
    isMutedRef.current = next
    setIsMuted(next)
  }, [])

  useEffect(() => {
    return () => releaseMicTracks()
  }, [])

  // ── releaseMicTracks ───────────────────────────────────────────────────────
  // Stops all mic tracks so the BT headset can switch back from HFP → A2DP.
  // Called immediately after stopRecording() sends audio_end.
  const releaseMicTracks = useCallback(() => {
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(t => t.stop())
      micStreamRef.current = null
    }
  }, [])

  // ── AudioContext — created once, never closed ──────────────────────────────
  // Keepalive oscillator prevents BT noise gate from engaging during silence.
  const initAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      const ctx = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: SAMPLE_RATE,
        latencyHint: 'playback',
      })
      audioContextRef.current = ctx

      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = 100
      gain.gain.value = 0.001
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
    } else if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume()
    }
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

  // ── requestMicPermission ───────────────────────────────────────────────────
  // Triggers the browser permission prompt, then immediately releases the
  // stream. This caches the grant without locking the BT headset into HFP.
  const requestMicPermission = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      stream.getTracks().forEach(t => t.stop())
    } catch (e) {
      console.warn('Mic permission denied:', e)
      throw e
    }
  }, [])

  const sendQueueRef = useRef(Promise.resolve())

  const stopCurrentRecorder = useCallback(() => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current
      if (!recorder || recorder.state === 'inactive') { resolve(); return }
      recorder.onstop = () => resolve()
      recorder.stop()
      mediaRecorderRef.current = null
    })
  }, [])



  // ── startRecording ─────────────────────────────────────────────────────────
  // Acquires mic fresh each turn so BT can be in A2DP during AI speech.
  const startRecording = useCallback(async () => {
    const ctx = audioContextRef.current
    if (!ctx) throw new Error('AudioContext not initialized')
    if (ctx.state === 'suspended') await ctx.resume()

    await stopCurrentRecorder()
    releaseMicTracks()

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    })
    micStreamRef.current = stream

    // Analyser only — not connected to destination, so BT stays in HFP
    // only for the duration of actual recording, not during playback.
    const source = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    source.connect(analyser)
    startLevelMeter(analyser)

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg;codecs=opus'

    const recorder = new MediaRecorder(stream, { mimeType })
    mediaRecorderRef.current = recorder
    sendQueueRef.current = Promise.resolve()

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0 && !isMutedRef.current) {
        const p = sendQueueRef.current
          .then(() => event.data.arrayBuffer())
          .then((buffer) => { sendBinaryRef.current?.(buffer) })
          .catch(console.error)
        sendQueueRef.current = p
        pendingSendsRef.current.push(p)
      }
    }

    recorder.start(250)
    isRecordingRef.current = true
    setIsRecording(true)
  }, [stopCurrentRecorder, releaseMicTracks, startLevelMeter, sendBinaryRef])

  // ── stopRecording ──────────────────────────────────────────────────────────
  const stopRecording = useCallback(async () => {
    isRecordingRef.current = false
    stopLevelMeter()
    await stopCurrentRecorder()

    // Wait for all in-flight sends — onstop fires before the last
    // ondataavailable .then() resolves, so audio_end must come after.
    await Promise.all(pendingSendsRef.current)
    pendingSendsRef.current = []

    setIsRecording(false)
    sendMessageRef.current?.({ type: 'audio_end' })

    // Release mic NOW — headset switches back to A2DP for AI playback
    releaseMicTracks()
  }, [stopCurrentRecorder, stopLevelMeter, releaseMicTracks, sendMessageRef])

  // ── playAudioChunk ─────────────────────────────────────────────────────────
  const playAudioChunk = useCallback((base64Audio) => {
    const ctx = audioContextRef.current
    if (!ctx) return
    if (ctx.state === 'suspended') ctx.resume()

    try {
      const binary = atob(base64Audio)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

      // PCM f32le must be 4-byte aligned
      const alignedLength = bytes.length - (bytes.length % 4)
      if (alignedLength === 0) return
      const float32 = new Float32Array(bytes.buffer, 0, alignedLength / 4)
      if (float32.length === 0) return

      const audioBuffer = ctx.createBuffer(CHANNELS, float32.length, SAMPLE_RATE)
      audioBuffer.getChannelData(0).set(float32)

      const source = ctx.createBufferSource()
      source.buffer = audioBuffer
      source.connect(ctx.destination)

      const now = ctx.currentTime
      // Only reset cursor if stale — don't add lead time per-chunk (causes drift)
      if (playbackCursorRef.current < now - 0.5) {
        playbackCursorRef.current = now + 0.08
      }
      const startAt = Math.max(playbackCursorRef.current, now)
      source.start(startAt)
      playbackCursorRef.current = startAt + audioBuffer.duration

      // Mark that audio has started arriving for this turn
      hasReceivedAudioRef.current = true
    } catch (err) {
      console.error('Audio playback error:', err)
    }
  }, [])

  const resetPlaybackCursor = useCallback(() => {
    if (audioContextRef.current) {
      playbackCursorRef.current = audioContextRef.current.currentTime + 0.08
      hasReceivedAudioRef.current = false
    }
  }, [])

  const getRemainingPlaybackMs = useCallback(() => {
    const ctx = audioContextRef.current
    if (!ctx) return 0
    return Math.max(0, (playbackCursorRef.current - ctx.currentTime) * 1000)
  }, [])

  // True only once the first chunk has been scheduled AND the scheduler is empty
  const isPlaybackTrulyDone = useCallback(() => {
    return hasReceivedAudioRef.current && getRemainingPlaybackMs() <= 0
  }, [getRemainingPlaybackMs])

  const toggleMute = useCallback(() => setIsMutedWrapped(p => !p), [setIsMutedWrapped])

  return {
    initAudioContext,
    requestMicPermission,
    startRecording,
    stopRecording,
    playAudioChunk,
    resetPlaybackCursor,
    getRemainingPlaybackMs,
    isPlaybackTrulyDone,   // ← new, used by useInterview poll
    isMuted,
    toggleMute,
    isRecording,
    audioLevel,
  }
}