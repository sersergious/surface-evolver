import { useEffect, useRef } from 'react'
import useStore from '../store/useStore'

const BACKOFF_DELAYS = [1000, 2000, 4000, 8000]

export function useProgressWS(sessionId: string | null) {
  const { appendLog, setStats, setJobProgress, clearJob, bumpMeshVersion } = useStore()
  const wsRef    = useRef<WebSocket | null>(null)
  const attempt  = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!sessionId) return

    function connect() {
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(
        `${protocol}://${window.location.host}/api/v1/ws/sessions/${sessionId}/progress`
      )
      wsRef.current = ws

      ws.onopen = () => {
        attempt.current = 0
      }

      ws.onmessage = (event) => {
        let msg: { type: string; step?: number; total?: number; energy?: number; message?: string }
        try {
          msg = JSON.parse(event.data)
        } catch {
          return
        }
        if (msg.type === 'progress' && msg.step !== undefined && msg.total !== undefined) {
          setJobProgress(msg.step, msg.total)
          if (msg.energy !== undefined) setStats(msg.energy, null)
        } else if (msg.type === 'completed') {
          if (msg.energy !== undefined) setStats(msg.energy, null)
          clearJob()
          bumpMeshVersion()
        } else if (msg.type === 'error') {
          appendLog(`[error] ${msg.message ?? 'unknown error'}`)
          clearJob()
        }
      }

      ws.onerror = () => appendLog('[ws] connection error')

      ws.onclose = (event) => {
        if (event.wasClean) return
        if (attempt.current >= BACKOFF_DELAYS.length) {
          appendLog('[ws] reconnection failed after maximum attempts')
          return
        }
        const delay = BACKOFF_DELAYS[attempt.current]
        appendLog(
          `[ws] disconnected — reconnecting in ${delay / 1000}s` +
          ` (attempt ${attempt.current + 1}/${BACKOFF_DELAYS.length})`
        )
        attempt.current += 1
        timerRef.current = setTimeout(connect, delay)
      }
    }

    connect()

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      wsRef.current?.close()
      wsRef.current = null
      attempt.current = 0
    }
  }, [sessionId])
}
