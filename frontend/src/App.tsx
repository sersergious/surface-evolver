import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ErrorBoundary from './components/ErrorBoundary'
import FilePane from './components/FilePane/FilePane'
import CliPane from './components/CliPane/CliPane'
import ViewerPane from './components/ViewerPane/ViewerPane'
import SmallScreen from './components/SmallScreen'
import { useProgressWS } from './hooks/useProgressWS'
import useStore from './store/useStore'

const queryClient = new QueryClient()

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
        <div className="flex-none w-[200px] border-r border-gh-border h-full overflow-hidden">
          <FilePane />
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
        <Inner />
      </ErrorBoundary>
    </QueryClientProvider>
  )
}
