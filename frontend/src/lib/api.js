const BASE_URL = import.meta.env.VITE_BACKEND_URL || ''

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(error.detail || `Request failed: ${res.status}`)
  }

  return res.json()
}

export async function createSession(userId, jdText) {
  return request('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, jd_text: jdText }),
  })
}

export async function getSessions(userId) {
  return request(`/api/sessions/${userId}`)
}

export async function getScorecard(sessionId) {
  return request(`/api/scorecard/${sessionId}`)
}

export function getWsUrl(sessionId) {
  const wsBase = import.meta.env.VITE_WS_URL || ''
  if (wsBase) {
    return `${wsBase}/ws/interview/${sessionId}`
  }
  // Dev fallback — Vite proxy handles /ws
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws/interview/${sessionId}`
}
