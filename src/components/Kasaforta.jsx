import { useEffect, useState } from 'react'

const CURS = ['LEK', 'EUR', 'USD', 'GBP', 'CHF']

function fmt(v) {
  const x = parseFloat(v) || 0
  if (x === 0) return '-'
  return x.toLocaleString('sq-AL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
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

  const { balance = {}, history = [] } = data

  const activeCurs = CURS.filter(c =>
    (balance[c] || 0) !== 0 ||
    history.some(h => (h[c]?.deposit || 0) || (h[c]?.withdraw || 0) || (h[c]?.closeout_in || 0))
  )
  const shownCurs = activeCurs.length ? activeCurs : ['LEK']

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div className="card bg-gradient-to-r from-slate-900 to-slate-800 text-white">
        <div>
          <p className="text-xs text-slate-400 uppercase tracking-wide font-semibold">Gjendja e Kasafortës</p>
          <p className="text-[10px] text-slate-500 mt-0.5">
            Derdhje + Mbyllje Ditore − Tërheqje (kumulative)
          </p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-4">
          {CURS.map(c => {
            const v = balance[c] || 0
            return (
              <div key={c} className="bg-slate-800 rounded-lg px-3 py-2.5">
                <div className="text-[10px] text-slate-400 uppercase font-semibold">{c}</div>
                <div className={`text-xl font-extrabold tabular-nums ${v < 0 ? 'text-rose-400' : v > 0 ? 'text-amber-300' : 'text-slate-500'}`}>
                  🔒 {fmt(v)}
                </div>
              </div>
            )
          })}
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
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase">Data</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase">Monedha</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase" title="Gjendja e kasafortës në fillim të kësaj date">Bilanci Fillestar</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase">Derdhje</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase">Mbyllje Dite</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase">Tërheqje</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase">Neto</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase" title="Gjendja e kasafortës në fund të kësaj date (fillestar + neto)">Bilanci Final</th>
                </tr>
              </thead>
              <tbody>
                {history.map(r => (
                  shownCurs.filter(c => {
                    const cur = r[c] || {}
                    return cur.deposit || cur.withdraw || cur.closeout_in
                  }).map((c, idx, arr) => {
                    const cur = r[c] || {}
                    return (
                      <tr key={`${r.date}-${c}`} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-3 py-2 text-slate-700 font-mono text-xs">
                          {idx === 0 ? fmtDate(r.date) : ''}
                        </td>
                        <td className="px-3 py-2 text-xs font-semibold text-slate-600">{c}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-500" title="Gjendja në fillim të ditës">
                          {fmt(cur.balance_before)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-emerald-700">
                          {cur.deposit > 0 ? `+${fmt(cur.deposit)}` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-amber-700">
                          {cur.closeout_in > 0 ? `+${fmt(cur.closeout_in)}` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-rose-700">
                          {cur.withdraw > 0 ? `−${fmt(cur.withdraw)}` : '—'}
                        </td>
                        <td className={`px-3 py-2 text-right tabular-nums font-semibold ${cur.net > 0 ? 'text-emerald-700' : cur.net < 0 ? 'text-rose-700' : 'text-slate-400'}`}>
                          {cur.net > 0 ? '+' : ''}{fmt(cur.net)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-bold text-slate-900" title={`${fmt(cur.balance_before)} + ${cur.net > 0 ? '+' : ''}${fmt(cur.net)} = ${fmt(cur.balance)}`}>
                          {fmt(cur.balance)}
                        </td>
                      </tr>
                    )
                  })
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
