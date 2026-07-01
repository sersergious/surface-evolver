import { useEffect, useRef, useState, useCallback } from 'react'
import { EditorView, lineNumbers, drawSelection, keymap } from '@codemirror/view'
import { EditorState }                                    from '@codemirror/state'
import { defaultKeymap, history, historyKeymap,
         indentWithTab }                                  from '@codemirror/commands'
import { indentOnInput, bracketMatching }                 from '@codemirror/language'
import { feLanguage }                                     from './feLanguage'
import { seTheme }                                        from './seTheme'
import { exportDmp, exportFe, updateFile, triggerDownload } from '../../api/export'
import { createSession }                                  from '../../api/sessions'
import { useAppState }                                    from '../../store/AppContext'

export default function EditorPane() {
  const { sessionId, activeFile, fileContent, setSession, setStats, setFileContent, appendLog } = useAppState()

  const editorRef  = useRef<HTMLDivElement>(null)
  const viewRef    = useRef<EditorView | null>(null)
  const [dirty,     setDirty]     = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [exporting, setExporting] = useState<'dmp' | 'fe' | null>(null)

  useEffect(() => {
    if (!editorRef.current) return

    const extensions = [
      lineNumbers(), drawSelection(), history(), indentOnInput(), bracketMatching(),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      feLanguage, seTheme,
      EditorView.updateListener.of(u => { if (u.docChanged) setDirty(true) }),
    ]

    if (viewRef.current) {
      const newDoc = fileContent ?? ''
      const cur    = viewRef.current.state.doc.toString()
      if (newDoc !== cur) {
        viewRef.current.dispatch({ changes: { from: 0, to: cur.length, insert: newDoc } })
        setDirty(false)
      }
      return
    }

    viewRef.current = new EditorView({
      state: EditorState.create({ doc: fileContent ?? '', extensions }),
      parent: editorRef.current,
    })
    setDirty(false)
    return () => { viewRef.current?.destroy(); viewRef.current = null }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileContent])

  const handleSave = useCallback(async () => {
    if (!activeFile || !sessionId || saving) return
    const content = viewRef.current?.state.doc.toString() ?? ''
    setSaving(true)
    try {
      await updateFile(activeFile, content)
      appendLog(`Saved ${activeFile} — reloading…`)
      const session = await createSession(activeFile)
      setSession(session.session_id, activeFile)
      setStats(session.energy, session.area)
      setFileContent(content)
      setDirty(false)
      appendLog(`Reloaded ${activeFile} — session ${session.session_id.slice(0, 8)}`)
      if ((session.lagrange_order ?? 1) > 1)
        appendLog(`[warning] ${activeFile}: Lagrange order ${session.lagrange_order} — curved patches render as straight edges`)
    } catch (err: unknown) {
      appendLog(`[error] Save failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally { setSaving(false) }
  }, [activeFile, sessionId, saving, appendLog, setSession, setStats, setFileContent])

  const handleDownload = useCallback(async (type: 'fe' | 'dmp') => {
    if (!sessionId || exporting) return
    setExporting(type)
    try {
      const result = type === 'fe' ? await exportFe(sessionId) : await exportDmp(sessionId)
      triggerDownload(result.filename, result.content, 'text/plain')
    } catch (err: unknown) {
      appendLog(`[error] Export .${type} failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally { setExporting(null) }
  }, [sessionId, exporting, appendLog])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); handleSave() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleSave])

  const noSession = !sessionId

  return (
    <div className="flex flex-col h-full bg-base-100">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-1.5 px-2 py-1.5 border-b border-base-300 bg-base-200">
        <span className="text-xs font-mono text-base-content/50 truncate flex-1 min-w-0">
          {activeFile ?? 'No file loaded'}
          {dirty && <span className="text-warning ml-1">●</span>}
        </span>

        <button
          className="btn btn-xs btn-ghost normal-case"
          onClick={handleSave}
          disabled={noSession || !dirty || saving}
          title="Save & Reload (⌘S)"
        >
          {saving ? <span className="loading loading-xs loading-spinner" /> : null}
          {saving ? 'Saving…' : 'Save & Reload'}
        </button>

        <div className="w-px h-4 bg-base-300 shrink-0" />

        <button
          className="btn btn-xs btn-ghost normal-case"
          onClick={() => handleDownload('fe')}
          disabled={noSession || !!exporting}
          title="Download .fe source"
        >
          {exporting === 'fe' ? <span className="loading loading-xs loading-spinner" /> : '↓ .fe'}
        </button>
        <button
          className="btn btn-xs btn-ghost normal-case"
          onClick={() => handleDownload('dmp')}
          disabled={noSession || !!exporting}
          title="Download SE dump"
        >
          {exporting === 'dmp' ? <span className="loading loading-xs loading-spinner" /> : '↓ .dmp'}
        </button>
      </div>

      {noSession ? (
        <div className="flex-1 flex items-center justify-center text-sm text-base-content/30 select-none">
          Load a .fe file to edit
        </div>
      ) : (
        <div ref={editorRef} className="flex-1 min-h-0 overflow-hidden" />
      )}
    </div>
  )
}
