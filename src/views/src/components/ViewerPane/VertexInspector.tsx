import type { VertexInfo } from '../../api/simulation'

// attr bits (se_api.h)
const ATTR_FLAGS: { bit: number; label: string }[] = [
  { bit: 0x40,  label: 'fixed' },
  { bit: 0x80,  label: 'boundary' },
  { bit: 0x400, label: 'constraint' },
]

function fmt(v: number): string {
  if (!isFinite(v)) return '—'
  return v.toPrecision(5).replace(/\.?0+$/, '')
}

export default function VertexInspector({ info, onClose }: { info: VertexInfo; onClose: () => void }) {
  const flags = ATTR_FLAGS.filter(f => info.attr & f.bit).map(f => f.label)

  return (
    <div className="absolute bottom-3 right-3 z-30 w-60 rounded-box overflow-hidden border border-base-300 bg-base-200/95 shadow-xl text-xs">
      <div className="flex items-center justify-between bg-base-300/90 px-2.5 py-1.5">
        <span className="font-semibold">Vertex #{info.id}</span>
        <button className="btn btn-ghost btn-xs btn-square -mr-1" onClick={onClose} title="Close">✕</button>
      </div>

      <div className="px-2.5 py-2 space-y-1.5">
        <div className="font-mono text-base-content/70">
          ({fmt(info.xyz[0])}, {fmt(info.xyz[1])}, {fmt(info.xyz[2])})
        </div>

        <div className="flex flex-wrap gap-1">
          {flags.length === 0
            ? <span className="text-base-content/40">free vertex</span>
            : flags.map(f => <span key={f} className="badge badge-sm badge-ghost">{f}</span>)}
        </div>

        {info.constraints.length > 0 && (
          <div className="pt-1">
            <div className="text-[10px] uppercase tracking-wider text-base-content/40 mb-1">Constraints</div>
            <div className="flex flex-wrap gap-1">
              {info.constraints.map(c => (
                <span key={c.idx} className="badge badge-sm badge-neutral font-mono" title={`constraint ${c.idx}`}>
                  {c.name || `constraint ${c.idx}`}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
