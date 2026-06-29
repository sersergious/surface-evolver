import { useState, useRef } from 'react'
import { runCommand, runTopo, type TopoOp } from '../../api/simulation'
import { useAppState } from '../../store/AppContext'
import { useMenuAction } from '../../hooks/useMenuAction'
import OutputLog from './OutputLog'

const TOPO_OPS: { op: TopoOp; label: string; title: string }[] = [
  { op: 'refine',     label: 'Refine',  title: 'Subdivide all edges (r)' },
  { op: 'equi',       label: 'Equiang', title: 'Equiangulate by edge swaps (u)' },
  { op: 'vertex_avg', label: 'V-Avg',   title: 'Vertex averaging (V)' },
  { op: 'pop',        label: 'Pop',     title: 'Pop non-manifold vertices/edges (pop)' },
]

// Turn the structured counts object into a compact one-line summary.
function summarize(counts: Record<string, number>): string {
  const parts = Object.entries(counts).map(([k, v]) => `${k.replace(/_/g, ' ')} ${v > 0 ? '+' : ''}${v}`)
  return parts.length ? parts.join(', ') : 'no change'
}

export default function CliPane() {
  const { sessionId, outputLog, appendLog, setStats, setTotalTime, bumpMeshVersion } = useAppState()
  const [input, setInput] = useState('')
  const [busy, setBusy]   = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Native Run menu → iterate `g N` (reuses the run path so stats/mesh refresh).
  async function runG(n: number) {
    if (!sessionId || busy) return
    appendLog(`> g ${n}`)
    setBusy(true)
    try {
      const res = await runCommand(sessionId, `g ${n}`)
      if (res.output) appendLog(res.output)
      setStats(res.energy, res.area)
      setTotalTime(res.total_time)
      bumpMeshVersion()
    } catch (err: unknown) {
      appendLog(`[error] ${err instanceof Error ? err.message : String(err)}`)
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
    setBusy(true)
    try {
      const res = await runTopo(sessionId, op)
      appendLog(`  ${summarize(res.counts)} · ΔE ${res.energy_delta >= 0 ? '+' : ''}${res.energy_delta.toExponential(2)}`)
      setStats(res.energy, res.area)
      setTotalTime(res.total_time)
      bumpMeshVersion()
    } catch (err: unknown) {
      appendLog(`[error] ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

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
        setTotalTime(res.total_time)
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

      {/* Topology op buttons */}
      <div className="shrink-0 flex items-center gap-1 px-3 py-1.5 border-t border-base-300 bg-base-200">
        {TOPO_OPS.map(t => (
          <button
            key={t.op}
            className="btn btn-xs bg-base-300/80 border-base-300 hover:bg-base-300 text-base-content"
            onClick={() => handleTopo(t.op, t.label)}
            disabled={!sessionId || busy}
            title={t.title}
          >
            {t.label}
          </button>
        ))}
      </div>

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
