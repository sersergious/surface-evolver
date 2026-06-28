import { useState, useRef } from 'react'
import { runCommand } from '../../api/simulation'
import { useAppState } from '../../store/AppContext'
import OutputLog from './OutputLog'

export default function CliPane() {
  const { sessionId, outputLog, appendLog, setStats, bumpMeshVersion } = useAppState()
  const [input, setInput] = useState('')
  const [busy, setBusy]   = useState(false)
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
      appendLog(`[error] ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
      inputRef.current?.focus()
    }
  }

  return (
    <div className="flex flex-col h-full bg-base-100">
      <OutputLog lines={outputLog} />

      {/* Input row */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-t border-base-300 bg-base-200">
        <span className="text-success text-sm font-mono select-none shrink-0">$</span>
        <input
          ref={inputRef}
          className="flex-1 bg-transparent border-none outline-none text-sm font-mono text-base-content caret-primary placeholder:text-base-content/30 disabled:cursor-not-allowed"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleRun()}
          placeholder={sessionId ? 'SE command…' : 'Load a file first'}
          disabled={!sessionId || busy}
          spellCheck={false}
          autoComplete="off"
        />
        <button
          className="btn btn-xs btn-primary shrink-0"
          onClick={handleRun}
          disabled={!sessionId || !input.trim() || busy}
        >
          Run
        </button>
      </div>
    </div>
  )
}
