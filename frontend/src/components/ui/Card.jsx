import React, { useState } from 'react'

export default function Card({ children, className = '', style = {}, hoverable = false, onClick }) {
  const [hovered, setHovered] = useState(false)

  const base = {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border)',
    padding: '20px',
    transition: 'border-color 0.15s ease, background 0.15s ease',
    cursor: onClick ? 'pointer' : 'default',
    ...(hoverable && hovered ? {
      borderColor: 'var(--border-active)',
      background: 'var(--bg-tertiary)',
    } : {}),
    ...style,
  }

  return (
    <div
      style={base}
      className={className}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
    >
      {children}
    </div>
  )
}
