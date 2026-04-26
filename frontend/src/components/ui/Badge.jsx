import React from 'react'

const variantColors = {
  success: { color: 'var(--accent)', border: '1px solid var(--accent)', background: 'var(--accent-dim)' },
  warning: { color: 'var(--warning)', border: '1px solid rgba(255,170,0,0.3)', background: 'rgba(255,170,0,0.1)' },
  error: { color: 'var(--danger)', border: '1px solid rgba(255,68,68,0.3)', background: 'rgba(255,68,68,0.1)' },
  neutral: { color: 'var(--text-secondary)', border: '1px solid var(--border)', background: 'var(--bg-secondary)' },
  accent: { color: '#000', border: '1px solid var(--accent)', background: 'var(--accent)' },
}

export default function Badge({ children, variant = 'neutral', style = {} }) {
  return (
    <span style={{
      fontSize: '11px',
      fontFamily: 'var(--font)',
      fontWeight: '500',
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      padding: '2px 8px',
      display: 'inline-block',
      ...variantColors[variant],
      ...style,
    }}>
      {children}
    </span>
  )
}
