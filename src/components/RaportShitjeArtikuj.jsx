import { useState, useEffect, useRef, useCallback } from 'react'
import { loadXLSX } from '../lib/xlsx.js'
import DateRangeFilter from './DateRangeFilter.jsx'
import ExportFieldsModal from './ExportFieldsModal.jsx'

// Fushat e eksportit — renditja ndjek Produkte Inventar (barkod → emër → …),
// me metrikat e raportit (qty/has/vlerat e shitjes) në fund.
const SALES_EXPORT_FIELDS = [
  // Fushat e produktit (renditja si te Produkte Inventar export)
  { key: 'nr',             label: 'Nr' },
  { key: 'last_purchase_date', label: 'Data Blerje' },
  { key: 'barcode',        label: 'Barkodi' },
  { key: 'name',           label: 'Pershkrimi' },
  { key: 'category',       label: 'Kategoria' },
  { key: 'material',       label: 'Materiali' },
  { key: 'brand',          label: 'Brendi' },
  { key: 'sku',            label: 'SKU' },
  { key: 'stock',          label: 'Sasia (stock)' },
  { key: 'min_stock',      label: 'Stok Minimal' },
  { key: 'prod_gram',      label: 'Gram (produkt)' },
  { key: 'kodi',           label: 'Kodi (flori)' },
  { key: 'has_gram',       label: 'Cmim Blerje Has' },
  { key: 'has_rate',       label: 'Kursi Blerje' },
  { key: 'cost_price',     label: 'Cmim Kosto ($)' },
  { key: 'multiplier',     label: 'Shumëzues' },
  { key: 'sell_price_has', label: 'Cmim Shitje Has' },
  { key: 'sell_rate',      label: 'Kursi Shitje' },
  { key: 'purchase_price_no_vat', label: 'Cmimi PA' },
  { key: 'vat_rate',       label: 'TVSH %' },
  { key: 'sell_price',     label: 'Cmim Shitje (€)' },
  { key: 'profit_pct',     label: 'Fitim %' },
  { key: 'margin_pct',     label: 'Marzh %' },
  { key: 'promo',          label: 'Në promocion' },
  { key: 'promo_pct',      label: 'Zbritje Promo %' },
  // Metrikat e raportit (në fund)
  { key: 'source',             label: 'Lloji' },
  { key: 'qty',                label: 'Sasia (shitur)' },
  { key: 'has',                label: 'Has (shitur)' },
  { key: 'unit_price_lek',     label: 'Çm. Shitje (LEK)' },
  { key: 'discount_lek',       label: 'Zbritje (LEK)' },
  { key: 'value_no_vat_lek',   label: 'Vlera pa TVSH (LEK)' },
  { key: 'vat_lek',            label: 'TVSH (LEK)' },
  { key: 'value_with_vat_lek', label: 'Vlera me TVSH (LEK)' },
  { key: 'docs_count',         label: 'Nr. Faturash' },
]
const SALES_EXPORT_LS_KEY = 'sales_report_export_fields_v3'
const SALES_DEFAULT_KEYS = ['source', 'barcode', 'name', 'category', 'qty', 'has', 'unit_price_lek', 'value_no_vat_lek', 'value_with_vat_lek']

function n(v) { return parseFloat(v) || 0 }
function fmt(v) {
  const x = n(v)
  if (x === 0) return '—'
  return Math.round(x).toLocaleString('sq-AL', { maximumFractionDigits: 0 })
}
function fmtQty(v) {
  const x = n(v)
  if (x === 0) return '—'
  return x.toLocaleString('sq-AL', { minimumFractionDigits: 0, maximumFractionDigits: 3 })
}

function getToday() { return new Date().toISOString().split('T')[0] }
// Far-past sentinel so the default range covers every sale ever recorded.
const ALL_TIME_FROM = '2000-01-01'

