import { rpc } from './client'

export interface SessionState {
  session_id:   string
  fe_file:      string
  energy:       number | null
  area:         number | null
  lagrange_order: number | null
}

export async function createSession(feFile: string): Promise<SessionState> {
  return rpc<SessionState>('createSession', { fe_file: feFile })
}

// The surface restored from the previous run's auto-saved snapshot, or null.
export async function getRestore(): Promise<SessionState | null> {
  return rpc<SessionState | null>('getRestore')
}

/** Stop the running command. The backend sends SIGINT first: `interrupted`
 *  means the engine aborted the command and kept the worker and the evolved
 *  surface. Otherwise it fell back to killing the worker (the surface is gone,
 *  the last snapshot survives). */
export async function cancelSession(): Promise<{ cancelled: boolean; interrupted?: boolean }> {
  return rpc<{ cancelled: boolean; interrupted?: boolean }>('cancel')
}

/** Warning for curved-patch models the linear renderer draws wrong, else null. */
export function lagrangeWarning(file: string, s: SessionState): string | null {
  return (s.lagrange_order ?? 1) > 1
    ? `[warning] ${file}: Lagrange order ${s.lagrange_order} — curved patches render as straight edges`
    : null
}
