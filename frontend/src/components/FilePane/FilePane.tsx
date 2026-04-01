import { useQuery } from '@tanstack/react-query'
import { listFiles } from '../../api/files'
import { createSession } from '../../api/sessions'
import useStore from '../../store/useStore'

export default function FilePane() {
  const { sessionId, activeFile, setSession, setStats, appendLog } = useStore()

  const { data: files = [], isLoading } = useQuery({
    queryKey: ['files'],
    queryFn: listFiles,
  })

  async function handleSelect(file: string) {
    if (activeFile === file) return
    try {
      appendLog(`Loading ${file}...`)
      const session = await createSession(file)
      setSession(session.session_id, file)
      setStats(session.energy, session.area)
      appendLog(`Loaded ${file} — session ${session.session_id.slice(0, 8)}`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      appendLog(`[error] Failed to load ${file}: ${msg}`)
    }
  }

  return (
    <div className="flex flex-col h-full bg-gh-bg-surface min-w-0">
      <div className="px-3 py-2.5 text-[11px] font-semibold tracking-[0.08em] uppercase text-gh-text-secondary border-b border-gh-border">
        Explorer
      </div>
      {isLoading && (
        <div className="px-3 py-2 text-xs text-gh-text-muted">Loading...</div>
      )}
      {!isLoading && files.length === 0 && (
        <div className="px-3 py-2 text-xs text-gh-text-muted">No .fe files found</div>
      )}
      <ul className="list-none m-0 py-1 overflow-y-auto flex-1">
        {files.map((f) => (
          <li
            key={f}
            className={[
              'px-3 py-1.5 text-[13px] cursor-pointer select-none whitespace-nowrap overflow-hidden text-ellipsis transition-colors duration-100 border-l-2',
              activeFile === f
                ? 'bg-gh-bg-elevated border-gh-accent text-gh-text-primary'
                : 'border-transparent text-gh-text-secondary hover:bg-gh-bg-elevated hover:text-gh-text-primary',
            ].join(' ')}
            onClick={() => handleSelect(f)}
          >
            {f}
          </li>
        ))}
      </ul>
      {sessionId && (
        <div className="px-3 py-2 text-[11px] border-t border-gh-border font-mono">
          <span className="text-gh-text-muted">session</span>{' '}
          <span className="text-gh-accent">{sessionId.slice(0, 8)}</span>
        </div>
      )}
    </div>
  )
}
