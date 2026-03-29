import { useEffect, useRef } from 'react'
import useStore from '../store/useStore'

export function useProgressWS(sessionId: string | null) {
  const { appendLog, setStats, setJobProgress, clearJob, bumpMeshVersion } = useStore()
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    if (!sessionId) return

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${protocol}://${window.location.host}/api/v1/ws/sessions/${sessionId}/progress`)
    wsRef.current = ws

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

    return () => {
      ws.close()
      wsRef.current = null
    }
  }, [sessionId])
}
