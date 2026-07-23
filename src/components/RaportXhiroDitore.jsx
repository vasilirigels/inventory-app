import { useState, useEffect, useCallback, Fragment } from 'react'
import { loadXLSX } from '../lib/xlsx.js'
import { getUser } from '../lib/auth.js'
import DateRangeFilter from './DateRangeFilter.jsx'

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
function getMinusDays(n) {
  const d = new Date(); d.setDate(d.getDate() - n)
  return d.toISOString().split('T')[0]
}

const SALES_MAX_DAYS = 30
const isSalesUser = () => getUser()?.role === 'sales'

export default function RaportXhiroDitore({ onNavigate }) {
  const isSales = isSalesUser()
  const minFrom = isSales ? getMinusDays(SALES_MAX_DAYS - 1) : null
  const clampFrom = (v) => (minFrom && v && v < minFrom ? minFrom : v)

  const [from, setFrom]   = useState(clampFrom(getMonthStart()))
  const [to, setTo]       = useState(getToday())
  const [pm, setPm]       = useState('')
  const [cur, setCur]     = useState('')
  const [eurRate, setEurRate] = useState('')
  const [rows, setRows]   = useState([])
  const [totals, setTotals] = useState(null)
  const [byCurTotals, setByCurTotals] = useState([])
  const [serverEurRate, setServerEurRate] = useState(100)
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [expanded, setExpanded] = useState(() => new Set())

  const toggleExpand = (date) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(date)) next.delete(date); else next.add(date)
      return next
    })
  }
  const expandAll = () => setExpanded(new Set(rows.map(r => r.date)))
  const collapseAll = () => setExpanded(new Set())

  const load = useCallback(async () => {
    if (!from || !to) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ from, to })
      if (pm)  params.set('payment_method', pm)
      if (cur) params.set('currency', cur)
      const rateNum = parseFloat(eurRate)
      if (Number.isFinite(rateNum) && rateNum > 0) params.set('eur_rate', String(rateNum))
      const d = await fetch(`/api/reports/daily-turnover?${params}`).then(r => r.json())
      setRows(Array.isArray(d?.rows) ? d.rows : [])
      setTotals(d?.totals || null)
      setByCurTotals(Array.isArray(d?.by_currency_totals) ? d.by_currency_totals : [])
      setServerEurRate(d?.eur_rate || 100)
      setSearched(true)
    } catch (e) {
      console.error(e); setRows([]); setTotals(null); setByCurTotals([])
    } finally {
      setLoading(false)
    }
  }, [from, to, pm, cur, eurRate])

  useEffect(() => { load() }, []) // eslint-disable-line
  useEffect(() => {
    if (searched) load()
    // eslint-disable-next-line
  }, [from, to, pm, cur, eurRate])

  const exportXlsx = async () => {
    const XLSX = await loadXLSX()
    const out = rows.map(r => ({
      Data: r.date,
      'Nr. Faturash': r.count,
      'Kreditore': r.credit_count,
      'Pa Zbritje (EUR)': r.gross_eur,
      'Zbritja (EUR)': r.disc_eur,
      'Pa TVSH (EUR)': r.sub_eur,
      'TVSH (EUR)': r.vat_eur,
      'TOTALI (EUR)': r.tot_eur,
      'Cash (EUR)': r.cash_eur,
      'POS (EUR)': r.pos_eur,
      'Bankë (EUR)': r.bank_eur,
      'Borxh (EUR)': r.debt_eur,
      'Paguar (EUR)': r.paid_eur,
      'Pa Paguar (EUR)': r.due_eur,
      'Total Cash (EUR)': r.total_cash_eur,
    }))
    if (totals) {
      out.push({
        Data: 'TOTALI',
        'Nr. Faturash': totals.count,
        'Kreditore': totals.credit_count,
        'Pa Zbritje (EUR)': totals.gross_eur,
        'Zbritja (EUR)': totals.disc_eur,
        'Pa TVSH (EUR)': totals.sub_eur,
        'TVSH (EUR)': totals.vat_eur,
        'TOTALI (EUR)': totals.tot_eur,
        'Cash (EUR)': totals.cash_eur,
        'POS (EUR)': totals.pos_eur,
        'Bankë (EUR)': totals.bank_eur,
        'Borxh (EUR)': totals.debt_eur,
        'Paguar (EUR)': totals.paid_eur,
        'Pa Paguar (EUR)': totals.due_eur,
        'Total Cash (EUR)': totals.total_cash_eur,
      })
    }
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.json_to_sheet(out)
    ws['!cols'] = [12, 10, 8, 14, 12, 14, 12, 14, 12, 12, 12, 12, 12, 12, 14].map(w => ({ wch: w }))
    XLSX.utils.book_append_sheet(wb, ws, 'Xhiro Ditore (EUR)')

    // Fletë e dytë: ndarja në monedhat native (LEK/EUR/USD/GBP/CHF).
    const nativeRows = []
    for (const r of rows) {
      for (const bc of r.by_currency) {
        nativeRows.push({
          Data: r.date,
          Monedha: bc.currency,
          Cash: bc.cash,
          POS: bc.pos,
          'Bankë': bc.bank,
          'Borxh': bc.debt,
        })
      }
    }
    for (const t of byCurTotals) {
      nativeRows.push({
        Data: 'TOTALI',
        Monedha: t.currency,
        Cash: t.cash,
        POS: t.pos,
        'Bankë': t.bank,
        'Borxh': t.debt,
      })
    }
    if (nativeRows.length > 0) {
      const ws2 = XLSX.utils.json_to_sheet(nativeRows)
      ws2['!cols'] = [12, 10, 14, 14, 14, 14].map(w => ({ wch: w }))
      XLSX.utils.book_append_sheet(wb, ws2, 'Sipas Monedhës')
    }

    XLSX.writeFile(wb, `raport_xhiro_ditore_${from}_${to}.xlsx`)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Raport Xhiro Ditore</h2>
          <p className="text-xs text-slate-500">
            Xhiroja ditore nga Faturat e Shitjes · Totalet në <strong>EUR</strong> (bazë) · Klikoni ▶ për të parë monedhat native
          </p>
        </div>
        <button onClick={exportXlsx} disabled={!rows.length} className="btn-secondary disabled:opacity-40">
          📥 Eksporto Excel
        </button>
      </div>

      <DateRangeFilter
        from={from}
        to={to}
        minFrom={minFrom || undefined}
        onChange={({ from: f, to: t }) => { setFrom(clampFrom(f)); setTo(t) }}
        loading={loading}
        hint={isSales
          ? `Shitësit mund të shohin vetëm 30 ditët e fundit (nga ${fmtDate(minFrom)}).`
          : 'Ndikon: rreshtat, totalet dhe eksporti'}
      />

      <div className="card">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
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
          <div>
            <label className="form-label">Kursi EUR (LEK për 1 EUR)</label>
            <input
              type="number" step="0.01" min="0"
              value={eurRate}
              onChange={e => setEurRate(e.target.value)}
              placeholder={`Auto: ${serverEurRate}`}
              className="input-field"
              title="Përdoret për konvertimin bazë në EUR. Bosh = kursi më i freskët i faturave EUR në periudhë."
            />
          </div>
          <div className="flex gap-2">
            <button onClick={load} className="btn-secondary flex-1" title="Rifresko manualisht — filtrat aplikohen automatikisht">
              🔄 Rifresko
            </button>
            <button
              onClick={() => { setPm(''); setCur(''); setEurRate(''); setFrom(clampFrom(getMonthStart())); setTo(getToday()) }}
              className="btn-secondary"
              title="Pastro filtrat"
            >✕</button>
          </div>
        </div>
      </div>

      {totals && rows.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="card !p-4">
            <div className="text-[10px] text-slate-500 uppercase font-semibold">Total Xhiro (EUR)</div>
            <div className="text-xl font-bold text-blue-700 tabular-nums">{fmt(totals.tot_eur)}</div>
          </div>
          <div className="card !p-4">
            <div className="text-[10px] text-slate-500 uppercase font-semibold">Pa TVSH (EUR)</div>
            <div className="text-xl font-bold text-slate-800 tabular-nums">{fmt(totals.sub_eur)}</div>
          </div>
          <div className="card !p-4">
            <div className="text-[10px] text-slate-500 uppercase font-semibold">TVSH (EUR)</div>
            <div className="text-xl font-bold text-slate-700 tabular-nums">{fmt(totals.vat_eur)}</div>
          </div>
          <div className="card !p-4">
            <div className="text-[10px] text-slate-500 uppercase font-semibold">Pa Paguar (Borxh) (EUR)</div>
            <div className="text-xl font-bold text-red-700 tabular-nums">{fmt(totals.due_eur)}</div>
          </div>
          <div className="card !p-4 md:col-span-4 bg-emerald-50/60 border-emerald-200">
            <div className="text-[10px] text-emerald-700 uppercase font-semibold">
              💵 TOTAL CASH (EUR) — Total − POS − Bankë − Pa Paguar
            </div>
            <div className="text-2xl font-extrabold text-emerald-700 tabular-nums">{fmt(totals.total_cash_eur)}</div>
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <div className="flex items-center gap-2 text-xs flex-wrap">
          <button onClick={expandAll} className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold">
            ▼ Zgjero të gjitha
          </button>
          <button onClick={collapseAll} className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold">
            ▶ Mbyll të gjitha
          </button>
          <span className="text-slate-400 italic">Kursi bazë: 1 EUR = {serverEurRate} LEK</span>
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
                  <th className="px-2 py-2 w-8"></th>
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
                {rows.map(r => {
                  const isExp = expanded.has(r.date)
                  const hasBreakdown = r.by_currency && r.by_currency.length > 0
                  return (
                    <Fragment key={r.date}>
                      <tr className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-2 py-2 text-center">
                          {hasBreakdown && (
                            <button
                              onClick={() => toggleExpand(r.date)}
                              className="w-6 h-6 rounded hover:bg-slate-200 text-slate-500 text-xs"
                              title={isExp ? 'Mbyll monedhat' : 'Shih monedhat native'}
                            >{isExp ? '▼' : '▶'}</button>
                          )}
                        </td>
                        <td className="px-3 py-2 font-medium text-slate-800">
                          {fmtDate(r.date)}
                          {r.credit_count > 0 && (
                            <div className="text-[10px] text-red-600 italic">{r.credit_count} kreditore</div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center text-slate-700 font-semibold">{r.count}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-600">{fmt(r.gross_eur)}</td>
                        <td className={`px-3 py-2 text-right tabular-nums ${r.disc_eur > 0.005 ? 'text-orange-600' : 'text-slate-400'}`}>
                          {r.disc_eur > 0.005 ? `-${fmt(r.disc_eur)}` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-700">{fmt(r.sub_eur)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-500">{fmt(r.vat_eur)}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-bold text-blue-700 bg-blue-50/40">{fmt(r.tot_eur)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{fmt(r.cash_eur)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-purple-700">{fmt(r.pos_eur)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-blue-700">{fmt(r.bank_eur)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-amber-700">{fmt(r.debt_eur)}</td>
                        <td className={`px-3 py-2 text-right tabular-nums font-semibold ${r.due_eur > 0.005 ? 'text-red-600' : 'text-slate-400'}`}>
                          {r.due_eur > 0.005 ? fmt(r.due_eur) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-bold text-emerald-700 bg-emerald-50/60">
                          {fmt(r.total_cash_eur)}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <button
                            onClick={() => onNavigate?.('fatura-shitje', { date: r.date })}
                            className="px-2 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 text-[11px] font-medium"
                            title="Shih faturat e ditës"
                          >Hap</button>
                        </td>
                      </tr>
                      {isExp && hasBreakdown && r.by_currency.map(bc => (
                        <tr key={`${r.date}-${bc.currency}`} className="bg-slate-50/70 border-b border-slate-100 text-[11px]">
                          <td className="px-2 py-1"></td>
                          <td className="px-3 py-1 text-slate-500 italic">
                            <span className="inline-flex items-center gap-1">
                              <span className="text-slate-300">↳</span>
                              <span className="font-semibold text-slate-600">{bc.currency}</span>
                              <span className="text-slate-400">(native)</span>
                            </span>
                          </td>
                          <td colSpan={6}></td>
                          <td className="px-3 py-1 text-right tabular-nums text-emerald-700">{fmt(bc.cash)}</td>
                          <td className="px-3 py-1 text-right tabular-nums text-purple-700">{fmt(bc.pos)}</td>
                          <td className="px-3 py-1 text-right tabular-nums text-blue-700">{fmt(bc.bank)}</td>
                          <td className="px-3 py-1 text-right tabular-nums text-amber-700">{fmt(bc.debt)}</td>
                          <td colSpan={3}></td>
                        </tr>
                      ))}
                    </Fragment>
                  )
                })}
              </tbody>
              {totals && (
                <tfoot className="bg-blue-50 border-t-2 border-blue-200">
                  <tr className="font-bold text-xs">
                    <td></td>
                    <td className="px-3 py-3 text-right uppercase tracking-wide text-blue-700">TOTALI (EUR)</td>
                    <td className="px-3 py-3 text-center tabular-nums text-slate-800">{totals.count}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-800">{fmt(totals.gross_eur)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-orange-700">
                      {totals.disc_eur > 0.005 ? `-${fmt(totals.disc_eur)}` : '—'}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-800">{fmt(totals.sub_eur)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-700">{fmt(totals.vat_eur)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-blue-800 text-sm bg-blue-100/60">{fmt(totals.tot_eur)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-emerald-800">{fmt(totals.cash_eur)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-purple-800">{fmt(totals.pos_eur)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-blue-800">{fmt(totals.bank_eur)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-amber-800">{fmt(totals.debt_eur)}</td>
                    <td className={`px-3 py-3 text-right tabular-nums ${totals.due_eur > 0.005 ? 'text-red-700' : 'text-slate-500'}`}>
                      {totals.due_eur > 0.005 ? fmt(totals.due_eur) : '—'}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-emerald-800 text-sm bg-emerald-100/70">
                      {fmt(totals.total_cash_eur)}
                    </td>
                    <td></td>
                  </tr>
                  {byCurTotals.map(t => (
                    <tr key={`sum-${t.currency}`} className="text-[11px] border-t border-blue-100 bg-blue-50/40">
                      <td></td>
                      <td className="px-3 py-2 text-slate-600 italic">
                        <span className="inline-flex items-center gap-1">
                          <span className="text-slate-300">↳</span>
                          <span className="font-semibold text-slate-700">Total në {t.currency}</span>
                          <span className="text-slate-400">(native)</span>
                        </span>
                      </td>
                      <td colSpan={6}></td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-700 font-semibold">{fmt(t.cash)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-purple-700 font-semibold">{fmt(t.pos)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-blue-700 font-semibold">{fmt(t.bank)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-amber-700 font-semibold">{fmt(t.debt)}</td>
                      <td colSpan={3}></td>
                    </tr>
                  ))}
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>

      <p className="text-[11px] text-slate-400 italic px-1">
        Faturat e anuluara janë përjashtuar. Faturat kreditore (stornime) zbresin xhiron automatikisht (kanë totale negative).
        Kolonat kryesore janë në EUR (bazë) me kursin 1 EUR = {serverEurRate} LEK. Rreshtat e zgjeruara tregojnë pagesat në monedhën origjinale (native), pa konvertim.
      </p>
    </div>
  )
}
