import { useEffect, useRef, useState, useCallback } from 'react'
import { listFiles, uploadFile } from '../../api/files'
import { useStore } from '../../store/useStore'

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + 8192, bytes.length)))
  }
  return btoa(binary)
}

/**
 * Modal file browser: bundled .fe library + upload. `onPick(file)` is called
 * when the user chooses a built-in file or after a successful upload; the
 * caller opens it (creates the session and adds it to the open-files list).
 */
export default function FileBrowserModal({ open, onClose, onPick }: {
  open: boolean
  onClose: () => void
  onPick: (file: string) => void
}) {
  const { appendLog } = useStore()
  const [files,     setFiles]     = useState<string[]>([])
  const [loading,   setLoading]   = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadErr, setUploadErr] = useState<string | null>(null)
  const [dragging,  setDragging]  = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const refreshFiles = useCallback(async () => {
    setLoading(true)
    try   { setFiles(await listFiles()) }
    catch { setFiles([]) }
    finally { setLoading(false) }
  }, [])

  // Refresh the library each time the modal opens.
  useEffect(() => { if (open) { setUploadErr(null); refreshFiles() } }, [open, refreshFiles])

  async function handleFiles(fileList: FileList | null) {
    if (!fileList?.length) return
    const file = fileList[0]
    if (!file.name.endsWith('.fe')) { setUploadErr('Only .fe files are accepted'); return }
    setUploading(true); setUploadErr(null)
    try {
      const result = await uploadFile(file.name, arrayBufferToBase64(await file.arrayBuffer()))
      appendLog(`Uploaded ${result.filename} (${result.size_bytes} bytes)`)
      await refreshFiles()
      if (result.renderable) { onPick(result.filename); onClose() }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setUploadErr(msg.length > 80 ? msg.slice(0, 77) + '…' : msg)
      appendLog(`[error] Upload failed: ${msg}`)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* dialog */}
      <div
        className={`relative z-10 flex flex-col w-[28rem] max-w-[90vw] max-h-[80vh] rounded-box border border-base-300 bg-base-100 shadow-2xl overflow-hidden ${dragging ? 'ring-2 ring-inset ring-primary' : ''}`}
        onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
      >
        {/* header */}
        <div className="flex items-center justify-between px-4 h-11 shrink-0 border-b border-base-300 bg-base-200">
          <span className="text-sm font-semibold">Open .fe file</span>
          <button className="btn btn-ghost btn-xs btn-square" onClick={onClose} title="Close">✕</button>
        </div>

        {/* library list */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading && (
            <div className="px-4 py-3 flex items-center gap-2 text-xs text-base-content/40">
              <span className="loading loading-dots loading-xs" /> Loading…
            </div>
          )}
          {!loading && files.length === 0 && (
            <p className="px-4 py-3 text-xs text-base-content/40">No .fe files found</p>
          )}
          <ul className="menu menu-sm w-full py-1 px-1 gap-0.5">
            {files.map(f => (
              <li key={f}>
                <a
                  className="flex items-center gap-1 py-1.5 font-mono text-xs leading-none rounded"
                  onClick={() => { onPick(f); onClose() }}
                  title={f}
                >
                  <span className="truncate flex-1 min-w-0">{f}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>

        {/* upload footer */}
        <div className="shrink-0 border-t border-base-300 p-2 space-y-1.5">
          {uploadErr && (
            <p className="text-[11px] text-error leading-tight break-words" title={uploadErr}>{uploadErr}</p>
          )}
          <button
            className={`btn btn-sm btn-block btn-ghost border border-base-300 normal-case text-xs font-normal ${uploading ? 'loading' : ''}`}
            onClick={() => !uploading && fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? 'Uploading…' : dragging ? 'Drop to upload' : '+ Upload .fe'}
          </button>
          <input
            ref={fileInputRef} type="file" accept=".fe" className="hidden"
            onChange={e => handleFiles(e.target.files)}
          />
        </div>
      </div>
    </div>
  )
}
