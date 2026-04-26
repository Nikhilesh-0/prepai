import React from 'react'

export default function ProgressBar({ current = 0, total = 8 }) {
  const pct = total > 0 ? Math.min((current / total) * 100, 100) : 0

  return (
    <div style={{ minWidth: '160px' }}>
      <div style={{
        fontSize: '12px',
        color: 'var(--text-muted)',
        marginBottom: '6px',
        textAlign: 'right',
        letterSpacing: '0.05em',
      }}>
        Q{current + 1} <span style={{ color: 'var(--border-active)' }}>/</span> {total}
      </div>
      <div style={{
        height: '1px',
        background: 'var(--border)',
        width: '100%',
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute',
          left: 0,
          top: 0,
          height: '100%',
          width: `${pct}%`,
          background: 'var(--accent)',
          transition: 'width 0.4s ease',
        }} />
      </div>
    </div>
  )
}
