import React from 'react'

export default function FeedbackBlock({ title, items = [], type = 'strength' }) {
  const isStrength = type === 'strength'
  const prefix = isStrength ? '[+]' : '[!]'
  const prefixColor = isStrength ? 'var(--accent)' : 'var(--warning)'

  return (
    <div>
      <div style={{
        fontSize: '11px',
        color: 'var(--text-muted)',
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        marginBottom: '12px',
        paddingBottom: '8px',
        borderBottom: '1px solid var(--border)',
      }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {items.length === 0 ? (
          <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No items recorded.</span>
        ) : (
          items.map((item, i) => (
            <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
              <span style={{
                color: prefixColor,
                fontFamily: 'var(--font)',
                fontSize: '13px',
                flexShrink: 0,
                lineHeight: '1.6',
              }}>
                {prefix}
              </span>
              <span style={{
                color: 'var(--text-secondary)',
                fontSize: '13px',
                lineHeight: '1.6',
              }}>
                {item}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
