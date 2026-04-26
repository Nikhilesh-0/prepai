import React from 'react'

function StatItem({ value, label }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{
        fontSize: '32px',
        fontWeight: '700',
        color: 'var(--text-primary)',
        fontFamily: 'var(--font)',
        lineHeight: 1,
        marginBottom: '6px',
      }}>
        {value ?? '—'}
      </div>
      <div style={{
        fontSize: '11px',
        color: 'var(--text-muted)',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
      }}>
        {label}
      </div>
    </div>
  )
}

export default function StatsBar({ sessions }) {
  const completed = sessions.filter(s => s.status === 'completed')
  const scores = completed
    .map(s => s.scorecards?.[0]?.overall_score)
    .filter(s => s != null)

  const avgScore = scores.length
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : null

  const bestScore = scores.length ? Math.max(...scores) : null

  return (
    <div style={{
      display: 'flex',
      gap: '0',
      border: '1px solid var(--border)',
      background: 'var(--bg-secondary)',
      marginBottom: '32px',
    }}>
      {[
        { value: sessions.length, label: 'Total Interviews' },
        { value: avgScore, label: 'Avg Score' },
        { value: bestScore, label: 'Best Score' },
      ].map((stat, i) => (
        <div key={i} style={{
          flex: 1,
          padding: '24px',
          borderRight: i < 2 ? '1px solid var(--border)' : 'none',
        }}>
          <StatItem value={stat.value} label={stat.label} />
        </div>
      ))}
    </div>
  )
}
