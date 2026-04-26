import React, { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { supabase } from './lib/supabase'
import Landing from './pages/Landing'
import Dashboard from './pages/Dashboard'
import JDInput from './pages/JDInput'
import Interview from './pages/Interview'
import Scorecard from './pages/Scorecard'

function AuthGuard({ children }) {
  const [session, setSession] = useState(undefined)
  const location = useLocation()

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => subscription.unsubscribe()
  }, [])

  // Loading state
  if (session === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
        <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font)' }}>
          <span style={{ color: 'var(--accent)' }}>$</span> authenticating
          <span className="cursor-blink">_</span>
        </span>
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/" state={{ from: location }} replace />
  }

  return children
}

class InterviewErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    console.error('Interview error boundary caught:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center gap-4" style={{ background: 'var(--bg)' }}>
          <div style={{
            border: '1px solid var(--danger)',
            padding: '24px',
            maxWidth: '480px',
            width: '100%',
            margin: '0 16px',
          }}>
            <p style={{ color: 'var(--danger)', marginBottom: '8px' }}>[ERROR] Interview session crashed</p>
            <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '16px' }}>
              {this.state.error?.message || 'Unknown error'}
            </p>
            <button
              onClick={() => window.location.href = '/dashboard'}
              style={{
                background: 'transparent',
                border: '1px solid var(--border-active)',
                color: 'var(--text-primary)',
                padding: '8px 16px',
                cursor: 'pointer',
                fontFamily: 'var(--font)',
              }}
            >
              ← back to dashboard
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/dashboard" element={
          <AuthGuard><Dashboard /></AuthGuard>
        } />
        <Route path="/new" element={
          <AuthGuard><JDInput /></AuthGuard>
        } />
        <Route path="/interview/:sessionId" element={
          <AuthGuard>
            <InterviewErrorBoundary>
              <Interview />
            </InterviewErrorBoundary>
          </AuthGuard>
        } />
        <Route path="/scorecard/:sessionId" element={
          <AuthGuard><Scorecard /></AuthGuard>
        } />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
