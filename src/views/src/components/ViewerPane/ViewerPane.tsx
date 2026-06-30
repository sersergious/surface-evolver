import { useRef, useEffect, useState, useMemo } from 'react'
import * as THREE from 'three'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { ArrowPathIcon, ChartBarIcon, CursorArrowRaysIcon, Cog6ToothIcon } from '@heroicons/react/24/outline'
import { useMesh } from '../../hooks/useMesh'
import { useQuantities } from '../../hooks/useQuantities'
import { useMenuAction } from '../../hooks/useMenuAction'
import { useThemeColors } from '../../hooks/useThemeColors'
import { useAppState } from '../../store/AppContext'
import { getVertexInfo, type MeshData, type VertexInfo } from '../../api/simulation'
import MeshGeometry, {
  EdgeLines, PickPoints, VertexMarker, BodyMarkers, RaycasterConfig, type RenderMode,
} from './MeshGeometry'
import QuantitiesPanel from './QuantitiesPanel'
import VertexInspector from './VertexInspector'
import SettingsPanel from './SettingsPanel'

const MODES: RenderMode[] = ['solid', 'wireframe', 'xray']
const MODE_LABEL: Record<RenderMode, string> = { solid: 'Solid', wireframe: 'Wire', xray: 'X-Ray' }

// Frames the camera on a new mesh. Runs *inside* the Canvas and reads the
// controls from R3F state (not a ref) so it re-fires once OrbitControls has
// mounted — otherwise the first load runs before controls exist, the orbit
// target stays at the origin, and you end up pivoting around a corner vertex.
function FitCamera({ mesh }: { mesh: MeshData | null }) {
  const camera = useThree(s => s.camera)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controls = useThree(s => s.controls) as any
  useEffect(() => {
    if (!controls || !mesh || mesh.vertices.length === 0) return
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(mesh.vertices.flat()), 3))
    geo.computeBoundingBox(); geo.computeBoundingSphere()
    const center = new THREE.Vector3()
    geo.boundingBox!.getCenter(center)
    const radius   = geo.boundingSphere!.radius || 1
    const distance = radius * 3.5
    camera.position.set(center.x + distance * 0.7, center.y + distance * 0.6, center.z + distance * 0.7)
    controls.target.copy(center)
    controls.update()
    controls.saveState()
    geo.dispose()
  }, [mesh, camera, controls])
  return null
}

export default function ViewerPane() {
  const { sessionId, setStats, setTotalTime, bumpMeshVersion } = useAppState()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controlsRef = useRef<any>(null)
  const [mode,      setMode]      = useState<RenderMode>('solid')
  const [showQuants, setShowQuants] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [inspect,    setInspect]    = useState(false)
  const [picked,     setPicked]     = useState<VertexInfo | null>(null)
  const [pickedPos,  setPickedPos]  = useState<number[] | null>(null)

  const { data: mesh, isFetching } = useMesh()
  const quantities = useQuantities(showQuants)
  const themeColors = useThemeColors()

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

  // Native View menu → render mode, panel toggles.
  useMenuAction(a => {
    if (!sessionId) return
    if (a.startsWith('render:'))      setMode(a.slice(7) as RenderMode)
    else if (a === 'panel:quants')    { setShowQuants(s => !s); setShowSettings(false) }
    else if (a === 'panel:settings')  { setShowSettings(s => !s); setShowQuants(false) }
    else if (a === 'panel:inspect')   { setInspect(i => !i); setPicked(null); setPickedPos(null) }
  })

  useEffect(() => {
    if (!sessionId) { setShowQuants(false); setShowSettings(false); setInspect(false) }
  }, [sessionId])

  // A picked vertex's position index goes stale when the mesh changes (refine,
  // iterate, etc.) — clear the selection so we never highlight the wrong vertex.
  useEffect(() => { setPicked(null); setPickedPos(null) }, [mesh])

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

      {/* Toolbar (top-left) */}
      <div className="absolute top-2 left-2 z-20 flex items-center gap-1">
        <button
          className="btn btn-xs bg-base-300/80 border-base-300 hover:bg-base-300 text-base-content"
          onClick={() => controlsRef.current?.reset()} title="Reset camera"
        ><ArrowPathIcon className="w-4 h-4" /></button>
        <button
          className="btn btn-xs bg-base-300/80 border-base-300 hover:bg-base-300 text-base-content"
          onClick={() => setMode(m => MODES[(MODES.indexOf(m) + 1) % MODES.length])}
          title="Cycle render mode"
        >{MODE_LABEL[mode]}</button>
        <button
          className={`btn btn-xs border-base-300 text-base-content ${showQuants ? 'bg-base-300' : 'bg-base-300/80 hover:bg-base-300'}`}
          onClick={() => { setShowQuants(s => !s); setShowSettings(false) }}
          disabled={!sessionId}
          title="Quantities & energy breakdown"
        ><ChartBarIcon className="w-4 h-4" /></button>
        <button
          className={`btn btn-xs border-base-300 text-base-content ${inspect ? 'bg-base-300' : 'bg-base-300/80 hover:bg-base-300'}`}
          onClick={() => { setInspect(i => !i); setPicked(null); setPickedPos(null) }}
          disabled={!sessionId}
          title="Inspect: click a vertex; show body centroids"
        ><CursorArrowRaysIcon className="w-4 h-4" /></button>
        <button
          className={`btn btn-xs border-base-300 text-base-content ${showSettings ? 'bg-base-300' : 'bg-base-300/80 hover:bg-base-300'}`}
          onClick={() => { setShowSettings(s => !s); setShowQuants(false) }}
          disabled={!sessionId}
          title="Mesh & physics settings"
        ><Cog6ToothIcon className="w-4 h-4" /></button>
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
        <div className="absolute bottom-3 right-3 z-30 badge bg-base-300/80 border-base-300 text-base-content text-[10px] pointer-events-none">
          Click a vertex to inspect
        </div>
      )}

      {/* Mesh stats (bottom-left — bottom-right is the Inspect panel's spot) */}
      {mesh && (
        <div className="absolute bottom-3 left-3 z-20 badge bg-base-300/80 border-base-300 text-base-content font-mono text-[10px] pointer-events-none">
          {mesh.vertices.length.toLocaleString()} v · {mesh.edges.length.toLocaleString()} e · {mesh.facets.length.toLocaleString()} f
        </div>
      )}

      <Canvas style={{ height: '100%' }} camera={{ position: [2.5, 2, 2.5], fov: 40 }} gl={{ antialias: true, alpha: true }}>
        <ambientLight intensity={0.35} />
        <directionalLight position={[4, 8, 4]} intensity={0.9} />
        <directionalLight position={[-4, -2, -4]} intensity={0.2} color="#4488cc" />
        {mesh && mesh.facets.length > 0 && (
          <MeshGeometry mesh={mesh} mode={mode} elementColors themeColors={themeColors} />
        )}
        {mesh && mesh.facets.length === 0 && mesh.edges.length > 0 && (
          <EdgeLines mesh={mesh} themeColors={themeColors} />
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
        <FitCamera mesh={mesh} />
      </Canvas>
    </div>
  )
}
