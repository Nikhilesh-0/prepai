import React, { useEffect, useState, useRef } from 'react'

export default function LiveTranscript({ text = '', isStreaming = false }) {
  const [displayed, setDisplayed] = useState('')
  const [charIndex, setCharIndex] = useState(0)
  const intervalRef = useRef(null)
  const prevTextRef = useRef('')

  useEffect(() => {
    // When new text arrives (longer than before), type out the new characters
    if (text.length > prevTextRef.current.length && text.startsWith(prevTextRef.current)) {
      // Append mode — continue from where we left off
      prevTextRef.current = text
    } else if (text !== prevTextRef.current) {
      // Reset — new question
      setDisplayed('')
      setCharIndex(0)
      prevTextRef.current = text
    }
  }, [text])

  useEffect(() => {
    if (!text) {
      setDisplayed('')
      return
    }

    if (displayed.length >= text.length) return

    clearInterval(intervalRef.current)
    intervalRef.current = setInterval(() => {
      setDisplayed(prev => {
        if (prev.length >= text.length) {
          clearInterval(intervalRef.current)
          return prev
        }
        return text.slice(0, prev.length + 1)
      })
    }, 15)

    return () => clearInterval(intervalRef.current)
  }, [text, displayed.length])

  const showCursor = isStreaming || displayed.length < text.length

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
