import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getSessions } from '../lib/api'
import StatsBar from '../components/dashboard/StatsBar'
import SessionCard from '../components/dashboard/SessionCard'
import Button from '../components/ui/Button'

export default function Dashboard() {
  const navigate = useNavigate()
  const [user, setUser] = useState(null)
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user)
        loadSessions(session.user.id)
      }
    })
  }, [])

  const loadSessions = async (userId) => {
    try {
      const data = await getSessions(userId)
      setSessions(data.sessions || [])
    } catch (err) {
      console.error('Failed to load sessions:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    navigate('/')
  }

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

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {user?.user_metadata?.avatar_url && (
            <img
              src={user.user_metadata.avatar_url}
              alt="avatar"
              style={{ width: 24, height: 24, borderRadius: '50%', border: '1px solid var(--border)' }}
            />
          )}
          <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
            {user?.email}
          </span>
          <button
            onClick={handleSignOut}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              fontFamily: 'var(--font)',
              fontSize: '12px',
              cursor: 'pointer',
              padding: '4px 8px',
            }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--text-secondary)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
          >
            $ exit
          </button>
        </div>
      </header>

      {/* Main */}
      <main style={{
        flex: 1,
        maxWidth: '860px',
        width: '100%',
        margin: '0 auto',
        padding: '40px 24px',
      }}>
        {/* Stats */}
        {!loading && <StatsBar sessions={sessions} />}

        {/* Sessions header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
        }}>
          <span style={{
            fontSize: '11px',
            color: 'var(--text-muted)',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}>
            Interview Sessions
          </span>
          <Button variant="primary" onClick={() => navigate('/new')} style={{ fontSize: '12px' }}>
            + new interview
          </Button>
        </div>

        {/* Session list */}
        {loading ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '13px', padding: '24px 0' }}>
            <span style={{ color: 'var(--accent)' }}>$</span> loading sessions
            <span style={{ animation: 'blink 1s step-end infinite' }}>_</span>
          </div>
        ) : sessions.length === 0 ? (
          <div style={{
            border: '1px solid var(--border)',
            padding: '32px',
            color: 'var(--text-muted)',
            fontSize: '13px',
            lineHeight: '1.8',
          }}>
            <span style={{ color: 'var(--text-secondary)' }}>{'>'}</span>{' '}
            No interviews found. Run your first session.
            <span style={{ animation: 'blink 1s step-end infinite', color: 'var(--accent)' }}>_</span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
            {sessions.map(session => (
              <SessionCard key={session.id} session={session} />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
