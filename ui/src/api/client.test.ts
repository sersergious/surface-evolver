import { describe, expect, it, vi, beforeEach } from 'vitest'

// NOTE: only the resolve path is exercised through a mocked @tauri-apps/api/core
// here — in this environment, mocking that package specifically (not local
// modules) and then rejecting through it makes Vitest report a false
// "unhandled rejection" regardless of how the rejection is awaited/caught
// (reproduced identically under both Bun and Node, independent of vitest
// version). toError() below is exported from client.ts and tested directly
// instead, so the actual string-to-Error conversion behavior still has real
// coverage; every other test file mocks the local `api/client` module
// instead of the npm package, which does not hit this issue.
const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }))

const { rpc, toError } = await import('./client')

describe('rpc', () => {
  beforeEach(() => invoke.mockReset())

  it('invokes the single "rpc" command with method and params', async () => {
    invoke.mockResolvedValue({ ok: true })
    const result = await rpc('listFiles', { foo: 'bar' })
    expect(invoke).toHaveBeenCalledWith('rpc', { method: 'listFiles', params: { foo: 'bar' } })
    expect(result).toEqual({ ok: true })
  })

  it('defaults params to null when omitted', async () => {
    invoke.mockResolvedValue(null)
    await rpc('getRestore')
    expect(invoke).toHaveBeenCalledWith('rpc', { method: 'getRestore', params: null })
  })
})

describe('toError', () => {
  it('wraps a plain string (Tauri rejection shape) into a real Error', () => {
    const err = toError('File not found: cube.fe')
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('File not found: cube.fe')
  })

  it('passes an already-real Error through unchanged', () => {
    const original = new Error('boom')
    expect(toError(original)).toBe(original)
  })
})
