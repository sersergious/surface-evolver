import { describe, expect, it, beforeEach } from 'vitest'
import { useStore } from './useStore'

const initial = useStore.getState()

describe('useStore', () => {
  beforeEach(() => useStore.setState(initial, true))

  it('setSession adds the file to openFiles once', () => {
    useStore.getState().setSession('s1', 'cube.fe')
    useStore.getState().setSession('s2', 'cube.fe')
    expect(useStore.getState().openFiles).toEqual(['cube.fe'])
    expect(useStore.getState().sessionId).toBe('s2')
  })

  it('clearSession drops the session but keeps the tab', () => {
    useStore.getState().setSession('s1', 'cube.fe')
    useStore.getState().setStats(1.5, 2.5)
    useStore.getState().clearSession()
    const s = useStore.getState()
    expect(s.sessionId).toBeNull()
    expect(s.energy).toBeNull()
    expect(s.activeFile).toBe('cube.fe')
    expect(s.openFiles).toEqual(['cube.fe'])
  })

  it('removeOpenFile tears down the session only if it was the active file', () => {
    useStore.getState().setSession('s1', 'cube.fe')
    useStore.getState().setSession('s1', 'sphere.fe') // adds a second tab, stays active
    useStore.getState().removeOpenFile('cube.fe') // not active — session survives
    expect(useStore.getState().sessionId).toBe('s1')
    expect(useStore.getState().openFiles).toEqual(['sphere.fe'])

    useStore.getState().removeOpenFile('sphere.fe') // active — session torn down
    const s = useStore.getState()
    expect(s.sessionId).toBeNull()
    expect(s.activeFile).toBeNull()
    expect(s.openFiles).toEqual([])
  })

  it('appendLog caps the log at 1000 lines', () => {
    for (let i = 0; i < 1005; i++) useStore.getState().appendLog(`line ${i}`)
    const log = useStore.getState().outputLog
    expect(log.length).toBe(1000)
    expect(log[0]).toBe('line 5')
    expect(log[log.length - 1]).toBe('line 1004')
  })

  it('bumpMeshVersion increments', () => {
    const before = useStore.getState().meshVersion
    useStore.getState().bumpMeshVersion()
    expect(useStore.getState().meshVersion).toBe(before + 1)
  })
})
