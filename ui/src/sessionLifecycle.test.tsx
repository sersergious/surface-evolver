// Save and session lifecycle, asserted at the IPC boundary (test/ipc.ts):
// which rpc calls reach Rust, and what the UI does with their failures.
import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { answerRpc, ipc } from './test/ipc'
import EditorPane from './components/EditorPane/EditorPane'
import CliPane from './components/CliPane/CliPane'
import FilePane from './components/FilePane/FilePane'
import { useStore } from './store/useStore'

const initial = useStore.getState()
beforeEach(() => useStore.setState(initial, true))

const rpcMethods = () =>
  ipc.mock.calls.filter(([cmd]) => cmd === 'rpc').map(([, a]) => (a as { method: string }).method)

const pressSave = () => fireEvent.keyDown(window, { key: 's', metaKey: true })

describe('Save & Reload shortcut (#15)', () => {
  it('⌘S with no edits does nothing — the evolved surface is not reloaded from disk', async () => {
    useStore.setState({ sessionId: 's1', activeFile: 'cube.fe', fileContent: 'vertices' })
    render(<EditorPane />)

    pressSave()
    await new Promise(r => setTimeout(r, 0))

    expect(rpcMethods()).not.toContain('updateFile')
    expect(rpcMethods()).not.toContain('createSession')
  })

  it('⌘S after an edit saves and reloads', async () => {
    useStore.setState({ sessionId: 's1', activeFile: 'cube.fe', fileContent: 'vertices' })
    answerRpc({
      updateFile: { filename: 'cube.fe', size_bytes: 9 },
      createSession: { session_id: 's2', fe_file: 'cube.fe', energy: 1, area: 1, lagrange_order: 1 },
    })
    render(<EditorPane />)
    const editable = document.querySelector('.cm-content') as HTMLElement
    editable.focus()
    await userEvent.setup().type(editable, '!')

    pressSave()

    await waitFor(() => expect(useStore.getState().sessionId).toBe('s2'))
    expect(rpcMethods()).toEqual(expect.arrayContaining(['updateFile', 'createSession']))
  })
})

describe('a session that ends under the UI (#16)', () => {
  it('a worker crash mid-command drops the session, and clicking the tab reloads it', async () => {
    useStore.setState({ openFiles: ['cube.fe'], activeFile: 'cube.fe', sessionId: 's1', energy: 6 })
    answerRpc({
      // rpc.rs prefixes every session-ending error with "Session ended:"
      runCommand: new Error('Session ended: SE engine process crashed — reload the file to continue'),
      createSession: { session_id: 's2', fe_file: 'cube.fe', energy: 6, area: 6, lagrange_order: 1 },
    })
    render(<><FilePane /><CliPane /></>)
    const user = userEvent.setup()

    await user.type(screen.getByPlaceholderText('SE command…'), 'g 10{Enter}')
    await waitFor(() => expect(useStore.getState().sessionId).toBeNull())
    expect(useStore.getState().energy).toBeNull()   // no stale stats for a dead surface

    await user.click(screen.getByText('cube.fe'))
    await waitFor(() => expect(useStore.getState().sessionId).toBe('s2'))
  })

  it('an ordinary command error keeps the session', async () => {
    useStore.setState({ openFiles: ['cube.fe'], activeFile: 'cube.fe', sessionId: 's1' })
    answerRpc({ runCommand: new Error('ERROR 1441: Divide by zero.') })
    render(<CliPane />)

    await userEvent.setup().type(screen.getByPlaceholderText('SE command…'), 'x := 1/0{Enter}')
    await waitFor(() => expect(useStore.getState().outputLog.some(l => l.includes('Divide by zero'))).toBe(true))
    expect(useStore.getState().sessionId).toBe('s1')
  })
})
