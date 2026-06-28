import { useRef, useEffect, useState } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useMesh, type ColorMode, type ColorScalars } from '../../hooks/useMesh'
import { useAppState } from '../../store/AppContext'
import MeshGeometry, { type RenderMode } from './MeshGeometry'

const MODES: RenderMode[] = ['solid', 'wireframe', 'xray']
const MODE_LABEL: Record<RenderMode, string> = { solid: 'Solid', wireframe: 'Wire', xray: 'X-Ray' }

const COLOR_MODES: { value: ColorMode; label: string }[] = [
  { value: 'none',           label: 'Color: Off'      },
  { value: 'height',         label: 'Height Z'        },
  { value: 'mean_curvature', label: 'Mean Curv. |H|'  },
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
  const { sessionId, jobProgress } = useAppState()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controlsRef = useRef<any>(null)
  const [mode,      setMode]      = useState<RenderMode>('solid')
  const [colorMode, setColorMode] = useState<ColorMode>('none')

  const { data: mesh, isFetching, colorScalars } = useMesh(colorMode)

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

  useEffect(() => { if (!sessionId) setColorMode('none') }, [sessionId])

  const progressPct = jobProgress
    ? Math.round((jobProgress.step / jobProgress.total) * 100)
    : null

  const colorLabel = COLOR_MODES.find(m => m.value === colorMode)?.label ?? ''

  return (
    <div className="relative h-full bg-base-100 min-w-0">

      {/* Empty state */}
      {!sessionId && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="badge badge-ghost badge-lg text-base-content/40">Select a .fe file to begin</div>
        </div>
      )}
      {sessionId && mesh && mesh.facets.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="badge badge-ghost badge-lg text-base-content/40">No surface — non-triangulated model</div>
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
          {COLOR_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </div>

      {/* Colour legend */}
      {colorScalars && colorMode !== 'none' && <Legend scalars={colorScalars} label={colorLabel} />}

      {/* Mesh stats (bottom-right) */}
      {mesh && (
        <div className="absolute bottom-2 right-2 z-20 badge badge-neutral font-mono text-[10px] pointer-events-none">
          {mesh.vertices.length.toLocaleString()} v · {mesh.facets.length.toLocaleString()} f
        </div>
      )}

      <Canvas style={{ height: '100%' }} camera={{ position: [2.5, 2, 2.5], fov: 40 }} gl={{ antialias: true, alpha: true }}>
        <ambientLight intensity={0.35} />
        <directionalLight position={[4, 8, 4]} intensity={0.9} />
        <directionalLight position={[-4, -2, -4]} intensity={0.2} color="#4488cc" />
        {mesh && mesh.facets.length > 0 && (
          <MeshGeometry mesh={mesh} mode={mode} colorScalars={colorScalars} />
        )}
        <OrbitControls ref={controlsRef} makeDefault />
      </Canvas>
    </div>
  )
}
