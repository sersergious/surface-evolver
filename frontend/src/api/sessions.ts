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
  return client.post<SessionState>('/sessions', { fe_file: feFile })
}

export async function listSessions(): Promise<SessionState[]> {
  return client.get<SessionState[]>('/sessions')
}

export async function getSession(id: string): Promise<SessionState> {
  return client.get<SessionState>(`/sessions/${id}`)
}

export async function deleteSession(id: string): Promise<void> {
  return client.delete(`/sessions/${id}`)
}
