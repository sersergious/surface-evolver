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
  return client.post<JobResult>(`/sessions/${id}/iterate`, { steps })
}

export async function runCommand(id: string, command: string): Promise<RunCommandResponse> {
  return client.post<RunCommandResponse>(`/sessions/${id}/run`, { command })
}

export async function getMesh(id: string): Promise<MeshData> {
  return client.get<MeshData>(`/sessions/${id}/mesh`)
}
