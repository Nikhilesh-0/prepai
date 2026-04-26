import React from 'react'

// State: 'idle' | 'speaking' | 'listening' | 'processing'
export default function AIIndicator({ state = 'idle' }) {
  const size = 80

  const orbStyle = {
    width: size,
    height: size,
    borderRadius: '50%',
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  }

  if (state === 'speaking') {
    return (
      <div style={{ position: 'relative', width: size, height: size }}>
        <div style={{
          ...orbStyle,
          background: 'radial-gradient(circle at 35% 35%, #00ff88, #00cc66)',
          animation: 'orb-pulse 1.5s ease-in-out infinite',
          boxShadow: '0 0 30px #00ff8866, 0 0 60px #00ff8833',
        }} />
      </div>
    )
  }

  if (state === 'listening') {
    return (
      <div style={{ position: 'relative', width: size * 2.5, height: size * 2.5, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {/* Ripple rings */}
        {[0, 1, 2].map(i => (
          <div
            key={i}
            style={{
              position: 'absolute',
              borderRadius: '50%',
              border: '1px solid var(--accent)',
              width: size,
              height: size,
              opacity: 0,
              animation: `orb-ripple 2s ease-out ${i * 0.6}s infinite`,
            }}
          />
        ))}
        {/* Core orb */}
        <div style={{
          ...orbStyle,
          background: 'radial-gradient(circle at 35% 35%, #00ff88, #00cc66)',
          boxShadow: '0 0 20px #00ff8844',
          zIndex: 1,
        }} />
      </div>
    )
  }

  if (state === 'processing') {
    return (
      <div style={{ position: 'relative', width: size, height: size }}>
        {/* Rotating dashed border */}
        <div style={{
          position: 'absolute',
          inset: -4,
          borderRadius: '50%',
          border: '2px dashed var(--border-active)',
          animation: 'orb-spin 2s linear infinite',
        }} />
        <div style={{
          ...orbStyle,
          background: '#1a1a1a',
          border: '1px solid var(--border)',
        }} />
      </div>
    )
  }

  // idle
  return (
    <div style={{ width: size, height: size }}>
      <div style={{
        ...orbStyle,
        background: '#111',
        border: '1px solid var(--border)',
        boxShadow: 'none',
      }} />
    </div>
  )
}
