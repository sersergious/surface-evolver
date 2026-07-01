import { useState, useEffect } from 'react'
import { getMesh, type MeshData } from '../api/simulation'
import { useStore } from '../store/useStore'

// Fetches the mesh (with native SE per-element colours) for the active session,
// refetching whenever the surface changes (meshVersion bump).
export function useMesh() {
  const { sessionId, meshVersion, appendLog } = useStore()
  const [data, setData]             = useState<MeshData | null>(null)
  const [isFetching, setIsFetching] = useState(false)

  useEffect(() => {
    if (!sessionId) { setData(null); return }
    let cancelled = false
    setIsFetching(true)
    getMesh(sessionId)
      .then(mesh  => { if (!cancelled) setData(mesh) })
      .catch((err: unknown) => {
        if (cancelled) return
        setData(null)
        appendLog(`[error] mesh fetch failed: ${err instanceof Error ? err.message : String(err)}`)
      })
      .finally(() => { if (!cancelled) setIsFetching(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, meshVersion])

  return { data, isFetching }
}
