import { useState, useRef } from 'react'
import { runCommand } from '../../api/simulation'
import { cancelJob } from '../../api/jobs'
import useStore from '../../store/useStore'
import OutputLog from './OutputLog'

export default function CliPane() {
  const { sessionId, energy, area, outputLog, appendLog, setStats, bumpMeshVersion, jobProgress, jobId, clearJob } = useStore()
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

  async function handleCancel() {
    if (!jobId) return
    try {
      await cancelJob(jobId)
      appendLog('[job] cancelled')
      clearJob()
    } catch (err: unknown) {
      appendLog(`[error] cancel failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const progressPct = jobProgress
    ? Math.round((jobProgress.step / jobProgress.total) * 100)
    : null

  return (
    <div className="flex flex-col h-full bg-gh-bg-surface min-w-0">
      <div className="flex flex-wrap gap-4 items-center px-3 py-1.5 bg-gh-bg-elevated border-b border-gh-border">
        <StatChip label="Energy" value={energy !== null ? energy.toFixed(6) : '—'} />
        <StatChip label="Area"   value={area   !== null ? area.toFixed(6)          : '—'} />
        {progressPct !== null && (
          <span className="ml-auto text-[11px] text-gh-accent">
            {progressPct}%&nbsp;({jobProgress!.step}/{jobProgress!.total})
          </span>
        )}
      </div>

      <OutputLog lines={outputLog} />

      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-t border-gh-border bg-gh-bg-elevated">
        <span className="text-gh-success text-[13px] font-mono select-none">$</span>
        <input
          ref={inputRef}
          className="flex-1 bg-transparent border-none outline-none text-gh-text-primary text-[13px] font-mono caret-gh-accent placeholder:text-gh-text-muted disabled:cursor-not-allowed"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleRun()}
          placeholder={sessionId ? 'SE command…' : 'Load a file first'}
          disabled={!sessionId || busy}
          spellCheck={false}
          autoComplete="off"
        />
        {jobId !== null && (
          <button className={btnClass(false)} onClick={handleCancel}>
            Cancel
          </button>
        )}
        <button
          className={btnClass(!sessionId || !input.trim() || busy)}
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
    <span className="flex gap-1.5 items-baseline">
      <span className="text-[10px] uppercase tracking-[0.06em] text-gh-text-muted">{label}</span>
      <span className="text-[12px] font-mono text-gh-text-primary">{value}</span>
    </span>
  )
}

function btnClass(disabled: boolean) {
  return [
    'px-3 py-1 text-xs rounded-md border border-gh-btn-border transition-colors duration-100',
    disabled
      ? 'bg-transparent text-gh-text-muted cursor-not-allowed opacity-50'
      : 'bg-gh-btn-bg text-gh-btn-text cursor-pointer hover:bg-gh-btn-hover-bg',
  ].join(' ')
}
