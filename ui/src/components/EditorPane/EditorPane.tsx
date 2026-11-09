import { useEffect, useRef, useState, useCallback } from 'react'
import { EditorView, lineNumbers, drawSelection, keymap } from '@codemirror/view'
import { EditorState }                                    from '@codemirror/state'
import { defaultKeymap, history, historyKeymap,
         indentWithTab }                                  from '@codemirror/commands'
import { indentOnInput, bracketMatching }                 from '@codemirror/language'
import { feLanguage }                                     from './feLanguage'
import { seTheme }                                        from './seTheme'
import { exportDmp, exportFe, updateFile, saveExport } from '../../api/export'
import { createSession, lagrangeWarning }                  from '../../api/sessions'
import { useStore }                                    from '../../store/useStore'

export default function EditorPane() {
  const { sessionId, activeFile, fileContent, setSession, setStats, setFileContent, appendLog } = useStore()

  const editorRef  = useRef<HTMLDivElement>(null)
  const viewRef    = useRef<EditorView | null>(null)
  const [dirty,     setDirty]     = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [exporting, setExporting] = useState<'dmp' | 'fe' | null>(null)

  // One CodeMirror view for the pane's lifetime. It used to be rebuilt on every
  // fileContent change (the effect's cleanup destroyed it first), so a
  // successful Save & Reload reset the cursor and scroll and dropped undo
  // history (#23).
  const extensionsRef = useRef([
    lineNumbers(), drawSelection(), history(), indentOnInput(), bracketMatching(),
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    feLanguage, seTheme,
    EditorView.updateListener.of(u => { if (u.docChanged) setDirty(true) }),
  ])

  useEffect(() => {
    if (!editorRef.current) return
    viewRef.current = new EditorView({
      state: EditorState.create({ doc: useStore.getState().fileContent ?? '', extensions: extensionsRef.current }),
      parent: editorRef.current,
    })
    return () => { viewRef.current?.destroy(); viewRef.current = null }
  }, [])

  // Text from outside: a load, a restore, a file switch. Identical text (what a
  // save writes back) is left alone, keeping history and cursor. Different
  // text gets a fresh state, so undo can't step back into another file.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const next = fileContent ?? ''
    if (next !== view.state.doc.toString()) {
      view.setState(EditorState.create({ doc: next, extensions: extensionsRef.current }))
    }
    setDirty(false)
  }, [fileContent])

  const handleSave = useCallback(async () => {
    // Clean buffer: nothing to save, and reloading would discard the evolved
    // surface (#15). The button is disabled too; this also covers ⌘S.
    // No session needed: a file that failed to load is fixed exactly this way.
    if (!activeFile || saving || !dirty) return
    const content = viewRef.current?.state.doc.toString() ?? ''
    setSaving(true)
    try {
      await updateFile(activeFile, content)
      // On disk now, whatever the reload does next.
      setFileContent(content)
      setDirty(false)
      appendLog(`Saved ${activeFile} — reloading…`)
      const session = await createSession(activeFile)
      setSession(session.session_id, activeFile)
      setStats(session.energy, session.area)
      appendLog(`Reloaded ${activeFile} — session ${session.session_id.slice(0, 8)}`)
      const warn = lagrangeWarning(activeFile, session)
      if (warn) appendLog(warn)
    } catch (err: unknown) {
      appendLog(`[error] Save failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally { setSaving(false) }
  }, [activeFile, saving, dirty, appendLog, setSession, setStats, setFileContent])

  const handleDownload = useCallback(async (type: 'fe' | 'dmp') => {
    if (!sessionId || exporting) return
    setExporting(type)
    try {
      const result = type === 'fe' ? await exportFe(sessionId) : await exportDmp(sessionId)
      const saved  = await saveExport(result.filename, result.content)
      appendLog(`Exported ${saved.path}`)
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
          disabled={!activeFile || !dirty || saving}
          title={`Save & Reload (${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+'}S)`}
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

      {/* The editor stays mounted: unmounting it on every session change left
          CodeMirror attached to a detached node, so the pane came back blank
          while still marked dirty. Hidden, not removed, when no file is open. */}
      {!activeFile && (
        <div className="flex-1 flex items-center justify-center text-sm text-base-content/30 select-none">
          Load a .fe file to edit
        </div>
      )}
      <div ref={editorRef} className={activeFile ? 'flex-1 min-h-0 overflow-hidden' : 'hidden'} />
    </div>
  )
}
