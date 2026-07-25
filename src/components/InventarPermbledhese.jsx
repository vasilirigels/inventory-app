import { useEffect, useState, useMemo } from 'react'
import DateRangeFilter from './DateRangeFilter.jsx'

function n(v) { return parseFloat(v) || 0 }
function fmt(v, digits = 2) {
  return n(v).toLocaleString('sq-AL', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}
function fmtQty(v) {
  const x = n(v)
  return Number.isInteger(x) ? x.toLocaleString('sq-AL') : x.toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
}

export default function InventarPermbledhese() {
  const [data, setData] = useState({ rows: [], totals: null, profitByCurrency: {} })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [sortBy, setSortBy] = useState('value')   // value | name | qty
  const [refreshKey, setRefreshKey] = useState(0)
  const [from, setFrom] = useState('')   // bosh = nga fillimi
  const [to, setTo]     = useState('')   // bosh = deri sot

  useEffect(() => {
    let cancel = false
    setLoading(true)
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to)   params.set('to', to)
    const qs = params.toString()
    fetch(`/api/inventory-summary${qs ? `?${qs}` : ''}`)
      .then(r => r.json())
      .then(d => { if (!cancel) { setData(d); setLoading(false) } })
      .catch(() => { if (!cancel) { setData({ rows: [], totals: null, profitByCurrency: {} }); setLoading(false) } })
    return () => { cancel = true }
  }, [refreshKey, from, to])

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    let list = data.rows
    if (!showAll) {
      list = list.filter(r => r.total_in > 0 || r.total_out > 0 || n(r.net_qty) !== 0)
    }
    if (q) {
      list = list.filter(r =>
        (r.name || '').toLowerCase().includes(q) ||
        (r.barcode || '').toLowerCase().includes(q) ||
        (r.sku || '').toLowerCase().includes(q) ||
        (r.category || '').toLowerCase().includes(q)
      )
    }
    if (sortBy === 'value') list = [...list].sort((a, b) => b.total_value_lek - a.total_value_lek)
    else if (sortBy === 'qty') list = [...list].sort((a, b) => b.net_qty - a.net_qty)
    else if (sortBy === 'profit') list = [...list].sort((a, b) => n(b.profit_no_vat_lek) - n(a.profit_no_vat_lek))
    else list = [...list].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'sq'))
    return list
  }, [data.rows, search, showAll, sortBy])

  const shownTotals = useMemo(() => {
    const t = filtered.reduce((a, r) => ({
      total_in:                 a.total_in                 + n(r.total_in),
      total_out:                a.total_out                + n(r.total_out),
      net_qty:                  a.net_qty                  + n(r.net_qty),
      total_value_lek:          a.total_value_lek          + n(r.total_value_lek),
      total_value_no_vat_lek:   a.total_value_no_vat_lek   + n(r.total_value_no_vat_lek),
      total_value_vat_lek:      a.total_value_vat_lek      + n(r.total_value_vat_lek),
      total_value_with_vat_lek: a.total_value_with_vat_lek + n(r.total_value_with_vat_lek),
      sales_no_vat_lek:         a.sales_no_vat_lek         + n(r.sales_no_vat_lek),
      cogs_no_vat_lek:          a.cogs_no_vat_lek          + n(r.cogs_no_vat_lek),
      profit_no_vat_lek:        a.profit_no_vat_lek        + n(r.profit_no_vat_lek),
    }), { total_in: 0, total_out: 0, net_qty: 0,
          total_value_lek: 0,
          total_value_no_vat_lek: 0, total_value_vat_lek: 0, total_value_with_vat_lek: 0,
          sales_no_vat_lek: 0, cogs_no_vat_lek: 0, profit_no_vat_lek: 0 })
    t.profit_margin_pct = t.sales_no_vat_lek > 0
      ? +((t.profit_no_vat_lek / t.sales_no_vat_lek) * 100).toFixed(2)
      : 0
    return t
  }, [filtered])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">📦 Përmbledhëse Inventari</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Hyrje (+): Fatura Blerje, Magazina Hyrje · Dalje (−): Fatura Shitje, Magazina Dalje
          </p>
        </div>
        <button onClick={() => setRefreshKey(k => k + 1)} className="btn-secondary text-xs">↻ Rifresko</button>
      </div>

      <DateRangeFilter
        from={from}
        to={to}
        onChange={({ from: f, to: t }) => { setFrom(f); setTo(t) }}
        loading={loading}
        emptyForAll
        hint="Boshi = i gjithë historiku"
      />

      {/* Filters shtesë */}
      <div className="card flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">🔎</span>
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Filtra shtesë</span>
        </div>
        <div className="flex-1 min-w-[220px]">
          <label className="form-label">Produkti (emër / barkod / SKU / kategori)</label>
          <input
            type="text" value={search}
            onChange={e => setSearch(e.target.value)}
            className="input-field" placeholder="kërko..."
          />
        </div>
        <div>
          <label className="form-label">Rendit</label>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="input-field w-44">
            <option value="value">Vlera (më e madhe)</option>
            <option value="qty">Sasia (më e madhe)</option>
            <option value="profit">Fitimi (më i madh)</option>
            <option value="name">Emri (A–Z)</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 mb-1">
          <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />
          Trego edhe produktet pa lëvizje
        </label>
        {(from || to || search) && (
          <button
            onClick={() => { setFrom(''); setTo(''); setSearch('') }}
            className="btn-secondary text-xs"
          >Pastro filtrat</button>
        )}
      </div>

      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-400 dark:text-slate-500 text-sm">Duke ngarkuar...</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center">
            <div className="text-5xl mb-3">📦</div>
            <p className="text-slate-500 dark:text-slate-400">
              {data.rows.length === 0
                ? 'Nuk ka produkte në inventar.'
                : 'Asnjë produkt nuk përputhet me filtrat.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-separate" style={{ borderSpacing: 0 }}>
              <thead className="bg-slate-50 dark:bg-slate-900">
                {/* Row 1 — grupe */}
                <tr className="text-[10px] uppercase tracking-wider">
                  <th colSpan={2} className="px-3 py-2 text-left font-bold text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">Produkti</th>
                  <th colSpan={3} className="px-3 py-2 text-center font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 border-b border-l-2 border-slate-200 dark:border-slate-700">Hyrje (sasi)</th>
                  <th colSpan={3} className="px-3 py-2 text-center font-bold text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/30 border-b border-l-2 border-slate-200 dark:border-slate-700">Dalje (sasi)</th>
                  <th className="px-3 py-2 text-center font-bold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 border-b border-l-2 border-slate-200 dark:border-slate-700">Bilanci</th>
                  <th colSpan={2} className="px-3 py-2 text-center font-bold text-slate-600 dark:text-slate-300 border-b border-l-2 border-slate-200 dark:border-slate-700">Kosto mesatare</th>
                  <th colSpan={3} className="px-3 py-2 text-center font-bold text-blue-700 dark:text-blue-300 bg-blue-50/60 border-b border-l-2 border-slate-200 dark:border-slate-700">Vlera e stokut (LEK)</th>
                  <th colSpan={4} className="px-3 py-2 text-center font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 border-b border-l-2 border-slate-200 dark:border-slate-700">Fitimi (periudha)</th>
                </tr>
                {/* Row 2 — kolonat */}
                <tr className="text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                  <th className="px-3 py-2 text-left text-[11px] font-semibold border-b border-slate-200 dark:border-slate-700">Emri</th>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold border-b border-slate-200 dark:border-slate-700">Barkod / SKU</th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold border-b border-l-2 border-slate-200 dark:border-slate-700" title="Sasia nga Faturat e Blerjes">Blerje</th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold border-b border-slate-200 dark:border-slate-700" title="Sasia nga Magazina Hyrje">Mag. Hyrje</th>
                  <th className="px-3 py-2 text-right text-[11px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 border-b border-slate-200 dark:border-slate-700">Σ Hyrje</th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold border-b border-l-2 border-slate-200 dark:border-slate-700" title="Sasia nga Faturat e Shitjes">Shitje</th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold border-b border-slate-200 dark:border-slate-700" title="Sasia nga Magazina Dalje">Mag. Dalje</th>
                  <th className="px-3 py-2 text-right text-[11px] font-bold text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/30 border-b border-slate-200 dark:border-slate-700">Σ Dalje</th>
                  <th className="px-3 py-2 text-right text-[11px] font-bold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 border-b border-l-2 border-slate-200 dark:border-slate-700">Gjendja</th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold border-b border-l-2 border-slate-200 dark:border-slate-700">pa TVSH</th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold border-b border-slate-200 dark:border-slate-700">me TVSH</th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold border-b border-l-2 border-slate-200 dark:border-slate-700">pa TVSH</th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold border-b border-slate-200 dark:border-slate-700">TVSH</th>
                  <th className="px-3 py-2 text-right text-[11px] font-bold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 border-b border-slate-200 dark:border-slate-700">me TVSH</th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold border-b border-l-2 border-slate-200 dark:border-slate-700" title="Shitje pa TVSH në LEK">Shitje</th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold border-b border-slate-200 dark:border-slate-700" title="Sasia e shitur × kosto mesatare pa TVSH">Kosto</th>
                  <th className="px-3 py-2 text-right text-[11px] font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 border-b border-slate-200 dark:border-slate-700">Fitim</th>
                  <th className="px-3 py-2 text-right text-[11px] font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 border-b border-slate-200 dark:border-slate-700">Marzh %</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => {
                  const stockMismatch = Math.abs(n(r.net_qty) - n(r.stock)) > 0.001
                  const cellBase = 'px-3 py-2.5 text-right tabular-nums whitespace-nowrap border-b border-slate-100 dark:border-slate-800'
                  const cellGroup = `${cellBase} border-l-2 border-l-slate-200 dark:border-l-slate-700`
                  return (
                    <tr key={r.id} className="hover:bg-slate-50/60">
                      {/* Produkti */}
                      <td className="px-3 py-2.5 border-b border-slate-100 dark:border-slate-800">
                        <div className="font-medium text-slate-800 dark:text-slate-100">{r.name}</div>
                        {r.category && <div className="text-[10px] text-slate-400 dark:text-slate-500">{r.category}</div>}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800">
                        <div>{r.barcode || '—'}</div>
                        {r.sku && <div className="text-[10px] text-slate-400 dark:text-slate-500">{r.sku}</div>}
                      </td>

                      {/* Hyrje */}
                      <td className={`${cellGroup} text-slate-700 dark:text-slate-200`}>
                        {n(r.qty_in_purchase) > 0 ? fmtQty(r.qty_in_purchase) : '—'}
                      </td>
                      <td className={`${cellBase} text-slate-700 dark:text-slate-200`}>
                        {n(r.qty_in_magazina) > 0 ? fmtQty(r.qty_in_magazina) : '—'}
                      </td>
                      <td className={`${cellBase} font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50/50`}>
                        {n(r.total_in) > 0 ? `+${fmtQty(r.total_in)}` : '—'}
                      </td>

                      {/* Dalje */}
                      <td className={`${cellGroup} text-slate-700 dark:text-slate-200`}>
                        {n(r.qty_out_sales) !== 0 ? fmtQty(r.qty_out_sales) : '—'}
                      </td>
                      <td className={`${cellBase} text-slate-700 dark:text-slate-200`}>
                        {n(r.qty_out_magazina) > 0 ? fmtQty(r.qty_out_magazina) : '—'}
                      </td>
                      <td className={`${cellBase} font-semibold text-red-700 dark:text-red-300 bg-red-50/50`}>
                        {n(r.total_out) !== 0 ? `−${fmtQty(r.total_out)}` : '—'}
                      </td>

                      {/* Bilanci */}
                      <td className={`${cellGroup} font-bold bg-blue-50/60 ${n(r.net_qty) < 0 ? 'text-red-700 dark:text-red-300' : 'text-blue-800 dark:text-blue-200'}`}>
                        {fmtQty(r.net_qty)}
                        {stockMismatch && (
                          <div className="text-[9px] font-normal text-orange-600 italic" title={`Stoku aktual në Produkte: ${r.stock}`}>
                            ≠ stok: {fmtQty(r.stock)}
                          </div>
                        )}
                      </td>

                      {/* Kosto mesatare */}
                      <td className={`${cellGroup} text-slate-700 dark:text-slate-200`}>
                        {n(r.avg_price_no_vat_lek ?? r.avg_price_lek) > 0 ? fmt(r.avg_price_no_vat_lek ?? r.avg_price_lek) : '—'}
                      </td>
                      <td className={`${cellBase} text-slate-700 dark:text-slate-200`}>
                        {n(r.avg_price_with_vat_lek) > 0 ? fmt(r.avg_price_with_vat_lek) : '—'}
                      </td>

                      {/* Vlera e stokut */}
                      <td className={`${cellGroup} text-slate-800 dark:text-slate-100`}>
                        {fmt(r.total_value_no_vat_lek ?? r.total_value_lek)}
                      </td>
                      <td className={`${cellBase} text-slate-500 dark:text-slate-400`}>
                        {n(r.total_value_vat_lek) > 0.005 ? fmt(r.total_value_vat_lek) : '—'}
                      </td>
                      <td className={`${cellBase} font-bold text-blue-800 dark:text-blue-200 bg-blue-50/60`}>
                        {fmt(r.total_value_with_vat_lek ?? r.total_value_lek)}
                      </td>

                      {/* Fitimi */}
                      <td className={`${cellGroup} text-slate-700 dark:text-slate-200`}>
                        {n(r.sales_no_vat_lek) > 0.005 ? fmt(r.sales_no_vat_lek) : '—'}
                      </td>
                      <td className={`${cellBase} text-slate-500 dark:text-slate-400`}>
                        {n(r.cogs_no_vat_lek) > 0.005 ? fmt(r.cogs_no_vat_lek) : '—'}
                      </td>
                      <td className={`${cellBase} font-bold bg-amber-50/60 ${n(r.profit_no_vat_lek) < 0 ? 'text-red-700 dark:text-red-300' : n(r.profit_no_vat_lek) > 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-400 dark:text-slate-500'}`}>
                        {n(r.sales_no_vat_lek) > 0.005 ? fmt(r.profit_no_vat_lek) : '—'}
                      </td>
                      <td className={`${cellBase} font-semibold bg-amber-50/60 ${n(r.profit_margin_pct) < 0 ? 'text-red-700 dark:text-red-300' : n(r.profit_margin_pct) > 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-400 dark:text-slate-500'}`}>
                        {n(r.sales_no_vat_lek) > 0.005 ? `${fmt(r.profit_margin_pct, 1)}%` : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className="bg-slate-100 dark:bg-slate-800 border-t-2 border-slate-300 dark:border-slate-700">
                <tr className="font-bold text-xs">
                  <td colSpan={11} className="px-3 py-3 text-right uppercase tracking-wide text-slate-700 dark:text-slate-200 whitespace-nowrap">
                    TOTAL në LEK (të konvertuara) — {filtered.length} produkte
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-800 dark:text-slate-100 border-l-2 border-slate-300 dark:border-slate-700 whitespace-nowrap">{fmt(shownTotals.total_value_no_vat_lek)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-700 dark:text-slate-200 whitespace-nowrap">{fmt(shownTotals.total_value_vat_lek)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-blue-800 dark:text-blue-200 text-base bg-blue-50/60 whitespace-nowrap">{fmt(shownTotals.total_value_with_vat_lek)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-800 dark:text-slate-100 border-l-2 border-slate-300 dark:border-slate-700 whitespace-nowrap">{fmt(shownTotals.sales_no_vat_lek)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-600 dark:text-slate-300 whitespace-nowrap">{fmt(shownTotals.cogs_no_vat_lek)}</td>
                  <td className={`px-3 py-3 text-right tabular-nums text-base bg-amber-50/60 whitespace-nowrap ${shownTotals.profit_no_vat_lek < 0 ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
                    {fmt(shownTotals.profit_no_vat_lek)}
                  </td>
                  <td className={`px-3 py-3 text-right tabular-nums bg-amber-50/60 whitespace-nowrap ${shownTotals.profit_margin_pct < 0 ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
                    {shownTotals.sales_no_vat_lek > 0 ? `${fmt(shownTotals.profit_margin_pct, 1)}%` : '—'}
                  </td>
                </tr>
                {/* Rreshta për fitimin sipas monedhës origjinale */}
                {Object.keys(data.profitByCurrency || {}).sort().map(cur => {
                  const t = data.profitByCurrency[cur]
                  return (
                    <tr key={cur} className="font-bold text-xs bg-emerald-50 dark:bg-emerald-900/30 border-t border-emerald-200">
                      <td colSpan={11} className="px-3 py-2.5 text-right uppercase tracking-wide text-emerald-700 dark:text-emerald-300 whitespace-nowrap">
                        💵 TOTAL ({cur}) — pa konvertim
                      </td>
                      <td colSpan={3} className="px-3 py-2.5 text-center text-[10px] text-slate-400 dark:text-slate-500 italic border-l-2 border-emerald-200 whitespace-nowrap">
                        (vlera e stokut mbetet vetëm në LEK)
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-800 dark:text-slate-100 border-l-2 border-emerald-200 whitespace-nowrap">{fmt(t.sales_no_vat)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-300 whitespace-nowrap">{fmt(t.cogs)}</td>
                      <td className={`px-3 py-2.5 text-right tabular-nums text-base whitespace-nowrap ${t.profit < 0 ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
                        {fmt(t.profit)}
                      </td>
                      <td className={`px-3 py-2.5 text-right tabular-nums whitespace-nowrap ${t.margin_pct < 0 ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
                        {t.sales_no_vat > 0 ? `${fmt(t.margin_pct, 2)}%` : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <p className="text-[11px] text-slate-400 dark:text-slate-500 italic px-1">
        Kosto për Fitim: <strong>Çmimi Kosto</strong> nga karta e produktit × kursi i shitjes (kur cost_price &gt; 0);
        përndryshe përdoret mesatarja e ponderuar historike e blerjeve deri në fund të periudhës.
        Çmimi mesatar në kolonë llogaritet si mesatare e ponderuar (vlera totale e hyrjes / sasia totale) e të gjitha blerjeve deri në `to`.
        Faturat e anuluara nuk merren parasysh; faturat kreditore (stornime) zbresin sasinë e dalë automatikisht.
        Konvertimi në LEK bëhet me kursin e secilës faturë.
        Fitimi = Shitje pa TVSH (LEK) − COGS. Nuk përfshin dalje magazine (transferime).
      </p>
    </div>
  )
}
