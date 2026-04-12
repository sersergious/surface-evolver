import { Routes, Route, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ErrorBoundary from './components/ErrorBoundary'
import FilePane from './components/FilePane/FilePane'
import CliPane from './components/CliPane/CliPane'
import ViewerPane from './components/ViewerPane/ViewerPane'
import SmallScreen from './components/SmallScreen'
import DocsPage from './components/DocsPage/DocsPage'
import { useProgressWS } from './hooks/useProgressWS'
import useStore from './store/useStore'

const queryClient = new QueryClient()

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

  return (
    <>
      {/* Phone / small-screen fallback — hidden on md+ */}
      <div className="flex md:hidden">
        <SmallScreen />
      </div>

      {/* Main 3-pane layout — hidden on small screens */}
      <div className="hidden md:flex h-screen w-screen overflow-hidden bg-gh-bg-base font-sans">
        <div className="flex-none w-[200px] border-r border-gh-border h-full overflow-hidden flex flex-col">
          <div className="flex-1 min-h-0 overflow-hidden">
            <FilePane />
          </div>
          <div className="flex-none px-3 py-2 border-t border-gh-border flex justify-start">
            <HelpButton />
          </div>
        </div>
        <div className="flex-none w-[380px] border-r border-gh-border h-full overflow-hidden">
          <CliPane />
        </div>
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
