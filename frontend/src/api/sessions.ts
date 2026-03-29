import client from './client'

export interface SessionState {
  session_id: string
  fe_file: string
  energy: number | null
  area: number | null
  scale: number | null
  vertex_count: number | null
  facet_count: number | null
  edge_count: number | null
}

export async function createSession(feFile: string): Promise<SessionState> {
  const res = await client.post<SessionState>('/sessions', { fe_file: feFile })
  return res.data
}

export async function listSessions(): Promise<SessionState[]> {
  const res = await client.get<SessionState[]>('/sessions')
  return res.data
}

export async function getSession(id: string): Promise<SessionState> {
  const res = await client.get<SessionState>(`/sessions/${id}`)
  return res.data
}

export async function deleteSession(id: string): Promise<void> {
  await client.delete(`/sessions/${id}`)
}
