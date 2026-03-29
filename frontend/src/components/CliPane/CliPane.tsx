import { useState, useRef } from 'react'
import { runCommand } from '../../api/simulation'
import { iterateSession } from '../../api/simulation'
import useStore from '../../store/useStore'
import OutputLog from './OutputLog'
import { gh } from '../../theme'

export default function CliPane() {
  const { sessionId, energy, area, outputLog, appendLog, setStats, bumpMeshVersion, setJob, jobProgress } = useStore()
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleRun() {
    if (!sessionId || !input.trim() || busy) return
    const cmd = input.trim()
    setInput('')
    appendLog(`> ${cmd}`)
    setBusy(true)
    try {
      const res = await runCommand(sessionId, cmd)
      if (res.output) appendLog(res.output)
      if (res.energy !== null || res.area !== null) {
        setStats(res.energy, res.area)
        bumpMeshVersion()
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      appendLog(`[error] ${msg}`)
    } finally {
      setBusy(false)
      inputRef.current?.focus()
    }
  }

  async function handleIterate() {
    if (!sessionId || busy) return
    setBusy(true)
    appendLog('> iterate 100')
    try {
      const job = await iterateSession(sessionId, 100)
      setJob(job.job_id)
      appendLog(`[job ${job.job_id.slice(0, 8)} queued]`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      appendLog(`[error] ${msg}`)
    } finally {
      setBusy(false)
    }
  }

  const progressPct = jobProgress
    ? Math.round((jobProgress.step / jobProgress.total) * 100)
    : null

  return (
    <div style={styles.pane}>
      <div style={styles.statsBar}>
        <StatChip label="Energy" value={energy !== null ? energy.toExponential(6) : '—'} />
        <StatChip label="Area"   value={area   !== null ? area.toFixed(6)          : '—'} />
        {progressPct !== null && (
          <span style={{ color: gh.accent, fontSize: 11, marginLeft: 'auto' }}>
            {progressPct}%&nbsp;({jobProgress!.step}/{jobProgress!.total})
          </span>
        )}
      </div>

      <OutputLog lines={outputLog} />

      <div style={styles.toolbar}>
        <button style={btnStyle(!sessionId || busy)} onClick={handleIterate} disabled={!sessionId || busy}>
          Iterate ×100
        </button>
      </div>

      <div style={styles.inputRow}>
        <span style={styles.prompt}>$</span>
        <input
          ref={inputRef}
          style={styles.input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleRun()}
          placeholder={sessionId ? 'SE command…' : 'Load a file first'}
          disabled={!sessionId || busy}
          spellCheck={false}
          autoComplete="off"
        />
        <button
          style={btnStyle(!sessionId || !input.trim() || busy)}
          onClick={handleRun}
          disabled={!sessionId || !input.trim() || busy}
        >
          Run
        </button>
      </div>
    </div>
  )
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ display: 'flex', gap: 5, alignItems: 'baseline' }}>
      <span style={{ color: gh.textMuted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </span>
      <span style={{ color: gh.textPrimary, fontSize: 12, fontFamily: 'ui-monospace, Menlo, monospace' }}>
        {value}
      </span>
    </span>
  )
}

function btnStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: '4px 12px',
    fontSize: 12,
    background: disabled ? 'transparent' : gh.btnBg,
    color: disabled ? gh.textMuted : gh.textPrimary,
    border: `1px solid ${gh.btnBorder}`,
    borderRadius: 6,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: 'inherit',
    opacity: disabled ? 0.5 : 1,
  }
}

const styles: Record<string, React.CSSProperties> = {
  pane: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: gh.bgSurface,
    minWidth: 0,
  },
  statsBar: {
    display: 'flex',
    gap: 16,
    alignItems: 'center',
    padding: '6px 12px',
    background: gh.bgElevated,
    borderBottom: `1px solid ${gh.border}`,
    flexWrap: 'wrap',
  },
  toolbar: {
    display: 'flex',
    gap: 8,
    padding: '6px 10px',
    borderTop: `1px solid ${gh.border}`,
    background: gh.bgSurface,
  },
  inputRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 10px',
    borderTop: `1px solid ${gh.border}`,
    background: gh.bgElevated,
  },
  prompt: {
    color: gh.success,
    fontSize: 13,
    fontFamily: 'ui-monospace, Menlo, monospace',
    userSelect: 'none',
  },
  input: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: gh.textPrimary,
    fontSize: 13,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, "Courier New", monospace',
    caretColor: gh.accent,
  },
}
