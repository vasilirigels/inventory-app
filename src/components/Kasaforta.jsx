import { useEffect, useState } from 'react'

function fmt(v) {
  const x = parseFloat(v) || 0
  return x.toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(d) {
  return d.split('-').reverse().join('.')
}

export default function Kasaforta() {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  useEffect(() => {
    let cancel = false
    fetch('/api/kasaforta')
      .then(r => r.json())
      .then(d => { if (!cancel) { setData(d); setLoading(false) } })
      .catch(e => { if (!cancel) { setError(e.message || 'Gabim'); setLoading(false) } })
    return () => { cancel = true }
  }, [])

  if (loading) return <div className="card p-8 text-center text-slate-400 text-sm">Duke ngarkuar...</div>
  if (error)   return <div className="card p-8 text-center text-red-500 text-sm">⚠ {error}</div>
  if (!data)   return null

  const { balance_lek, history } = data

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="card bg-gradient-to-r from-slate-900 to-slate-800 text-white">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-400 uppercase tracking-wide font-semibold">Gjendja e Kasafortës</p>
            <p className="text-[10px] text-slate-500 mt-0.5">
              Derdhje + Mbyllje Ditore − Tërheqje (kumulative)
            </p>
          </div>
          <div className={`text-4xl font-extrabold tabular-nums ${balance_lek < 0 ? 'text-rose-400' : 'text-amber-300'}`}>
            🔒 {fmt(balance_lek)} <span className="text-sm font-medium text-slate-400">LEK</span>
          </div>
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Historiku i Lëvizjeve</h4>
          <span className="text-xs text-slate-400">{history.length} ditë me lëvizje</span>
        </div>
        {history.length === 0 ? (
          <div className="p-10 text-center text-slate-400">
            <div className="text-4xl mb-2">🔒</div>
            <p className="text-sm">Asnjë lëvizje në kasafortë.</p>
            <p className="text-xs mt-1">Përdor "Mbyllje Dite" tek Arka Ditore për të derdhur kesh në kasafortë.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase">Data</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase">Derdhje</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase">Mbyllje Dite</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase">Tërheqje</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase">Neto</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase">Bilanci</th>
              </tr>
            </thead>
            <tbody>
              {history.map(r => (
                <tr key={r.date} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 text-slate-700 font-mono text-xs">{fmtDate(r.date)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-700">
                    {r.deposit_lek > 0 ? `+${fmt(r.deposit_lek)}` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-amber-700">
                    {r.closeout_in > 0 ? `+${fmt(r.closeout_in)}` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-rose-700">
                    {r.withdraw_lek > 0 ? `−${fmt(r.withdraw_lek)}` : '—'}
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums font-semibold ${r.net_lek > 0 ? 'text-emerald-700' : r.net_lek < 0 ? 'text-rose-700' : 'text-slate-400'}`}>
                    {r.net_lek > 0 ? '+' : ''}{fmt(r.net_lek)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-bold text-slate-900">
                    {fmt(r.balance_lek)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
