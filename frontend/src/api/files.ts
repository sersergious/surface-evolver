import client from './client'

export async function listFiles(): Promise<string[]> {
  const res = await client.get<string[]>('/files')
  return res.data
}
