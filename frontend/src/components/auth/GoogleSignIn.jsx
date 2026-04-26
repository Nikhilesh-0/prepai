import React, { useState } from 'react'
import { supabase } from '../../lib/supabase'

export default function GoogleSignIn() {
  const [loading, setLoading] = useState(false)

  const handleSignIn = async () => {
    setLoading(true)
    try {
      await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/dashboard`,
        },
      })
    } catch (err) {
      console.error('Sign in error:', err)
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleSignIn}
      disabled={loading}
      style={{
        fontFamily: 'var(--font)',
        background: 'transparent',
        border: '1px solid var(--accent)',
        color: 'var(--accent)',
        padding: '12px 24px',
        fontSize: '14px',
        cursor: loading ? 'not-allowed' : 'pointer',
        opacity: loading ? 0.6 : 1,
        letterSpacing: '0.02em',
        transition: 'all 0.15s ease',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
      }}
      onMouseEnter={(e) => {
        if (!loading) {
          e.currentTarget.style.background = 'var(--accent-dim)'
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
      }}
    >
      <span style={{ color: 'var(--text-muted)' }}>$</span>
      {loading ? (
        <>
          <span>authenticating</span>
          <span style={{ color: 'var(--text-muted)' }}>
            <span style={{ animation: 'blink 1s step-end infinite' }}>_</span>
          </span>
        </>
      ) : (
        <>
          <span>sign_in</span>
          <span style={{ color: 'var(--text-muted)' }}>--provider=google</span>
        </>
      )}
    </button>
  )
}
