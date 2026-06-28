import client from './client'

export interface UploadResult {
  filename:   string
  size_bytes: number
  renderable: boolean
}

export async function listFiles(): Promise<string[]> {
  return client.get<string[]>('/files')
}

export async function uploadFile(filename: string, content: string): Promise<UploadResult> {
  return client.post<UploadResult>('/files/upload', { filename, content })
}
