import { useRef, useEffect, useState, useMemo } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useMesh, type ColorMode, type ColorScalars } from '../../hooks/useMesh'
import { useQuantities } from '../../hooks/useQuantities'
import { useMenuAction } from '../../hooks/useMenuAction'
import { useAppState } from '../../store/AppContext'
import { getVertexInfo, type VertexInfo } from '../../api/simulation'
import MeshGeometry, {
  EdgeLines, PickPoints, VertexMarker, BodyMarkers, RaycasterConfig, type RenderMode,
} from './MeshGeometry'
import QuantitiesPanel from './QuantitiesPanel'
import VertexInspector from './VertexInspector'
import SettingsPanel from './SettingsPanel'

const MODES: RenderMode[] = ['solid', 'wireframe', 'xray']
const MODE_LABEL: Record<RenderMode, string> = { solid: 'Solid', wireframe: 'Wire', xray: 'X-Ray' }

const COLOR_MODES: { value: ColorMode; label: string }[] = [
  { value: 'none',               label: 'Color: Off'      },
  { value: 'height',             label: 'Height Z'        },
  { value: 'mean_curvature',     label: 'Mean Curv. |H|'  },
  { value: 'gaussian_curvature', label: 'Gauss Curv. K'   },
  { value: 'energy_density',     label: 'Energy Density'  },
  { value: 'star_area',          label: 'Star Area'       },
  { value: 'valence',            label: 'Valence'         },
  { value: 'force',              label: 'Force |∇E|'      },
  { value: 'se_colors',          label: 'SE Colors'       },
]

const LEGEND_GRADIENT = 'linear-gradient(to right, rgb(64,104,224), rgb(245,245,245), rgb(183,6,38))'

function fmtScalar(v: number): string {
  if (!isFinite(v)) return '—'
  if (Math.abs(v) >= 1000 || (Math.abs(v) < 0.001 && v !== 0)) return v.toExponential(2)
  return v.toPrecision(4).replace(/\.?0+$/, '')
}

function Legend({ scalars, label }: { scalars: ColorScalars; label: string }) {
  return (
    <div className="absolute bottom-10 left-3 z-20 pointer-events-none select-none">
      <div className="text-[10px] text-base-content/40 mb-1">{label}</div>
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-mono text-base-content/60">{fmtScalar(scalars.min)}</span>
        <div className="w-24 h-2.5 rounded border border-base-content/10" style={{ background: LEGEND_GRADIENT }} />
        <span className="text-[10px] font-mono text-base-content/60">{fmtScalar(scalars.max)}</span>
      </div>
    </div>
  )
}

