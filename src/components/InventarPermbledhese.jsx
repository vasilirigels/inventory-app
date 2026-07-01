import { useEffect, useState, useMemo } from 'react'

function n(v) { return parseFloat(v) || 0 }
function fmt(v, digits = 2) {
  return n(v).toLocaleString('sq-AL', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}
function fmtQty(v) {
  const x = n(v)
  return Number.isInteger(x) ? x.toLocaleString('sq-AL') : x.toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
}

export default function InventarPermbledhese() {
  const [data, setData] = useState({ rows: [], totals: null })
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
      .catch(() => { if (!cancel) { setData({ rows: [], totals: null }); setLoading(false) } })
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
    else list = [...list].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'sq'))
    return list
  }, [data.rows, search, showAll, sortBy])

  const shownTotals = useMemo(() => {
    return filtered.reduce((a, r) => ({
      total_in:                 a.total_in                 + n(r.total_in),
      total_out:                a.total_out                + n(r.total_out),
      net_qty:                  a.net_qty                  + n(r.net_qty),
      total_value_lek:          a.total_value_lek          + n(r.total_value_lek),
      total_value_no_vat_lek:   a.total_value_no_vat_lek   + n(r.total_value_no_vat_lek),
      total_value_vat_lek:      a.total_value_vat_lek      + n(r.total_value_vat_lek),
      total_value_with_vat_lek: a.total_value_with_vat_lek + n(r.total_value_with_vat_lek),
    }), { total_in: 0, total_out: 0, net_qty: 0,
          total_value_lek: 0,
          total_value_no_vat_lek: 0, total_value_vat_lek: 0, total_value_with_vat_lek: 0 })
  }, [filtered])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-800">📦 Përmbledhëse Inventari</h2>
          <p className="text-xs text-slate-500">
            Hyrje (+): Fatura Blerje, Magazina Hyrje · Dalje (−): Fatura Shitje, Magazina Dalje
          </p>
        </div>
        <button onClick={() => setRefreshKey(k => k + 1)} className="btn-secondary text-xs">↻ Rifresko</button>
      </div>

      {/* Filters */}
      <div className="card flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">🔎</span>
          <span className="text-sm font-semibold text-slate-700">Filtra</span>
        </div>
        <div>
          <label className="form-label">Nga data</label>
          <input
            type="date" value={from} max={to || undefined}
            onChange={e => setFrom(e.target.value)}
            className="input-field"
          />
        </div>
        <div>
          <label className="form-label">Deri më datë</label>
          <input
            type="date" value={to} min={from || undefined}
            onChange={e => setTo(e.target.value)}
            className="input-field"
          />
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
            <option value="name">Emri (A–Z)</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700 mb-1">
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
          <div className="p-8 text-center text-slate-400 text-sm">Duke ngarkuar...</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center">
            <div className="text-5xl mb-3">📦</div>
            <p className="text-slate-500">
              {data.rows.length === 0
                ? 'Nuk ka produkte në inventar.'
                : 'Asnjë produkt nuk përputhet me filtrat.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-slate-500">
                  <th className="px-3 py-3 text-left text-xs font-semibold uppercase">Produkti</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold uppercase">Barkod / SKU</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold uppercase" title="Sasia nga Faturat e Blerjes">+ Blerje</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold uppercase" title="Sasia nga Magazina Hyrje">+ Mag. Hyrje</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold uppercase bg-emerald-50 text-emerald-700">Σ Hyrje</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold uppercase" title="Sasia nga Faturat e Shitjes">− Shitje</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold uppercase" title="Sasia nga Magazina Dalje">− Mag. Dalje</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold uppercase bg-red-50 text-red-700">Σ Dalje</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold uppercase bg-blue-50 text-blue-700">Gjendja</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold uppercase">Çm. pa TVSH</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold uppercase">Çm. me TVSH</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold uppercase">Vlera pa TVSH</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold uppercase">TVSH</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold uppercase bg-blue-50 text-blue-700">Vlera me TVSH</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => {
                  const stockMismatch = Math.abs(n(r.net_qty) - n(r.stock)) > 0.001
                  return (
                    <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-2">
                        <div className="font-medium text-slate-800">{r.name}</div>
                        {r.category && <div className="text-[10px] text-slate-400">{r.category}</div>}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-500">
                        <div>{r.barcode || '—'}</div>
                        {r.sku && <div className="text-[10px] text-slate-400">{r.sku}</div>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                        {n(r.qty_in_purchase) > 0 ? fmtQty(r.qty_in_purchase) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                        {n(r.qty_in_magazina) > 0 ? fmtQty(r.qty_in_magazina) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-emerald-700 bg-emerald-50/40">
                        {n(r.total_in) > 0 ? `+${fmtQty(r.total_in)}` : '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                        {n(r.qty_out_sales) > 0 ? fmtQty(r.qty_out_sales) : n(r.qty_out_sales) < 0 ? fmtQty(r.qty_out_sales) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                        {n(r.qty_out_magazina) > 0 ? fmtQty(r.qty_out_magazina) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-red-700 bg-red-50/40">
                        {n(r.total_out) !== 0 ? `−${fmtQty(r.total_out)}` : '—'}
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums font-bold bg-blue-50/40 ${n(r.net_qty) < 0 ? 'text-red-700' : 'text-blue-800'}`}>
                        {fmtQty(r.net_qty)}
                        {stockMismatch && (
                          <div className="text-[9px] font-normal text-orange-600 italic" title={`Stoku aktual në Produkte: ${r.stock}`}>
                            ≠ stok: {fmtQty(r.stock)}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                        {n(r.avg_price_no_vat_lek ?? r.avg_price_lek) > 0 ? fmt(r.avg_price_no_vat_lek ?? r.avg_price_lek) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                        {n(r.avg_price_with_vat_lek) > 0 ? fmt(r.avg_price_with_vat_lek) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-800">
                        {fmt(r.total_value_no_vat_lek ?? r.total_value_lek)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                        {n(r.total_value_vat_lek) > 0.005 ? fmt(r.total_value_vat_lek) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-bold text-blue-800 bg-blue-50/40">
                        {fmt(r.total_value_with_vat_lek ?? r.total_value_lek)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className="bg-blue-50 border-t-2 border-blue-300">
                <tr className="font-bold text-xs">
                  <td colSpan={11} className="px-3 py-3 text-right uppercase tracking-wide text-blue-700">
                    TOTAL ({filtered.length} produkte të treguara)
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-800">{fmt(shownTotals.total_value_no_vat_lek)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-700">{fmt(shownTotals.total_value_vat_lek)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-blue-800 text-base">{fmt(shownTotals.total_value_with_vat_lek)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <p className="text-[11px] text-slate-400 italic px-1">
        Çmimi mesatar llogaritet si mesatare e ponderuar (vlera totale e hyrjes në LEK / sasia totale e hyrjes).
        Faturat e anuluara nuk merren parasysh; faturat kreditore (stornime) zbresin sasinë e dalë automatikisht.
        Konvertimi në LEK bëhet me kursin e secilës faturë / fletë magazinash.
      </p>
    </div>
  )
}
