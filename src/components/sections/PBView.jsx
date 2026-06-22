import { useEffect, useState } from 'react'

function n(v) { return parseFloat(v) || 0 }
function fmt(v) {
  const val = n(v)
  if (val === 0) return '-'
  return val.toLocaleString('sq-AL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

// PB = pagesë me kartë. Sums lek_pb + eur_pb across sales (-returns) by type.
export default function PBView({ date }) {
  const [sales, setSales] = useState([])
  useEffect(() => {
    fetch(`/api/sales/${date}`).then(r => r.json()).then(setSales).catch(() => setSales([]))
  }, [date])

  const types = ['flori', 'diamant', 'online']
  const sumPB = type => {
    const filt = sales.filter(s => s.type === type)
    const sign = s => s.is_return ? -1 : 1
    return {
      lek: filt.reduce((a, s) => a + sign(s) * n(s.lek_pb), 0),
      eur: filt.reduce((a, s) => a + sign(s) * n(s.eur_pb), 0),
    }
  }

  const rows = types.map(t => ({ type: t, ...sumPB(t) }))
  const total = rows.reduce((a, r) => ({ lek: a.lek + r.lek, eur: a.eur + r.eur }), { lek: 0, eur: 0 })

  const labels = { flori: 'FLORI', diamant: 'DIAMANT', online: 'ONLINE & STAFI' }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <h3 className="text-lg font-bold text-slate-800">Pagesa me Kartë (PB)</h3>
        <p className="text-xs text-slate-500 mt-1 mb-4">Përmbledhje e shitjeve të paguara me kartë bankare.</p>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="text-left px-3 py-2 text-xs font-semibold text-slate-600">Kategoria</th>
              <th className="text-right px-3 py-2 text-xs font-semibold text-slate-600">LEK</th>
              <th className="text-right px-3 py-2 text-xs font-semibold text-slate-600">EUR</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.type} className="border-b border-slate-100">
                <td className="px-3 py-2 text-slate-700">{labels[r.type]}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(r.lek)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(r.eur)}</td>
              </tr>
            ))}
            <tr className="bg-emerald-50 font-bold">
              <td className="px-3 py-2 text-slate-800">Total PB</td>
              <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{fmt(total.lek)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{fmt(total.eur)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