export default function ViewerPane() {
  const { sessionId, jobProgress, vertexAttributes, setStats, setTotalTime, bumpMeshVersion } = useAppState()

  // Built-in colour modes + one entry per user-defined vertex attribute.
  const colorModes = useMemo(
    () => [...COLOR_MODES, ...vertexAttributes.map(a => ({ value: `attr:${a}` as ColorMode, label: `Attr: ${a}` }))],
    [vertexAttributes],
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controlsRef = useRef<any>(null)
  const [mode,      setMode]      = useState<RenderMode>('solid')
  const [colorMode, setColorMode] = useState<ColorMode>('none')
  const [showQuants, setShowQuants] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [inspect,    setInspect]    = useState(false)
  const [picked,     setPicked]     = useState<VertexInfo | null>(null)
  const [pickedPos,  setPickedPos]  = useState<number[] | null>(null)

  const { data: mesh, isFetching, colorScalars } = useMesh(colorMode)
  const quantities = useQuantities(showQuants)

  // Characteristic mesh size → raycaster threshold + marker radii (scale-aware).
  const meshRadius = useMemo(() => {
    if (!mesh || mesh.vertices.length === 0) return 1
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
    for (const v of mesh.vertices) for (let k = 0; k < 3; k++) {
      if (v[k] < lo[k]) lo[k] = v[k]; if (v[k] > hi[k]) hi[k] = v[k]
    }
    return Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1
  }, [mesh])

  async function handlePick(vpos: number) {
    if (!sessionId || !mesh) return
    setPickedPos(mesh.vertices[vpos] ?? null)
    try { setPicked(await getVertexInfo(sessionId, vpos)) }
    catch { setPicked(null) }
  }

  useEffect(() => {
    if (!controlsRef.current || !mesh) return
    const positions = new Float32Array(mesh.vertices.flat())
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.computeBoundingBox(); geo.computeBoundingSphere()
    const center = new THREE.Vector3()
    geo.boundingBox!.getCenter(center)
    const radius   = geo.boundingSphere!.radius || 1
    const distance = radius * 3.5
    const camera   = controlsRef.current.object as THREE.Camera
    camera.position.set(center.x + distance * 0.7, center.y + distance * 0.6, center.z + distance * 0.7)
    controlsRef.current.target.copy(center)
    controlsRef.current.update()
    controlsRef.current.saveState()
    geo.dispose()
  }, [mesh])

  // Native View menu → colour mode, render mode, panel toggles.
  useMenuAction(a => {
    if (!sessionId) return
    if (a.startsWith('color:'))       setColorMode(a.slice(6) as ColorMode)
    else if (a.startsWith('render:')) setMode(a.slice(7) as RenderMode)
    else if (a === 'panel:quants')    { setShowQuants(s => !s); setShowSettings(false) }
    else if (a === 'panel:settings')  { setShowSettings(s => !s); setShowQuants(false) }
    else if (a === 'panel:inspect')   { setInspect(i => !i); setPicked(null); setPickedPos(null) }
  })

  useEffect(() => {
    if (!sessionId) { setColorMode('none'); setShowQuants(false); setShowSettings(false); setInspect(false) }
  }, [sessionId])

  // Reset to a valid mode if the selected custom attribute isn't in this surface.
  useEffect(() => {
    if (colorMode.startsWith('attr:') && !colorModes.some(m => m.value === colorMode))
      setColorMode('none')
  }, [colorModes, colorMode])

  // A picked vertex's position index goes stale when the mesh changes (refine,
  // iterate, etc.) — clear the selection so we never highlight the wrong vertex.
  useEffect(() => { setPicked(null); setPickedPos(null) }, [mesh])

  const progressPct = jobProgress
    ? Math.round((jobProgress.step / jobProgress.total) * 100)
    : null

  const colorLabel = colorModes.find(m => m.value === colorMode)?.label ?? ''

  return (
    <div className="relative h-full bg-base-100 min-w-0">

      {/* Empty state */}
      {!sessionId && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="badge badge-ghost badge-lg text-base-content/40">Select a .fe file to begin</div>
        </div>
      )}
      {sessionId && mesh && mesh.facets.length === 0 && mesh.edges.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="badge badge-ghost badge-lg text-base-content/40">No geometry in this model</div>
        </div>
      )}

      {/* Fetching indicator */}
      {isFetching && (
        <div className="absolute top-2.5 right-3 z-20 badge badge-neutral gap-1 pointer-events-none">
          <span className="loading loading-xs loading-dots" />
          Loading
        </div>
      )}

      {/* Progress bar */}
      {progressPct !== null && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-base-300 z-20">
          <div className="h-full bg-primary transition-[width] duration-200" style={{ width: `${progressPct}%` }} />
        </div>
      )}

      {/* Toolbar (top-left) */}
      <div className="absolute top-2 left-2 z-20 flex items-center gap-1">
        <button
          className="btn btn-xs bg-base-300/80 border-base-300 hover:bg-base-300 text-base-content"
          onClick={() => controlsRef.current?.reset()} title="Reset camera"
        >↺</button>
        <button
          className="btn btn-xs bg-base-300/80 border-base-300 hover:bg-base-300 text-base-content"
          onClick={() => setMode(m => MODES[(MODES.indexOf(m) + 1) % MODES.length])}
          title="Cycle render mode"
        >{MODE_LABEL[mode]}</button>
        <select
          value={colorMode}
          onChange={e => setColorMode(e.target.value as ColorMode)}
          className="select select-xs bg-base-300/80 border-base-300 text-base-content min-h-0 h-6 py-0 pr-6 pl-2 text-xs"
          title="Scalar colour field"
        >
          {colorModes.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <button
          className={`btn btn-xs border-base-300 text-base-content ${showQuants ? 'bg-base-300' : 'bg-base-300/80 hover:bg-base-300'}`}
          onClick={() => { setShowQuants(s => !s); setShowSettings(false) }}
          disabled={!sessionId}
          title="Quantities & energy breakdown"
        >Σ</button>
        <button
          className={`btn btn-xs border-base-300 text-base-content ${inspect ? 'bg-base-300' : 'bg-base-300/80 hover:bg-base-300'}`}
          onClick={() => { setInspect(i => !i); setPicked(null); setPickedPos(null) }}
          disabled={!sessionId}
          title="Inspect: click a vertex; show body centroids"
        >⊙</button>
        <button
          className={`btn btn-xs border-base-300 text-base-content ${showSettings ? 'bg-base-300' : 'bg-base-300/80 hover:bg-base-300'}`}
          onClick={() => { setShowSettings(s => !s); setShowQuants(false) }}
          disabled={!sessionId}
          title="Mesh & physics settings"
        >⚙</button>
      </div>

      {showQuants && quantities && (
        <QuantitiesPanel data={quantities} onClose={() => setShowQuants(false)} />
      )}

      {showSettings && sessionId && (
        <SettingsPanel
          sessionId={sessionId}
          onClose={() => setShowSettings(false)}
          onApplied={(energy, area, totalTime) => { setStats(energy, area); setTotalTime(totalTime); bumpMeshVersion() }}
        />
      )}

      {inspect && picked && (
        <VertexInspector info={picked} onClose={() => { setPicked(null); setPickedPos(null) }} />
      )}
      {inspect && !picked && mesh && (
        <div className="absolute bottom-3 right-3 z-30 badge badge-neutral text-[10px] pointer-events-none">
          Click a vertex to inspect
        </div>
      )}

      {/* Colour legend */}
      {colorScalars && colorMode !== 'none' && <Legend scalars={colorScalars} label={colorLabel} />}

      {/* Mesh stats (bottom-right) */}
      {mesh && (
        <div className="absolute bottom-2 right-2 z-20 badge badge-neutral font-mono text-[10px] pointer-events-none">
          {mesh.vertices.length.toLocaleString()} v · {mesh.edges.length.toLocaleString()} e · {mesh.facets.length.toLocaleString()} f
        </div>
      )}

      <Canvas style={{ height: '100%' }} camera={{ position: [2.5, 2, 2.5], fov: 40 }} gl={{ antialias: true, alpha: true }}>
        <ambientLight intensity={0.35} />
        <directionalLight position={[4, 8, 4]} intensity={0.9} />
        <directionalLight position={[-4, -2, -4]} intensity={0.2} color="#4488cc" />
        {mesh && mesh.facets.length > 0 && (
          <MeshGeometry mesh={mesh} mode={mode} colorScalars={colorScalars} elementColors={colorMode === 'se_colors'} />
        )}
        {mesh && mesh.facets.length === 0 && mesh.edges.length > 0 && (
          <EdgeLines mesh={mesh} colorScalars={colorScalars} />
        )}
        {inspect && mesh && (
          <>
            <RaycasterConfig threshold={meshRadius * 0.02} />
            <PickPoints mesh={mesh} onPick={handlePick} />
            {mesh.body_cms && mesh.body_cms.some(Boolean) &&
              <BodyMarkers cms={mesh.body_cms} radius={meshRadius * 0.02} />}
            {pickedPos && <VertexMarker position={pickedPos} radius={meshRadius * 0.025} />}
          </>
        )}
        <OrbitControls ref={controlsRef} makeDefault />
      </Canvas>
    </div>
  )
}
