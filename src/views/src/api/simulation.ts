import client from './client'

export interface MeshData {
  vertices: number[][]
  vertex_ids: number[]
  facets: number[][]
  edges: number[][]
  body_volumes: Record<number, number>
  body_cms?: (number[] | null)[]
  facet_colors?: number[]
  edge_colors?: number[]
}

export interface RunCommandResponse {
  output: string
  energy: number | null
  area: number | null
  total_time: number
}

export interface MeshParams { min_area: number; min_length: number; max_len: number; temperature: number }
export interface Physics { gravflag: boolean; grav_const: number; pressflag: boolean; pressure: number }
export interface Settings { mesh_params: MeshParams; physics: Physics; total_time: number }

export async function getSettings(id: string): Promise<Settings> {
  return client.get<Settings>(`/sessions/${id}/settings`)
}

export async function setSettings(
  id: string, patch: { mesh_params?: MeshParams; physics?: Physics },
): Promise<Settings & { energy: number; area: number }> {
  return client.post<Settings & { energy: number; area: number }>(`/sessions/${id}/settings`, patch)
}

export async function runCommand(id: string, command: string): Promise<RunCommandResponse> {
  return client.post<RunCommandResponse>(`/sessions/${id}/run`, { command })
}

export type TopoOp = 'refine' | 'equi' | 'vertex_avg' | 'pop'

export interface TopoResponse {
  output: string
  counts: Record<string, number>
  energy: number
  energy_delta: number
  area: number
  total_time: number
}

export async function runTopo(id: string, op: TopoOp, n?: number): Promise<TopoResponse> {
  return client.post<TopoResponse>(`/sessions/${id}/topo`, { op, ...(n ? { n } : {}) })
}

// Always requests native SE per-element colours alongside the geometry.
export async function getMesh(id: string): Promise<MeshData> {
  return client.get<MeshData>(`/sessions/${id}/mesh?colors=true`)
}

// flags bits (se_api.h): Q_ENERGY=1, Q_FIXED=2, Q_INFO=4
export interface Quantity {
  name: string
  value: number
  target: number
  modulus: number
  flags: number
}

export interface MethodInstance {
  name: string
  type: number   // element type: 1=vertex 2=edge 3=facet 4=body
  value: number
}

export interface QuantitiesData {
  quantities: Quantity[]
  methods: MethodInstance[]
}

export async function getQuantities(id: string): Promise<QuantitiesData> {
  return client.get<QuantitiesData>(`/sessions/${id}/quantities`)
}

// attr bits (se_api.h): FIXED=0x40, BOUNDARY=0x80, CONSTRAINT=0x400
export interface VertexInfo {
  id: number
  xyz: number[]
  attr: number
  constraints: { idx: number; name: string }[]
}

export async function getVertexInfo(id: string, vpos: number): Promise<VertexInfo> {
  return client.get<VertexInfo>(`/sessions/${id}/vertex/${vpos}`)
}
