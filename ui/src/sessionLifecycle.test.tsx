// Save and session lifecycle, asserted at the IPC boundary (test/ipc.ts):
// which rpc calls reach Rust, and what the UI does with their failures.
import { describe, expect, it, beforeEach } from 'vitest'
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react'
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

const editorText = () => document.querySelector('.cm-content')?.textContent ?? null

describe('the editor across session changes', () => {
  it('keeps its text when the session ends and returns, and Save stays truthful (blank-but-dirty bug)', async () => {
    useStore.setState({ openFiles: ['cube.fe'], activeFile: 'cube.fe', sessionId: 's1', fileContent: 'vertices' })
    render(<EditorPane />)
    const editable = document.querySelector('.cm-content') as HTMLElement
    editable.focus()
    await userEvent.setup().type(editable, '!')
    const edited = editorText()
    expect(edited).toMatch(/!/)

    act(() => useStore.getState().clearSession())        // Stop, crash, failed reload
    expect(editorText()).toBe(edited)
    act(() => useStore.setState({ sessionId: 's2' }))     // reopened
    expect(editorText()).toBe(edited)

    // The unsaved edit is still on screen, so Save & Reload is legitimately on.
    expect(screen.getByRole('button', { name: /Save & Reload/ })).toBeEnabled()
  })

  it('a file that fails to load shows its text from disk, and can be fixed and reloaded without a session', async () => {
    useStore.setState({ openFiles: ['cube.fe'], activeFile: null, sessionId: null, fileContent: null })
    let loads = 0
    ipc.mockImplementation((cmd, args) => {
      const { method, params } = (args ?? {}) as { method?: string; params?: Record<string, unknown> }
      if (cmd !== 'rpc') return null
      if (method === 'createSession') {
        loads++
        if (loads === 1) throw 'Session ended: ERROR 1157: Facet 6: edge 99 is not defined.'
        return { session_id: 's-fixed', fe_file: 'cube.fe', energy: 6, area: 6, lagrange_order: 1 }
      }
      if (method === 'readFile') return { filename: 'cube.fe', content: 'faces 1 2 99' }
      if (method === 'updateFile') return { filename: 'cube.fe', size_bytes: String(params?.content).length }
      return null
    })
    render(<><FilePane /><EditorPane /></>)
    const user = userEvent.setup()

    await user.click(screen.getByText('cube.fe'))
    await waitFor(() => expect(editorText()).toContain('faces 1 2 99'))
    expect(useStore.getState().sessionId).toBeNull()

    const editable = document.querySelector('.cm-content') as HTMLElement
    editable.focus()
    await user.keyboard('{End}{Backspace}{Backspace}')     // remove the bad edge "99"
    await user.click(screen.getByRole('button', { name: /Save & Reload/ }))

    await waitFor(() => expect(useStore.getState().sessionId).toBe('s-fixed'))
    const saved = ipc.mock.calls.find(([, a]) => (a as { method?: string }).method === 'updateFile')
    expect((saved?.[1] as { params: { content: string } }).params.content).toBe('faces 1 2 ')
  })
})

describe('Stop', () => {
  it('does not report the stopped command as a crash', async () => {
    useStore.setState({ openFiles: ['cube.fe'], activeFile: 'cube.fe', sessionId: 's1' })
    let failRun!: (e: unknown) => void
    ipc.mockImplementation((cmd, args) => {
      const { method } = (args ?? {}) as { method?: string }
      if (cmd !== 'rpc') return null
      // The killed worker's in-flight request fails after Stop, as rpc.rs reports it.
      if (method === 'runCommand') return new Promise((_, reject) => { failRun = reject })
      if (method === 'cancel') return { cancelled: true }
      return null
    })
    render(<CliPane />)
    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText('SE command…'), 'g 100000{Enter}')
    await user.click(await screen.findByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(useStore.getState().outputLog.some(l => l.includes('[stopped]'))).toBe(true))

    failRun('Session ended: SE engine process crashed — reload the file to continue')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run' })).toBeInTheDocument())
    expect(useStore.getState().outputLog.some(l => l.includes('crashed'))).toBe(false)
  })
})

