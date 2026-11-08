// Upload and library behaviour, asserted at the IPC boundary (test/ipc.ts).
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { answerRpc, ipc } from '../../test/ipc'
import FileBrowserModal from './FileBrowserModal'

const uploadCalls = () =>
  ipc.mock.calls.filter(([cmd, a]) => cmd === 'rpc' && (a as { method: string }).method === 'uploadFile')

function setup() {
  const onPick = vi.fn(), onClose = vi.fn()
  render(<FileBrowserModal open onClose={onClose} onPick={onPick} />)
  return { onPick, onClose }
}

describe('FileBrowserModal', () => {
  it('lists the library and opens the file you click', async () => {
    answerRpc({ listFiles: ['cube.fe', 'phelanc.fe'] })
    const { onPick, onClose } = setup()

    await userEvent.setup().click(await screen.findByText('phelanc.fe'))

    expect(onPick).toHaveBeenCalledWith('phelanc.fe')
    expect(onClose).toHaveBeenCalled()
  })

  it('uploads a .fe as base64 and opens it', async () => {
    // Bigger than the component's 8 KB chunk, so the chunk join is exercised.
    // Expected: one whole-string btoa (the text is ASCII), not the chunked join.
    const text = 'SOAPFILM\n' + 'vertices\n'.repeat(1200)
    answerRpc({ listFiles: [], uploadFile: { filename: 'big.fe', size_bytes: text.length } })
    const { onPick } = setup()

    const input = document.querySelector('input[type=file]') as HTMLInputElement
    await userEvent.setup().upload(input, new File([text], 'big.fe'))

    await waitFor(() => expect(onPick).toHaveBeenCalledWith('big.fe'))
    expect(uploadCalls()).toHaveLength(1)
    expect(uploadCalls()[0][1]).toEqual({
      method: 'uploadFile',
      params: { filename: 'big.fe', content: btoa(text) },
    })
  })

  it('refuses a dropped non-.fe file before calling the backend', async () => {
    // Drag-and-drop bypasses the input's accept=".fe", so the check must hold.
    answerRpc({ listFiles: [] })
    const { onPick } = setup()
    const dialog = screen.getByText('Open .fe file').closest('div')!.parentElement!

    fireEvent.drop(dialog, { dataTransfer: { files: [new File(['x'], 'notes.txt')] } })

    expect(await screen.findByText('Only .fe files are accepted')).toBeInTheDocument()
    expect(uploadCalls()).toHaveLength(0)
    expect(onPick).not.toHaveBeenCalled()
  })

  it('shows a backend rejection and stays open', async () => {
    answerRpc({ listFiles: [], uploadFile: new Error('A file named cube.fe already exists') })
    const { onPick, onClose } = setup()

    const input = document.querySelector('input[type=file]') as HTMLInputElement
    await userEvent.setup().upload(input, new File(['SOAPFILM'], 'cube.fe'))

    expect(await screen.findByText('A file named cube.fe already exists')).toBeInTheDocument()
    expect(onPick).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })
})
