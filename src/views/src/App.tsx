import { useState, useRef, useCallback, useEffect } from 'react'
import ErrorBoundary from './components/ErrorBoundary'
import FilePane      from './components/FilePane/FilePane'
import CliPane       from './components/CliPane/CliPane'
import EditorPane    from './components/EditorPane/EditorPane'
import ViewerPane    from './components/ViewerPane/ViewerPane'
import { useMenuAction } from './hooks/useMenuAction'
import { useStore } from './store/useStore'

// ── Theme ─────────────────────────────────────────────────────────────────────

// Follow the OS light/dark appearance — native desktop behaviour, no toggle.
function useSystemTheme() {
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () =>
      document.documentElement.setAttribute('data-theme', mq.matches ? 'dark' : 'light')
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])
}

// ── Resize ────────────────────────────────────────────────────────────────────

function useDrag(direction: 'h' | 'v', onDelta: (d: number) => void) {
  return useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    let prev = direction === 'h' ? e.clientX : e.clientY
    const onMove = (ev: MouseEvent) => {
      const cur = direction === 'h' ? ev.clientX : ev.clientY
      onDelta(cur - prev)
      prev = cur
    }
    const onUp = () => {
      document.body.style.cursor = document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    document.body.style.cursor    = direction === 'h' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [direction, onDelta])
}

// ── Navbar ────────────────────────────────────────────────────────────────────

function Navbar({ sidebarOpen, onToggleSidebar }: {
  sidebarOpen: boolean
  onToggleSidebar: () => void
}) {
  const { sessionId, activeFile, energy, area, totalTime } = useStore()

  return (
    <div className="navbar min-h-0 h-11 bg-base-200 border-b border-base-300 px-2 gap-0 shrink-0 electrobun-webkit-app-region-drag">

      {/* ── Left ── (traffic-light inset only exists on macOS) */}
      <div className={`navbar-start gap-1.5 min-w-0 ${navigator.platform.includes('Mac') ? 'pl-[72px]' : 'pl-1'}`}>
        <button
          className={`btn btn-ghost btn-xs btn-square electrobun-webkit-app-region-no-drag ${sidebarOpen ? 'bg-base-300' : ''}`}
          onClick={onToggleSidebar}
          title={sidebarOpen ? 'Hide explorer' : 'Show explorer'}
        >
          <SidebarIcon />
        </button>

        <div className="flex items-center gap-1.5 min-w-0 text-sm select-none">
          <span className="font-semibold text-base-content whitespace-nowrap">Surface Evolver</span>
          {activeFile && (
            <>
              <span className="text-base-content/25">/</span>
              <span className="font-mono text-base-content/60 truncate max-w-44">{activeFile}</span>
            </>
          )}
        </div>
      </div>

      {/* ── Right ── */}
      <div className="navbar-end gap-2 electrobun-webkit-app-region-no-drag">
        {/* Stats */}
        {(energy !== null || area !== null || totalTime !== null) && (
          <div className="hidden sm:flex items-center gap-3 mr-1">
            {energy !== null && <StatChip label="E" value={energy.toFixed(4)} />}
            {area   !== null && <StatChip label="A" value={area.toFixed(4)} />}
            {totalTime !== null && <StatChip label="t" value={totalTime.toPrecision(4)} />}
          </div>
        )}

        {/* Session badge */}
        {sessionId && (
          <div className="badge badge-ghost badge-sm font-mono hidden md:flex">
            #{sessionId.slice(0, 8)}
          </div>
        )}
      </div>
    </div>
  )
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-base-content/40">{label}</span>
      <span className="text-xs font-mono tabular-nums text-base-content/80">{value}</span>
    </span>
  )
}

function SidebarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="0.6" y="0.6" width="3.5" height="12.8" rx="1" stroke="currentColor" strokeWidth="1.2"/>
      <rect x="5.9" y="0.6" width="7.5" height="12.8" rx="1" stroke="currentColor" strokeWidth="1.2"/>
    </svg>
  )
}


// ── Main layout ───────────────────────────────────────────────────────────────

const SIDEBAR_W   = 220
const SIDEBAR_MIN = 140
const SIDEBAR_MAX = 380
const EDITOR_W    = 340
const EDITOR_MIN  = 200
const EDITOR_MAX  = 600

function Inner() {
  useSystemTheme()
  const [sidebarOpen,  setSidebarOpen]  = useState(true)

  // Native View menu → explorer toggle.
  useMenuAction(a => {
    if (a === 'view:sidebar') setSidebarOpen(o => !o)
  })
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_W)
  const [editorWidth,  setEditorWidth]  = useState(EDITOR_W)
  const [viewerPct,    setViewerPct]    = useState(62)
  const bodyRef = useRef<HTMLDivElement>(null)

  // Files (left) + Editor (middle): both handles sit on the panel's right edge,
  // so dragging right grows the panel.
  const onSidebarDrag = useDrag('h', useCallback((d: number) => {
    setSidebarWidth(w => Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, w + d)))
  }, []))

  const onEditorDrag = useDrag('h', useCallback((d: number) => {
    setEditorWidth(w => Math.max(EDITOR_MIN, Math.min(EDITOR_MAX, w + d)))
  }, []))

  const onSplitDrag = useDrag('v', useCallback((d: number) => {
    if (!bodyRef.current) return
    const h = bodyRef.current.clientHeight
    setViewerPct(p => Math.max(20, Math.min(82, p + (d / h) * 100)))
  }, []))

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-base-100 font-sans">

        <Navbar
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen(o => !o)}
        />

        <div ref={bodyRef} className="flex flex-1 min-h-0 overflow-hidden">

          {/* File explorer (left, collapsible) */}
          {sidebarOpen && (
            <>
              <div className="shrink-0 h-full overflow-hidden bg-base-200"
                   style={{ width: sidebarWidth }}>
                <FilePane />
              </div>

              <div
                onMouseDown={onSidebarDrag}
                className="relative w-px shrink-0 h-full cursor-col-resize bg-base-300 hover:bg-primary transition-colors duration-150"
              >
                <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
              </div>
            </>
          )}

          {/* Editor (middle) */}
          <div className="shrink-0 h-full overflow-hidden"
               style={{ width: editorWidth }}>
            <EditorPane />
          </div>

          {/* Editor drag handle */}
          <div
            onMouseDown={onEditorDrag}
            className="relative w-px shrink-0 h-full cursor-col-resize bg-base-300 hover:bg-primary transition-colors duration-150"
          >
            <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
          </div>

          {/* Right column: viewer on top, CLI/output below */}
          <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
            <div className="overflow-hidden min-h-0" style={{ height: `${viewerPct}%` }}>
              <ViewerPane />
            </div>

            {/* Viewer / output drag handle */}
            <div
              onMouseDown={onSplitDrag}
              className="relative h-px w-full shrink-0 cursor-row-resize bg-base-300 hover:bg-primary transition-colors duration-150"
            >
              <div className="absolute inset-x-0 -top-1.5 -bottom-1.5" />
            </div>

            <div className="flex-1 min-h-0 overflow-hidden">
              <CliPane />
            </div>
          </div>

        </div>
    </div>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <Inner />
    </ErrorBoundary>
  )
}
