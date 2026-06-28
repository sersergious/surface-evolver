import { useEffect, useRef, useState, useCallback } from 'react'
import { listFiles, uploadFile } from '../../api/files'
import { createSession } from '../../api/sessions'
import { exportFe } from '../../api/export'
import { useAppState } from '../../store/AppContext'

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + 8192, bytes.length)))
  }
  return btoa(binary)
}

export default function FilePane() {
  const { activeFile, setSession, setStats, setFileContent, appendLog } = useAppState()

  const [files,       setFiles]       = useState<string[]>([])
  const [loading,     setLoading]     = useState(true)
  const [loadingFile, setLoadingFile] = useState<string | null>(null)
  const [fileErrors,  setFileErrors]  = useState<Record<string, string>>({})
  const [uploading,   setUploading]   = useState(false)
  const [uploadErr,   setUploadErr]   = useState<string | null>(null)
  const [dragging,    setDragging]    = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const clearError = (file: string) =>
    setFileErrors(prev => { const n = { ...prev }; delete n[file]; return n })

  const refreshFiles = useCallback(async () => {
    setLoading(true)
    try   { setFiles(await listFiles()) }
    catch { setFiles([]) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { refreshFiles() }, [refreshFiles])

  async function handleSelect(file: string) {
    if (loadingFile) return
    if (activeFile === file && !fileErrors[file]) return
    clearError(file)
    setLoadingFile(file)
    try {
      appendLog(`Loading ${file}…`)
      const session = await createSession(file)
      setSession(session.session_id, file)
      setStats(session.energy, session.area)
      appendLog(`Loaded ${file} — session ${session.session_id.slice(0, 8)}`)
      try {
        const fe = await exportFe(session.session_id)
        setFileContent(fe.content)
      } catch { /* editor stays empty */ }
    } catch (err: unknown) {
      const msg = (err instanceof Error ? err.message : String(err)).replace(/^Error:\s*/i, '')
      setFileErrors(prev => ({ ...prev, [file]: msg }))
      appendLog(`[error] ${file}: ${msg}`)
    } finally {
      setLoadingFile(null)
    }
  }

  async function handleFiles(fileList: FileList | null) {
    if (!fileList?.length) return
    const file = fileList[0]
    if (!file.name.endsWith('.fe')) { setUploadErr('Only .fe files are accepted'); return }
    setUploading(true); setUploadErr(null)
    try {
      const result = await uploadFile(file.name, arrayBufferToBase64(await file.arrayBuffer()))
      appendLog(`Uploaded ${result.filename} (${result.size_bytes} bytes)`)
      await refreshFiles()
      if (result.renderable) await handleSelect(result.filename)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setUploadErr(msg.length > 80 ? msg.slice(0, 77) + '…' : msg)
      appendLog(`[error] Upload failed: ${msg}`)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const onDrop     = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const onDragOver  = (e: React.DragEvent) => { e.preventDefault(); setDragging(true) }
  const onDragLeave = () => setDragging(false)

  return (
    <div
      className={`flex flex-col h-full min-h-0 transition-colors duration-100 ${dragging ? 'ring-2 ring-inset ring-primary' : ''}`}
      onDrop={onDrop} onDragOver={onDragOver} onDragLeave={onDragLeave}
    >
      {/* Section header */}
      <div className="px-3 py-2 text-[10px] font-bold tracking-[0.12em] uppercase text-base-content/40 border-b border-base-300 shrink-0">
        Files
      </div>

      {/* File list */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading && (
          <div className="px-3 py-3 flex items-center gap-2 text-xs text-base-content/40">
            <span className="loading loading-dots loading-xs" />
            Loading…
          </div>
        )}
        {!loading && files.length === 0 && (
          <p className="px-3 py-3 text-xs text-base-content/40">No .fe files found</p>
        )}

        <ul className="menu menu-sm w-full py-1 px-1 gap-0.5">
          {files.map((f) => {
            const isActive  = activeFile === f
            const isLoading = loadingFile === f
            const hasError  = Boolean(fileErrors[f])
            const isBusy    = Boolean(loadingFile && !isLoading)

            return (
              <li key={f} className={isBusy ? 'opacity-40 pointer-events-none' : ''}>
                <a
                  onClick={() => !isBusy && handleSelect(f)}
                  title={hasError ? fileErrors[f] : f}
                  className={[
                    'flex items-center gap-1 py-1.5 font-mono text-xs leading-none rounded',
                    isActive && !hasError ? 'active' : '',
                    hasError ? 'text-error hover:text-error' : '',
                  ].join(' ')}
                >
                  <span className="truncate flex-1 min-w-0">{f}</span>
                  {isLoading && <span className="loading loading-dots loading-xs shrink-0" />}
                  {hasError && !isLoading && (
                    <span className="shrink-0 text-error" title={fileErrors[f]}>⚠</span>
                  )}
                </a>
              </li>
            )
          })}
        </ul>
      </div>

      {/* Upload footer */}
      <div className="shrink-0 border-t border-base-300 p-2 space-y-1.5">
        {uploadErr && (
          <p className="text-[11px] text-error leading-tight break-words" title={uploadErr}>
            {uploadErr}
          </p>
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
  )
}
