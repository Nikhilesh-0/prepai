import React from 'react'

const BAR_ANIMATIONS = [
  'wave-1 0.8s ease-in-out infinite',
  'wave-2 0.9s ease-in-out infinite 0.1s',
  'wave-3 0.7s ease-in-out infinite 0.2s',
  'wave-4 1.0s ease-in-out infinite 0.05s',
  'wave-5 0.85s ease-in-out infinite 0.15s',
]

export default function WaveformBar({ audioLevel = 0, active = false }) {
  const baseHeight = 4
  const maxExtra = 32

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      height: '40px',
    }}>
      {BAR_ANIMATIONS.map((anim, i) => {
        const dynamicHeight = active
          ? baseHeight + audioLevel * maxExtra * (0.6 + Math.random() * 0.4)
          : baseHeight

        return (
          <div
            key={i}
            style={{
              width: '3px',
              height: active ? undefined : `${baseHeight}px`,
              background: 'var(--accent)',
              borderRadius: '1px',
              animation: active ? anim : 'none',
              opacity: active ? 0.9 : 0.3,
              transition: 'opacity 0.2s ease',
            }}
          />
        )
      })}
    </div>
  )
}
