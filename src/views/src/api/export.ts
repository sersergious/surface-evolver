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

/** Trigger a browser download from an in-memory string. */
export function triggerDownload(filename: string, content: string, mimeType = 'text/plain'): void {
  const blob = new Blob([content], { type: mimeType })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
