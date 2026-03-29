import { useQuery } from '@tanstack/react-query'
import { listFiles } from '../../api/files'
import { createSession } from '../../api/sessions'
import useStore from '../../store/useStore'
import { gh } from '../../theme'

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
    <div style={styles.pane}>
      <div style={styles.header}>Explorer</div>
      {isLoading && <div style={styles.hint}>Loading...</div>}
      {!isLoading && files.length === 0 && (
        <div style={styles.hint}>No .fe files found</div>
      )}
      <ul style={styles.list}>
        {files.map((f) => (
          <li
            key={f}
            style={{
              ...styles.item,
              background: activeFile === f ? gh.bgElevated : 'transparent',
              borderLeft: activeFile === f
                ? `2px solid ${gh.accent}`
                : `2px solid transparent`,
              color: activeFile === f ? gh.textPrimary : gh.textSecondary,
            }}
            onClick={() => handleSelect(f)}
          >
            {f}
          </li>
        ))}
      </ul>
      {sessionId && (
        <div style={styles.sessionInfo}>
          <span style={{ color: gh.textMuted }}>session</span>{' '}
          <span style={{ color: gh.accent }}>{sessionId.slice(0, 8)}</span>
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  pane: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: gh.bgSurface,
    minWidth: 0,
  },
  header: {
    padding: '10px 12px',
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: gh.textSecondary,
    borderBottom: `1px solid ${gh.border}`,
  },
  hint: { padding: '8px 12px', fontSize: 12, color: gh.textMuted },
  list: { listStyle: 'none', margin: 0, padding: '4px 0', overflowY: 'auto', flex: 1 },
  item: {
    padding: '6px 12px',
    fontSize: 13,
    cursor: 'pointer',
    userSelect: 'none',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    transition: 'background 0.1s, color 0.1s',
  },
  sessionInfo: {
    padding: '8px 12px',
    fontSize: 11,
    borderTop: `1px solid ${gh.border}`,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  },
}
