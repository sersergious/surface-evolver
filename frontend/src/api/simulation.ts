import client from './client'
import type { JobResult } from './jobs'

export interface MeshData {
  vertices: number[][]
  vertex_ids: number[]
  facets: number[][]
  body_volumes: Record<number, number>
}

export interface RunCommandResponse {
  output: string
  energy: number | null
  area: number | null
}

export async function iterateSession(id: string, steps: number): Promise<JobResult> {
  const res = await client.post<JobResult>(`/sessions/${id}/iterate`, { steps })
  return res.data
}

export async function runCommand(id: string, command: string): Promise<RunCommandResponse> {
  const res = await client.post<RunCommandResponse>(`/sessions/${id}/run`, { command })
  return res.data
}

export async function getMesh(id: string): Promise<MeshData> {
  const res = await client.get<MeshData>(`/sessions/${id}/mesh`)
  return res.data
}
