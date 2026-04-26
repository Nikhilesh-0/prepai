import React from 'react'

const variantStyles = {
  primary: {
    background: 'var(--accent)',
    color: '#000',
    border: '1px solid var(--accent)',
  },
  ghost: {
    background: 'transparent',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-active)',
  },
  danger: {
    background: 'transparent',
    color: 'var(--danger)',
    border: '1px solid var(--danger)',
  },
  muted: {
    background: 'transparent',
    color: 'var(--text-secondary)',
    border: '1px solid var(--border)',
  },
}

const hoverStyles = {
  primary: { filter: 'brightness(0.9)' },
  ghost: { background: 'var(--bg-tertiary)' },
  danger: { background: 'rgba(255,68,68,0.1)' },
  muted: { background: 'var(--bg-secondary)' },
}

export default function Button({
  children,
  variant = 'ghost',
  disabled = false,
  onClick,
  className = '',
  style = {},
  type = 'button',
  ...props
}) {
  const [hovered, setHovered] = React.useState(false)

  const base = {
    fontFamily: 'var(--font)',
    fontSize: '13px',
    padding: '8px 16px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.4 : 1,
    borderRadius: 0,
    transition: 'all 0.15s ease',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    letterSpacing: '0.02em',
    userSelect: 'none',
    ...variantStyles[variant],
    ...(hovered && !disabled ? hoverStyles[variant] : {}),
    ...style,
  }

  return (
    <button
      type={type}
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={base}
      className={className}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  )
}
