import client from './client'

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
  return client.get<DmpExport>(`/sessions/${sessionId}/export/dmp`)
}

export async function exportFe(sessionId: string): Promise<FeExport> {
  return client.get<FeExport>(`/sessions/${sessionId}/export/fe`)
}

export async function setScale(sessionId: string, scale: number): Promise<ScaleResult> {
  return client.post<ScaleResult>(`/sessions/${sessionId}/scale`, { scale })
}

export async function updateFile(filename: string, content: string): Promise<{ filename: string; size_bytes: number }> {
  // client.post maps to PUT via the /files/:filename route in client.ts
  return client.post<{ filename: string; size_bytes: number }>(`/files/${encodeURIComponent(filename)}`, { content })
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
