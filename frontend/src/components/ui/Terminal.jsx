import React from 'react'

export default function Terminal({ title = 'terminal', children, style = {}, className = '' }) {
  return (
    <div style={{
      border: '1px solid var(--border)',
      background: 'var(--bg-secondary)',
      ...style,
    }} className={className}>
      {/* Header bar */}
      <div style={{
        borderBottom: '1px solid var(--border)',
        padding: '8px 12px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        background: 'var(--bg-tertiary)',
      }}>
        {/* Three square dots — terminal aesthetic */}
        <span style={{ width: '8px', height: '8px', background: 'var(--danger)', display: 'inline-block' }} />
        <span style={{ width: '8px', height: '8px', background: 'var(--warning)', display: 'inline-block' }} />
        <span style={{ width: '8px', height: '8px', background: 'var(--accent)', display: 'inline-block' }} />
        <span style={{
          marginLeft: '8px',
          fontSize: '11px',
          color: 'var(--text-muted)',
          fontFamily: 'var(--font)',
          letterSpacing: '0.05em',
        }}>
          {title}
        </span>
      </div>
      {/* Content */}
      <div style={{ padding: '16px' }}>
        {children}
      </div>
    </div>
  )
}
