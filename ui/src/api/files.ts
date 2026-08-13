import { rpc } from './client'

export interface UploadResult {
  filename:   string
  size_bytes: number
}

export async function listFiles(): Promise<string[]> {
  return rpc<string[]>('listFiles')
}

export async function uploadFile(filename: string, content: string): Promise<UploadResult> {
  return rpc<UploadResult>('uploadFile', { filename, content })
}
