import React, { useEffect, useState, useRef } from 'react'

export default function LiveTranscript({ text = '', isStreaming = false }) {
  const [displayed, setDisplayed] = useState('')
  const textRef = useRef(text)
  const displayedLenRef = useRef(0)

  useEffect(() => {
    textRef.current = text
    if (text === '') {
      setDisplayed('')
      displayedLenRef.current = 0
    }
  }, [text])

  useEffect(() => {
    const interval = setInterval(() => {
      if (displayedLenRef.current < textRef.current.length) {
        // Calculate difference between target and current
        const diff = textRef.current.length - displayedLenRef.current
        
        // Dynamic speed adjustment to catch up if buffer is large
        // but generally maintain a comfortable reading/speaking pace (~30ms per char)
        const step = diff > 80 ? 3 : diff > 30 ? 2 : 1
        
        displayedLenRef.current += step
        if (displayedLenRef.current > textRef.current.length) {
          displayedLenRef.current = textRef.current.length
        }
        
        setDisplayed(textRef.current.slice(0, displayedLenRef.current))
      }
    }, 30) // Tick every 30ms
    
    return () => clearInterval(interval)
  }, [])

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