describe('Stop with an interrupt (#35)', () => {
  it('keeps the session and the evolved surface, and refreshes the stats', async () => {
    useStore.setState({ openFiles: ['cube.fe'], activeFile: 'cube.fe', sessionId: 's1', energy: 6 })
    let failRun!: (e: unknown) => void
    const runs: string[] = []
    ipc.mockImplementation((cmd, args) => {
      const { method, params } = (args ?? {}) as { method?: string; params?: { command?: string } }
      if (cmd !== 'rpc') return null
      if (method === 'runCommand') {
        runs.push(params?.command ?? '')
        if (params?.command === 'g 200000') return new Promise((_, reject) => { failRun = reject })
        return { output: '', energy: 4.88, area: 4.88 }      // the surface as interrupted
      }
      if (method === 'cancel') {
        failRun('ERROR 2073: Command aborted due to user interrupt.')
        return { cancelled: true, interrupted: true }
      }
      return null
    })
    render(<CliPane />)
    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText('SE command…'), 'g 200000{Enter}')
    await user.click(await screen.findByRole('button', { name: 'Stop' }))

    await waitFor(() => expect(useStore.getState().energy).toBe(4.88))
    expect(useStore.getState().sessionId).toBe('s1')
    const log = useStore.getState().outputLog
    expect(log.some(l => l.includes('[stopped]') && l.includes('kept'))).toBe(true)
    expect(log.some(l => l.startsWith('[error]'))).toBe(false)
    expect(runs).toContain('')                               // stats refreshed from the engine
  })
})

describe('Save & Reload keeps the editing session (#23)', () => {
  it('undo still works after a successful save, and the text stays put', async () => {
    useStore.setState({ openFiles: ['cube.fe'], activeFile: 'cube.fe', sessionId: 's1', fileContent: 'vertices' })
    answerRpc({
      updateFile: { filename: 'cube.fe', size_bytes: 9 },
      createSession: { session_id: 's2', fe_file: 'cube.fe', energy: 1, area: 1, lagrange_order: 1 },
    })
    render(<EditorPane />)
    const user = userEvent.setup()
    const editable = document.querySelector('.cm-content') as HTMLElement
    editable.focus()
    await user.type(editable, 'Z')
    const edited = editorText()
    expect(edited).toMatch(/Z/)

    await user.click(screen.getByRole('button', { name: /Save & Reload/ }))
    await waitFor(() => expect(useStore.getState().sessionId).toBe('s2'))
    expect(editorText()).toBe(edited)

    // The view was not rebuilt, so the edit is still in its undo history.
    editable.focus()
    await user.keyboard('{Control>}z{/Control}')
    expect(editorText()).toBe('vertices')
  })
})

describe('closing a tab while its command runs (#24)', () => {
  it('stops the command, and the CLI comes back instead of staying busy', async () => {
    useStore.setState({ openFiles: ['cube.fe'], activeFile: 'cube.fe', sessionId: 's1' })
    let failRun!: (e: unknown) => void
    const methods: string[] = []
    ipc.mockImplementation((cmd, args) => {
      const { method } = (args ?? {}) as { method?: string }
      if (cmd !== 'rpc') return null
      methods.push(method ?? '')
      if (method === 'runCommand') return new Promise((_, reject) => { failRun = reject })
      if (method === 'cancel') {
        failRun('ERROR 2073: Command aborted due to user interrupt.')
        return { cancelled: true, interrupted: true }
      }
      return null
    })
    render(<><FilePane /><CliPane /></>)
    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText('SE command…'), 'g 200000{Enter}')
    await screen.findByRole('button', { name: 'Stop' })

    await user.click(screen.getByTitle('Close file'))

    await waitFor(() => expect(methods).toContain('cancel'))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument())
    expect(useStore.getState().outputLog.some(l => l.startsWith('[error]'))).toBe(false)
  })
})
