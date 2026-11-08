import { describe, expect, it, vi } from 'vitest'
import { emit } from '@tauri-apps/api/event'
import { ipc } from '../test/ipc'
import { rpc, toError } from './client'

// Driven through Tauri's own mockIPC (test/ipc.ts), so these assert what
// actually crosses the IPC boundary, rejections included.
describe('rpc', () => {
  it('invokes the single "rpc" command with method and params', async () => {
    ipc.mockReturnValue({ ok: true })
    const result = await rpc('listFiles', { foo: 'bar' })
    expect(ipc).toHaveBeenCalledWith('rpc', { method: 'listFiles', params: { foo: 'bar' } })
    expect(result).toEqual({ ok: true })
  })

  it('defaults params to null when omitted', async () => {
    await rpc('getRestore')
    expect(ipc).toHaveBeenCalledWith('rpc', { method: 'getRestore', params: null })
  })

  it('turns a Tauri rejection (a plain string) into an Error', async () => {
    ipc.mockImplementation(() => { throw 'File not found: cube.fe' })
    const err = await rpc('createSession').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toBe('File not found: cube.fe')
  })
})

describe('native menu bridge', () => {
  it('re-dispatches the Tauri se-menu event as a window CustomEvent', async () => {
    const seen = vi.fn()
    window.addEventListener('se-menu', e => seen((e as CustomEvent).detail))
    await emit('se-menu', 'run:refine')
    expect(seen).toHaveBeenCalledWith('run:refine')
  })
})

describe('toError', () => {
  it('passes an already-real Error through unchanged', () => {
    const original = new Error('boom')
    expect(toError(original)).toBe(original)
  })
})
