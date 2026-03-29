import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import FilePane from './components/FilePane/FilePane'
import CliPane from './components/CliPane/CliPane'
import ViewerPane from './components/ViewerPane/ViewerPane'
import { useProgressWS } from './hooks/useProgressWS'
import useStore from './store/useStore'
import { gh } from './theme'

const queryClient = new QueryClient()

function Inner() {
  const sessionId = useStore((s) => s.sessionId)
  useProgressWS(sessionId)

  return (
    <div style={styles.layout}>
      <div style={{ ...styles.pane, flex: '0 0 200px', borderRight: `1px solid ${gh.border}` }}>
        <FilePane />
      </div>
      <div style={{ ...styles.pane, flex: '0 0 380px', borderRight: `1px solid ${gh.border}` }}>
        <CliPane />
      </div>
      <div style={{ ...styles.pane, flex: 1 }}>
        <ViewerPane />
      </div>
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Inner />
    </QueryClientProvider>
  )
}

const styles: Record<string, React.CSSProperties> = {
  layout: {
    display: 'flex',
    height: '100vh',
    width: '100vw',
    overflow: 'hidden',
    background: gh.bgBase,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
  },
  pane: {
    height: '100%',
    overflow: 'hidden',
  },
}
