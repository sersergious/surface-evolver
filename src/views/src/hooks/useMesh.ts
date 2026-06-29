import { useState, useEffect, useMemo } from 'react'
import { getMesh, type MeshData } from '../api/simulation'
import { useAppState } from '../store/AppContext'

export type ColorMode =
  | 'none' | 'height'
  | 'mean_curvature' | 'gaussian_curvature' | 'valence'
  | 'star_area' | 'force' | 'energy_density'

// Modes computed server-side: the value doubles as the `scalars` query param
// (must match the C dispatch keys in se-worker.ts). 'height' is derived locally.
const SERVER_SCALARS: ReadonlySet<ColorMode> = new Set([
  'mean_curvature', 'gaussian_curvature', 'valence', 'star_area', 'force', 'energy_density',
])

export interface ColorScalars {
  values: number[]
  min:    number
  max:    number
}

export function useMesh(colorMode: ColorMode = 'none') {
  const { sessionId, meshVersion } = useAppState()
  const [data, setData]           = useState<MeshData | null>(null)
  const [isFetching, setIsFetching] = useState(false)

  // Server-computed modes round-trip; 'none'/'height' need no scalar fetch.
  const apiScalars = SERVER_SCALARS.has(colorMode) ? colorMode : undefined

  useEffect(() => {
    if (!sessionId) { setData(null); return }
    let cancelled = false
    setIsFetching(true)
    getMesh(sessionId, apiScalars)
      .then(mesh  => { if (!cancelled) setData(mesh) })
      .catch(()   => { if (!cancelled) setData(null) })
      .finally(() => { if (!cancelled) setIsFetching(false) })
    return () => { cancelled = true }
  }, [sessionId, meshVersion, apiScalars])

  const colorScalars = useMemo<ColorScalars | null>(() => {
    if (!data || colorMode === 'none') return null

    let values: number[]
    if (colorMode === 'height') {
      values = data.vertices.map(v => v[2])
    } else if (SERVER_SCALARS.has(colorMode) && data.scalar_values?.length) {
      values = data.scalar_values
    } else {
      return null
    }

    // Avoid spread for large arrays (stack overflow risk)
    let min = Infinity, max = -Infinity
    for (const v of values) { if (v < min) min = v; if (v > max) max = v }

    return { values, min, max }
  }, [data, colorMode])

  return { data, isFetching, colorScalars }
}
