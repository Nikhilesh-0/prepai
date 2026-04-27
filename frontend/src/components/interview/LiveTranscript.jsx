import React, { useEffect, useState, useRef } from 'react'

export default function LiveTranscript({ text = '', isStreaming = false }) {
  // While streaming: show the full accumulated text as-is (no typewriter delay on tokens)
  // After streaming ends (isStreaming=false, text stable): keep showing full text
  // On reset (text goes to '' then new text): fade out then typewrite new text
  const [displayed, setDisplayed] = useState('')
  const intervalRef = useRef(null)
  const prevTextRef = useRef('')
  const isTypingRef = useRef(false)

  useEffect(() => {
    // Text reset — new question starting
    if (text === '' && prevTextRef.current !== '') {
      clearInterval(intervalRef.current)
      setDisplayed('')
      prevTextRef.current = ''
      isTypingRef.current = false
      return
    }

    if (!text) return

    // Same text, no change
    if (text === prevTextRef.current) return

    prevTextRef.current = text

    // While AI is streaming tokens: just display the full buffer immediately.
    // This avoids the garbled look from typewriter racing behind fast token arrival.
    if (isStreaming) {
      setDisplayed(text)
      return
    }

    // Streaming finished — typewrite the complete final text from the start
    // (only triggered once when isStreaming flips to false)
    if (!isTypingRef.current) {
      isTypingRef.current = true
      setDisplayed('')
      let i = 0
      clearInterval(intervalRef.current)
      intervalRef.current = setInterval(() => {
        i++
        setDisplayed(text.slice(0, i))
        if (i >= text.length) {
          clearInterval(intervalRef.current)
          isTypingRef.current = false
        }
      }, 18)
    }

    return () => clearInterval(intervalRef.current)
  }, [text, isStreaming])

  const showCursor = isStreaming || isTypingRef.current

  return (
    <div style={{
      fontFamily: 'var(--font)',
      fontSize: '16px',
      lineHeight: '1.7',
      color: 'var(--text-primary)',
      maxWidth: '600px',
      minHeight: '80px',
      textAlign: 'center',
    }}>
      {displayed}
      {showCursor && (
        <span style={{
          display: 'inline-block',
          width: '2px',
          height: '1.1em',
          background: 'var(--accent)',
          marginLeft: '2px',
          verticalAlign: 'text-bottom',
          animation: 'blink 1s step-end infinite',
        }} />
      )}
    </div>
  )
}