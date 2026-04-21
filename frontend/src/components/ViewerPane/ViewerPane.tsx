import { useRef, useEffect, useState } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useMesh } from '../../hooks/useMesh'
import useStore from '../../store/useStore'
import MeshGeometry, { type RenderMode } from './MeshGeometry'

const MODES: RenderMode[] = ['solid', 'wireframe', 'xray']
const MODE_LABEL: Record<RenderMode, string> = { solid: 'Solid', wireframe: 'Wire', xray: 'X-Ray' }

export default function ViewerPane() {
  const sessionId = useStore((s) => s.sessionId)
  const jobProgress = useStore((s) => s.jobProgress)
  const { data: mesh, isFetching } = useMesh()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controlsRef = useRef<any>(null)
  const [mode, setMode] = useState<RenderMode>('solid')
  const cycleMode = () => setMode((m) => MODES[(MODES.indexOf(m) + 1) % MODES.length])

  useEffect(() => {
    if (!controlsRef.current || !mesh) return
    const positions = new Float32Array(mesh.vertices.flat())
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.computeBoundingBox()
    geo.computeBoundingSphere()
    const center = new THREE.Vector3()
    geo.boundingBox!.getCenter(center)
    const radius = geo.boundingSphere!.radius || 1
    geo.dispose()

    // Frame the mesh: pull camera back along a fixed direction from center
    const distance = radius * 3.5
    const camera = controlsRef.current.object as THREE.Camera
    camera.position.set(
      center.x + distance * 0.7,
      center.y + distance * 0.6,
      center.z + distance * 0.7,
    )
    controlsRef.current.target.copy(center)
    controlsRef.current.update()
    // Save so reset() returns to this mesh-centered home view
    controlsRef.current.saveState()
  }, [mesh]);

  const progressPct = jobProgress
    ? Math.round((jobProgress.step / jobProgress.total) * 100)
    : null

  return (
    <div className="relative h-full bg-gh-bg-base min-w-0">
      {!sessionId && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <span className="text-[13px] text-gh-text-muted bg-gh-bg-elevated px-3.5 py-1.5 rounded-md border border-gh-border">
            Select a .fe file to begin
          </span>
        </div>
      )}
      {sessionId && mesh && mesh.facets.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <span className="text-[13px] text-gh-text-muted bg-gh-bg-elevated px-3.5 py-1.5 rounded-md border border-gh-border">
            No surface — this model uses a non-triangulated representation
          </span>
        </div>
      )}
      {isFetching && (
        <div className="absolute top-2.5 right-3 text-[11px] text-gh-accent bg-gh-bg-elevated px-2 py-[3px] rounded border border-gh-border z-20 pointer-events-none">
          Loading mesh…
        </div>
      )}
      {progressPct !== null && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gh-bg-elevated z-20">
          <div
            className="h-full bg-gh-accent transition-[width] duration-200 ease-in-out"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      )}

      {/* Top-left controls */}
      <div className="absolute top-2.5 left-3 z-20 flex items-center gap-1.5">
        <button
          className="text-[13px] leading-none text-gh-text-muted bg-gh-bg-elevated hover:text-gh-text-primary border border-gh-border rounded px-1.5 py-0.5 transition-colors duration-100 cursor-pointer"
          onClick={() => controlsRef.current?.reset()}
          title="Reset camera"
        >
          ↺
        </button>
        <button
          className="text-[11px] leading-none text-gh-text-muted bg-gh-bg-elevated hover:text-gh-text-primary border border-gh-border rounded px-1.5 py-0.5 transition-colors duration-100 cursor-pointer"
          onClick={cycleMode}
          title="Cycle render mode"
        >
          {MODE_LABEL[mode]}
        </button>
      </div>

      {/* Mesh stats — bottom-right */}
      {mesh && (
        <div className="absolute bottom-3 right-3 z-20 text-[11px] font-mono text-gh-text-muted bg-gh-bg-elevated border border-gh-border rounded px-2 py-1 pointer-events-none">
          {mesh.vertices.length.toLocaleString()} verts
          <span className="mx-1.5">·</span>
          {mesh.facets.length.toLocaleString()} facets
        </div>
      )}

      <Canvas
        style={{ height: '100%' }}
        camera={{ position: [2.5, 2, 2.5], fov: 40 }}
        gl={{ antialias: true, alpha: true }}
      >
        {/* Lighting tuned to match SE's classic OpenGL look */}
        <ambientLight intensity={0.35} />
        <directionalLight position={[4, 8, 4]} intensity={0.9} />
        <directionalLight position={[-4, -2, -4]} intensity={0.2} color="#4488cc" />

        {mesh && mesh.facets.length > 0 && <MeshGeometry mesh={mesh} mode={mode} />}
        <OrbitControls ref={controlsRef} makeDefault />
      </Canvas>
    </div>
  )
}
