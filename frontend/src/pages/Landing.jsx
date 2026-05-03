import React, { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import GoogleSignIn from '../components/auth/GoogleSignIn'

export default function Landing() {
  const navigate = useNavigate()

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        navigate('/dashboard', { replace: true })
      }
    })
  }, [navigate])

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg)',
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Scanlines */}
      <div className="scanlines" />

      {/* Nav */}
      <nav style={{
        padding: '20px 32px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: '1px solid var(--border)',
        position: 'relative',
        zIndex: 1,
      }}>
        <span style={{
          fontFamily: 'var(--font)',
          fontWeight: '700',
          fontSize: '14px',
          color: 'var(--text-primary)',
          letterSpacing: '0.05em',
        }}>
          <span style={{ color: 'var(--accent)' }}>prep</span>ai
        </span>
        <span style={{
          fontFamily: 'var(--font)',
          fontSize: '11px',
          color: 'var(--text-muted)',
          letterSpacing: '0.08em',
        }}>
          v0.1.0
        </span>
      </nav>

      {/* Hero */}
      <main style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 24px',
        position: 'relative',
        zIndex: 1,
        gap: '32px',
      }}>
        {/* Badge */}
        <div style={{
          border: '1px solid var(--accent)',
          color: 'var(--accent)',
          padding: '4px 12px',
          fontSize: '11px',
          letterSpacing: '0.12em',
          fontFamily: 'var(--font)',
        }}>
          [ AI MOCK INTERVIEWER ]
        </div>

        {/* Headline */}
        <div style={{ textAlign: 'center' }}>
          <h1 style={{
            fontFamily: 'var(--font)',
            fontWeight: '700',
            fontSize: 'clamp(32px, 6vw, 64px)',
            color: 'var(--text-primary)',
            lineHeight: '1.1',
            margin: 0,
            letterSpacing: '-0.02em',
          }}>
            Prepare Smarter.<br />
            <span style={{ color: 'var(--accent)' }}>Interview Better.</span>
          </h1>
        </div>

        {/* Subline */}
        <p style={{
          fontFamily: 'var(--font)',
          fontSize: '14px',
          color: 'var(--text-secondary)',
          textAlign: 'center',
          margin: 0,
          maxWidth: '420px',
          lineHeight: '1.6',
        }}>
          Paste a job description. Speak your answers. Get scored.
        </p>

        {/* CTA */}
        <GoogleSignIn />

        {/* Feature tags */}
        <div style={{
          display: 'flex',
          gap: '24px',
          flexWrap: 'wrap',
          justifyContent: 'center',
          marginTop: '8px',
        }}>
          {['[ voice-first ]', '[ real-time feedback ]', '[ JD-tailored ]'].map(tag => (
            <span key={tag} style={{
              fontFamily: 'var(--font)',
              fontSize: '12px',
              color: 'var(--text-muted)',
              letterSpacing: '0.04em',
            }}>
              {tag}
            </span>
          ))}
        </div>
      </main>

      {/* Footer */}
      <footer style={{
        padding: '20px 32px',
        borderTop: '1px solid var(--border)',
        textAlign: 'center',
        position: 'relative',
        zIndex: 1,
      }}>
        <span style={{
          fontFamily: 'var(--font)',
          fontSize: '11px',
          color: 'var(--text-muted)',
          letterSpacing: '0.05em',
        }}>
          Built with{' '}
          <span style={{ color: 'var(--text-secondary)' }}>Groq</span>
          {' · '}
          <span style={{ color: 'var(--text-secondary)' }}>Cartesia</span>
          {' · '}
          <span style={{ color: 'var(--text-secondary)' }}>Supabase</span>
        </span>
      </footer>
    </div>
  )
}
