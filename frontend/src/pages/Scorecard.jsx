import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getScorecard } from '../lib/api'
import ScoreRing from '../components/scorecard/ScoreRing'
import FeedbackBlock from '../components/scorecard/FeedbackBlock'
import Terminal from '../components/ui/Terminal'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'

function formatDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function Scorecard() {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const [scorecard, setScorecard] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const load = async () => {
      try {
        // Retry up to 3 times — scorecard may still be generating
        let data = null
        for (let i = 0; i < 3; i++) {
          try {
            data = await getScorecard(sessionId)
            if (data) break
          } catch (e) {
            if (i < 2) {
              await new Promise(r => setTimeout(r, 2000))
            } else {
              throw e
            }
          }
        }
        setScorecard(data)
      } catch (err) {
        setError(err.message || 'Failed to load scorecard')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [sessionId])

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'var(--bg)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font)', fontSize: '13px' }}>
          <span style={{ color: 'var(--text-secondary)' }}>{'>'}</span>{' '}
          Loading results
          <span style={{ animation: 'blink 1s step-end infinite', color: 'var(--accent)' }}>_</span>
        </span>
      </div>
    )
  }

  if (error || !scorecard) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'var(--bg)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '16px',
      }}>
        <div style={{ color: 'var(--danger)', fontSize: '13px' }}>
          [!] {error || 'Scorecard not available'}
        </div>
        <Button variant="ghost" onClick={() => navigate('/dashboard')}>
          ← Back to Dashboard
        </Button>
      </div>
    )
  }

  const strengths = Array.isArray(scorecard.strengths) ? scorecard.strengths : []
  const improvements = Array.isArray(scorecard.improvements) ? scorecard.improvements : []

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg)',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Header */}
      <header style={{
        borderBottom: '1px solid var(--border)',
        padding: '16px 32px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span style={{
          fontFamily: 'var(--font)',
          fontWeight: '700',
          fontSize: '14px',
          color: 'var(--text-primary)',
        }}>
          <span style={{ color: 'var(--accent)' }}>prep</span>ai
        </span>
        <Button variant="ghost" onClick={() => navigate('/dashboard')} style={{ fontSize: '12px' }}>
          ← dashboard
        </Button>
      </header>

      <main style={{
        flex: 1,
        maxWidth: '860px',
        width: '100%',
        margin: '0 auto',
        padding: '40px 24px',
      }}>
        {/* Title section */}
        <div style={{ marginBottom: '40px' }}>
          <div style={{
            fontSize: '11px', color: 'var(--text-muted)',
            letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '8px',
          }}>
            Interview Complete
          </div>
          <h1 style={{
            fontFamily: 'var(--font)',
            fontWeight: '700',
            fontSize: '24px',
            color: 'var(--text-primary)',
            margin: '0 0 4px 0',
          }}>
            Performance Report
          </h1>
          {scorecard.created_at && (
            <div style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
              {formatDate(scorecard.created_at)}
            </div>
          )}
        </div>

        {/* Score rings */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '0',
          border: '1px solid var(--border)',
          marginBottom: '32px',
        }}>
          {[
            { score: scorecard.overall_score, label: 'Overall' },
            { score: scorecard.communication_score, label: 'Communication' },
            { score: scorecard.technical_score, label: 'Technical' },
            { score: scorecard.confidence_score, label: 'Confidence' },
          ].map((item, i) => (
            <div
              key={item.label}
              style={{
                padding: '28px 16px',
                display: 'flex',
                justifyContent: 'center',
                borderRight: i < 3 ? '1px solid var(--border)' : 'none',
                background: 'var(--bg-secondary)',
              }}
            >
              <ScoreRing score={item.score ?? 0} label={item.label} />
            </div>
          ))}
        </div>

        {/* Filler word count */}
        {scorecard.filler_word_count > 0 && (
          <div style={{ marginBottom: '24px' }}>
            <Badge variant="warning">
              [ {scorecard.filler_word_count} filler word{scorecard.filler_word_count !== 1 ? 's' : ''} detected ]
            </Badge>
          </div>
        )}

        {/* Strengths and improvements */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '1px',
          marginBottom: '32px',
          background: 'var(--border)',
        }}>
          <div style={{ background: 'var(--bg)', padding: '24px' }}>
            <FeedbackBlock
              title="Strengths"
              items={strengths}
              type="strength"
            />
          </div>
          <div style={{ background: 'var(--bg)', padding: '24px' }}>
            <FeedbackBlock
              title="Areas for Improvement"
              items={improvements}
              type="improvement"
            />
          </div>
        </div>

        {/* Summary */}
        {scorecard.summary && (
          <Terminal title="summary.txt" style={{ marginBottom: '32px' }}>
            <p style={{
              color: 'var(--text-secondary)',
              fontSize: '13px',
              lineHeight: '1.8',
              margin: 0,
            }}>
              {scorecard.summary}
            </p>
          </Terminal>
        )}

        {/* Detailed feedback */}
        {scorecard.detailed_feedback && (
          <Terminal title="detailed-feedback.json" style={{ marginBottom: '40px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {Object.entries(scorecard.detailed_feedback).map(([key, value]) => (
                <div key={key}>
                  <div style={{
                    fontSize: '11px',
                    color: 'var(--accent)',
                    marginBottom: '6px',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                  }}>
                    {key}
                  </div>
                  <div style={{
                    color: 'var(--text-secondary)',
                    fontSize: '13px',
                    lineHeight: '1.7',
                  }}>
                    {value}
                  </div>
                </div>
              ))}
            </div>
          </Terminal>
        )}

        {/* Back button */}
        <div style={{ display: 'flex', justifyContent: 'center', paddingBottom: '40px' }}>
          <Button
            variant="ghost"
            onClick={() => navigate('/dashboard')}
            style={{ fontSize: '13px', padding: '12px 32px' }}
          >
            ← Back to Dashboard
          </Button>
        </div>

        {/* Mobile responsive for score rings */}
        <style>{`
          @media (max-width: 600px) {
            .score-grid { grid-template-columns: repeat(2, 1fr) !important; }
            .feedback-grid { grid-template-columns: 1fr !important; }
          }
        `}</style>
      </main>
    </div>
  )
}
