import { useState, useEffect, useCallback } from 'react'
import * as XLSX from 'xlsx'

const CURRENCIES = ['LEK', 'EUR', 'USD', 'GBP', 'CHF']
const PAYMENT_METHODS = [
  { value: 'cash', label: '💵 Cash' },
  { value: 'pos',  label: '💳 POS' },
  { value: 'bank', label: '🏦 Bankë' },
  { value: 'debt', label: '⚠️ Borxh' },
]

function n(v) { return parseFloat(v) || 0 }
function fmt(v) {
  const x = n(v)
  if (x === 0) return '—'
  return x.toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtDate(d) {
  if (!d) return ''
  const [y, m, day] = d.split('-')
  return `${day}.${m}.${y}`
}

function getToday() { return new Date().toISOString().split('T')[0] }
function getMonthStart() {
  const d = new Date(); d.setDate(1)
  return d.toISOString().split('T')[0]
}

export default function RaportXhiroDitore({ onNavigate }) {
  const [from, setFrom]   = useState(getMonthStart())
  const [to, setTo]       = useState(getToday())
  const [pm, setPm]       = useState('')
  const [cur, setCur]     = useState('')
  const [rows, setRows]   = useState([])
  const [totals, setTotals] = useState(null)
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  const load = useCallback(async () => {
    if (!from || !to) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ from, to })
      if (pm)  params.set('payment_method', pm)
      if (cur) params.set('currency', cur)
      const d = await fetch(`/api/reports/daily-turnover?${params}`).then(r => r.json())
      setRows(Array.isArray(d?.rows) ? d.rows : [])
      setTotals(d?.totals || null)
      setSearched(true)
    } catch (e) {
      console.error(e); setRows([]); setTotals(null)
    } finally {
      setLoading(false)
    }
  }, [from, to, pm, cur])

  useEffect(() => { load() }, []) // eslint-disable-line

  const exportXlsx = () => {
    const out = rows.map(r => ({
      Data: r.date,
      'Nr. Faturash': r.count,
      'Kreditore': r.credit_count,
      'Pa Zbritje (LEK)': r.gross_lek,
      'Zbritja (LEK)': r.disc_lek,
      'Pa TVSH (LEK)': r.sub_lek,
      'TVSH (LEK)': r.vat_lek,
      'TOTALI (LEK)': r.tot_lek,
      'Cash (faturat cash)': r.cash_lek,
      'POS': r.pos_lek,
      'Bankë': r.bank_lek,
      'Borxh': r.debt_lek,
      'Paguar': r.paid_lek,
      'Pa Paguar': r.due_lek,
      'Total Cash (LEK)': r.total_cash_lek,
    }))
    if (totals) {
      out.push({
        Data: 'TOTALI',
        'Nr. Faturash': totals.count,
        'Kreditore': totals.credit_count,
        'Pa Zbritje (LEK)': totals.gross_lek,
        'Zbritja (LEK)': totals.disc_lek,
        'Pa TVSH (LEK)': totals.sub_lek,
        'TVSH (LEK)': totals.vat_lek,
        'TOTALI (LEK)': totals.tot_lek,
        'Cash (faturat cash)': totals.cash_lek,
        'POS': totals.pos_lek,
        'Bankë': totals.bank_lek,
        'Borxh': totals.debt_lek,
        'Paguar': totals.paid_lek,
        'Pa Paguar': totals.due_lek,
        'Total Cash (LEK)': totals.total_cash_lek,
      })
    }
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.json_to_sheet(out)
    ws['!cols'] = [12, 10, 8, 14, 12, 14, 12, 14, 12, 12, 12, 12, 12, 12, 14].map(w => ({ wch: w }))
    XLSX.utils.book_append_sheet(wb, ws, 'Xhiro Ditore')
    XLSX.writeFile(wb, `raport_xhiro_ditore_${from}_${to}.xlsx`)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Raport Xhiro Ditore</h2>
          <p className="text-xs text-slate-500">
            Xhiroja ditore nga Faturat e Shitjes · Të gjitha vlerat në LEK (konvertim me kursin e secilës faturë)
          </p>
        </div>
        <button onClick={exportXlsx} disabled={!rows.length} className="btn-secondary disabled:opacity-40">
          📥 Eksporto Excel
        </button>
      </div>

      <div className="card">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
          <div>
            <label className="form-label">Nga data</label>
            <input type="date" value={from} max={to}
              onChange={e => setFrom(e.target.value)} className="input-field" />
          </div>
          <div>
            <label className="form-label">Deri më datë</label>
            <input type="date" value={to} min={from}
              onChange={e => setTo(e.target.value)} className="input-field" />
          </div>
          <div>
            <label className="form-label">Lloji i Pagesës</label>
            <select value={pm} onChange={e => setPm(e.target.value)} className="input-field">
              <option value="">Të gjitha</option>
              {PAYMENT_METHODS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label">Monedha e Faturës</label>
            <select value={cur} onChange={e => setCur(e.target.value)} className="input-field">
              <option value="">Të gjitha</option>
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={load} className="btn-primary flex-1">🔎 Kërko</button>
            <button
              onClick={() => { setPm(''); setCur(''); setFrom(getMonthStart()); setTo(getToday()) }}
              className="btn-secondary"
              title="Pastro filtrat"
            >✕</button>
          </div>
        </div>
      </div>

      {/* Top KPI cards */}
      {totals && rows.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="card !p-4">
            <div className="text-[10px] text-slate-500 uppercase font-semibold">Total Xhiro (LEK)</div>
            <div className="text-xl font-bold text-blue-700 tabular-nums">{fmt(totals.tot_lek)}</div>
          </div>
          <div className="card !p-4">
            <div className="text-[10px] text-slate-500 uppercase font-semibold">Pa TVSH (LEK)</div>
            <div className="text-xl font-bold text-slate-800 tabular-nums">{fmt(totals.sub_lek)}</div>
          </div>
          <div className="card !p-4">
            <div className="text-[10px] text-slate-500 uppercase font-semibold">TVSH (LEK)</div>
            <div className="text-xl font-bold text-slate-700 tabular-nums">{fmt(totals.vat_lek)}</div>
          </div>
          <div className="card !p-4">
            <div className="text-[10px] text-slate-500 uppercase font-semibold">Pa Paguar (Borxh)</div>
            <div className="text-xl font-bold text-red-700 tabular-nums">{fmt(totals.due_lek)}</div>
          </div>
          <div className="card !p-4 md:col-span-4 bg-emerald-50/60 border-emerald-200">
            <div className="text-[10px] text-emerald-700 uppercase font-semibold">
              💵 TOTAL CASH (LEK) — Total − POS − Bankë − Pa Paguar
            </div>
            <div className="text-2xl font-extrabold text-emerald-700 tabular-nums">{fmt(totals.total_cash_lek)}</div>
          </div>
        </div>
      )}

      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-400 text-sm">Duke ngarkuar...</div>
        ) : !searched ? (
          <div className="p-8 text-center text-slate-400 text-sm">Vendos filtrat dhe kliko Kërko.</div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center">
            <div className="text-5xl mb-3">📅</div>
            <p className="text-slate-500">Nuk u gjetën fatura në këtë periudhë.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase">Data</th>
                  <th className="px-3 py-2 text-center text-xs font-semibold text-slate-500 uppercase">Fatura</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase">Pa Zbritje</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase">Zbritja</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase">Pa TVSH</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase">TVSH</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase bg-blue-50">TOTALI</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase">💵 Cash</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase">💳 POS</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase">🏦 Bankë</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase">⚠️ Borxh</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase">Pa Paguar</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-emerald-700 uppercase bg-emerald-50" title="Total − POS − Bankë − Pa Paguar">💵 Total Cash</th>
                  <th className="px-3 py-2 text-center text-xs font-semibold text-slate-500 uppercase">Veprime</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.date} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium text-slate-800">
                      {fmtDate(r.date)}
                      {r.credit_count > 0 && (
                        <div className="text-[10px] text-red-600 italic">{r.credit_count} kreditore</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center text-slate-700 font-semibold">{r.count}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">{fmt(r.gross_lek)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${r.disc_lek > 0.005 ? 'text-orange-600' : 'text-slate-400'}`}>
                      {r.disc_lek > 0.005 ? `-${fmt(r.disc_lek)}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">{fmt(r.sub_lek)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">{fmt(r.vat_lek)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-bold text-blue-700 bg-blue-50/40">{fmt(r.tot_lek)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{fmt(r.cash_lek)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-purple-700">{fmt(r.pos_lek)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-blue-700">{fmt(r.bank_lek)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-amber-700">{fmt(r.debt_lek)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums font-semibold ${r.due_lek > 0.005 ? 'text-red-600' : 'text-slate-400'}`}>
                      {r.due_lek > 0.005 ? fmt(r.due_lek) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-bold text-emerald-700 bg-emerald-50/60">
                      {fmt(r.total_cash_lek)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={() => onNavigate?.('fatura-shitje', { date: r.date })}
                        className="px-2 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 text-[11px] font-medium"
                        title="Shih faturat e ditës"
                      >Hap</button>
                    </td>
                  </tr>
                ))}
              </tbody>
              {totals && (
                <tfoot className="bg-blue-50 border-t-2 border-blue-200">
                  <tr className="font-bold text-xs">
                    <td className="px-3 py-3 text-right uppercase tracking-wide text-blue-700">TOTALI</td>
                    <td className="px-3 py-3 text-center tabular-nums text-slate-800">{totals.count}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-800">{fmt(totals.gross_lek)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-orange-700">
                      {totals.disc_lek > 0.005 ? `-${fmt(totals.disc_lek)}` : '—'}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-800">{fmt(totals.sub_lek)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-700">{fmt(totals.vat_lek)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-blue-800 text-sm bg-blue-100/60">{fmt(totals.tot_lek)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-emerald-800">{fmt(totals.cash_lek)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-purple-800">{fmt(totals.pos_lek)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-blue-800">{fmt(totals.bank_lek)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-amber-800">{fmt(totals.debt_lek)}</td>
                    <td className={`px-3 py-3 text-right tabular-nums ${totals.due_lek > 0.005 ? 'text-red-700' : 'text-slate-500'}`}>
                      {totals.due_lek > 0.005 ? fmt(totals.due_lek) : '—'}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-emerald-800 text-sm bg-emerald-100/70">
                      {fmt(totals.total_cash_lek)}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>

      <p className="text-[11px] text-slate-400 italic px-1">
        Faturat e anuluara janë përjashtuar. Faturat kreditore (stornime) zbresin xhiron automatikisht (kanë totale negative).
        Klasifikimi Cash/POS/Bankë/Borxh përdor llojin e pagesës të ruajtur në faturë.
      </p>
    </div>
  )
}
