import { useEffect, useRef, useState, useCallback } from 'react'
import { getWsUrl } from '../lib/api'

const MAX_RETRIES = 3
const BASE_DELAY = 1000

export default function useWebSocket(sessionId) {
  const wsRef = useRef(null)
  const [connectionState, setConnectionState] = useState('disconnected')
  const [lastMessage, setLastMessage] = useState(null)
  const retryCountRef = useRef(0)
  const retryTimerRef = useRef(null)
  const shouldReconnectRef = useRef(true)
  const onBinaryRef = useRef(null) // callback for binary frames

  const connect = useCallback(() => {
    if (!sessionId) return
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    const url = getWsUrl(sessionId)
    setConnectionState('connecting')

    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      setConnectionState('connected')
      retryCountRef.current = 0
    }

    ws.onmessage = (event) => {
      if (event.data instanceof Blob) {
        // Binary message — read as ArrayBuffer and dispatch
        event.data.arrayBuffer().then((buffer) => {
          if (onBinaryRef.current) {
            onBinaryRef.current(buffer)
          }
        })
        return
      }

      if (typeof event.data === 'string') {
        try {
          const parsed = JSON.parse(event.data)
          setLastMessage(parsed)
        } catch (e) {
          console.error('Failed to parse WS message:', e)
        }
      }
    }

    ws.onclose = (event) => {
      setConnectionState('disconnected')
      wsRef.current = null

      if (
        shouldReconnectRef.current &&
        retryCountRef.current < MAX_RETRIES &&
        event.code !== 1000 // normal closure
      ) {
        const delay = BASE_DELAY * Math.pow(2, retryCountRef.current)
        retryCountRef.current += 1
        retryTimerRef.current = setTimeout(connect, delay)
      }
    }

    ws.onerror = () => {
      setConnectionState('error')
    }
  }, [sessionId])

  useEffect(() => {
    shouldReconnectRef.current = true
    connect()

    return () => {
      shouldReconnectRef.current = false
      clearTimeout(retryTimerRef.current)
      if (wsRef.current) {
        wsRef.current.close(1000, 'Component unmounted')
        wsRef.current = null
      }
    }
  }, [connect])

  const sendMessage = useCallback((data) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data))
    } else {
      console.warn('WebSocket not connected, cannot send message')
    }
  }, [])

  const sendBinary = useCallback((data) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(data)
    }
  }, [])

  const onBinary = useCallback((handler) => {
    onBinaryRef.current = handler
  }, [])

  return {
    wsRef,
    connectionState,
    sendMessage,
    sendBinary,
    onBinary,
    lastMessage,
  }
}
