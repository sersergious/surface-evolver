import { rpc } from './client'

export interface DmpExport {
  filename: string
  content:  string
}

export interface FeExport {
  filename: string
  content:  string
}

export interface ScaleResult {
  scale:  number
  energy: number
  area:   number
}

export async function exportDmp(sessionId: string): Promise<DmpExport> {
  return rpc<DmpExport>('exportDmp', { sessionId })
}

export async function exportFe(sessionId: string): Promise<FeExport> {
  return rpc<FeExport>('exportFe', { sessionId })
}

export async function setScale(sessionId: string, scale: number): Promise<ScaleResult> {
  return rpc<ScaleResult>('setScale', { sessionId, scale })
}

export async function updateFile(filename: string, content: string): Promise<{ filename: string; size_bytes: number }> {
  return rpc<{ filename: string; size_bytes: number }>('updateFile', { filename, content })
}

/**
 * Save an export to ~/Downloads via the bun process (which also reveals it).
 * A blob-URL <a download> is silently dropped by the embedded webview, so
 * downloads must go through native IPC.
 */
export function saveExport(filename: string, content: string): Promise<{ path: string }> {
  return rpc<{ path: string }>('saveExport', { filename, content })
}
