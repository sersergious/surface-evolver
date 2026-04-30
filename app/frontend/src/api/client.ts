const BASE_URL = '/api'
const TIMEOUT_MS = 30_000

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
  } catch (err) {
    clearTimeout(timer)
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Request timed out')
    }
    throw err
  }
  clearTimeout(timer)

  if (!response.ok) {
    let msg = `HTTP ${response.status}`
    try {
      const data = await response.json() as { detail?: string; message?: string }
      msg = data.detail ?? data.message ?? msg
    } catch {
      // ignore parse errors
    }
    throw new Error(msg)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return response.json() as Promise<T>
}

const client = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  delete: <T = void>(path: string) => request<T>('DELETE', path),
}

export default client
