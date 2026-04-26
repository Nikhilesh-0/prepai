import React, { useState } from 'react'
import Button from '../ui/Button'

export default function Controls({ isMuted, onToggleMute, onEndInterview, disabled = false }) {
  const [confirmEnd, setConfirmEnd] = useState(false)

  const handleEndClick = () => {
    if (confirmEnd) {
      onEndInterview()
      setConfirmEnd(false)
    } else {
      setConfirmEnd(true)
      // Auto-reset confirm state after 3s
      setTimeout(() => setConfirmEnd(false), 3000)
    }
  }

  return (
    <div style={{
      display: 'flex',
      gap: '12px',
      alignItems: 'center',
    }}>
      <Button
        variant="ghost"
        onClick={onToggleMute}
        disabled={disabled}
        style={{ fontSize: '12px' }}
      >
        {isMuted ? (
          <>
            <span style={{ color: 'var(--danger)' }}>●</span>
            <span>unmute</span>
          </>
        ) : (
          <>
            <span style={{ color: 'var(--accent)' }}>●</span>
            <span>mute</span>
          </>
        )}
      </Button>

      <Button
        variant={confirmEnd ? 'danger' : 'muted'}
        onClick={handleEndClick}
        disabled={disabled}
        style={{ fontSize: '12px' }}
      >
        {confirmEnd ? '[ confirm? ]' : '[ end interview ]'}
      </Button>
    </div>
  )
}
