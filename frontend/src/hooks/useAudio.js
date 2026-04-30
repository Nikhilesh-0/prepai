import { useRef, useState, useCallback, useEffect } from 'react'

const SAMPLE_RATE = 44100
const CHANNELS = 1

// ── Bluetooth A2DP/HFP fix — the core insight ────────────────────────────────
//
// Bluetooth headsets have two incompatible audio profiles:
//   A2DP  — high-quality stereo, active when NO mic track is open
//   HFP   — 8kHz mono, heavily compressed, active whenever a mic track is open
//
// The original code called requestMicPermission() on session start and kept
// micStreamRef alive for the entire interview. This locked the headset into
// HFP permanently — causing the faded/muffled AI voice the user hears.
//
// Fix: We do NOT pre-acquire the mic. Instead:
//   • startRecording()  → getUserMedia() → record → stop tracks immediately after
//   • stopRecording()   → stops all mic tracks as soon as audio_end is sent
//
// This means the mic track is only alive during the ~seconds the user speaks.
// The headset spends the rest of the time in A2DP, so the AI voice is full quality.
//
// requestMicPermission() still exists but now ONLY asks for the browser permission
// prompt (needed on first interaction). It acquires and immediately releases the
// track so the permission is cached without keeping HFP active.
// ─────────────────────────────────────────────────────────────────────────────

export default function useAudio(sendBinaryRef, sendMessageRef) {
  const audioContextRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const micStreamRef = useRef(null)      // only non-null during active recording
  const playbackCursorRef = useRef(0)
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

  // Defensive cleanup on unmount only
  useEffect(() => {
    return () => {
      releaseMicTracks()
    }
  }, [])

  // Stops and nulls the mic stream — keeps HFP from staying active
  const releaseMicTracks = useCallback(() => {
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(t => t.stop())
      micStreamRef.current = null
    }
  }, [])

  // ── AudioContext — created once, kept alive forever ────────────────────────
  //
  // Never close or recreate this. Recreating it resets the audio clock and
  // causes its own glitches. The keepalive oscillator prevents Bluetooth noise
  // gates from cutting in during silent gaps between AI sentences.
  const initAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      const ctx = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: SAMPLE_RATE,
        latencyHint: 'playback',
      })
      audioContextRef.current = ctx

      // Keepalive: inaudible 100Hz tone, prevents BT noise gate / sleep
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
  //
  // Only triggers the browser permission prompt. Acquires then immediately
  // releases the mic so the user sees the prompt once, without locking HFP.
  // Call this once when the user clicks "Begin Interview".
  const requestMicPermission = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      // Release immediately — we only wanted the permission grant cached
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
      if (!recorder || recorder.state === 'inactive') {
        resolve()
        return
      }
      recorder.onstop = () => resolve()
      recorder.stop()
      mediaRecorderRef.current = null
    })
  }, [])

  // ── startRecording ─────────────────────────────────────────────────────────
  //
  // Acquires the mic fresh each turn. This is intentional — we released it
  // after the previous turn so the headset could switch back to A2DP.
  const startRecording = useCallback(async () => {
    const ctx = audioContextRef.current
    if (!ctx) throw new Error('AudioContext not initialized')
    if (ctx.state === 'suspended') await ctx.resume()

    await stopCurrentRecorder()
    releaseMicTracks() // ensure previous turn's tracks are gone

    // Fresh getUserMedia every turn — this is what allows the headset to
    // switch back to A2DP between turns and return here at full quality
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    })
    micStreamRef.current = stream

    // Level meter: MediaStreamSource → analyser only, NOT to destination.
    // Connecting to destination would give the browser a reason to keep
    // the mic's HFP audio path alive through the Web Audio graph.
    const source = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    source.connect(analyser)
    startLevelMeter(analyser)

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : 'audio/ogg;codecs=opus'

    const recorder = new MediaRecorder(stream, { mimeType })
    mediaRecorderRef.current = recorder

    sendQueueRef.current = Promise.resolve()

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0 && !isMutedRef.current) {
        const p = sendQueueRef.current
          .then(() => event.data.arrayBuffer())
          .then((buffer) => {
            sendBinaryRef.current?.(buffer)
          })
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

    // Wait for all in-flight arrayBuffer→sendBinary promises before audio_end.
    // onstop fires before the last ondataavailable .then() resolves — without
    // this, audio_end races ahead of the final binary chunk.
    await Promise.all(pendingSendsRef.current)
    pendingSendsRef.current = []

    setIsRecording(false)

    // Send audio_end first, THEN release mic tracks.
    // Releasing before sending could abort the last send on some browsers.
    sendMessageRef.current?.({ type: 'audio_end' })

    // NOW release — headset can switch back to A2DP for AI playback
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

      // Reset cursor only if significantly stale (gap between questions).
      // Within a continuous stream, chain chunks precisely — no added lead
      // time per chunk, which was causing cumulative drift in the original.
      if (playbackCursorRef.current < now - 0.5) {
        playbackCursorRef.current = now + 0.08
      }

      const startAt = Math.max(playbackCursorRef.current, now)
      source.start(startAt)
      playbackCursorRef.current = startAt + audioBuffer.duration
    } catch (err) {
      console.error('Audio playback error:', err)
    }
  }, [])

  const resetPlaybackCursor = useCallback(() => {
    if (audioContextRef.current) {
      playbackCursorRef.current = audioContextRef.current.currentTime + 0.08
    }
  }, [])

  const getRemainingPlaybackMs = useCallback(() => {
    const ctx = audioContextRef.current
    if (!ctx) return 0
    const remaining = playbackCursorRef.current - ctx.currentTime
    return Math.max(0, remaining * 1000)
  }, [])

  const toggleMute = useCallback(() => setIsMutedWrapped(p => !p), [setIsMutedWrapped])

  return {
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
  }
}