function ProductFilterPicker({ value, onChange }) {
  const [query, setQuery]     = useState(value || '')
  const [results, setResults] = useState([])
  const [open, setOpen]       = useState(false)
  const [loading, setLoading] = useState(false)
  const timerRef = useRef(null)
  const boxRef   = useRef(null)

  useEffect(() => { setQuery(value || '') }, [value])
  useEffect(() => {
    function onDoc(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const search = (q) => {
    clearTimeout(timerRef.current)
    if (!q.trim()) { setResults([]); return }
    timerRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const data = await fetch(`/api/products/search?q=${encodeURIComponent(q)}`).then(r => r.json())
        setResults(Array.isArray(data) ? data : [])
      } catch { setResults([]) }
      setLoading(false)
    }, 200)
  }

  return (
    <div ref={boxRef} className="relative">
      <label className="form-label">Artikulli (barkod / SKU / emër)</label>
      <div className="flex gap-1">
        <input
          type="text"
          value={query}
          placeholder="të gjithë artikujt..."
          onChange={e => { setQuery(e.target.value); onChange(e.target.value); search(e.target.value); setOpen(true) }}
          onFocus={() => query && setOpen(true)}
          className="input-field flex-1"
        />
        {query && (
          <button type="button" onClick={() => { setQuery(''); onChange(''); setOpen(false) }}
            className="px-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 text-xs" title="Pastro">✕</button>
        )}
      </div>
      {open && (results.length > 0 || loading) && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg max-h-64 overflow-y-auto">
          {loading && <div className="p-2 text-xs text-slate-400 dark:text-slate-500">Duke kërkuar...</div>}
          {results.map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => { onChange(p.barcode || p.name); setQuery(p.barcode || p.name); setOpen(false) }}
              className="w-full text-left px-3 py-1.5 hover:bg-blue-50 border-b border-slate-100 dark:border-slate-800 last:border-0"
            >
              <div className="text-xs font-medium text-slate-800 dark:text-slate-100 truncate">{p.name}</div>
              <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">{p.barcode || p.sku || '—'}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function DocsModal({ row, from, to, onClose, onNavigate }) {
  const [docs, setDocs]       = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!row) return
    setLoading(true)
    const params = new URLSearchParams({ from, to })
    if (row.product_id) params.set('product_id', String(row.product_id))
    if (row.barcode) params.set('barcode', row.barcode)
    if (row.name) params.set('name', row.name)
    fetch(`/api/reports/sales-items/docs?${params}`)
      .then(r => r.json())
      .then(d => { setDocs(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => { setDocs([]); setLoading(false) })
  }, [row, from, to])

  if (!row) return null

  const openInvoice = (d) => {
    onNavigate?.('fatura-shitje', { date: d.date, invoiceId: d.invoice_id })
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="modal-header">
          <div>
            <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">Faturat e Shitjes</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Artikulli: <span className="font-medium">{row.name || '—'}</span>
              {row.barcode && <> · <span className="font-mono">{row.barcode}</span></>}
              <> · periudha {from} → {to}</>
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 dark:text-slate-500 text-xl">×</button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center text-slate-400 dark:text-slate-500 text-sm">Duke ngarkuar...</div>
          ) : docs.length === 0 ? (
            <div className="p-8 text-center text-slate-500 dark:text-slate-400 text-sm">S'ka fatura për këtë artikull në periudhë.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Data</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Nr. Fature</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Klienti</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Sasia</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Çm. Shitje (LEK)</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Pa TVSH (LEK)</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Me TVSH (LEK)</th>
                  <th className="px-3 py-2 text-center text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Veprime</th>
                </tr>
              </thead>
              <tbody>
                {docs.map(d => (
                  <tr key={d.invoice_id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-blue-50 cursor-pointer"
                      onClick={() => openInvoice(d)}>
                    <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-300">{d.date}</td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-700 dark:text-slate-200">{d.invoice_no}</td>
                    <td className="px-3 py-2 text-slate-800 dark:text-slate-100">{d.customer_name || <span className="italic text-slate-400 dark:text-slate-500">— pa klient —</span>}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmtQty(d.qty)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">{fmt(d.unit_price_lek)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(d.value_no_vat_lek)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-bold text-blue-700 dark:text-blue-300">{fmt(d.value_with_vat_lek)}</td>
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={e => { e.stopPropagation(); openInvoice(d) }}
                        className="px-2 py-1 rounded-lg bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 text-blue-600 text-[11px] font-medium"
                      >Hap</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="btn-secondary">Mbyll</button>
        </div>
      </div>
    </div>
  )
}

export default function RaportShitjeArtikuj({ onNavigate }) {
  const [from, setFrom]       = useState(ALL_TIME_FROM)
  const [to, setTo]           = useState(getToday())
  const [filter, setFilter]   = useState('')
  const [material, setMaterial] = useState('')
  const [rows, setRows]       = useState([])
  const [rowsDetailed, setRowsDetailed] = useState([])
  const [totals, setTotals]   = useState(null)
  const [totalsByMaterial, setTotalsByMaterial] = useState(null)
  const [totalsByCurrency, setTotalsByCurrency] = useState(null)
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [docsRow, setDocsRow] = useState(null)
  const [showExport, setShowExport] = useState(false)
  const [viewMode, setViewMode] = useState('detailed')  // 'aggregated' | 'detailed'
  const productNo = (id) => id ? `P${String(id).padStart(5, '0')}` : ''

  const load = useCallback(async () => {
    if (!from || !to) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ from, to })
      if (filter.trim()) params.set('q', filter.trim())
      if (material === 'flori' || material === 'diamant') params.set('material', material)
      if (viewMode === 'detailed') params.set('detailed', '1')
      const data = await fetch(`/api/reports/sales-items?${params}`).then(r => r.json())
      setRows(Array.isArray(data?.rows) ? data.rows : [])
      setRowsDetailed(Array.isArray(data?.rowsDetailed) ? data.rowsDetailed : [])
      setTotals(data?.totals || null)
      setTotalsByMaterial(data?.totalsByMaterial || null)
      setTotalsByCurrency(data?.totalsByCurrency || null)
      setSearched(true)
    } catch (e) {
      console.error(e)
      setRows([]); setRowsDetailed([]); setTotals(null); setTotalsByMaterial(null); setTotalsByCurrency(null)
    } finally {
      setLoading(false)
    }
  }, [from, to, filter, material, viewMode])

  useEffect(() => { load() }, []) // eslint-disable-line
  // Auto-load kur ndryshojnë filtrat "atomikë" (data, materiali, viewMode).
  // Për filtrin tekstual përdoret debounce më poshtë.
  useEffect(() => {
    if (searched) load()
    // eslint-disable-next-line
  }, [from, to, material, viewMode])
  // Debounce për filtrin tekstual — 350ms pas ndërprerjes së shkrimit.
  useEffect(() => {
    if (!searched) return
    const t = setTimeout(() => { load() }, 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line
  }, [filter])

  const runExport = async (selectedKeys) => {
    const XLSX = await loadXLSX()
    const matLabel = (m) => m === 'flori' ? 'Flori' : m === 'diamant' ? 'Diamant' : ''
    // Ngarko produktet freskët para eksportit — që getter-at e fushave të
    // produktit (has_gram, cost_price, brand, etj.) të kenë vlerat aktuale.
    let productMap = new Map()
    try {
      const prods = await fetch('/api/products').then(r => r.json())
      if (Array.isArray(prods)) productMap = new Map(prods.map(p => [p.id, p]))
    } catch (_) { /* fallback: fushat e produktit do dalin bosh */ }
    const FIELD_WIDTHS = {
      // Raport metrika
      source: 12, qty: 10, has: 10, unit_price_lek: 14, discount_lek: 14,
      value_no_vat_lek: 16, vat_lek: 14, value_with_vat_lek: 16, docs_count: 10,
      // Produkt fusha (si në Inventar export)
      nr: 10, last_purchase_date: 12, barcode: 14, name: 32, category: 14,
      material: 10, brand: 14, sku: 12, stock: 10, min_stock: 12, prod_gram: 10,
      kodi: 8, has_gram: 14, has_rate: 14, cost_price: 14, multiplier: 12,
      sell_price_has: 14, sell_rate: 14, purchase_price_no_vat: 12,
      vat_rate: 8, sell_price: 16, profit_pct: 10, margin_pct: 10,
      promo: 12, promo_pct: 14,
    }
    const getters = {
      // Raport
      source: r => r.source === 'marketing' ? 'Marketing' : 'Shitje',
      qty: r => r.qty,
      has: r => r.has || 0,
      unit_price_lek: r => r.unit_price_lek,
      discount_lek: r => r.discount_lek,
      value_no_vat_lek: r => r.value_no_vat_lek,
      vat_lek: r => r.vat_lek,
      value_with_vat_lek: r => r.value_with_vat_lek,
      docs_count: r => r.docs_count,
      // Produkt (nga map; fallback te rreshti)
      nr:                 (r, p) => productNo(p?.id || r.product_id),
      last_purchase_date: (r, p) => p?.last_purchase_date || '',
      barcode:            (r, p) => p?.barcode || r.barcode || '',
      name:               (r, p) => p?.name || r.name || '',
      category:           (r, p) => p?.category || r.category || '',
      material:           (r, p) => matLabel(p?.material || r.material),
      brand:              (r, p) => p?.brand || '',
      sku:                (r, p) => p?.sku || r.sku || '',
      stock:              (_, p) => p?.stock ?? 0,
      min_stock:          (_, p) => p?.min_stock ?? 5,
      prod_gram:          (_, p) => p?.gram ?? 0,
      kodi:               (_, p) => p?.kodi || '',
      has_gram:           (_, p) => p?.has_gram ?? 0,
      has_rate:           (_, p) => p?.has_rate ?? 0,
      cost_price:         (_, p) => p?.cost_price ?? 0,
      multiplier:         (_, p) => p?.multiplier ?? 0,
      sell_price_has:     (_, p) => {
        const hg = parseFloat(p?.has_gram) || 0
        const m  = parseFloat(p?.multiplier) || 0
        return hg > 0 && m > 0 ? +(hg * m).toFixed(2) : 0
      },
      sell_rate:          (_, p) => p?.sell_rate ?? 0,
      purchase_price_no_vat: (_, p) => p?.purchase_price_no_vat ?? 0,
      vat_rate:           (_, p) => p?.vat_rate ?? 0,
      sell_price:         (_, p) => p?.sell_price ?? 0,
      profit_pct:         (_, p) => {
        const c = parseFloat(p?.cost_price) || 0
        const s = parseFloat(p?.sell_price) || 0
        return c > 0 ? +(((s - c) / c) * 100).toFixed(2) : 0
      },
      margin_pct:         (_, p) => {
        const c = parseFloat(p?.cost_price) || 0
        const s = parseFloat(p?.sell_price) || 0
        return s > 0 ? +(((s - c) / s) * 100).toFixed(2) : 0
      },
      promo:              (_, p) => p?.is_promotion ? 'Po' : '',
      promo_pct:          (_, p) => p?.is_promotion ? (p?.promo_discount_pct || 0) : '',
    }
    const active = SALES_EXPORT_FIELDS.filter(f => selectedKeys.includes(f.key))
    if (active.length === 0) return
    const out = rows.map(r => {
      const p = productMap.get(r.product_id)
      return Object.fromEntries(active.map(f => [f.label, getters[f.key](r, p)]))
    })

    // Rreshtat NËN-TOTAL / TOTAL — ndërtohen në mënyrë gjenerike për fushat
    // aktive. Vendos emrin te 'name' nëse është aktiv; përndryshe te fusha e
    // parë tekstuale që ekziston.
    const makeTotalRow = (labelText, totalData) => {
      const row = Object.fromEntries(active.map(f => {
        const v = totalData?.[f.key]
        return [f.label, (v === undefined || v === null) ? '' : v]
      }))
      // Shkruaj etiketën te një kolonë e dukshme
      const labelKey = active.find(f => f.key === 'name') || active.find(f => f.key === 'barcode') || active[0]
      if (labelKey) row[labelKey.label] = labelText
      return row
    }
    if (totalsByMaterial?.flori?.qty > 0) {
      out.push(makeTotalRow('NËN-TOTAL FLORI', {
        material: 'Flori', qty: totalsByMaterial.flori.qty,
        has: totalsByMaterial.flori.has,
        discount_lek: totalsByMaterial.flori.discount_lek,
        value_no_vat_lek: totalsByMaterial.flori.value_no_vat_lek,
        vat_lek: totalsByMaterial.flori.vat_lek,
        value_with_vat_lek: totalsByMaterial.flori.value_with_vat_lek,
      }))
    }
    if (totalsByMaterial?.diamant?.qty > 0) {
      out.push(makeTotalRow('NËN-TOTAL DIAMANT', {
        material: 'Diamant', qty: totalsByMaterial.diamant.qty,
        has: totalsByMaterial.diamant.has,
        discount_lek: totalsByMaterial.diamant.discount_lek,
        value_no_vat_lek: totalsByMaterial.diamant.value_no_vat_lek,
        vat_lek: totalsByMaterial.diamant.vat_lek,
        value_with_vat_lek: totalsByMaterial.diamant.value_with_vat_lek,
      }))
    }
    if (totals) {
      out.push(makeTotalRow('TOTALI në LEK (kombinuar)', {
        qty: totals.qty,
        has: totals.has,
        discount_lek: totals.discount_lek,
        value_no_vat_lek: totals.value_no_vat_lek,
        vat_lek: totals.vat_lek,
        value_with_vat_lek: totals.value_with_vat_lek,
      }))
    }
    if (totalsByCurrency) {
      for (const cur of Object.keys(totalsByCurrency).sort()) {
        const t = totalsByCurrency[cur]
        out.push(makeTotalRow(`TOTAL (${cur})`, {
          qty: t.qty,
          has: t.has,
          discount_lek: t.discount,
          value_no_vat_lek: t.value_no_vat,
          vat_lek: t.vat,
          value_with_vat_lek: t.value_with_vat,
        }))
      }
    }
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.json_to_sheet(out)
    ws['!cols'] = active.map(f => ({ wch: FIELD_WIDTHS[f.key] || 14 }))
    XLSX.utils.book_append_sheet(wb, ws, 'Raport Shitje Artikuj')
    XLSX.writeFile(wb, `raport_shitje_artikuj_${from}_${to}.xlsx`)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">Raport Shitje — Artikuj</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Burimi: Fatura Shitje · Kolonat për çdo artikull janë në LEK (të konvertuara me kursin e çdo fature) · Totalet finale sipas monedhës origjinale
          </p>
        </div>
        <button onClick={() => setShowExport(true)} disabled={!rows.length} className="btn-secondary flex-shrink-0 disabled:opacity-40">
          ⬇️ Export
        </button>
      </div>

      {showExport && (
        <ExportFieldsModal
          title="Export Raport Shitje — Artikuj"
          subtitle={`${rows.length} artikuj · zgjidh cilat fusha të përfshihen`}
          fields={SALES_EXPORT_FIELDS}
          defaultKeys={SALES_DEFAULT_KEYS}
          lsKey={SALES_EXPORT_LS_KEY}
          onClose={() => setShowExport(false)}
          onExport={async (keys) => { await runExport(keys); setShowExport(false) }}
        />
      )}

      <DateRangeFilter
        from={from}
        to={to}
        onChange={({ from: f, to: t }) => { setFrom(f); setTo(t) }}
        loading={loading}
        hint="Ndikon: rreshtat, totalet dhe eksporti"
      />

      <div className="card">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <ProductFilterPicker value={filter} onChange={setFilter} />
          <div>
            <label className="form-label">Materiali</label>
            <select value={material} onChange={e => setMaterial(e.target.value)} className="input-field">
              <option value="">Të gjitha</option>
              <option value="flori">🟡 Flori</option>
              <option value="diamant">💎 Diamant</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={load} className="btn-secondary flex-1" title="Rifresko manualisht — filtrat aplikohen automatikisht">
              🔄 Rifresko
            </button>
            <button
              onClick={() => { setFilter(''); setMaterial(''); setFrom(ALL_TIME_FROM); setTo(getToday()) }}
              className="btn-secondary"
              title="Pastro filtrat"
            >✕</button>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
          <button
            type="button"
            onClick={() => setViewMode('aggregated')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              viewMode === 'aggregated' ? 'bg-white dark:bg-slate-800 shadow-sm text-slate-800 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
            title="Grupuar sipas produktit (një rresht për artikull)"
          >📦 Përmbledhur (sipas artikullit)</button>
          <button
            type="button"
            onClick={() => setViewMode('detailed')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              viewMode === 'detailed' ? 'bg-white dark:bg-slate-800 shadow-sm text-slate-800 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
            title="Një rresht për çdo shitje (çdo faturë e ndarë)"
          >🧾 I Detajuar (fatura të veçanta)</button>
        </div>
        {viewMode === 'detailed' && searched && (() => {
          const nMkt = rowsDetailed.filter(r => r.source === 'marketing').length
          const nSale = rowsDetailed.length - nMkt
          return (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {nSale} shitje{nMkt > 0 ? ` · ${nMkt} marketing` : ''}
            </p>
          )
        })()}
      </div>

      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-400 dark:text-slate-500 text-sm">Duke ngarkuar...</div>
        ) : !searched ? (
          <div className="p-8 text-center text-slate-400 dark:text-slate-500 text-sm">Vendos filtrat dhe kliko Kërko.</div>
        ) : viewMode === 'detailed' ? (
          rowsDetailed.length === 0 ? (
            <div className="p-10 text-center">
              <div className="text-5xl mb-3">🧾</div>
              <p className="text-slate-500 dark:text-slate-400">Nuk u gjetën shitje ose marketing në këtë periudhë.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Data</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Lloji</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Nr. Fature</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Klienti</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Barkodi</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Artikulli</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Materiali</th>
                    <th className="px-3 py-2 text-center text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Mon.</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Sasia</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">Gram</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300">Has</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Çm. Shitje</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Zbritje %</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Vlera pa TVSH</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">TVSH</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Vlera me TVSH</th>
                    <th className="px-3 py-2 text-center text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Hap</th>
                  </tr>
                </thead>
                <tbody>
                  {rowsDetailed.map((r, idx) => {
                    const isMarketing = r.source === 'marketing'
                    return (
                      <tr key={`${r.item_id}-${idx}`}
                          className={`border-b border-slate-100 dark:border-slate-800 ${
                            isMarketing ? 'bg-purple-50/40 hover:bg-purple-50 dark:bg-purple-900/10'
                            : r.is_credit_note ? 'bg-red-50/40 hover:bg-red-50'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                          }`}>
                        <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-300 whitespace-nowrap">{r.date}</td>
                        <td className="px-3 py-2 text-xs">
                          {isMarketing
                            ? <span className="px-1.5 py-0.5 rounded-md bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-200 font-semibold text-[10px]">📣 Marketing</span>
                            : <span className="px-1.5 py-0.5 rounded-md bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200 font-semibold text-[10px]">💰 Shitje</span>}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">
                          {isMarketing ? (
                            <button
                              onClick={() => onNavigate?.('marketing', { date: r.date, openContractId: r.contract_id || null })}
                              className="text-purple-600 hover:text-purple-800 hover:underline font-semibold"
                              title={r.contract_id ? 'Hap kontratën e marketingut' : 'Hap Fletën e Marketingut për këtë datë'}
                            >{r.invoice_no}</button>
                          ) : (
                            <button
                              onClick={() => onNavigate?.('fatura-shitje', { date: r.date, invoiceId: r.invoice_id })}
                              className="text-blue-600 hover:text-blue-800 hover:underline font-semibold"
                              title="Hap faturën"
                            >{r.invoice_no}</button>
                          )}
                          {r.is_credit_note && <span className="ml-1 badge bg-red-100 text-red-700 dark:text-red-300 text-[9px]">KREDIT</span>}
                        </td>
                        <td className="px-3 py-2 text-slate-800 dark:text-slate-100 text-xs">
                          {r.customer_name || <span className="italic text-slate-400 dark:text-slate-500">—</span>}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-600 dark:text-slate-300">{r.barcode || '—'}</td>
                        <td className="px-3 py-2 text-slate-800 dark:text-slate-100">{r.name || <span className="italic text-slate-400 dark:text-slate-500">—</span>}</td>
                        <td className="px-3 py-2 text-xs">
                          {r.material === 'flori'
                            ? <span className="px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-800 dark:text-amber-200 font-medium">🟡</span>
                            : r.material === 'diamant'
                            ? <span className="px-1.5 py-0.5 rounded-md bg-blue-100 text-blue-800 dark:text-blue-200 font-medium">💎</span>
                            : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className="badge bg-blue-100 text-blue-700 dark:text-blue-300 text-[10px]">{r.currency}</span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-800 dark:text-slate-100">
                          {fmtQty(r.qty)} <span className="text-[10px] text-slate-400 dark:text-slate-500">{r.unit}</span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums bg-amber-50/40 dark:bg-amber-900/10 text-amber-800 dark:text-amber-200 font-semibold">
                          {r.gram > 0 ? `${r.gram.toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}gr` : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums bg-yellow-50/40 dark:bg-yellow-900/10 text-yellow-800 dark:text-yellow-200 font-semibold">
                          {r.has > 0 ? r.has.toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">
                          {fmt(r.unit_price)}
                        </td>
                        <td className={`px-3 py-2 text-right tabular-nums ${r.discount_percent > 0 ? 'text-orange-600' : 'text-slate-400 dark:text-slate-500'}`}>
                          {r.discount_percent > 0 ? `${r.discount_percent}%` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">
                          {fmt(r.value_no_vat)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-500 dark:text-slate-400">
                          {fmt(r.vat)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-bold text-blue-700 dark:text-blue-300">
                          {fmt(r.value_with_vat)}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {isMarketing ? (
                            <button
                              onClick={() => onNavigate?.('marketing', { date: r.date, openContractId: r.contract_id || null })}
                              className="px-2 py-0.5 rounded-md text-xs font-semibold text-purple-600 hover:bg-purple-50"
                              title={r.contract_id ? 'Hap kontratën e marketingut' : 'Hap Fletën e Marketingut'}
                            >📣</button>
                          ) : (
                            <button
                              onClick={() => onNavigate?.('fatura-shitje', { date: r.date, invoiceId: r.invoice_id })}
                              className="px-2 py-0.5 rounded-md text-xs font-semibold text-blue-600 hover:bg-blue-50"
                              title="Hap faturën"
                            >📄</button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                {totalsByCurrency && Object.keys(totalsByCurrency).length > 0 && (
                  <tfoot className="bg-emerald-50 dark:bg-emerald-900/30 border-t-2 border-emerald-300">
                    {Object.keys(totalsByCurrency).sort().map((cur, idx) => {
                      const t = totalsByCurrency[cur]
                      return (
                        <tr key={cur} className={`font-bold text-xs ${idx > 0 ? 'border-t border-emerald-200' : ''}`}>
                          <td colSpan={8} className="px-3 py-2 text-right text-emerald-700 dark:text-emerald-300 uppercase tracking-wide">💵 TOTAL SHITJE ({cur}):</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-900 dark:text-white">{fmtQty(t.qty)}</td>
                          <td className="px-3 py-2 text-right tabular-nums bg-amber-50/40 dark:bg-amber-900/10 text-amber-800 dark:text-amber-200">
                            {t.gram > 0 ? `${t.gram.toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}gr` : '—'}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums bg-yellow-50/40 dark:bg-yellow-900/10 text-yellow-800 dark:text-yellow-200 font-semibold">
                            {t.has > 0 ? t.has.toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                          </td>
                          <td></td>
                          <td className="px-3 py-2 text-right tabular-nums text-orange-700 dark:text-orange-300">
                            {t.discount > 0.005 ? `-${fmt(t.discount)}` : '—'}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-900 dark:text-white">{fmt(t.value_no_vat)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">{fmt(t.vat)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-emerald-800 dark:text-emerald-200 text-sm">{fmt(t.value_with_vat)}</td>
                          <td></td>
                        </tr>
                      )
                    })}
                  </tfoot>
                )}
              </table>
            </div>
          )
        ) : rows.length === 0 ? (
          <div className="p-10 text-center">
            <div className="text-5xl mb-3">📊</div>
            <p className="text-slate-500 dark:text-slate-400">Nuk u gjetën artikuj të shitur ose të dhënë marketing në këtë periudhë.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Lloji</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Barkodi</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Artikulli</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Kategoria</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Materiali</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Sasia</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300">Has</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Çm. Shitje</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Zbritje</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Vlera pa TVSH</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">TVSH</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Vlera me TVSH</th>
                  <th className="px-3 py-2 text-center text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Fatura</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => {
                  const isMarketing = r.source === 'marketing'
                  return (
                  <tr key={`${r.source || 'sale'}-${r.product_id}-${r.barcode}-${idx}`} className={`border-b border-slate-100 dark:border-slate-800 ${isMarketing ? 'bg-purple-50/40 hover:bg-purple-50 dark:bg-purple-900/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}>
                    <td className="px-3 py-2 text-xs">
                      {isMarketing
                        ? <span className="px-1.5 py-0.5 rounded-md bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-200 font-semibold text-[10px]">📣 Marketing</span>
                        : <span className="px-1.5 py-0.5 rounded-md bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200 font-semibold text-[10px]">💰 Shitje</span>}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-600 dark:text-slate-300">{r.barcode || '—'}</td>
                    <td className="px-3 py-2 text-slate-800 dark:text-slate-100">{r.name || <span className="italic text-slate-400 dark:text-slate-500">— pa emër —</span>}</td>
                    <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{r.category || '—'}</td>
                    <td className="px-3 py-2 text-xs">
                      {r.material === 'flori'
                        ? <span className="px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-800 dark:text-amber-200 font-medium">🟡 Flori</span>
                        : r.material === 'diamant'
                        ? <span className="px-1.5 py-0.5 rounded-md bg-blue-100 text-blue-800 dark:text-blue-200 font-medium">💎 Diamant</span>
                        : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-800 dark:text-slate-100">
                      {fmtQty(r.qty)} <span className="text-[10px] text-slate-400 dark:text-slate-500">{r.unit}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums bg-yellow-50/40 dark:bg-yellow-900/10 text-yellow-800 dark:text-yellow-200 font-semibold">
                      {r.has > 0 ? r.has.toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">{fmt(r.unit_price_lek)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${r.discount_lek > 0.005 ? 'text-orange-600' : 'text-slate-400 dark:text-slate-500'}`}>
                      {r.discount_lek > 0.005 ? `-${fmt(r.discount_lek)}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">{fmt(r.value_no_vat_lek)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500 dark:text-slate-400">{fmt(r.vat_lek)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums font-bold ${isMarketing ? 'text-purple-700 dark:text-purple-300' : 'text-blue-700 dark:text-blue-300'}`}>{fmt(r.value_with_vat_lek)}</td>
                    <td className="px-3 py-2 text-center">
                      {isMarketing ? (
                        <button
                          type="button"
                          onClick={() => onNavigate?.('marketing')}
                          className="px-2 py-0.5 rounded-md text-xs font-semibold text-purple-600 hover:bg-purple-50"
                          title="Hap Fletën e Marketingut"
                        >{r.docs_count}<span className="ml-1 text-[10px]">📣</span></button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setDocsRow(r)}
                          disabled={!r.docs_count}
                          className="px-2 py-0.5 rounded-md text-xs font-semibold text-blue-600 hover:bg-blue-50 disabled:text-slate-400 disabled:hover:bg-transparent"
                          title={r.docs_count ? 'Shih faturat e këtij artikulli' : ''}
                        >{r.docs_count}{r.docs_count > 0 && <span className="ml-1 text-[10px]">📄</span>}</button>
                      )}
                    </td>
                  </tr>
                  )
                })}
              </tbody>
              {totals && (
                <tfoot className="bg-blue-50 dark:bg-blue-900/30 border-t-2 border-blue-200">
                  {totalsByMaterial?.flori?.qty > 0 && (
                    <tr className="text-xs bg-amber-50 dark:bg-amber-900/30 border-b border-amber-100">
                      <td colSpan={5} className="px-3 py-1.5 text-right text-amber-800 dark:text-amber-200 font-semibold">🟡 Flori:</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-amber-900">{fmtQty(totalsByMaterial.flori.qty)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums bg-yellow-50/60 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-200 font-semibold">
                        {(totalsByMaterial.flori.has || 0) > 0.0005 ? totalsByMaterial.flori.has.toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                      </td>
                      <td></td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-amber-800 dark:text-amber-200">
                        {totalsByMaterial.flori.discount_lek > 0.005 ? `-${fmt(totalsByMaterial.flori.discount_lek)}` : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-amber-900">{fmt(totalsByMaterial.flori.value_no_vat_lek)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-amber-700 dark:text-amber-300">{fmt(totalsByMaterial.flori.vat_lek)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-amber-900 font-semibold">{fmt(totalsByMaterial.flori.value_with_vat_lek)}</td>
                      <td></td>
                    </tr>
                  )}
                  {totalsByMaterial?.diamant?.qty > 0 && (
                    <tr className="text-xs bg-sky-50 border-b border-sky-100">
                      <td colSpan={5} className="px-3 py-1.5 text-right text-sky-800 font-semibold">💎 Diamant:</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-sky-900">{fmtQty(totalsByMaterial.diamant.qty)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums bg-yellow-50/60 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-200 font-semibold">
                        {(totalsByMaterial.diamant.has || 0) > 0.0005 ? totalsByMaterial.diamant.has.toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                      </td>
                      <td></td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-sky-800">
                        {totalsByMaterial.diamant.discount_lek > 0.005 ? `-${fmt(totalsByMaterial.diamant.discount_lek)}` : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-sky-900">{fmt(totalsByMaterial.diamant.value_no_vat_lek)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-sky-700">{fmt(totalsByMaterial.diamant.vat_lek)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-sky-900 font-semibold">{fmt(totalsByMaterial.diamant.value_with_vat_lek)}</td>
                      <td></td>
                    </tr>
                  )}
                  {totalsByMaterial?.tjeter?.qty > 0 && (
                    <tr className="text-xs bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                      <td colSpan={5} className="px-3 py-1.5 text-right text-slate-600 dark:text-slate-300 font-semibold">— Pa material:</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-700 dark:text-slate-200">{fmtQty(totalsByMaterial.tjeter.qty)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums bg-yellow-50/60 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-200 font-semibold">
                        {(totalsByMaterial.tjeter.has || 0) > 0.0005 ? totalsByMaterial.tjeter.has.toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                      </td>
                      <td></td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-600 dark:text-slate-300">
                        {totalsByMaterial.tjeter.discount_lek > 0.005 ? `-${fmt(totalsByMaterial.tjeter.discount_lek)}` : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-700 dark:text-slate-200">{fmt(totalsByMaterial.tjeter.value_no_vat_lek)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-500 dark:text-slate-400">{fmt(totalsByMaterial.tjeter.vat_lek)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-700 dark:text-slate-200">{fmt(totalsByMaterial.tjeter.value_with_vat_lek)}</td>
                      <td></td>
                    </tr>
                  )}
                  <tr className="font-bold text-xs bg-slate-100 dark:bg-slate-800 border-t border-slate-300 dark:border-slate-700">
                    <td colSpan={5} className="px-3 py-2 text-right text-slate-500 dark:text-slate-400 uppercase tracking-wide">TOTALI SHITJE në LEK (kombinuar):</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">{fmtQty(totals.qty)}</td>
                    <td className="px-3 py-2 text-right tabular-nums bg-yellow-50/60 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-200">
                      {(totals.has || 0) > 0.0005 ? totals.has.toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                    </td>
                    <td></td>
                    <td className="px-3 py-2 text-right tabular-nums text-orange-600">
                      {totals.discount_lek > 0.005 ? `-${fmt(totals.discount_lek)}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">{fmt(totals.value_no_vat_lek)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{fmt(totals.vat_lek)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">{fmt(totals.value_with_vat_lek)}</td>
                    <td></td>
                  </tr>
                  {totalsByCurrency && Object.keys(totalsByCurrency).sort().map((cur, idx, arr) => {
                    const t = totalsByCurrency[cur]
                    return (
                      <tr key={cur} className={`font-bold text-xs bg-emerald-50 dark:bg-emerald-900/30 ${idx === 0 ? 'border-t-2 border-emerald-300' : 'border-t border-emerald-200'}`}>
                        <td colSpan={5} className="px-3 py-2 text-right text-emerald-700 dark:text-emerald-300 uppercase tracking-wide">💵 TOTAL SHITJE ({cur}):</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-900 dark:text-white">{fmtQty(t.qty)}</td>
                        <td className="px-3 py-2 text-right tabular-nums bg-yellow-50/60 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-200">
                          {(t.has || 0) > 0.0005 ? t.has.toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                        </td>
                        <td></td>
                        <td className="px-3 py-2 text-right tabular-nums text-orange-700 dark:text-orange-300">
                          {t.discount > 0.005 ? `-${fmt(t.discount)}` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-900 dark:text-white">{fmt(t.value_no_vat)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">{fmt(t.vat)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-emerald-800 dark:text-emerald-200 text-sm">{fmt(t.value_with_vat)}</td>
                        <td></td>
                      </tr>
                    )
                  })}
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>

      {docsRow && (
        <DocsModal
          row={docsRow}
          from={from}
          to={to}
          onClose={() => setDocsRow(null)}
          onNavigate={onNavigate}
        />
      )}
    </div>
  )
}
