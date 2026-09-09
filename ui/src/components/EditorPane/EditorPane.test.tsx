import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EditorPane from './EditorPane'
import { useStore } from '../../store/useStore'

vi.mock('../../api/export', () => ({
  exportDmp: vi.fn(),
  exportFe: vi.fn(),
  updateFile: vi.fn(),
  saveExport: vi.fn(),
}))
vi.mock('../../api/sessions', () => ({
  createSession: vi.fn(),
  lagrangeWarning: vi.fn().mockReturnValue(null),
}))

import { exportDmp, exportFe, updateFile, saveExport } from '../../api/export'
import { createSession } from '../../api/sessions'

const initial = useStore.getState()

describe('EditorPane', () => {
  beforeEach(() => {
    useStore.setState(initial, true)
    vi.mocked(exportDmp).mockReset()
    vi.mocked(exportFe).mockReset()
    vi.mocked(updateFile).mockReset()
    vi.mocked(saveExport).mockReset()
    vi.mocked(createSession).mockReset()
  })

  it('shows a placeholder and disables actions when no session is loaded', () => {
    render(<EditorPane />)
    expect(screen.getByText('Load a .fe file to edit')).toBeInTheDocument()
    expect(screen.getByTitle('Download .fe source')).toBeDisabled()
    expect(screen.getByTitle('Download SE dump')).toBeDisabled()
  })

  it('Save & Reload calls updateFile then createSession with the edited content', async () => {
    useStore.setState({ sessionId: 's1', activeFile: 'cube.fe', fileContent: 'original text' })
    vi.mocked(updateFile).mockResolvedValue({ filename: 'cube.fe', size_bytes: 5 })
    vi.mocked(createSession).mockResolvedValue({
      session_id: 's2', fe_file: 'cube.fe', energy: 1, area: 1, lagrange_order: 1,
    })
    render(<EditorPane />)

    // CodeMirror mounts real DOM; typing into its contenteditable marks the
    // buffer dirty, which is what enables the Save button.
    const user = userEvent.setup()
    const editable = document.querySelector('.cm-content') as HTMLElement
    editable.focus()
    await user.type(editable, '!')

    const saveButton = await screen.findByRole('button', { name: /Save & Reload/ })
    await waitFor(() => expect(saveButton).toBeEnabled())
    await user.click(saveButton)

    await waitFor(() => expect(updateFile).toHaveBeenCalledWith('cube.fe', expect.stringContaining('original text')))
    await waitFor(() => expect(createSession).toHaveBeenCalledWith('cube.fe'))
    expect(useStore.getState().sessionId).toBe('s2')
  })

  it('downloading .fe exports then saves to disk', async () => {
    useStore.setState({ sessionId: 's1', activeFile: 'cube.fe', fileContent: '' })
    vi.mocked(exportFe).mockResolvedValue({ filename: 'cube.fe', content: 'the source' })
    vi.mocked(saveExport).mockResolvedValue({ path: '/Users/x/Downloads/cube.fe' })
    render(<EditorPane />)

    const user = userEvent.setup()
    await user.click(screen.getByTitle('Download .fe source'))

    await waitFor(() => expect(exportFe).toHaveBeenCalledWith('s1'))
    await waitFor(() => expect(saveExport).toHaveBeenCalledWith('cube.fe', 'the source'))
    // outputLog is rendered by CliPane, not EditorPane — assert the shared
    // store directly rather than querying a sibling that isn't mounted here.
    await waitFor(() => expect(useStore.getState().outputLog).toContain('Exported /Users/x/Downloads/cube.fe'))
  })

  it('a failed export appends [error] instead of throwing', async () => {
    useStore.setState({ sessionId: 's1', activeFile: 'cube.fe', fileContent: '' })
    vi.mocked(exportDmp).mockRejectedValue(new Error('worker crashed'))
    render(<EditorPane />)

    const user = userEvent.setup()
    await user.click(screen.getByTitle('Download SE dump'))

    await waitFor(() => expect(useStore.getState().outputLog).toContain('[error] Export .dmp failed: worker crashed'))
  })
})
