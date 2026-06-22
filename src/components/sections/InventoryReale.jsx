import { useEffect, useState } from 'react'

const TYPES = [{ key: 'flori', label: 'Flori' }, { key: 'diamant', label: 'Diamant' }]

function n(v) { return parseFloat(v) || 0 }
function fmt(v) {
  const val = n(v)
  if (val === 0) return '-'
  return val.toLocaleString('sq-AL', { minimumFractionDigits: 0, maximumFractionDigits: 3 })
}

export default function InventoryReale({ date }) {
  const [rows, setRows] = useState([])
  useEffect(() => {
    fetch(`/api/inventory/${date}`).then(r => r.json()).then(setRows).catch(() => setRows([]))
  }, [date])

  const get = type => rows.find(r => r.type === type) || {}

  return (
    <div className="max-w-5xl mx-auto">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <h3 className="text-lg font-bold text-slate-800">Gjendja Reale & Diferenca</h3>
        <p className="text-xs text-slate-500 mt-1 mb-4">Krahasim mes gjendjes së llogaritur (fillim + hyrje − dalje − shitur) dhe gjendjes reale të verifikuar fizikisht.</p>

        {TYPES.map(t => {
          const r = get(t.key)
          const endGram = n(r.gram_start) + n(r.gram_in) - n(r.gram_out) - n(r.gram_sold)
          const endCope = n(r.cope_start) + n(r.cope_in) - n(r.cope_out) - n(r.cope_sold)
          const diffGram = n(r.gram_real) - endGram
          const diffCope = n(r.cope_real) - endCope
          return (
            <div key={t.key} className="mb-5">
              <h4 className="font-semibold text-slate-700 mb-2 text-sm">{t.label}</h4>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="text-left px-3 py-2 text-xs text-slate-600">Zëri</th>
                    <th className="text-right px-3 py-2 text-xs text-slate-600 w-28">Gram</th>
                    <th className="text-right px-3 py-2 text-xs text-slate-600 w-28">Copë</th>
                  </tr>
                </thead>
                <tbody>
                  <Row label="Gjendja fundit (llogaritur)" gram={endGram} cope={endCope} />
                  <Row label="Gjendja reale" gram={r.gram_real} cope={r.cope_real} />
                  <tr className={`font-bold ${Math.abs(diffGram) > 0.001 || diffCope !== 0 ? 'bg-amber-50' : 'bg-emerald-50'}`}>
                    <td className="px-3 py-2 text-slate-800">Diferenca</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(diffGram)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(diffCope)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Row({ label, gram, cope }) {
  return (
    <tr className="border-b border-slate-100">
      <td className="px-3 py-2 text-slate-700">{label}</td>
      <td className="px-3 py-2 text-right tabular-nums">{fmt(gram)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{fmt(cope)}</td>
    </tr>
  )
}
