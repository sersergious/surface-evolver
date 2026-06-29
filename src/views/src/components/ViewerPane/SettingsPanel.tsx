import { useEffect, useState } from 'react'
import { getSettings, setSettings, type Settings } from '../../api/simulation'

function NumberRow({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="text-base-content/70">{label}</span>
      <input
        type="number" step="any"
        className="input input-xs w-24 bg-base-100 border-base-300 font-mono text-right"
        value={Number.isFinite(value) ? value : 0}
        onChange={e => onChange(parseFloat(e.target.value))}
      />
    </label>
  )
}

interface Props {
  sessionId: string
  onClose: () => void
  onApplied: (energy: number, area: number, totalTime: number) => void
}

export default function SettingsPanel({ sessionId, onClose, onApplied }: Props) {
  const [s, setS]       = useState<Settings | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr]   = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getSettings(sessionId)
      .then(d => { if (!cancelled) setS(d) })
      .catch(e => { if (!cancelled) setErr(String(e)) })
    return () => { cancelled = true }
  }, [sessionId])

  if (!s) {
    return (
      <div className="absolute top-10 right-3 z-30 w-64 rounded-box border border-base-300 bg-base-200/95 shadow-xl text-xs p-3">
        {err ? <span className="text-error">{err}</span> : <span className="loading loading-xs loading-dots" />}
      </div>
    )
  }

  const mp = s.mesh_params, ph = s.physics
  const patchMp = (k: keyof typeof mp, v: number) => setS({ ...s, mesh_params: { ...mp, [k]: v } })
  const patchPh = (k: keyof typeof ph, v: number | boolean) => setS({ ...s, physics: { ...ph, [k]: v } })

  async function apply() {
    setBusy(true); setErr(null)
    try {
      const r = await setSettings(sessionId, { mesh_params: s!.mesh_params, physics: s!.physics })
      setS({ mesh_params: r.mesh_params, physics: r.physics, total_time: r.total_time })
      onApplied(r.energy, r.area, r.total_time)
    } catch (e) { setErr(String(e)) }
    finally { setBusy(false) }
  }

  return (
    <div className="absolute top-10 right-3 z-30 w-64 rounded-box border border-base-300 bg-base-200/95 shadow-xl text-xs">
      <div className="flex items-center justify-between bg-base-300/90 px-2.5 py-1.5">
        <span className="font-semibold">Settings</span>
        <button className="btn btn-ghost btn-xs btn-square -mr-1" onClick={onClose} title="Close">✕</button>
      </div>

      <div className="px-2.5 py-2 space-y-2.5">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-base-content/40 mb-1.5">Mesh quality</div>
          <div className="space-y-1.5">
            <NumberRow label="min area"   value={mp.min_area}    onChange={v => patchMp('min_area', v)} />
            <NumberRow label="min length" value={mp.min_length}  onChange={v => patchMp('min_length', v)} />
            <NumberRow label="max length" value={mp.max_len}     onChange={v => patchMp('max_len', v)} />
            <NumberRow label="temperature" value={mp.temperature} onChange={v => patchMp('temperature', v)} />
          </div>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wider text-base-content/40 mb-1.5">Physics</div>
          <div className="space-y-1.5">
            <label className="flex items-center justify-between gap-2">
              <span className="text-base-content/70">gravity</span>
              <input type="checkbox" className="toggle toggle-xs" checked={ph.gravflag}
                     onChange={e => patchPh('gravflag', e.target.checked)} />
            </label>
            <NumberRow label="grav const" value={ph.grav_const} onChange={v => patchPh('grav_const', v)} />
            <label className="flex items-center justify-between gap-2">
              <span className="text-base-content/70">pressure on</span>
              <input type="checkbox" className="toggle toggle-xs" checked={ph.pressflag}
                     onChange={e => patchPh('pressflag', e.target.checked)} />
            </label>
            <NumberRow label="ambient P" value={ph.pressure} onChange={v => patchPh('pressure', v)} />
          </div>
        </div>

        {err && <div className="text-error">{err}</div>}
        <button className="btn btn-xs btn-primary w-full" onClick={apply} disabled={busy}>
          {busy ? 'Applying…' : 'Apply'}
        </button>
      </div>
    </div>
  )
}
