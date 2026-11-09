import { useState, useRef } from 'react'
import { runCommand, runTopo, type TopoOp } from '../../api/simulation'
import { cancelSession } from '../../api/sessions'
import { useStore } from '../../store/useStore'
import { useMenuAction } from '../../hooks/useMenuAction'
import OutputLog from './OutputLog'

// Structured topology ops, routed from the native Run menu (see useMenuAction).
const TOPO_OPS: { op: TopoOp; label: string }[] = [
  { op: 'refine',     label: 'Refine'  },
  { op: 'equi',       label: 'Equiang' },
  { op: 'vertex_avg', label: 'V-Avg'   },
  { op: 'pop',        label: 'Pop'     },
]

// Turn the structured counts object into a compact one-line summary.
function summarize(counts: Record<string, number>): string {
  const parts = Object.entries(counts).map(([k, v]) => `${k.replace(/_/g, ' ')} ${v > 0 ? '+' : ''}${v}`)
  return parts.length ? parts.join(', ') : 'no change'
}

export default function CliPane() {
  const { sessionId, outputLog, appendLog, setStats, bumpMeshVersion, clearSession } = useStore()
  const [input, setInput] = useState('')
  const [busy, setBusy]   = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Stop. The backend interrupts the command (SIGINT) and keeps the surface;
  // only if that fails does it kill the worker, and then the in-memory surface
  // is gone (the tab stays so the file can be reopened, and the last
  // auto-snapshot is still on disk).
  // Set by Stop: the stopped command's own failure (the killed worker's
  // in-flight request) is expected, not a crash worth reporting.
  const stoppedRef = useRef(false)
  function logCommandError(err: unknown) {
    if (stoppedRef.current) return
    appendLog(`[error] ${err instanceof Error ? err.message : String(err)}`)
  }

  async function handleStop() {
    if (!sessionId) return
    stoppedRef.current = true
    try {
      const res = await cancelSession()
      if (res?.interrupted) {
        appendLog('[stopped] command interrupted — the evolved surface is kept')
        // The command stopped part-way: show the surface as it stands. An
        // empty command succeeds and reports the current energy and area.
        const now = await runCommand(sessionId, '')
        setStats(now.energy, now.area)
        bumpMeshVersion()
        return
      }
      clearSession()
      appendLog('[stopped] engine killed — reopen the file to continue')
    } catch (err: unknown) {
      appendLog(`[error] ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Native Run menu → iterate `g N` (reuses the run path so stats/mesh refresh).
  async function runG(n: number) {
    if (!sessionId || busy) return
    appendLog(`> g ${n}`)
    stoppedRef.current = false
    setBusy(true)
    try {
      const res = await runCommand(sessionId, `g ${n}`)
      if (res.output) appendLog(res.output)
      setStats(res.energy, res.area)
      bumpMeshVersion()
    } catch (err: unknown) {
      logCommandError(err)
    } finally {
      setBusy(false)
    }
  }

  useMenuAction(a => {
    if (a.startsWith('run:')) {
      const op = a.slice(4) as TopoOp
      const t  = TOPO_OPS.find(x => x.op === op)
      if (t) void handleTopo(op, t.label)
    } else if (a.startsWith('iterate:')) {
      void runG(Number(a.slice(8)))
    }
  })

  async function handleTopo(op: TopoOp, label: string) {
    if (!sessionId || busy) return
    appendLog(`> ${label}`)
    stoppedRef.current = false
    setBusy(true)
    try {
      const res = await runTopo(sessionId, op)
      appendLog(`  ${summarize(res.counts)} · ΔE ${res.energy_delta >= 0 ? '+' : ''}${res.energy_delta.toExponential(2)}`)
      setStats(res.energy, res.area)
      bumpMeshVersion()
    } catch (err: unknown) {
      logCommandError(err)
    } finally {
      setBusy(false)
    }
  }

  async function handleRun() {
    if (!sessionId || !input.trim() || busy) return
    const cmd = input.trim()
    setInput('')
    appendLog(`> ${cmd}`)
    stoppedRef.current = false
    setBusy(true)
    try {
      const res = await runCommand(sessionId, cmd)
      if (res.output) appendLog(res.output)
      if (res.energy !== null || res.area !== null) {
        setStats(res.energy, res.area)
        bumpMeshVersion()
      }
    } catch (err: unknown) {
      logCommandError(err)
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
          className={`btn btn-xs shrink-0 ${busy ? 'btn-error' : 'btn-primary'}`}
          onClick={busy ? handleStop : handleRun}
          disabled={!sessionId || (!busy && !input.trim())}
          title={busy ? 'Kill the engine process' : 'Run command'}
        >
          {busy ? 'Stop' : 'Run'}
        </button>
      </div>
    </div>
  )
}
