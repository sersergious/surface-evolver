// Contract tests: each api/*.ts wrapper must call rpc() with the exact method
// name and param shape src-tauri/src/rpc.rs's dispatch() expects. A typo'd
// method name here is otherwise only caught by clicking through the real UI.
import { describe, expect, it, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
vi.mock('./client', () => ({ rpc: (...args: unknown[]) => rpc(...args) }))

const { createSession, getRestore, cancelSession, lagrangeWarning } = await import('./sessions')
const { listFiles, uploadFile } = await import('./files')
const { runCommand, runTopo, getMesh, getVertexInfo } = await import('./simulation')
const { exportDmp, exportFe, updateFile, saveExport } = await import('./export')

beforeEach(() => rpc.mockReset())

describe('sessions.ts', () => {
  it('createSession', async () => {
    rpc.mockResolvedValue({ session_id: 's1' })
    await createSession('cube.fe')
    expect(rpc).toHaveBeenCalledWith('createSession', { fe_file: 'cube.fe' })
  })

  it('getRestore', async () => {
    rpc.mockResolvedValue(null)
    await getRestore()
    expect(rpc).toHaveBeenCalledWith('getRestore')
  })

  it('cancelSession', async () => {
    rpc.mockResolvedValue({ cancelled: true })
    await cancelSession()
    expect(rpc).toHaveBeenCalledWith('cancel')
  })

  it('lagrangeWarning only fires for lagrange_order > 1', () => {
    const base = { session_id: 's', fe_file: 'f', energy: 0, area: 0, lagrange_order: 1 }
    expect(lagrangeWarning('f', base)).toBeNull()
    expect(lagrangeWarning('f', { ...base, lagrange_order: 2 })).toContain('Lagrange order 2')
    expect(lagrangeWarning('f', { ...base, lagrange_order: null })).toBeNull()
  })
})

describe('files.ts', () => {
  it('listFiles', async () => {
    rpc.mockResolvedValue(['cube.fe'])
    await listFiles()
    expect(rpc).toHaveBeenCalledWith('listFiles')
  })

  it('uploadFile', async () => {
    rpc.mockResolvedValue({ filename: 'a.fe', size_bytes: 3 })
    await uploadFile('a.fe', 'YWJj')
    expect(rpc).toHaveBeenCalledWith('uploadFile', { filename: 'a.fe', content: 'YWJj' })
  })
})

describe('simulation.ts', () => {
  it('runCommand', async () => {
    rpc.mockResolvedValue({ output: '', energy: 1, area: 1 })
    await runCommand('sid', 'g 5')
    expect(rpc).toHaveBeenCalledWith('runCommand', { sessionId: 'sid', command: 'g 5' })
  })

  it('runTopo', async () => {
    rpc.mockResolvedValue({ output: '', counts: {}, energy: 1, energy_delta: 0, area: 1 })
    await runTopo('sid', 'refine')
    expect(rpc).toHaveBeenCalledWith('topo', { sessionId: 'sid', op: 'refine' })
  })

  it('getMesh always requests colors', async () => {
    rpc.mockResolvedValue({ vertices: [], facets: [], edges: [] })
    await getMesh('sid')
    expect(rpc).toHaveBeenCalledWith('getMesh', { sessionId: 'sid', colors: true })
  })

  it('getVertexInfo', async () => {
    rpc.mockResolvedValue({ id: 0, xyz: [0, 0, 0], attr: 0, constraints: [] })
    await getVertexInfo('sid', 3)
    expect(rpc).toHaveBeenCalledWith('vertexInfo', { sessionId: 'sid', vpos: 3 })
  })
})

describe('export.ts', () => {
  it('exportDmp', async () => {
    rpc.mockResolvedValue({ filename: 'a.dmp', content: '' })
    await exportDmp('sid')
    expect(rpc).toHaveBeenCalledWith('exportDmp', { sessionId: 'sid' })
  })

  it('exportFe', async () => {
    rpc.mockResolvedValue({ filename: 'a.fe', content: '' })
    await exportFe('sid')
    expect(rpc).toHaveBeenCalledWith('exportFe', { sessionId: 'sid' })
  })

  it('updateFile', async () => {
    rpc.mockResolvedValue({ filename: 'a.fe', size_bytes: 1 })
    await updateFile('a.fe', 'content')
    expect(rpc).toHaveBeenCalledWith('updateFile', { filename: 'a.fe', content: 'content' })
  })

  it('saveExport', async () => {
    rpc.mockResolvedValue({ path: '/x' })
    await saveExport('a.fe', 'content')
    expect(rpc).toHaveBeenCalledWith('saveExport', { filename: 'a.fe', content: 'content' })
  })
})
