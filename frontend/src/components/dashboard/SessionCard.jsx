import React from 'react'
import { useNavigate } from 'react-router-dom'
import Badge from '../ui/Badge'

function formatDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function statusVariant(status) {
  if (status === 'completed') return 'success'
  if (status === 'abandoned') return 'error'
  return 'warning'
}

export default function SessionCard({ session }) {
  const navigate = useNavigate()
  const scorecard = session.scorecards?.[0] || null
  const score = scorecard?.overall_score ?? null
  const isCompleted = session.status === 'completed'
  const isInProgress = session.status === 'in_progress'
  const isClickable = isCompleted || isInProgress

  const handleClick = () => {
    if (isCompleted) navigate(`/scorecard/${session.id}`)
    else if (isInProgress) navigate(`/interview/${session.id}`)
  }

  return (
    <div
      onClick={isClickable ? handleClick : undefined}
      style={{
        border: '1px solid var(--border)',
        background: 'var(--bg-secondary)',
        padding: '16px 20px',
        cursor: isClickable ? 'pointer' : 'default',
        transition: 'border-color 0.15s ease, background 0.15s ease',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '16px',
      }}
      onMouseEnter={e => {
        if (isClickable) {
          e.currentTarget.style.borderColor = 'var(--border-active)'
          e.currentTarget.style.background = 'var(--bg-tertiary)'
        }
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--border)'
        e.currentTarget.style.background = 'var(--bg-secondary)'
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px', flexWrap: 'wrap' }}>
          <span style={{
            color: 'var(--text-primary)', fontSize: '14px', fontWeight: '500',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {session.role_title || 'Software Engineer'}
          </span>
          <Badge variant={statusVariant(session.status)}>{session.status.replace('_', ' ')}</Badge>
          {session.level && <Badge variant="neutral">{session.level}</Badge>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{formatDate(session.created_at)}</span>
          {session.domain && <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{session.domain}</span>}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexShrink: 0 }}>
        {isCompleted && score !== null ? (
          <div style={{ textAlign: 'right' }}>
            <div style={{
              fontSize: '24px', fontWeight: '700',
              color: score >= 70 ? 'var(--accent)' : score >= 50 ? 'var(--warning)' : 'var(--danger)',
            }}>
              {score}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>score</div>
          </div>
        ) : isInProgress ? (
          <span style={{ color: 'var(--warning)', fontSize: '12px' }}>resume →</span>
        ) : (
          <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>—</span>
        )}
        {isCompleted && <span style={{ color: 'var(--text-muted)', fontSize: '16px' }}>→</span>}
      </div>
    </div>
  )
}