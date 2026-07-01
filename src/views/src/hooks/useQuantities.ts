import { useState, useEffect } from 'react'
import { getQuantities, type QuantitiesData } from '../api/simulation'
import { useAppState } from '../store/AppContext'

// Fetches named quantities + method-instance energy breakdown, refreshing
// whenever the surface changes (meshVersion bump after run/iterate/topo).
export function useQuantities(enabled: boolean) {
  const { sessionId, meshVersion } = useAppState()
  const [data, setData] = useState<QuantitiesData | null>(null)

  useEffect(() => {
    if (!sessionId || !enabled) { setData(null); return }
    let cancelled = false
    getQuantities(sessionId)
      .then(d => { if (!cancelled) setData(d) })
      .catch(() => { if (!cancelled) setData(null) })
    return () => { cancelled = true }
  }, [sessionId, meshVersion, enabled])

  return data
}
