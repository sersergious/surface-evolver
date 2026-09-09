import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FilePane from './FilePane'
import { useStore } from '../../store/useStore'

vi.mock('../../api/sessions', () => ({
  createSession: vi.fn(),
  getRestore: vi.fn().mockResolvedValue(null),
  lagrangeWarning: vi.fn().mockReturnValue(null),
}))
vi.mock('../../api/export', () => ({ exportFe: vi.fn().mockResolvedValue({ filename: 'f', content: '' }) }))

import { createSession, getRestore } from '../../api/sessions'

const initial = useStore.getState()

describe('FilePane', () => {
  beforeEach(() => {
    useStore.setState(initial, true)
    vi.mocked(createSession).mockReset()
    vi.mocked(getRestore).mockReset().mockResolvedValue(null)
  })

  it('shows the empty state when no files are open', async () => {
    render(<FilePane />)
    expect(await screen.findByText(/No open files/)).toBeInTheDocument()
  })

  it('resumes a restored session on mount', async () => {
    vi.mocked(getRestore).mockResolvedValue({
      session_id: 's1', fe_file: 'cube.fe', energy: 1.2, area: 3.4, lagrange_order: 1,
    })
    render(<FilePane />)
    await waitFor(() => expect(useStore.getState().sessionId).toBe('s1'))
    expect(useStore.getState().activeFile).toBe('cube.fe')
    expect(useStore.getState().outputLog.some(l => l.includes('Restored previous session'))).toBe(true)
    expect(await screen.findByText('cube.fe')).toBeInTheDocument()
  })

  it('clicking an open (inactive) tab loads it', async () => {
    useStore.setState({
      openFiles: ['cube.fe', 'sphere.fe'], activeFile: 'cube.fe', sessionId: 's-old',
    })
    vi.mocked(createSession).mockResolvedValue({
      session_id: 's-new', fe_file: 'sphere.fe', energy: 0, area: 0, lagrange_order: 1,
    })

    render(<FilePane />)
    const user = userEvent.setup()
    await user.click(screen.getByText('sphere.fe'))

    await waitFor(() => expect(createSession).toHaveBeenCalledWith('sphere.fe'))
    await waitFor(() => expect(useStore.getState().sessionId).toBe('s-new'))
    expect(useStore.getState().activeFile).toBe('sphere.fe')
  })

  it('surfaces a load failure as a per-file error, not a thrown exception', async () => {
    useStore.setState({ openFiles: ['broken.fe'], activeFile: null, sessionId: null })
    vi.mocked(createSession).mockRejectedValue(new Error('File not found: broken.fe'))

    render(<FilePane />)
    const user = userEvent.setup()
    await user.click(screen.getByText('broken.fe'))

    expect(await screen.findByText('⚠')).toBeInTheDocument()
    expect(useStore.getState().outputLog.some(l => l.includes('File not found: broken.fe'))).toBe(true)
  })

  it('closing a tab removes it without calling the backend', async () => {
    useStore.setState({ openFiles: ['cube.fe'], activeFile: 'cube.fe', sessionId: 's1' })
    render(<FilePane />)
    const user = userEvent.setup()
    await user.click(screen.getByTitle('Close file'))
    expect(useStore.getState().openFiles).toEqual([])
    expect(createSession).not.toHaveBeenCalled()
  })
})
