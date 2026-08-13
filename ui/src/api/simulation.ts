import { rpc } from './client'

export interface MeshData {
  vertices: number[][]
  facets: number[][]
  edges: number[][]
  body_cms?: (number[] | null)[]
  facet_colors?: number[]
  // Periodic (torus) surfaces only, and only when non-zero: edges crossing a
  // period boundary, which the worker drops because a straight line between
  // their endpoints would span the whole domain.
  wrapped_edges_hidden?: number
}

export interface RunCommandResponse {
  output: string
  energy: number | null
  area: number | null
}

export async function runCommand(id: string, command: string): Promise<RunCommandResponse> {
  return rpc<RunCommandResponse>('runCommand', { sessionId: id, command })
}

export type TopoOp = 'refine' | 'equi' | 'vertex_avg' | 'pop'

export interface TopoResponse {
  output: string
  counts: Record<string, number>
  energy: number
  energy_delta: number
  area: number
}

// No count parameter: only `equi` would use one (worker maps it to `u N`), and
// one menu click = one pass is the honest behaviour. Repeated passes are `u 5`
// in the CLI pane. Was BACKLOG F7.
export async function runTopo(id: string, op: TopoOp): Promise<TopoResponse> {
  return rpc<TopoResponse>('topo', { sessionId: id, op })
}

// Always requests native SE per-element colours alongside the geometry.
export async function getMesh(id: string): Promise<MeshData> {
  return rpc<MeshData>('getMesh', { sessionId: id, colors: true })
}

// attr bits (se_api.h): FIXED=0x40, BOUNDARY=0x80, CONSTRAINT=0x400
export interface VertexInfo {
  id: number
  xyz: number[]
  attr: number
  constraints: { idx: number; name: string }[]
}

export async function getVertexInfo(id: string, vpos: number): Promise<VertexInfo> {
  return rpc<VertexInfo>('vertexInfo', { sessionId: id, vpos })
}
