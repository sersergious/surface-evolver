import { useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useMesh } from '../../hooks/useMesh'
import useStore from '../../store/useStore'
import MeshGeometry from './MeshGeometry'

export default function ViewerPane() {
  const sessionId = useStore((s) => s.sessionId)
  const jobProgress = useStore((s) => s.jobProgress)
  const { data: mesh, isFetching } = useMesh()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controlsRef = useRef<any>(null)

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

      {/* Camera reset — top-left */}
      <button
        className="absolute top-2.5 left-3 z-20 text-[13px] leading-none text-gh-text-muted bg-gh-bg-elevated hover:text-gh-text-primary border border-gh-border rounded px-1.5 py-0.5 transition-colors duration-100 cursor-pointer"
        onClick={() => controlsRef.current?.reset()}
        title="Reset camera"
      >
        ↺
      </button>

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
        <directionalLight position={[4, 8, 4]}  intensity={0.9} />
        <directionalLight position={[-4, -2, -4]} intensity={0.2} color="#4488cc" />

        {mesh && <MeshGeometry mesh={mesh} />}
        <OrbitControls ref={controlsRef} makeDefault />
      </Canvas>
    </div>
  )
}
