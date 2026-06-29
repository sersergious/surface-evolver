import { useState, useEffect, useMemo } from 'react'
import { getMesh, type MeshData } from '../api/simulation'
import { useAppState } from '../store/AppContext'

export type ColorMode =
  | 'none' | 'height'
  | 'mean_curvature' | 'gaussian_curvature' | 'valence'
  | 'star_area' | 'force' | 'energy_density'
  | 'se_colors'                 // per-facet SE colour-table indices (not a scalar)
  | `attr:${string}`            // a user-defined vertex attribute

// Built-in modes computed server-side: the value doubles as the `scalars` query
// param (must match the C dispatch keys in se-worker.ts). 'height' is local.
const SERVER_SCALARS: ReadonlySet<string> = new Set([
  'mean_curvature', 'gaussian_curvature', 'valence', 'star_area', 'force', 'energy_density',
])

// A mode that produces per-vertex scalar values fetched from the server
// (built-in scalars + any "attr:NAME" custom vertex attribute).
function isServerScalar(mode: ColorMode): boolean {
  return SERVER_SCALARS.has(mode) || mode.startsWith('attr:')
}

export interface ColorScalars {
  values: number[]
  min:    number
  max:    number
}

export function useMesh(colorMode: ColorMode = 'none') {
  const { sessionId, meshVersion } = useAppState()
  const [data, setData]           = useState<MeshData | null>(null)
  const [isFetching, setIsFetching] = useState(false)

  const apiScalars = isServerScalar(colorMode) ? colorMode : undefined
  const apiColors  = colorMode === 'se_colors'

  useEffect(() => {
    if (!sessionId) { setData(null); return }
    let cancelled = false
    setIsFetching(true)
    getMesh(sessionId, apiScalars, apiColors)
      .then(mesh  => { if (!cancelled) setData(mesh) })
      .catch(()   => { if (!cancelled) setData(null) })
      .finally(() => { if (!cancelled) setIsFetching(false) })
    return () => { cancelled = true }
  }, [sessionId, meshVersion, apiScalars, apiColors])

  const colorScalars = useMemo<ColorScalars | null>(() => {
    if (!data || colorMode === 'none' || colorMode === 'se_colors') return null

    let values: number[]
    if (colorMode === 'height') {
      values = data.vertices.map(v => v[2])
    } else if (isServerScalar(colorMode) && data.scalar_values?.length) {
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
