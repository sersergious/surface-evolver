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

/** A datafile's text from disk (the user copy if one exists). Needs no session,
 *  so the editor can show a file that fails to load. */
export async function readFile(filename: string): Promise<{ filename: string; content: string }> {
  return rpc<{ filename: string; content: string }>('readFile', { filename })
}
