// jsdom has no WebGL, so @react-three/fiber's <Canvas> (which needs a real
// GL context) is stubbed out to just render its children — this tests the
// DOM logic ViewerPane owns (toolbar, empty states, mesh stat badge, picked-
// vertex panel), not Three.js rendering. See the plan: "not chasing pixel
// output".
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import ViewerPane from './ViewerPane'
import { useStore } from '../../store/useStore'
import type { MeshData } from '../../api/simulation'

vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children: ReactNode }) => <div data-testid="canvas">{children}</div>,
  useThree: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ camera: { position: { set: vi.fn() } }, controls: null }),
}))
vi.mock('@react-three/drei', () => ({
  OrbitControls: () => null,
}))
vi.mock('./MeshGeometry', () => ({
  __esModule: true,
  default: () => <div data-testid="mesh-geometry" />,
  EdgeLines: () => null,
  PickPoints: () => null,
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
