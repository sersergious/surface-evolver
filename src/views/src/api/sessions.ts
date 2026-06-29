import client from './client'

export interface SessionState {
  session_id:   string
  fe_file:      string
  energy:       number | null
  area:         number | null
  scale:        number | null
  sdim:         number | null
  vertex_count: number | null
  facet_count:  number | null
  edge_count:   number | null
  lagrange_order: number | null
  vertex_attributes?: string[]   // user-defined scalar vertex attrs → custom colormaps
}

export async function createSession(feFile: string): Promise<SessionState> {
  return client.post<SessionState>('/sessions', { fe_file: feFile })
}

// The surface restored from the previous run's auto-saved snapshot, or null.
export async function getRestore(): Promise<SessionState | null> {
  return client.get<SessionState | null>('/restore')
}
