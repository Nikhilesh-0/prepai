import React, { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { createSession } from '../lib/api'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import Terminal from '../components/ui/Terminal'

function LoadingDots() {
  const [dots, setDots] = useState(0)
  React.useEffect(() => {
    const t = setInterval(() => setDots(d => (d + 1) % 4), 400)
    return () => clearInterval(t)
  }, [])
  return <span style={{ color: 'var(--accent)' }}>{'...'.slice(0, dots + 1)}</span>
}

function ProfileRow({ label, value }) {
  return (
    <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', marginBottom: '10px' }}>
      <span style={{ color: 'var(--text-muted)', fontSize: '12px', minWidth: '100px', flexShrink: 0 }}>
        {label}
      </span>
      <span style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>
        {value}
      </span>
    </div>
  )
}

export default function JDInput() {
  const navigate = useNavigate()
  const audioContextRef = useRef(null)

  const [jdText, setJdText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sessionData, setSessionData] = useState(null)

  const handleAnalyze = async () => {
    if (!jdText.trim()) {
      setError('Paste a job description to continue.')
      return
    }

    setError('')
    setLoading(true)
    setSessionData(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) throw new Error('Not authenticated')

      const result = await createSession(session.user.id, jdText)
      setSessionData(result)
    } catch (err) {
      setError(err.message || 'Analysis failed. Try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleStartInterview = () => {
    if (!sessionData) return
    // Initialize AudioContext here (user gesture)
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 })
    }
    navigate(`/interview/${sessionData.session_id}`)
  }

  const profile = sessionData?.interview_profile

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
        <button
          onClick={() => navigate('/dashboard')}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', fontFamily: 'var(--font)', fontSize: '13px',
          }}
        >
          ← dashboard
        </button>
        <span style={{ color: 'var(--text-muted)', fontSize: '12px', letterSpacing: '0.05em' }}>
          new interview
        </span>
      </header>

      {/* Main two-column layout */}
      <main style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)',
        gap: '0',
        maxWidth: '1080px',
        margin: '0 auto',
        width: '100%',
        padding: '40px 24px',
        alignItems: 'start',
      }}
        className="jd-grid"
      >
        {/* Left: JD input */}
        <div style={{ paddingRight: '32px', borderRight: '1px solid var(--border)' }}>
          <div style={{
            fontSize: '11px', color: 'var(--text-muted)',
            letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '12px',
          }}>
            Job Description
          </div>

          <textarea
            value={jdText}
            onChange={e => setJdText(e.target.value)}
            placeholder="Paste the job description here..."
            rows={18}
            style={{
              width: '100%',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font)',
              fontSize: '13px',
              lineHeight: '1.6',
              padding: '16px',
              resize: 'vertical',
              outline: 'none',
              borderRadius: 0,
              transition: 'border-color 0.15s',
            }}
            onFocus={e => e.target.style.borderColor = 'var(--border-active)'}
            onBlur={e => e.target.style.borderColor = 'var(--border)'}
          />

          {error && (
            <div style={{
              marginTop: '8px',
              color: 'var(--danger)',
              fontSize: '12px',
              fontFamily: 'var(--font)',
            }}>
              [!] {error}
            </div>
          )}

          <div style={{ marginTop: '16px' }}>
            <Button
              variant="primary"
              onClick={handleAnalyze}
              disabled={loading || !jdText.trim()}
              style={{ width: '100%', justifyContent: 'center', padding: '12px' }}
            >
              {loading ? <>Analyzing <LoadingDots /></> : '$ analyze --jd'}
            </Button>
          </div>
        </div>

        {/* Right: Profile preview */}
        <div style={{ paddingLeft: '32px' }}>
          <div style={{
            fontSize: '11px', color: 'var(--text-muted)',
            letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '12px',
          }}>
            Profile Preview
          </div>

          {!sessionData && !loading && (
            <div style={{
              color: 'var(--text-muted)', fontSize: '13px',
              padding: '24px 0', fontFamily: 'var(--font)',
            }}>
              <span style={{ color: 'var(--text-secondary)' }}>{'>'}</span>{' '}
              Awaiting analysis
              <span style={{ animation: 'blink 1s step-end infinite', color: 'var(--accent)' }}>_</span>
            </div>
          )}

          {loading && (
            <div style={{ color: 'var(--text-muted)', fontSize: '13px', padding: '24px 0' }}>
              <span style={{ color: 'var(--accent)' }}>$</span> Analyzing <LoadingDots />
            </div>
          )}

          {profile && (
            <Terminal title="interview-profile.json" style={{ animation: 'slide-up 0.3s ease forwards' }}>
              <div style={{ fontSize: '13px' }}>
                <ProfileRow label="role" value={profile.role_title} />
                <ProfileRow label="level" value={
                  <Badge variant={profile.level === 'senior' ? 'warning' : profile.level === 'junior' ? 'neutral' : 'success'}>
                    {profile.level}
                  </Badge>
                } />
                <ProfileRow label="domain" value={profile.domain} />
                <ProfileRow label="company" value={profile.company_type} />
                <div style={{ marginBottom: '10px' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: '12px', display: 'block', marginBottom: '6px' }}>
                    tech_stack
                  </span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {profile.tech_stack?.map(tech => (
                      <span key={tech} style={{
                        border: '1px solid var(--border)',
                        padding: '2px 8px',
                        fontSize: '11px',
                        color: 'var(--text-secondary)',
                        background: 'var(--bg)',
                      }}>
                        {tech}
                      </span>
                    ))}
                  </div>
                </div>
                <div style={{ marginBottom: '10px' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: '12px', display: 'block', marginBottom: '6px' }}>
                    soft_skills
                  </span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {profile.soft_skill_signals?.map(s => (
                      <span key={s} style={{
                        border: '1px solid var(--border)',
                        padding: '2px 8px',
                        fontSize: '11px',
                        color: 'var(--text-muted)',
                      }}>
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
                <div style={{ marginTop: '4px' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>questions </span>
                  <span style={{ color: 'var(--accent)', fontSize: '12px' }}>
                    {sessionData.total_questions} planned
                  </span>
                </div>
              </div>
            </Terminal>
          )}

          {sessionData && (
            <div style={{ marginTop: '20px', animation: 'slide-up 0.3s ease 0.15s both' }}>
              <Button
                variant="primary"
                onClick={handleStartInterview}
                style={{
                  width: '100%',
                  justifyContent: 'center',
                  padding: '14px',
                  fontSize: '14px',
                  fontWeight: '700',
                }}
              >
                Start Interview →
              </Button>
            </div>
          )}
        </div>
      </main>

      <style>{`
        @media (max-width: 640px) {
          .jd-grid { grid-template-columns: 1fr !important; }
          .jd-grid > div:first-child { padding-right: 0 !important; border-right: none !important; border-bottom: 1px solid var(--border); padding-bottom: 24px; margin-bottom: 24px; }
          .jd-grid > div:last-child { padding-left: 0 !important; }
        }
      `}</style>
    </div>
  )
}
