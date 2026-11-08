// Native menu routes end to end: a Tauri `se-menu` event (as src-tauri/src/
// menu.rs emits it) → api/client.ts's bridge → the owning component → the rpc
// that reaches Rust. Nothing between the event and the IPC boundary is mocked.
import { describe, expect, it, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { emit } from '@tauri-apps/api/event'
import { answerRpc, ipc } from './test/ipc'
import CliPane from './components/CliPane/CliPane'
import FilePane from './components/FilePane/FilePane'
import { useStore } from './store/useStore'

const initial = useStore.getState()
beforeEach(() => useStore.setState(initial, true))

describe('native menu routes', () => {
  it('Run ▸ Iterate ×100 (iterate:100) runs `g 100` and updates the stats', async () => {
    useStore.setState({ sessionId: 's1' })
    answerRpc({ runCommand: { output: '', energy: 4.9, area: 6.0 } })
    render(<CliPane />)

    await emit('se-menu', 'iterate:100')

    await waitFor(() => expect(useStore.getState().energy).toBe(4.9))
    expect(ipc).toHaveBeenCalledWith('rpc', {
      method: 'runCommand', params: { sessionId: 's1', command: 'g 100' },
    })
  })

  it('File ▸ Reload Surface (file:reload) re-creates the active file\'s session', async () => {
    useStore.setState({ openFiles: ['cube.fe'], activeFile: 'cube.fe', sessionId: 's-old' })
    answerRpc({
      createSession: { session_id: 's-new', fe_file: 'cube.fe', energy: 6, area: 6, lagrange_order: 1 },
    })
    render(<FilePane />)

    await emit('se-menu', 'file:reload')

    await waitFor(() => expect(useStore.getState().sessionId).toBe('s-new'))
    expect(ipc).toHaveBeenCalledWith('rpc', { method: 'createSession', params: { fe_file: 'cube.fe' } })
  })

  it('file:reload with no active file does nothing', async () => {
    render(<FilePane />)
    await emit('se-menu', 'file:reload')
    expect(ipc).not.toHaveBeenCalledWith('rpc', expect.objectContaining({ method: 'createSession' }))
  })
})
