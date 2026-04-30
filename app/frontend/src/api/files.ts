import client from './client'

export async function listFiles(): Promise<string[]> {
  return client.get<string[]>('/files')
}
