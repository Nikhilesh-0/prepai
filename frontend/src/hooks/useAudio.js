import { useRef, useState, useCallback, useEffect } from 'react'

const SAMPLE_RATE = 44100
const CHANNELS = 1

export default function useAudio(sendBinary, sendMessage) {
  const audioContextRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const analyserRef = useRef(null)
  const micStreamRef = useRef(null)
  const playbackCursorRef = useRef(0) // time cursor for gapless playback
  const animFrameRef = useRef(null)

  const [isRecording, setIsRecording] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [audioLevel, setAudioLevel] = useState(0)

  // Initialize AudioContext (must be called inside a user gesture)
  const initAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: SAMPLE_RATE,
      })
      playbackCursorRef.current = 0
    } else if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume()
    }
    return audioContextRef.current
  }, [])

  // Start the level meter animation loop
  const startLevelMeter = useCallback(() => {
    if (!analyserRef.current) return

    const analyser = analyserRef.current
    const bufferLength = analyser.fftSize
    const dataArray = new Uint8Array(bufferLength)

    const tick = () => {
      analyser.getByteTimeDomainData(dataArray)
      // Compute RMS
      let sum = 0
      for (let i = 0; i < bufferLength; i++) {
        const val = (dataArray[i] - 128) / 128
        sum += val * val
      }
      const rms = Math.sqrt(sum / bufferLength)
      setAudioLevel(Math.min(rms * 4, 1)) // scale up for visibility
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

  const startRecording = useCallback(async () => {
    try {
      const ctx = initAudioContext()

      // Get microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      micStreamRef.current = stream

      // Set up analyser for level meter
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      analyserRef.current = analyser
      startLevelMeter()

      // Set up MediaRecorder
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : 'audio/ogg;codecs=opus'

      const recorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0 && !isMuted) {
          event.data.arrayBuffer().then((buffer) => {
            sendBinary(buffer)
          })
        }
      }

      recorder.start(250) // fire every 250ms
      setIsRecording(true)
    } catch (err) {
      console.error('Failed to start recording:', err)
      throw err
    }
  }, [initAudioContext, sendBinary, isMuted, startLevelMeter])

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }

    // Stop mic stream tracks
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop())
      micStreamRef.current = null
    }

    stopLevelMeter()
    setIsRecording(false)

    // Signal end of audio to backend
    sendMessage({ type: 'audio_end' })
  }, [sendMessage, stopLevelMeter])

  const playAudioChunk = useCallback((base64Audio) => {
    const ctx = audioContextRef.current
    if (!ctx) return

    try {
      // Decode base64 to bytes
      const binaryStr = atob(base64Audio)
      const bytes = new Uint8Array(binaryStr.length)
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i)
      }

      // PCM f32le — interpret raw bytes as float32 array
      const float32Array = new Float32Array(bytes.buffer)
      const numSamples = float32Array.length

      if (numSamples === 0) return

      // Create AudioBuffer
      const audioBuffer = ctx.createBuffer(CHANNELS, numSamples, SAMPLE_RATE)
      audioBuffer.getChannelData(0).set(float32Array)

      // Schedule for gapless playback
      const source = ctx.createBufferSource()
      source.buffer = audioBuffer
      source.connect(ctx.destination)

      const now = ctx.currentTime
      const startTime = Math.max(playbackCursorRef.current, now)
      source.start(startTime)
      playbackCursorRef.current = startTime + audioBuffer.duration

    } catch (err) {
      console.error('Failed to play audio chunk:', err)
    }
  }, [])

  const resetPlaybackCursor = useCallback(() => {
    playbackCursorRef.current = 0
    if (audioContextRef.current) {
      playbackCursorRef.current = audioContextRef.current.currentTime
    }
  }, [])

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => !prev)
  }, [])

  // Expose initAudioContext so Interview page can call it on button click
  return {
    initAudioContext,
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
