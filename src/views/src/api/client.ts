// @ts-ignore - electrobun/view is only resolvable inside the Electrobun webview bundle
import { Electroview } from 'electrobun/view'

// Define the view-side RPC (view has no incoming handlers; all calls go to bun).
// maxRequestTime covers slow ops like createSession and runCommand.
const rpc = (Electroview as any).defineRPC({
    maxRequestTime: 30_000,
    handlers: { requests: {}, messages: {} },
})

const view = new (Electroview as any)({ rpc })

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const call = (name: string, params?: unknown) =>
    (view.rpc as any).request(name, params) as Promise<T>

  if (path === '/restore' && method === 'GET')
    return call('getRestore')

  if (path === '/files' && method === 'GET')
    return call('listFiles')

  if (path === '/files/upload' && method === 'POST')
    return call('uploadFile', body)

  const fileUpdateMatch = path.match(/^\/files\/([^/]+)$/)
  if (fileUpdateMatch && (method === 'PUT' || method === 'POST'))
    return call('updateFile', { filename: decodeURIComponent(fileUpdateMatch[1]), ...(body as object) })

  if (path === '/sessions' && method === 'POST')
    return call('createSession', body)

  const iterateMatch = path.match(/^\/sessions\/([^/]+)\/iterate$/)
  if (iterateMatch && method === 'POST')
    return call('iterate', { sessionId: iterateMatch[1], ...(body as object) })

  const runMatch = path.match(/^\/sessions\/([^/]+)\/run$/)
  if (runMatch && method === 'POST')
    return call('runCommand', { sessionId: runMatch[1], ...(body as object) })

  const topoMatch = path.match(/^\/sessions\/([^/]+)\/topo$/)
  if (topoMatch && method === 'POST')
    return call('topo', { sessionId: topoMatch[1], ...(body as object) })

  const quantMatch = path.match(/^\/sessions\/([^/]+)\/quantities$/)
  if (quantMatch && method === 'GET')
    return call('quantities', { sessionId: quantMatch[1] })

  const vinfoMatch = path.match(/^\/sessions\/([^/]+)\/vertex\/(\d+)$/)
  if (vinfoMatch && method === 'GET')
    return call('vertexInfo', { sessionId: vinfoMatch[1], vpos: Number(vinfoMatch[2]) })

  const settingsMatch = path.match(/^\/sessions\/([^/]+)\/settings$/)
  if (settingsMatch && method === 'GET')
    return call('settings', { sessionId: settingsMatch[1] })
  if (settingsMatch && method === 'POST')
    return call('setSettings', { sessionId: settingsMatch[1], ...(body as object) })

  const meshMatch = path.match(/^\/sessions\/([^/]+)\/mesh(\?.*)?$/)
  if (meshMatch && method === 'GET') {
    const scalars = new URLSearchParams(meshMatch[2]?.slice(1) ?? '').get('scalars') ?? undefined
    return call('getMesh', { sessionId: meshMatch[1], ...(scalars ? { scalars } : {}) })
  }

  const scaleMatch = path.match(/^\/sessions\/([^/]+)\/scale$/)
  if (scaleMatch && method === 'POST')
    return call('setScale', { sessionId: scaleMatch[1], ...(body as object) })

  const dmpMatch = path.match(/^\/sessions\/([^/]+)\/export\/dmp$/)
  if (dmpMatch && method === 'GET')
    return call('exportDmp', { sessionId: dmpMatch[1] })

  const feMatch = path.match(/^\/sessions\/([^/]+)\/export\/fe$/)
  if (feMatch && method === 'GET')
    return call('exportFe', { sessionId: feMatch[1] })

  throw new Error(`RPC mapping not found for ${method} ${path}`)
}

const client = {
  get:  <T>(path: string)                => request<T>('GET',  path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
}

export default client
