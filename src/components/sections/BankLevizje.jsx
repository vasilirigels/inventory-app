import { useEffect, useState } from 'react'

const CUR = [
  { key: 'lek', label: 'LEK' },
  { key: 'eur', label: 'EUR' },
  { key: 'usd', label: 'USD' },
]

function n(v) { return parseFloat(v) || 0 }
function fmt(v) {
  const val = n(v)
  if (val === 0) return '-'
  return val.toLocaleString('sq-AL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

export default function BankLevizje({ date }) {
  const [rec, setRec] = useState({})
  useEffect(() => {
    fetch(`/api/daily/${date}`).then(r => r.json()).then(setRec).catch(() => setRec({}))
  }, [date])

  return (
    <div className="max-w-4xl mx-auto">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <h3 className="text-lg font-bold text-slate-800">Lëvizje në Bankë</h3>
        <p className="text-xs text-slate-500 mt-1 mb-4">Lëvizje neto në bankë = Tërheqje − Depozitim (formula H32−H42 në Excel).</p>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="text-left px-3 py-2 text-xs font-semibold text-slate-600">Zëri</th>
              {CUR.map(c => <th key={c.key} className="text-right px-3 py-2 text-xs font-semibold text-slate-600 w-28">{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-100">
              <td className="px-3 py-2 text-slate-700">+ Tërheqje nga Banka</td>
              {CUR.map(c => <td key={c.key} className="px-3 py-2 text-right tabular-nums text-emerald-700">{fmt(n(rec[`bank_withdraw_${c.key}`]))}</td>)}
            </tr>
            <tr className="border-b border-slate-100">
              <td className="px-3 py-2 text-slate-700">− Depozitim në Bankë</td>
              {CUR.map(c => <td key={c.key} className="px-3 py-2 text-right tabular-nums text-rose-600">{fmt(-n(rec[`bank_deposit_${c.key}`]))}</td>)}
            </tr>
            <tr className="bg-emerald-50 font-bold">
              <td className="px-3 py-2 text-slate-800">Lëvizje neto</td>
              {CUR.map(c => {
                const v = n(rec[`bank_withdraw_${c.key}`]) - n(rec[`bank_deposit_${c.key}`])
                return <td key={c.key} className="px-3 py-2 text-right tabular-nums text-emerald-700">{fmt(v)}</td>
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
