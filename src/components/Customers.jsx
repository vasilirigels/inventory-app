import { useState, useEffect } from 'react'

function fmt(v, dec = 2) {
  const n = parseFloat(v) || 0
  if (n === 0) return '—'
  return n.toLocaleString('sq-AL', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}

function BalanceBadge({ value, currency }) {
  const n = parseFloat(value) || 0
  if (n <= 0) return <span className="badge badge-green">Shlyer</span>
  return <span className="badge badge-red">{currency}{fmt(n)} borxh</span>
}

export default function Customers() {
  const [customers, setCustomers] = useState([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [filter, setFilter]       = useState('all') // all | indebted | clear

  useEffect(() => {
    fetch('/api/customers/summary')
      .then(r => r.json())
      .then(data => { setCustomers(Array.isArray(data) ? data : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const enriched = customers.map(c => ({
    ...c,
    balance_eur: (c.debt_eur || 0) - (c.paid_eur || 0),
    balance_lek: (c.debt_lek || 0) - (c.paid_lek || 0),
    balance_usd: (c.debt_usd || 0) - (c.paid_usd || 0),
  }))

  const filtered = enriched.filter(c => {
    const matchSearch = !search || c.name.toLowerCase().includes(search.toLowerCase())
    const matchFilter =
      filter === 'all'      ? true :
      filter === 'indebted' ? (c.balance_eur > 0 || c.balance_lek > 0 || c.balance_usd > 0) :
      filter === 'clear'    ? (c.balance_eur <= 0 && c.balance_lek <= 0 && c.balance_usd <= 0) :
      true
    return matchSearch && matchFilter
  })

  const totalDebtEur = enriched.reduce((s, c) => s + Math.max(0, c.balance_eur), 0)
  const totalDebtLek = enriched.reduce((s, c) => s + Math.max(0, c.balance_lek), 0)
  const indebted     = enriched.filter(c => c.balance_eur > 0 || c.balance_lek > 0 || c.balance_usd > 0).length
  const cleared      = enriched.length - indebted

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-slate-400">
      <div className="text-center"><div className="text-4xl mb-3 animate-pulse">👥</div><p className="text-sm">Duke ngarkuar klientët...</p></div>
    </div>
  )

  if (customers.length === 0) return (
    <div className="card text-center py-16">
      <div className="text-5xl mb-4">👥</div>
      <h3 className="text-xl font-bold text-slate-700 mb-2">Nuk ka klientë akoma</h3>
      <p className="text-slate-400 text-sm">Borxhet e klientëve regjistrohen nga Fatura Shitje</p>
    </div>
  )

  return (
    <div className="space-y-5">

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="card bg-slate-50">
          <p className="text-xs text-slate-500 mb-1">Gjithsej Klientë</p>
          <p className="text-3xl font-extrabold text-slate-700">{enriched.length}</p>
        </div>
        <div className="card bg-red-50">
          <p className="text-xs text-slate-500 mb-1">Me Borxh</p>
          <p className="text-3xl font-extrabold text-red-700">{indebted}</p>
        </div>
        <div className="card bg-emerald-50">
          <p className="text-xs text-slate-500 mb-1">Borxhi Total €</p>
          <p className="text-3xl font-extrabold text-emerald-700">€{fmt(totalDebtEur)}</p>
        </div>
        <div className="card bg-blue-50">
          <p className="text-xs text-slate-500 mb-1">Borxhi Total LEK</p>
          <p className="text-3xl font-extrabold text-blue-700">{fmt(totalDebtLek, 0)} L</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="flex-1 relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">🔍</span>
          <input
            type="text"
            placeholder="Kërko klient..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="input-field pl-9"
          />
        </div>
        <div className="flex bg-slate-100 rounded-lg p-0.5">
          {[
            { id: 'all',      label: 'Të gjithë' },
            { id: 'indebted', label: '⚠️ Me borxh' },
            { id: 'clear',    label: '✅ Shlyer' },
          ].map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${filter === f.id ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs text-slate-500">{filtered.length} klientë{search || filter !== 'all' ? ' (filtruar)' : ''}</p>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Klienti</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase">Borxh €</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase">Paguar €</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase">Bilanc €</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase">Borxh LEK</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase">Bilanc LEK</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase">Statusi</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase">Transaksione</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Data e fundit</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c, i) => {
              const hasDebt = c.balance_eur > 0 || c.balance_lek > 0 || c.balance_usd > 0
              return (
                <tr key={i} className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${hasDebt ? '' : ''}`}>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-base font-bold flex-shrink-0 ${hasDebt ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                        {c.name.charAt(0).toUpperCase()}
                      </div>
                      <span className="font-semibold text-slate-800">{c.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-right text-slate-700">{fmt(c.debt_eur)}</td>
                  <td className="px-4 py-3.5 text-right text-emerald-700">{fmt(c.paid_eur)}</td>
                  <td className="px-4 py-3.5 text-right font-bold">
                    <span className={c.balance_eur > 0 ? 'text-red-600' : 'text-emerald-600'}>
                      {c.balance_eur > 0 ? `€${fmt(c.balance_eur)}` : '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-right text-slate-700">{fmt(c.debt_lek, 0)}</td>
                  <td className="px-4 py-3.5 text-right font-bold">
                    <span className={c.balance_lek > 0 ? 'text-red-600' : 'text-emerald-600'}>
                      {c.balance_lek > 0 ? `${fmt(c.balance_lek, 0)} L` : '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-center">
                    {hasDebt
                      ? <span className="badge badge-red">Me borxh</span>
                      : <span className="badge badge-green">Shlyer</span>
                    }
                  </td>
                  <td className="px-4 py-3.5 text-center text-slate-500 text-sm">{c.entries}</td>
                  <td className="px-4 py-3.5 text-slate-500 text-sm">{c.last_date || '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="text-center py-10 text-slate-400">
            <p className="text-sm">Nuk u gjet asnjë klient</p>
          </div>
        )}
      </div>
    </div>
  )
}
