import type { QuantitiesData } from '../../api/simulation'

// Q flags (se_api.h): Q_ENERGY=1, Q_FIXED=2, Q_INFO=4
function flagLabel(flags: number): string {
  if (flags & 2) return 'fixed'
  if (flags & 1) return 'energy'
  if (flags & 4) return 'info'
  return ''
}

const ELEM_TYPE: Record<number, string> = { 1: 'vertex', 2: 'edge', 3: 'facet', 4: 'body' }

function fmt(v: number): string {
  if (!isFinite(v)) return '—'
  if (v !== 0 && (Math.abs(v) >= 1e5 || Math.abs(v) < 1e-3)) return v.toExponential(3)
  return v.toPrecision(5).replace(/\.?0+$/, '')
}

export default function QuantitiesPanel({ data, onClose }: { data: QuantitiesData; onClose: () => void }) {
  const { quantities, methods } = data
  const empty = quantities.length === 0 && methods.length === 0

  return (
    <div className="absolute top-10 right-3 z-30 w-72 max-h-[70%] overflow-auto rounded-box border border-base-300 bg-base-200/95 shadow-xl text-xs">
      <div className="flex items-center justify-between sticky top-0 bg-base-300/90 px-2.5 py-1.5">
        <span className="font-semibold">Quantities & Energy</span>
        <button className="btn btn-ghost btn-xs btn-square -mr-1" onClick={onClose} title="Close">✕</button>
      </div>

      {empty && <div className="px-3 py-3 text-base-content/50">No named quantities in this model.</div>}

      {quantities.length > 0 && (
        <table className="table table-xs">
          <thead>
            <tr><th>Quantity</th><th className="text-right">Value</th><th>Kind</th></tr>
          </thead>
          <tbody>
            {quantities.map(q => (
              <tr key={q.name}>
                <td className="font-mono truncate max-w-32" title={q.name}>{q.name}</td>
                <td className="text-right font-mono tabular-nums">{fmt(q.value)}</td>
                <td className="text-base-content/60">{flagLabel(q.flags)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {methods.length > 0 && (
        <>
          <div className="px-2.5 pt-2 pb-1 text-[10px] uppercase tracking-wider text-base-content/40">Energy breakdown</div>
          <table className="table table-xs">
            <thead>
              <tr><th>Method</th><th>On</th><th className="text-right">Energy</th></tr>
            </thead>
            <tbody>
              {methods.map(m => (
                <tr key={m.name}>
                  <td className="font-mono truncate max-w-32" title={m.name}>{m.name}</td>
                  <td className="text-base-content/60">{ELEM_TYPE[m.type] ?? m.type}</td>
                  <td className="text-right font-mono tabular-nums">{fmt(m.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}
