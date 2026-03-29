import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useMesh } from '../../hooks/useMesh'
import useStore from '../../store/useStore'
import MeshGeometry from './MeshGeometry'
import { gh } from '../../theme'

export default function ViewerPane() {
  const sessionId = useStore((s) => s.sessionId)
  const jobProgress = useStore((s) => s.jobProgress)
  const { data: mesh, isFetching } = useMesh()

  const progressPct = jobProgress
    ? Math.round((jobProgress.step / jobProgress.total) * 100)
    : null

  return (
    <div style={styles.pane}>
      {!sessionId && (
        <div style={styles.overlay}>
          <span style={styles.overlayText}>Select a .fe file to begin</span>
        </div>
      )}
      {isFetching && (
        <div style={styles.fetchingBadge}>Loading mesh…</div>
      )}
      {progressPct !== null && (
        <div style={styles.progressBar}>
          <div style={{ ...styles.progressFill, width: `${progressPct}%` }} />
        </div>
      )}
      {/* SE-style: pure black background */}
      <Canvas
        style={{ height: '100%', background: '#000' }}
        camera={{ position: [2.5, 2, 2.5], fov: 40 }}
        gl={{ antialias: true, alpha: false }}
        onCreated={({ gl }) => gl.setClearColor('#000000', 1)}
      >
        {/* Lighting tuned to match SE's classic OpenGL look */}
        <ambientLight intensity={0.35} />
        <directionalLight position={[4, 8, 4]}  intensity={0.9} />
        <directionalLight position={[-4, -2, -4]} intensity={0.2} color="#4488cc" />

        {mesh && <MeshGeometry mesh={mesh} />}
        <OrbitControls makeDefault />
      </Canvas>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  pane: {
    position: 'relative',
    height: '100%',
    background: '#000',
    minWidth: 0,
  },
  overlay: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
    zIndex: 10,
  },
  overlayText: {
    fontSize: 13,
    color: gh.textMuted,
    background: gh.bgElevated,
    padding: '6px 14px',
    borderRadius: 6,
    border: `1px solid ${gh.border}`,
  },
  fetchingBadge: {
    position: 'absolute',
    top: 10,
    right: 12,
    fontSize: 11,
    color: gh.accent,
    background: gh.bgElevated,
    padding: '3px 8px',
    borderRadius: 4,
    border: `1px solid ${gh.border}`,
    zIndex: 20,
    pointerEvents: 'none',
  },
  progressBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    background: gh.bgElevated,
    zIndex: 20,
  },
  progressFill: {
    height: '100%',
    background: gh.accent,
    transition: 'width 0.2s ease',
  },
}
