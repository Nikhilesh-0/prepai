import { useRef, useState, useCallback, useEffect } from 'react'

const SAMPLE_RATE = 44100
const CHANNELS = 1

export default function useAudio(sendBinaryRef, sendMessageRef) {
  const audioContextRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const micStreamRef = useRef(null)
  const hasReceivedAudioRef = useRef(false)  // true once first chunk of current turn arrives
  const animFrameRef = useRef(null)
  const isRecordingRef = useRef(false)
  const pendingSendsRef = useRef([])
  const audioPlayQueueRef = useRef(new Float32Array(0))  // PCM sample queue for playback

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
  // ScriptProcessorNode provides a continuous pull-based audio stream so the
  // BT A2DP codec never sees node start/stop transitions.
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

      // Continuous playback processor — always outputs samples so BT codecs
      // never see audio stream discontinuities.  Pulls from audioPlayQueueRef.
      const processor = ctx.createScriptProcessor(4096, 0, 1)
      processor.onaudioprocess = (e) => {
        const output = e.outputBuffer.getChannelData(0)
        const queue = audioPlayQueueRef.current
        const needed = output.length

        if (queue.length >= needed) {
          output.set(queue.subarray(0, needed))
          audioPlayQueueRef.current = queue.slice(needed)
        } else if (queue.length > 0) {
          output.set(queue)
          for (let i = queue.length; i < needed; i++) output[i] = 0
          audioPlayQueueRef.current = new Float32Array(0)
        } else {
          for (let i = 0; i < needed; i++) output[i] = 0
        }
      }
      processor.connect(ctx.destination)
    } else if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume()
    }
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

  // ── markNewAiTurn ──────────────────────────────────────────────────────────
  // Called by useInterview when a new AI turn begins (first audio_response_chunk).
  // Resets the flag so the poll in useInterview knows audio has started arriving.
  const markNewAiTurn = useCallback(() => {
    hasReceivedAudioRef.current = false
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
  // Decodes a base64 PCM chunk and appends samples to the playback queue.
  // The ScriptProcessorNode in initAudioContext pulls from this queue
  // continuously, so there are never discrete AudioNode start/stop events.
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

      // Append to the continuous playback queue
      const current = audioPlayQueueRef.current
      const merged = new Float32Array(current.length + float32.length)
      merged.set(current)
      merged.set(float32, current.length)
      audioPlayQueueRef.current = merged

      hasReceivedAudioRef.current = true
    } catch (err) {
      console.error('Audio playback error:', err)
    }
  }, [])

  const resetPlaybackCursor = useCallback(() => {
    audioPlayQueueRef.current = new Float32Array(0)
    hasReceivedAudioRef.current = false
  }, [])

  const getRemainingPlaybackMs = useCallback(() => {
    return Math.max(0, (audioPlayQueueRef.current.length / SAMPLE_RATE) * 1000)
  }, [])

  // True only once the first chunk has arrived AND the queue has been drained
  const isPlaybackTrulyDone = useCallback(() => {
    return hasReceivedAudioRef.current && audioPlayQueueRef.current.length === 0
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
    isPlaybackTrulyDone,   // ← new, used by useInterview poll
    markNewAiTurn,         // ← new, called on first audio_response_chunk
    isMuted,
    toggleMute,
    isRecording,
    audioLevel,
  }
}