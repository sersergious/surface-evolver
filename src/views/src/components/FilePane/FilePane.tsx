import { useEffect, useState } from 'react'
import { createSession, getRestore } from '../../api/sessions'
import { exportFe } from '../../api/export'
import { useAppState } from '../../store/AppContext'
import { useMenuAction } from '../../hooks/useMenuAction'
import FileBrowserModal from './FileBrowserModal'

export default function FilePane() {
  const {
    sessionId, activeFile, openFiles,
    setSession, setStats, setFileContent, appendLog, removeOpenFile,
  } = useAppState()

  const [loadingFile, setLoadingFile] = useState<string | null>(null)
  const [fileErrors,  setFileErrors]  = useState<Record<string, string>>({})
  const [browserOpen, setBrowserOpen] = useState(false)

  const clearError = (file: string) =>
    setFileErrors(prev => { const n = { ...prev }; delete n[file]; return n })

  // Auto-restore the previous run's evolved surface (once, on first mount).
  useEffect(() => {
    let cancelled = false
    getRestore().then(s => {
      if (cancelled || !s) return
      setSession(s.session_id, s.fe_file)
      setStats(s.energy, s.area)
      appendLog(`Restored previous session: ${s.fe_file}`)
      exportFe(s.session_id).then(fe => setFileContent(fe.content)).catch(() => {})
    }).catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Native File ▸ Reload Surface — re-create the session for the active file.
  useMenuAction(async a => {
    if (a !== 'file:reload' || !activeFile || loadingFile) return
    setLoadingFile(activeFile)
    try {
      appendLog(`Reloading ${activeFile}…`)
      const session = await createSession(activeFile)
      setSession(session.session_id, activeFile)
      setStats(session.energy, session.area)
      appendLog(`Reloaded ${activeFile}`)
    } catch (err: unknown) {
      appendLog(`[error] ${activeFile}: ${(err instanceof Error ? err.message : String(err)).replace(/^Error:\s*/i, '')}`)
    } finally {
      setLoadingFile(null)
    }
  })

  async function handleSelect(file: string) {
    if (loadingFile) return
    if (activeFile === file && !fileErrors[file]) return
    clearError(file)
    setLoadingFile(file)
    try {
      appendLog(`Loading ${file}…`)
      const session = await createSession(file)
      setSession(session.session_id, file)   // also adds to openFiles
      setStats(session.energy, session.area)
      appendLog(`Loaded ${file} — session ${session.session_id.slice(0, 8)}`)
      if ((session.lagrange_order ?? 1) > 1)
        appendLog(`[warning] ${file}: Lagrange order ${session.lagrange_order} — curved patches render as straight edges`)
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

  function closeFile(e: React.MouseEvent, file: string) {
    e.stopPropagation()
    clearError(file)
    removeOpenFile(file)
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Section header with Add button */}
      <div className="flex items-center justify-between pl-3 pr-1.5 py-1.5 border-b border-base-300 shrink-0">
        <span className="text-[10px] font-bold tracking-[0.12em] uppercase text-base-content/40">Files</span>
        <button
          className="btn btn-ghost btn-xs btn-square text-base-content/60 hover:text-base-content"
          onClick={() => setBrowserOpen(true)}
          title="Add .fe file"
        >+</button>
      </div>

      {/* Open files */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {openFiles.length === 0 && (
          <p className="px-3 py-3 text-xs text-base-content/40">
            No open files. Press <span className="font-bold">+</span> to add a .fe file.
          </p>
        )}

        <ul className="menu menu-sm w-full py-1 px-1 gap-0.5">
          {openFiles.map((f) => {
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
                    // Light tinted highlight for the selected row instead of daisyUI's
                    // `active` (which fills it with the dark neutral colour → in light
                    // mode the row goes dark and the ✕ is hard to see).
                    isActive && !hasError ? '!bg-primary/15 text-base-content font-medium' : '',
                    hasError ? 'text-error hover:text-error' : '',
                  ].join(' ')}
                >
                  <span className="flex-1 min-w-0">
                    <span className="block truncate">{f}</span>
                    {isActive && sessionId && !isLoading && (
                      <span className="block truncate text-[10px] font-mono text-base-content/50">#{sessionId.slice(0, 6)}</span>
                    )}
                  </span>
                  {isLoading && <span className="loading loading-dots loading-xs shrink-0" />}
                  {hasError && !isLoading && (
                    <span className="shrink-0 text-error" title={fileErrors[f]}>⚠</span>
                  )}
                  <button
                    className="shrink-0 px-1 text-base-content/40 hover:text-error"
                    onClick={e => closeFile(e, f)}
                    title="Close file"
                  >✕</button>
                </a>
              </li>
            )
          })}
        </ul>
      </div>

      <FileBrowserModal
        open={browserOpen}
        onClose={() => setBrowserOpen(false)}
        onPick={handleSelect}
      />
    </div>
  )
}
