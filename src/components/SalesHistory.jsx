import { useState, useEffect, useCallback } from 'react'
import * as XLSX from 'xlsx'

function n(v) { return parseFloat(v) || 0 }
function fmt(v) {
  const val = n(v)
  if (val === 0) return '—'
  return val.toLocaleString('sq-AL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

const TYPE_COLORS = {
  flori:   'bg-yellow-100 text-yellow-800',
  diamant: 'bg-blue-100 text-blue-800',
  online:  'bg-purple-100 text-purple-800',
}
const TYPE_LABELS = { flori: 'Flori', diamant: 'Diamant', online: 'Online/Staff' }

function getToday() { return new Date().toISOString().split('T')[0] }
function get30DaysAgo() {
  const d = new Date(); d.setDate(d.getDate() - 30)
  return d.toISOString().split('T')[0]
}

export default function SalesHistory({ onNavigate }) {
  const [sales, setSales]     = useState([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  const [search, setSearch]   = useState('')
  const [type, setType]       = useState('')
  const [from, setFrom]       = useState(get30DaysAgo())
  const [to, setTo]           = useState(getToday())

  const doSearch = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('q', search)
      if (type)   params.set('type', type)
      if (from)   params.set('from', from)
      if (to)     params.set('to', to)
      const data = await fetch(`/api/sales/history?${params}`).then(r => r.json())
      setSales(Array.isArray(data) ? data : [])
      setSearched(true)
    } catch (e) { console.error(e) }
    setLoading(false)
  }, [search, type, from, to])

  // Auto-search on mount
  useEffect(() => { doSearch() }, [])

  const normalSales  = sales.filter(s => !s.is_return)
  const returnSales  = sales.filter(s => s.is_return)
  const totalEur     = normalSales.reduce((s, r) => s + n(r.eur_cash) + n(r.eur_pb), 0)
  const totalLek     = normalSales.reduce((s, r) => s + n(r.lek_cash) + n(r.lek_pb), 0)
  const totalCope    = normalSales.reduce((s, r) => s + n(r.cope), 0)
  const totalGram    = normalSales.reduce((s, r) => s + n(r.gram), 0)

  const exportToExcel = () => {
    const rows = sales.map(s => ({
      Data: s.date,
      Lloji: TYPE_LABELS[s.type] || s.type,
      Kthim: s.is_return ? 'Po' : 'Jo',
      Barkodi: s.barcode || '',
      Cope: s.cope || 0,
      Gram: s.gram || 0,
      LEK_Cash: s.lek_cash || 0,
      LEK_PB: s.lek_pb || 0,
      EUR_Cash: s.eur_cash || 0,
      EUR_PB: s.eur_pb || 0,
      USD: s.usd_cash || 0,
      GBP: s.gbp_cash || 0,
      CHF: s.chf_cash || 0,
      'Skonto%': s.skonto_percent || 0,
      Shenime: s.notes || '',
    }))
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = [8,10,6,12,6,8,10,10,10,10,8,8,8,8,20].map(w => ({ wch: w }))
    XLSX.utils.book_append_sheet(wb, ws, 'Historiku Shitjeve')
    XLSX.writeFile(wb, `historiku_${from}_${to}.xlsx`)
  }

  return (
    <div className="space-y-4">

      {/* Search bar */}
      <div className="card">
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-3">
          <div>
            <label className="form-label">Kërko (barcode, shënim)</label>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && doSearch()}
              className="input-field" placeholder="Barcode ose fjalë kyçe..." />
          </div>
          <div>
            <label className="form-label">Lloji</label>
            <select value={type} onChange={e => setType(e.target.value)} className="input-field">
              <option value="">Të gjitha llojet</option>
              <option value="flori">Flori</option>
              <option value="diamant">Diamant</option>
              <option value="online">Online/Staff</option>
            </select>
          </div>
          <div>
            <label className="form-label">Nga data</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="input-field" />
          </div>
          <div>
            <label className="form-label">Deri data</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} className="input-field" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={doSearch} disabled={loading} className="btn-primary">
            {loading ? '⏳ Duke kërkuar...' : '🔍 Kërko'}
          </button>
          <button onClick={() => { setSearch(''); setType(''); setFrom(get30DaysAgo()); setTo(getToday()) }}
            className="btn-secondary">
            Pastro
          </button>
          {sales.length > 0 && (
            <button onClick={exportToExcel} className="btn-secondary ml-auto">
              ⬇️ Eksporto Excel
            </button>
          )}
        </div>
      </div>

      {/* Summary */}
      {searched && sales.length > 0 && (
        <div className="grid grid-cols-5 gap-3">
          {[
            { label: 'Shitje', value: normalSales.length, suffix: '', color: 'text-slate-700' },
            { label: 'EUR Total', value: totalEur.toLocaleString('sq-AL', {minimumFractionDigits:2,maximumFractionDigits:2}), suffix: '€', color: 'text-blue-700' },
            { label: 'LEK Total', value: Math.round(totalLek).toLocaleString('sq-AL'), suffix: ' L', color: 'text-emerald-700' },
            { label: 'Copë Total', value: totalCope, suffix: ' copë', color: 'text-purple-700' },
            { label: 'Gram Total', value: totalGram.toFixed(2), suffix: ' g', color: 'text-amber-700' },
          ].map(s => (
            <div key={s.label} className="card py-3 text-center">
              <p className="text-xs text-slate-500 mb-0.5">{s.label}</p>
              <p className={`text-lg font-bold ${s.color}`}>{s.value}{s.suffix}</p>
            </div>
          ))}
        </div>
      )}

      {/* Results */}
      {loading ? (
        <div className="text-center py-16 text-slate-400">
          <div className="text-4xl mb-3 animate-pulse">🔍</div>
          <p>Duke kërkuar...</p>
        </div>
      ) : searched && sales.length === 0 ? (
        <div className="card text-center py-16">
          <div className="text-4xl mb-3">🔍</div>
          <p className="text-slate-500">Nuk u gjet asnjë shitje për këto filtra</p>
        </div>
      ) : sales.length > 0 ? (
        <div className="card p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-700">
              {sales.length} rekorde ({normalSales.length} shitje + {returnSales.length} kthime)
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-2.5 text-left font-semibold text-slate-500 uppercase text-xs">Data</th>
                  <th className="px-3 py-2.5 text-left font-semibold text-slate-500 uppercase text-xs">Lloji</th>
                  <th className="px-3 py-2.5 text-left font-semibold text-slate-500 uppercase text-xs">Barkodi</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-slate-500 uppercase text-xs">Copë</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-slate-500 uppercase text-xs">Gram</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-slate-500 uppercase text-xs">LEK</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-slate-500 uppercase text-xs">EUR</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-slate-500 uppercase text-xs">USD</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-slate-500 uppercase text-xs">GBP</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-slate-500 uppercase text-xs">Sk%</th>
                </tr>
              </thead>
              <tbody>
                {sales.map(s => (
                  <tr key={s.id} className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${s.is_return ? 'bg-red-50' : ''}`}>
                    <td className="px-4 py-2.5">
                      <button
                        onClick={() => onNavigate('daily', { date: s.date })}
                        className="text-blue-600 hover:underline font-medium"
                      >{s.date}</button>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className={`badge text-xs ${TYPE_COLORS[s.type] || 'bg-slate-100 text-slate-700'}`}>
                          {TYPE_LABELS[s.type] || s.type}
                        </span>
                        {s.is_return && <span className="badge badge-red text-xs">Kthim</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-slate-600 max-w-[120px] truncate">{s.barcode || '—'}</td>
                    <td className="px-3 py-2.5 text-right">{s.cope || '—'}</td>
                    <td className="px-3 py-2.5 text-right">{s.gram ? n(s.gram).toFixed(2) : '—'}</td>
                    <td className="px-3 py-2.5 text-right font-medium text-slate-800">
                      {n(s.lek_cash) + n(s.lek_pb) > 0 ? fmt(n(s.lek_cash) + n(s.lek_pb)) : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium text-blue-700">
                      {n(s.eur_cash) + n(s.eur_pb) > 0 ? `€${fmt(n(s.eur_cash) + n(s.eur_pb))}` : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right">{n(s.usd_cash) > 0 ? `$${fmt(s.usd_cash)}` : '—'}</td>
                    <td className="px-3 py-2.5 text-right">{n(s.gbp_cash) > 0 ? `£${fmt(s.gbp_cash)}` : '—'}</td>
                    <td className="px-3 py-2.5 text-right text-slate-500">{s.skonto_percent ? `${s.skonto_percent}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  )
}
