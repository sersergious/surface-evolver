import { Routes, Route, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useRef, useState, useCallback } from 'react'
import ErrorBoundary from './components/ErrorBoundary'
import FilePane from './components/FilePane/FilePane'
import CliPane from './components/CliPane/CliPane'
import ViewerPane from './components/ViewerPane/ViewerPane'
import SmallScreen from './components/SmallScreen'
import DocsPage from './components/DocsPage/DocsPage'
import { useProgressWS } from './hooks/useProgressWS'
import useStore from './store/useStore'

const queryClient = new QueryClient()
const FILE_PANE_W = 200
const MIN_LEFT = FILE_PANE_W + 160
const MIN_RIGHT = 300

function HelpButton() {
  const navigate = useNavigate()
  return (
    <button
      onClick={() => navigate('/docs')}
      className="px-3 py-1.5 text-[12px] font-medium rounded border border-gh-btn-border bg-gh-btn-bg text-gh-btn-text hover:bg-gh-btn-hover-bg transition-colors duration-100 select-none"
    >
      Help
    </button>
  )
}

function Inner() {
  const sessionId = useStore((s) => s.sessionId)
  useProgressWS(sessionId)

  const containerRef = useRef<HTMLDivElement>(null)
  const [leftWidth, setLeftWidth] = useState<number | null>(null)
  const dragging = useRef(false)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const total = rect.width
      const raw = ev.clientX - rect.left
      const clamped = Math.max(MIN_LEFT, Math.min(raw, total - MIN_RIGHT))
      setLeftWidth(clamped)
    }

    const onUp = () => {
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  const leftStyle = leftWidth != null ? { width: leftWidth } : { width: '50%' }

  return (
    <>
      {/* Phone / small-screen fallback — hidden on md+ */}
      <div className="flex md:hidden">
        <SmallScreen />
      </div>

      {/* Main 3-pane layout — hidden on small screens */}
      <div ref={containerRef} className="hidden md:flex h-screen w-screen overflow-hidden bg-gh-bg-base font-sans">
        <div className="flex shrink-0 h-full overflow-hidden" style={leftStyle}>
          <div className="flex-none border-r border-gh-border/60 h-full overflow-hidden flex flex-col" style={{ width: FILE_PANE_W }}>
            <div className="flex-1 min-h-0 overflow-hidden">
              <FilePane />
            </div>
            <div className="flex-none px-3 py-2.5 border-t border-gh-border/60 bg-gh-bg-elevated flex items-center justify-between">
              <HelpButton />
              {sessionId && (
                <div className="text-[11px] font-mono">
                  <span className="text-gh-text-muted">session</span>{' '}
                  <span className="text-gh-accent">{sessionId.slice(0, 8)}</span>
                </div>
              )}
            </div>
          </div>
          <div className="flex-1 h-full overflow-hidden">
            <CliPane />
          </div>
        </div>

        {/* Drag handle */}
        <div
          onMouseDown={onMouseDown}
          className="flex-none w-px bg-gh-border hover:bg-gh-accent cursor-col-resize transition-colors duration-100 h-full"
        />

        <div className="flex-1 h-full overflow-hidden">
          <ViewerPane />
        </div>
      </div>
    </>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<Inner />} />
          <Route path="/docs" element={<DocsPage />} />
        </Routes>
      </ErrorBoundary>
    </QueryClientProvider>
  )
}
