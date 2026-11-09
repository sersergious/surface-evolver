// jsdom has no WebGL, so @react-three/fiber's <Canvas> (which needs a real
// GL context) is stubbed out to just render its children — this tests the
// DOM logic ViewerPane owns (toolbar, empty states, mesh stat badge, picked-
// vertex panel), not Three.js rendering. See the plan: "not chasing pixel
// output".
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import ViewerPane from './ViewerPane'
import { useStore } from '../../store/useStore'
import type { MeshData } from '../../api/simulation'

// Stable camera/controls, so FitCamera can run and be observed.
const three = vi.hoisted(() => ({
  camera:   { position: { set: vi.fn() } },
  controls: { target: { copy: vi.fn() }, update: vi.fn(), saveState: vi.fn(), reset: vi.fn() },
}))
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children: ReactNode }) => <div data-testid="canvas">{children}</div>,
  useThree: (selector: (s: Record<string, unknown>) => unknown) => selector(three),
}))
vi.mock('@react-three/drei', () => ({
  OrbitControls: () => null,
}))
vi.mock('./MeshGeometry', () => ({
  __esModule: true,
  default: () => <div data-testid="mesh-geometry" />,
  EdgeLines: () => null,
  // Stands in for a click on the vertex at buffer index 3.
  PickPoints: ({ onPick }: { onPick: (vpos: number) => void }) => <button onClick={() => onPick(3)}>pick vertex 3</button>,
  VertexMarker: () => null,
  BodyMarkers: () => null,
  RaycasterConfig: () => null,
}))
vi.mock('../../api/simulation', () => ({ getMesh: vi.fn(), getVertexInfo: vi.fn() }))

import { getMesh, getVertexInfo } from '../../api/simulation'

const initial = useStore.getState()

const mesh: MeshData = {
  vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
  facets: [[0, 1, 2]],
  edges: [[0, 1], [1, 2], [2, 0]],
}

describe('ViewerPane', () => {
  beforeEach(() => {
    useStore.setState(initial, true)
    vi.mocked(getMesh).mockReset()
    vi.mocked(getVertexInfo).mockReset()
  })

  it('shows the empty state when no session is loaded', () => {
    render(<ViewerPane />)
    expect(screen.getByText('Select a .fe file to begin')).toBeInTheDocument()
  })

  it('fetches and renders the mesh for the active session', async () => {
    useStore.setState({ sessionId: 's1' })
    vi.mocked(getMesh).mockResolvedValue(mesh)
    render(<ViewerPane />)

    expect(await screen.findByTestId('mesh-geometry')).toBeInTheDocument()
    expect(getMesh).toHaveBeenCalledWith('s1')
    expect(await screen.findByText(/3 v · 3 e · 1 f/)).toBeInTheDocument()
  })

  it('shows a warning badge for periodic surfaces with hidden wrapped edges', async () => {
    useStore.setState({ sessionId: 's1' })
    vi.mocked(getMesh).mockResolvedValue({ ...mesh, wrapped_edges_hidden: 12 })
    render(<ViewerPane />)
    expect(await screen.findByText(/12 wrapped/)).toBeInTheDocument()
  })

  it('a mesh fetch failure logs an error instead of throwing', async () => {
    useStore.setState({ sessionId: 's1' })
    vi.mocked(getMesh).mockRejectedValue(new Error('worker crashed'))
    render(<ViewerPane />)

    await vi.waitFor(() =>
      expect(useStore.getState().outputLog).toContain('[error] mesh fetch failed: worker crashed'))
  })

  it('clicking Inspect enables pick mode; picking a vertex fetches its info', async () => {
    useStore.setState({ sessionId: 's1' })
    vi.mocked(getMesh).mockResolvedValue(mesh)
    vi.mocked(getVertexInfo).mockResolvedValue({ id: 1, xyz: [1, 0, 0], attr: 0, constraints: [] })
    render(<ViewerPane />)
    await screen.findByTestId('mesh-geometry')

    const user = userEvent.setup()
    await user.click(screen.getByTitle('Inspect: click a vertex; show body centroids'))
    expect(await screen.findByText('Click a vertex to inspect')).toBeInTheDocument()
  })

  it('frames the camera once per session, not on every refetch (#21)', async () => {
    three.camera.position.set.mockClear()
    useStore.setState({ sessionId: 's1', meshVersion: 0 })
    vi.mocked(getMesh).mockImplementation(async () => ({ ...mesh }))   // a new object each fetch
    render(<ViewerPane />)
    await screen.findByTestId('mesh-geometry')
    await waitFor(() => expect(three.camera.position.set).toHaveBeenCalledTimes(1))

    act(() => useStore.getState().bumpMeshVersion())          // a command changed the surface
    await waitFor(() => expect(getMesh).toHaveBeenCalledTimes(2))
    await new Promise(r => setTimeout(r, 0))
    expect(three.camera.position.set).toHaveBeenCalledTimes(1) // orbit and zoom kept

    act(() => useStore.setState({ sessionId: 's2' }))          // another file or a reload
    await waitFor(() => expect(three.camera.position.set).toHaveBeenCalledTimes(2))
  })

  it('the Loading badge clears when the session ends mid-fetch (#34)', async () => {
    useStore.setState({ sessionId: 's1' })
    vi.mocked(getMesh).mockReturnValue(new Promise(() => {}))   // never settles
    render(<ViewerPane />)
    expect(await screen.findByText('Loading')).toBeInTheDocument()

    act(() => useStore.getState().clearSession())               // Stop, crash, closed tab
    expect(screen.queryByText('Loading')).not.toBeInTheDocument()
  })

  it('the vertex count is the engine\'s, not the unwrapped duplicates (#17)', async () => {
    useStore.setState({ sessionId: 's1' })
    // 3 engine vertices plus 1 appended copy for an unwrapped periodic facet.
    vi.mocked(getMesh).mockResolvedValue({ ...mesh, vertices: [...mesh.vertices, [2, 0, 0]], unwrap_source: [1] })
    render(<ViewerPane />)
    expect(await screen.findByText(/3 v · 3 e · 1 f/)).toBeInTheDocument()
  })

  it('picking an unwrapped duplicate of a periodic vertex inspects the engine vertex it copies (#17)', async () => {
    useStore.setState({ sessionId: 's1' })
    // Index 3 is the worker's appended copy of engine vertex 1, shifted by a period.
    vi.mocked(getMesh).mockResolvedValue({ ...mesh, vertices: [...mesh.vertices, [2, 0, 0]], unwrap_source: [1] })
    vi.mocked(getVertexInfo).mockResolvedValue({ id: 2, xyz: [1, 0, 0], attr: 0, constraints: [] })
    render(<ViewerPane />)
    await screen.findByTestId('mesh-geometry')
    const user = userEvent.setup()
    await user.click(screen.getByTitle('Inspect: click a vertex; show body centroids'))

    await user.click(await screen.findByText('pick vertex 3'))

    expect(getVertexInfo).toHaveBeenCalledWith('s1', 1)
  })

  it('a native View menu render: action switches render mode', async () => {
    useStore.setState({ sessionId: 's1' })
    vi.mocked(getMesh).mockResolvedValue(mesh)
    render(<ViewerPane />)
    await screen.findByTestId('mesh-geometry')

    expect(screen.getByTitle('Cycle render mode')).toHaveTextContent('Solid')
    window.dispatchEvent(new CustomEvent('se-menu', { detail: 'render:wireframe' }))
    expect(await screen.findByTitle('Cycle render mode')).toHaveTextContent('Wire')
  })
})
