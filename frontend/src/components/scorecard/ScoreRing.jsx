import React, { useEffect, useRef } from 'react'

export default function ScoreRing({ score = 0, label = '', color = 'var(--accent)', size = 120 }) {
  const circleRef = useRef(null)
  const strokeWidth = 6
  const radius = (size - strokeWidth * 2) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (score / 100) * circumference

  useEffect(() => {
    if (!circleRef.current) return
    // Start from full offset (empty), animate to target
    circleRef.current.style.strokeDashoffset = circumference
    const timer = setTimeout(() => {
      if (circleRef.current) {
        circleRef.current.style.strokeDashoffset = offset
      }
    }, 100)
    return () => clearTimeout(timer)
  }, [score, circumference, offset])

  const scoreColor = score >= 70 ? 'var(--accent)' : score >= 50 ? 'var(--warning)' : 'var(--danger)'

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '8px',
    }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg
          width={size}
          height={size}
          style={{ transform: 'rotate(-90deg)' }}
        >
          {/* Background track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--border)"
            strokeWidth={strokeWidth}
          />
          {/* Progress arc */}
          <circle
            ref={circleRef}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={scoreColor}
            strokeWidth={strokeWidth}
            strokeLinecap="butt"
            strokeDasharray={circumference}
            strokeDashoffset={circumference}
            style={{ transition: 'stroke-dashoffset 1s ease' }}
          />
        </svg>

        {/* Score number in center */}
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
        }}>
          <span style={{
            fontSize: size > 100 ? '28px' : '20px',
            fontWeight: '700',
            fontFamily: 'var(--font)',
            color: scoreColor,
            lineHeight: 1,
          }}>
            {score}
          </span>
        </div>
      </div>

      <span style={{
        fontSize: '11px',
        color: 'var(--text-muted)',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        textAlign: 'center',
      }}>
        {label}
      </span>
    </div>
  )
}
