import { useRef, useState, useCallback, useEffect } from 'react'

// Cartesia streams PCM f32le at 44100Hz mono
const SAMPLE_RATE = 44100
const CHANNELS = 1

// ── Bluetooth A2DP/HFP Fix ────────────────────────────────────────────────────
// Bluetooth headsets use A2DP (high-quality stereo) for output-only, but
// automatically switch to HFP/HSP (8kHz mono, heavily compressed) the moment
// the microphone is activated. This profile switch tears down and rebuilds the
// browser's audio pipeline mid-playback, causing word skips and glitches.
//
// Fix: Keep ONE AudioContext alive for the entire session and NEVER close/reopen
// it. Use separate GainNodes to independently control playback volume vs mic
// routing. The mic stream uses a MediaStreamSource routed only to the analyser
// (never to destination), so it doesn't trigger the HFP profile switch.
//
// Additionally, the keepalive oscillator (0.001 gain, 100Hz) prevents Bluetooth
// devices from engaging their noise gate / sleep mode during silent gaps.
// ─────────────────────────────────────────────────────────────────────────────

export default function useAudio(sendBinaryRef, sendMessageRef) {
  const audioContextRef = useRef(null)
  const keepaliveRef = useRef(null)          // {oscillator, gain} — started once, never stopped
  const playbackGainRef = useRef(null)       // GainNode for TTS output
  const mediaRecorderRef = useRef(null)
  const micStreamRef = useRef(null)
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

  useEffect(() => {
    return () => {
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach(t => t.stop())
      }
      // Don't close audioContextRef here — it outlives individual renders
    }
  }, [])

  // ── AudioContext — created ONCE, reused for the entire session ────────────
  //
  // KEY: We never call ctx.close() or create a new AudioContext after this
  // point. Recreating it is what triggers the Bluetooth profile renegotiation.
  const initAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      const ctx = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: SAMPLE_RATE,
        // latencyHint: 'playback' gives the browser permission to buffer more
        // aggressively, reducing glitches on high-latency Bluetooth links.
        latencyHint: 'playback',
      })
      audioContextRef.current = ctx

      // Playback gain node — all TTS audio routes through this
      const playbackGain = ctx.createGain()
      playbackGain.gain.value = 1.0
      playbackGain.connect(ctx.destination)
      playbackGainRef.current = playbackGain

      // Keepalive: inaudible 100Hz tone to prevent Bluetooth noise gate
      const oscillator = ctx.createOscillator()
      const keepGain = ctx.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = 100
      keepGain.gain.value = 0.001
      oscillator.connect(keepGain)
      keepGain.connect(ctx.destination)
      oscillator.start()
      keepaliveRef.current = { oscillator, gain: keepGain }

    } else if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume()
    }

    // Reset playback cursor to "now" so first chunk plays immediately
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
  //
  // IMPORTANT: We request mic permission here so it's obtained BEFORE
  // initAudioContext() is called. On some browsers, getUserMedia() after an
  // AudioContext is created can trigger a context state change that pauses
  // playback. Pre-granting avoids this entirely.
  const requestMicPermission = useCallback(async () => {
    if (!micStreamRef.current) {
      micStreamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: {
          // These constraints are critical for Bluetooth:
          // Disable processing that would trigger profile switching
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          // Do NOT set sampleRate here — let the browser/BT device negotiate.
          // Forcing 44100 can cause HFP to fail entirely on some headsets.
        },
        video: false,
      })
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
  const startRecording = useCallback(async () => {
    const ctx = audioContextRef.current
    if (!ctx) throw new Error('AudioContext not initialized')
    if (ctx.state === 'suspended') await ctx.resume()

    await stopCurrentRecorder()

    let stream = micStreamRef.current
    if (!stream || stream.getTracks().some(t => t.readyState === 'ended')) {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      })
      micStreamRef.current = stream
    }

    // Route mic → analyser ONLY (not to ctx.destination).
    // This is the key Bluetooth fix on the mic side: the MediaStreamSource
    // goes to the analyser for the level meter, but is NOT connected to
    // destination, so the browser has no reason to switch audio profiles.
    const source = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    source.connect(analyser)
    // Intentionally NOT connecting: source.connect(ctx.destination)
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
  }, [stopCurrentRecorder, startLevelMeter, sendBinaryRef])

  // ── stopRecording ──────────────────────────────────────────────────────────
  const stopRecording = useCallback(async () => {
    isRecordingRef.current = false
    stopLevelMeter()

    await stopCurrentRecorder()

    // Wait for all in-flight arrayBuffer→sendBinary promises.
    // onstop fires before the last ondataavailable .then() resolves,
    // so without this, audio_end would race ahead of the last binary chunk.
    await Promise.all(pendingSendsRef.current)
    pendingSendsRef.current = []

    setIsRecording(false)

    sendMessageRef.current?.({ type: 'audio_end' })
  }, [stopCurrentRecorder, stopLevelMeter, sendMessageRef])

  // ── playAudioChunk ─────────────────────────────────────────────────────────
  //
  // Bug fix vs original: the original had a gap where if playbackCursor was
  // only slightly in the past (within PLAYBACK_LEAD_TIME), it would schedule
  // to now+PLAYBACK_LEAD_TIME regardless, creating a growing delay over a long
  // AI response. Now we only reset the cursor if it's significantly stale
  // (>0.5s behind), otherwise we chain precisely to the previous chunk end.
  const playAudioChunk = useCallback((base64Audio) => {
    const ctx = audioContextRef.current
    if (!ctx) return
    if (ctx.state === 'suspended') ctx.resume()

    try {
      const binary = atob(base64Audio)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

      // Validate: PCM f32le must be divisible by 4
      const alignedLength = bytes.length - (bytes.length % 4)
      if (alignedLength === 0) return

      const float32 = new Float32Array(bytes.buffer, 0, alignedLength / 4)
      if (float32.length === 0) return

      const audioBuffer = ctx.createBuffer(CHANNELS, float32.length, SAMPLE_RATE)
      audioBuffer.getChannelData(0).set(float32)

      const source = ctx.createBufferSource()
      source.buffer = audioBuffer
      // Route through playbackGain so we can control TTS volume independently
      source.connect(playbackGainRef.current)

      const now = ctx.currentTime

      // If cursor is more than 500ms stale (gap between questions, pause, etc.)
      // reset it. Otherwise chain precisely — this prevents cumulative drift.
      const STALE_THRESHOLD = 0.5
      if (playbackCursorRef.current < now - STALE_THRESHOLD) {
        // Add a small 80ms lead to account for decode/scheduling jitter.
        // Much smaller than the original 350ms which was causing noticeable lag.
        playbackCursorRef.current = now + 0.08
      }

      const startAt = Math.max(playbackCursorRef.current, now)
      source.start(startAt)
      playbackCursorRef.current = startAt + audioBuffer.duration
    } catch (err) {
      console.error('Audio playback error:', err)
    }
  }, [])

  // Reset cursor — call before each AI turn so there's no gap from the previous one
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