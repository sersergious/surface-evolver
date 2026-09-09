import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CliPane from './CliPane'
import { useStore } from '../../store/useStore'
import type { RunCommandResponse } from '../../api/simulation'

vi.mock('../../api/simulation', () => ({
  runCommand: vi.fn(),
  runTopo: vi.fn(),
}))
vi.mock('../../api/sessions', () => ({ cancelSession: vi.fn() }))

import { runCommand, runTopo } from '../../api/simulation'
import { cancelSession } from '../../api/sessions'

const initial = useStore.getState()

describe('CliPane', () => {
  beforeEach(() => {
    useStore.setState(initial, true)
    vi.mocked(runCommand).mockReset()
    vi.mocked(runTopo).mockReset()
    vi.mocked(cancelSession).mockReset()
  })

  it('the input is disabled until a session is loaded', () => {
    render(<CliPane />)
    expect(screen.getByPlaceholderText('Load a file first')).toBeDisabled()
  })

  it('running a command appends its output and updates stats (Landmine 8: appendLog is the only error channel)', async () => {
    useStore.setState({ sessionId: 's1' })
    vi.mocked(runCommand).mockResolvedValue({ output: 'evolved', energy: 4.9, area: 6.0 })
    render(<CliPane />)
    const user = userEvent.setup()

    await user.type(screen.getByPlaceholderText('SE command…'), 'g 5{Enter}')

    expect(runCommand).toHaveBeenCalledWith('s1', 'g 5')
    expect(await screen.findByText('evolved')).toBeInTheDocument()
    expect(useStore.getState().energy).toBe(4.9)
  })

  it('a rejected command appends [error] to the log instead of throwing', async () => {
    useStore.setState({ sessionId: 's1' })
    vi.mocked(runCommand).mockRejectedValue(new Error('interactive command needs a value'))
    render(<CliPane />)
    const user = userEvent.setup()

    await user.type(screen.getByPlaceholderText('SE command…'), 'f{Enter}')

    expect(await screen.findByText('[error] interactive command needs a value')).toBeInTheDocument()
  })

  it('clicking Stop while busy cancels the session and clears it', async () => {
    useStore.setState({ sessionId: 's1' })
    let resolveRun!: (v: RunCommandResponse) => void
    vi.mocked(runCommand).mockReturnValue(new Promise(r => { resolveRun = r }))
    vi.mocked(cancelSession).mockResolvedValue(undefined)

    render(<CliPane />)
    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText('SE command…'), 'g 1000{Enter}')

    const stopButton = await screen.findByRole('button', { name: 'Stop' })
    await user.click(stopButton)

    expect(cancelSession).toHaveBeenCalled()
    expect(useStore.getState().sessionId).toBeNull()
    expect(screen.getByText(/engine killed/)).toBeInTheDocument()

    resolveRun({ output: '', energy: null, area: null }) // let the pending call settle
  })

  it('a native Run menu action (run:refine) triggers the matching topo op', async () => {
    useStore.setState({ sessionId: 's1' })
    vi.mocked(runTopo).mockResolvedValue({
      output: '', counts: { vertices: 3 }, energy: 1, energy_delta: -0.01, area: 1,
    })
    render(<CliPane />)

    window.dispatchEvent(new CustomEvent('se-menu', { detail: 'run:refine' }))

    await vi.waitFor(() => expect(runTopo).toHaveBeenCalledWith('s1', 'refine'))
    expect(await screen.findByText(/vertices \+3/)).toBeInTheDocument()
  })
})
