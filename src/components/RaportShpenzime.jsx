import { useState, useEffect, useCallback } from 'react'
import * as XLSX from 'xlsx'
import DateRangeFilter from './DateRangeFilter.jsx'

const CURRENCIES = ['LEK', 'EUR', 'USD', 'GBP', 'CHF']

function n(v) { return parseFloat(v) || 0 }
function fmt(v) {
  const x = n(v)
  if (x === 0) return '—'
  return x.toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function getToday() { return new Date().toISOString().split('T')[0] }
function getMonthStart() {
  const d = new Date(); d.setDate(1)
  return d.toISOString().split('T')[0]
}

export default function RaportShpenzime() {
  const [categories, setCategories] = useState([])
  const [from, setFrom]   = useState(getMonthStart())
  const [to, setTo]       = useState(getToday())
  const [catId, setCatId] = useState('')
  const [cur, setCur]     = useState('')
  const [data, setData]   = useState({ rows: [], totals: null, by_category: [] })
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  useEffect(() => {
    fetch('/api/expense-categories?all=1')
      .then(r => r.json())
      .then(d => setCategories(Array.isArray(d) ? d : []))
      .catch(() => setCategories([]))
  }, [])

  const load = useCallback(async () => {
    if (!from || !to) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ from, to })
      if (catId) params.set('category_id', catId)
      if (cur)   params.set('currency', cur)
      const d = await fetch(`/api/reports/expenses?${params}`).then(r => r.json())
      setData({
        rows: Array.isArray(d?.rows) ? d.rows : [],
        totals: d?.totals || null,
        by_category: Array.isArray(d?.by_category) ? d.by_category : [],
      })
      setSearched(true)
    } catch (e) {
      console.error(e); setData({ rows: [], totals: null, by_category: [] })
    } finally {
      setLoading(false)
    }
  }, [from, to, catId, cur])

  useEffect(() => { load() }, []) // eslint-disable-line
  // Auto-load kur ndryshojnë filtrat (data, zëri, monedha).
  useEffect(() => {
    if (searched) load()
    // eslint-disable-next-line
  }, [from, to, catId, cur])

  const exportXlsx = () => {
    const out = data.rows.map(r => ({
      Data: r.date,
      Zëri: r.category_name || '(pa zër)',
      Përshkrim: r.description || '',
      Monedha: r.currency || 'LEK',
      Vlera: n(r.amount),
      Kursi: n(r.exchange_rate),
      'Total LEK': n(r.total_lek),
    }))
    if (data.totals) {
      out.push({
        Data: '', Zëri: 'TOTALI', Përshkrim: '', Monedha: '',
        Vlera: '', Kursi: '',
        'Total LEK': data.totals.total_lek,
      })
    }
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.json_to_sheet(out)
    ws['!cols'] = [12, 24, 30, 10, 14, 10, 14].map(w => ({ wch: w }))
    XLSX.utils.book_append_sheet(wb, ws, 'Raport Shpenzime')
    XLSX.writeFile(wb, `raport_shpenzime_${from}_${to}.xlsx`)
  }

  const byCurrencyList = data.totals?.by_currency
    ? Object.entries(data.totals.by_currency).filter(([, v]) => Math.abs(v) > 0.005)
    : []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Raport Shpenzime</h2>
          <p className="text-xs text-slate-500">Shpenzime sipas datës, zërit dhe monedhës · Totali i konvertuar në LEK me kursin e secilit shpenzim</p>
        </div>
        <button onClick={exportXlsx} disabled={!data.rows.length} className="btn-secondary disabled:opacity-40">
          📥 Eksporto Excel
        </button>
      </div>

      <DateRangeFilter
        from={from}
        to={to}
        onChange={({ from: f, to: t }) => { setFrom(f); setTo(t) }}
        loading={loading}
        hint="Ndikon: rreshtat, totalet dhe eksporti"
      />

      <div className="card">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div>
            <label className="form-label">Lloji i Shpenzimit</label>
            <select value={catId} onChange={e => setCatId(e.target.value)} className="input-field">
              <option value="">Të gjitha</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name}{!c.active && ' (joaktiv)'}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label">Monedha</label>
            <select value={cur} onChange={e => setCur(e.target.value)} className="input-field">
              <option value="">Të gjitha</option>
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={load} className="btn-secondary flex-1" title="Rifresko manualisht — filtrat aplikohen automatikisht">
              🔄 Rifresko
            </button>
            <button
              onClick={() => { setCatId(''); setCur(''); setFrom(getMonthStart()); setTo(getToday()) }}
              className="btn-secondary"
              title="Pastro filtrat"
            >✕</button>
          </div>
        </div>
      </div>

      {/* Summary by category */}
      {data.by_category.length > 0 && (
        <div className="card">
          <h3 className="text-sm font-semibold text-slate-700 mb-2">Përmbledhje sipas Zërit</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {data.by_category.map(c => (
              <div key={c.category_id || 0} className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                <div className="text-xs text-slate-500">{c.category_name}</div>
                <div className="text-lg font-bold text-blue-700 tabular-nums">{fmt(c.total_lek)} LEK</div>
                <div className="text-[10px] text-slate-400">{c.count} regjistrime</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-400 text-sm">Duke ngarkuar...</div>
        ) : !searched ? (
          <div className="p-8 text-center text-slate-400 text-sm">Vendos filtrat dhe kliko Kërko.</div>
        ) : data.rows.length === 0 ? (
          <div className="p-10 text-center">
            <div className="text-5xl mb-3">🧾</div>
            <p className="text-slate-500">Nuk u gjetën shpenzime në këtë periudhë.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase">Data</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase">Zëri</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase">Përshkrimi</th>
                  <th className="px-3 py-2 text-center text-xs font-semibold text-slate-500 uppercase">Monedha</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase">Vlera</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase">Kursi</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase bg-blue-50">Total LEK</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map(r => (
                  <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2 text-xs text-slate-600">{r.date}</td>
                    <td className="px-3 py-2 font-medium text-slate-800">
                      {r.category_name || <span className="italic text-slate-400">(pa zër)</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">{r.description || '—'}</td>
                    <td className="px-3 py-2 text-center">
                      <span className="badge badge-blue text-[10px]">{r.currency || 'LEK'}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-800">{fmt(r.amount)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                      {(r.currency || 'LEK') === 'LEK' ? '1' : fmt(r.exchange_rate)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-bold text-blue-700 bg-blue-50/40">
                      {fmt(r.total_lek)}
                    </td>
                  </tr>
                ))}
              </tbody>
              {data.totals && (
                <tfoot className="bg-blue-50 border-t-2 border-blue-200">
                  <tr className="font-bold text-xs">
                    <td colSpan={4} className="px-3 py-3 text-right text-slate-700 uppercase tracking-wide">TOTALI:</td>
                    <td colSpan={2} className="px-3 py-3 text-right text-slate-600 text-[11px]">
                      {byCurrencyList.length === 0
                        ? '—'
                        : byCurrencyList.map(([c, v]) => `${fmt(v)} ${c}`).join(' · ')}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-blue-800 text-base bg-blue-100/60">
                      {fmt(data.totals.total_lek)} LEK
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>

      <p className="text-[11px] text-slate-400 italic px-1">
        Konvertimi në LEK bëhet me kursin e secilit shpenzim (i ruajtur në momentin e regjistrimit).
      </p>
    </div>
  )
}
