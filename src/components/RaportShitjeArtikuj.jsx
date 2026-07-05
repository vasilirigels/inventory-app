import { useState, useEffect, useRef, useCallback } from 'react'
import * as XLSX from 'xlsx'

function n(v) { return parseFloat(v) || 0 }
function fmt(v) {
  const x = n(v)
  if (x === 0) return '—'
  return x.toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
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
            className="px-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 text-xs" title="Pastro">✕</button>
        )}
      </div>
      {open && (results.length > 0 || loading) && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-64 overflow-y-auto">
          {loading && <div className="p-2 text-xs text-slate-400">Duke kërkuar...</div>}
          {results.map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => { onChange(p.barcode || p.name); setQuery(p.barcode || p.name); setOpen(false) }}
              className="w-full text-left px-3 py-1.5 hover:bg-blue-50 border-b border-slate-100 last:border-0"
            >
              <div className="text-xs font-medium text-slate-800 truncate">{p.name}</div>
              <div className="text-[10px] text-slate-500 font-mono">{p.barcode || p.sku || '—'}</div>
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
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="modal-header">
          <div>
            <h3 className="font-bold text-slate-800 text-lg">Faturat e Shitjes</h3>
            <p className="text-xs text-slate-500">
              Artikulli: <span className="font-medium">{row.name || '—'}</span>
              {row.barcode && <> · <span className="font-mono">{row.barcode}</span></>}
              <> · periudha {from} → {to}</>
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 text-xl">×</button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center text-slate-400 text-sm">Duke ngarkuar...</div>
          ) : docs.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-sm">S'ka fatura për këtë artikull në periudhë.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase">Data</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase">Nr. Fature</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase">Klienti</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase">Sasia</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase">Çm. Shitje (LEK)</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase">Pa TVSH (LEK)</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase">Me TVSH (LEK)</th>
                  <th className="px-3 py-2 text-center text-xs font-semibold text-slate-500 uppercase">Veprime</th>
                </tr>
              </thead>
              <tbody>
                {docs.map(d => (
                  <tr key={d.invoice_id} className="border-b border-slate-100 hover:bg-blue-50 cursor-pointer"
                      onClick={() => openInvoice(d)}>
                    <td className="px-3 py-2 text-xs text-slate-600">{d.date}</td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-700">{d.invoice_no}</td>
                    <td className="px-3 py-2 text-slate-800">{d.customer_name || <span className="italic text-slate-400">— pa klient —</span>}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmtQty(d.qty)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">{fmt(d.unit_price_lek)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(d.value_no_vat_lek)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-bold text-blue-700">{fmt(d.value_with_vat_lek)}</td>
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={e => { e.stopPropagation(); openInvoice(d) }}
                        className="px-2 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 text-[11px] font-medium"
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
  const [viewMode, setViewMode] = useState('detailed')  // 'aggregated' | 'detailed'

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
  // Kur ndryshohet mënyra e shikimit, rikthej të dhënat automatikisht
  // nëse përdoruesi ka bërë tashmë një kërkim.
  useEffect(() => {
    if (searched) load()
    // eslint-disable-next-line
  }, [viewMode])

  const exportXlsx = () => {
    const matLabel = (m) => m === 'flori' ? 'Flori' : m === 'diamant' ? 'Diamant' : ''
    const out = rows.map(r => ({
      Barkodi: r.barcode || '',
      SKU: r.sku || '',
      Artikulli: r.name || '',
      Kategoria: r.category || '',
      Materiali: matLabel(r.material),
      'Sasia': r.qty,
      'Çm. Shitje (LEK)': r.unit_price_lek,
      'Zbritje (LEK)': r.discount_lek,
      'Vlera pa TVSH (LEK)': r.value_no_vat_lek,
      'TVSH (LEK)': r.vat_lek,
      'Vlera me TVSH (LEK)': r.value_with_vat_lek,
      'Nr. Faturash': r.docs_count,
    }))
    if (totalsByMaterial?.flori?.qty > 0) {
      out.push({
        Barkodi: '', SKU: '', Artikulli: 'NËN-TOTAL FLORI', Kategoria: '', Materiali: 'Flori',
        'Sasia': totalsByMaterial.flori.qty,
        'Çm. Shitje (LEK)': '',
        'Zbritje (LEK)': totalsByMaterial.flori.discount_lek,
        'Vlera pa TVSH (LEK)': totalsByMaterial.flori.value_no_vat_lek,
        'TVSH (LEK)': totalsByMaterial.flori.vat_lek,
        'Vlera me TVSH (LEK)': totalsByMaterial.flori.value_with_vat_lek,
        'Nr. Faturash': '',
      })
    }
    if (totalsByMaterial?.diamant?.qty > 0) {
      out.push({
        Barkodi: '', SKU: '', Artikulli: 'NËN-TOTAL DIAMANT', Kategoria: '', Materiali: 'Diamant',
        'Sasia': totalsByMaterial.diamant.qty,
        'Çm. Shitje (LEK)': '',
        'Zbritje (LEK)': totalsByMaterial.diamant.discount_lek,
        'Vlera pa TVSH (LEK)': totalsByMaterial.diamant.value_no_vat_lek,
        'TVSH (LEK)': totalsByMaterial.diamant.vat_lek,
        'Vlera me TVSH (LEK)': totalsByMaterial.diamant.value_with_vat_lek,
        'Nr. Faturash': '',
      })
    }
    if (totals) {
      out.push({
        Barkodi: '', SKU: '', Artikulli: 'TOTALI në LEK (kombinuar)', Kategoria: '', Materiali: '',
        'Sasia': totals.qty,
        'Çm. Shitje (LEK)': '',
        'Zbritje (LEK)': totals.discount_lek,
        'Vlera pa TVSH (LEK)': totals.value_no_vat_lek,
        'TVSH (LEK)': totals.vat_lek,
        'Vlera me TVSH (LEK)': totals.value_with_vat_lek,
        'Nr. Faturash': '',
      })
    }
    if (totalsByCurrency) {
      for (const cur of Object.keys(totalsByCurrency).sort()) {
        const t = totalsByCurrency[cur]
        out.push({
          Barkodi: '', SKU: '', Artikulli: `TOTAL (${cur})`, Kategoria: '', Materiali: '',
          'Sasia': t.qty,
          'Çm. Shitje (LEK)': '',
          'Zbritje (LEK)': t.discount,
          'Vlera pa TVSH (LEK)': t.value_no_vat,
          'TVSH (LEK)': t.vat,
          'Vlera me TVSH (LEK)': t.value_with_vat,
          'Nr. Faturash': '',
        })
      }
    }
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.json_to_sheet(out)
    ws['!cols'] = [14, 12, 32, 14, 10, 10, 14, 14, 16, 14, 16, 10].map(w => ({ wch: w }))
    XLSX.utils.book_append_sheet(wb, ws, 'Raport Shitje Artikuj')
    XLSX.writeFile(wb, `raport_shitje_artikuj_${from}_${to}.xlsx`)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Raport Shitje — Artikuj</h2>
          <p className="text-xs text-slate-500">
            Burimi: Fatura Shitje · Kolonat për çdo artikull janë në LEK (të konvertuara me kursin e çdo fature) · Totalet finale sipas monedhës origjinale
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
            <button onClick={load} className="btn-primary flex-1">🔎 Kërko</button>
            <button
              onClick={() => { setFilter(''); setMaterial(''); setFrom(ALL_TIME_FROM); setTo(getToday()) }}
              className="btn-secondary"
              title="Pastro filtrat"
            >✕</button>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
          <button
            type="button"
            onClick={() => setViewMode('aggregated')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              viewMode === 'aggregated' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'
            }`}
            title="Grupuar sipas produktit (një rresht për artikull)"
          >📦 Përmbledhur (sipas artikullit)</button>
          <button
            type="button"
            onClick={() => setViewMode('detailed')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              viewMode === 'detailed' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'
            }`}
            title="Një rresht për çdo shitje (çdo faturë e ndarë)"
          >🧾 I Detajuar (fatura të veçanta)</button>
        </div>
        {viewMode === 'detailed' && searched && (
          <p className="text-[11px] text-slate-500">
            {rowsDetailed.length} rreshta shitjeje
          </p>
        )}
      </div>

      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-400 text-sm">Duke ngarkuar...</div>
        ) : !searched ? (
          <div className="p-8 text-center text-slate-400 text-sm">Vendos filtrat dhe kliko Kërko.</div>
        ) : viewMode === 'detailed' ? (
          rowsDetailed.length === 0 ? (
            <div className="p-10 text-center">
              <div className="text-5xl mb-3">🧾</div>
              <p className="text-slate-500">Nuk u gjetën shitje në këtë periudhë.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase">Data</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase">Nr. Fature</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase">Klienti</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase">Barkodi</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase">Artikulli</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase">Materiali</th>
                    <th className="px-3 py-2 text-center text-xs font-semibold text-slate-500 uppercase">Mon.</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase">Sasia</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase">Çm. Shitje</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase">Zbritje %</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase">Vlera pa TVSH</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase">TVSH</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase">Vlera me TVSH</th>
                    <th className="px-3 py-2 text-center text-xs font-semibold text-slate-500 uppercase">Hap</th>
                  </tr>
                </thead>
                <tbody>
                  {rowsDetailed.map((r, idx) => {
                    const isForeign = (r.currency || 'LEK') !== 'LEK'
                    return (
                      <tr key={`${r.item_id}-${idx}`}
                          className={`border-b border-slate-100 ${r.is_credit_note ? 'bg-red-50/40 hover:bg-red-50' : 'hover:bg-slate-50'}`}>
                        <td className="px-3 py-2 text-xs text-slate-600 whitespace-nowrap">{r.date}</td>
                        <td className="px-3 py-2 font-mono text-xs">
                          <button
                            onClick={() => onNavigate?.('fatura-shitje', { date: r.date, invoiceId: r.invoice_id })}
                            className="text-blue-600 hover:text-blue-800 hover:underline font-semibold"
                            title="Hap faturën"
                          >{r.invoice_no}</button>
                          {r.is_credit_note && <span className="ml-1 badge bg-red-100 text-red-700 text-[9px]">KREDIT</span>}
                        </td>
                        <td className="px-3 py-2 text-slate-800 text-xs">
                          {r.customer_name || <span className="italic text-slate-400">—</span>}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-600">{r.barcode || '—'}</td>
                        <td className="px-3 py-2 text-slate-800">{r.name || <span className="italic text-slate-400">—</span>}</td>
                        <td className="px-3 py-2 text-xs">
                          {r.material === 'flori'
                            ? <span className="px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-800 font-medium">🟡</span>
                            : r.material === 'diamant'
                            ? <span className="px-1.5 py-0.5 rounded-md bg-blue-100 text-blue-800 font-medium">💎</span>
                            : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className="badge bg-blue-100 text-blue-700 text-[10px]">{r.currency}</span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-800">
                          {fmtQty(r.qty)} <span className="text-[10px] text-slate-400">{r.unit}</span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                          {fmt(r.unit_price)}
                          {isForeign && <div className="text-[10px] font-normal text-slate-500 italic">= {fmt(r.unit_price_lek)} LEK</div>}
                        </td>
                        <td className={`px-3 py-2 text-right tabular-nums ${r.discount_percent > 0 ? 'text-orange-600' : 'text-slate-400'}`}>
                          {r.discount_percent > 0 ? `${r.discount_percent}%` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                          {fmt(r.value_no_vat)}
                          {isForeign && <div className="text-[10px] font-normal text-slate-500 italic">= {fmt(r.value_no_vat_lek)} LEK</div>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                          {fmt(r.vat)}
                          {isForeign && r.vat > 0.005 && <div className="text-[10px] font-normal text-slate-500 italic">= {fmt(r.vat_lek)} LEK</div>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-bold text-blue-700">
                          {fmt(r.value_with_vat)}
                          {isForeign && <div className="text-[10px] font-normal text-blue-600/70 italic">= {fmt(r.value_with_vat_lek)} LEK</div>}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <button
                            onClick={() => onNavigate?.('fatura-shitje', { date: r.date, invoiceId: r.invoice_id })}
                            className="px-2 py-0.5 rounded-md text-xs font-semibold text-blue-600 hover:bg-blue-50"
                            title="Hap faturën"
                          >📄</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                {totalsByCurrency && Object.keys(totalsByCurrency).length > 0 && (
                  <tfoot className="bg-emerald-50 border-t-2 border-emerald-300">
                    {Object.keys(totalsByCurrency).sort().map((cur, idx) => {
                      const t = totalsByCurrency[cur]
                      return (
                        <tr key={cur} className={`font-bold text-xs ${idx > 0 ? 'border-t border-emerald-200' : ''}`}>
                          <td colSpan={7} className="px-3 py-2 text-right text-emerald-700 uppercase tracking-wide">💵 TOTAL ({cur}):</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-900">{fmtQty(t.qty)}</td>
                          <td></td>
                          <td className="px-3 py-2 text-right tabular-nums text-orange-700">
                            {t.discount > 0.005 ? `-${fmt(t.discount)}` : '—'}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-900">{fmt(t.value_no_vat)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-700">{fmt(t.vat)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-emerald-800 text-sm">{fmt(t.value_with_vat)}</td>
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
            <p className="text-slate-500">Nuk u gjetën artikuj të shitur në këtë periudhë.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase">Barkodi</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase">Artikulli</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase">Kategoria</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase">Materiali</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase">Sasia</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase">Çm. Shitje</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase">Zbritje</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase">Vlera pa TVSH</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase">TVSH</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase">Vlera me TVSH</th>
                  <th className="px-3 py-2 text-center text-xs font-semibold text-slate-500 uppercase">Fatura</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => (
                  <tr key={`${r.product_id}-${r.barcode}-${idx}`} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono text-xs text-slate-600">{r.barcode || '—'}</td>
                    <td className="px-3 py-2 text-slate-800">{r.name || <span className="italic text-slate-400">— pa emër —</span>}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{r.category || '—'}</td>
                    <td className="px-3 py-2 text-xs">
                      {r.material === 'flori'
                        ? <span className="px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-800 font-medium">🟡 Flori</span>
                        : r.material === 'diamant'
                        ? <span className="px-1.5 py-0.5 rounded-md bg-blue-100 text-blue-800 font-medium">💎 Diamant</span>
                        : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-800">
                      {fmtQty(r.qty)} <span className="text-[10px] text-slate-400">{r.unit}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">{fmt(r.unit_price_lek)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${r.discount_lek > 0.005 ? 'text-orange-600' : 'text-slate-400'}`}>
                      {r.discount_lek > 0.005 ? `-${fmt(r.discount_lek)}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">{fmt(r.value_no_vat_lek)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">{fmt(r.vat_lek)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-bold text-blue-700">{fmt(r.value_with_vat_lek)}</td>
                    <td className="px-3 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => setDocsRow(r)}
                        disabled={!r.docs_count}
                        className="px-2 py-0.5 rounded-md text-xs font-semibold text-blue-600 hover:bg-blue-50 disabled:text-slate-400 disabled:hover:bg-transparent"
                        title={r.docs_count ? 'Shih faturat e këtij artikulli' : ''}
                      >{r.docs_count}{r.docs_count > 0 && <span className="ml-1 text-[10px]">📄</span>}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
              {totals && (
                <tfoot className="bg-blue-50 border-t-2 border-blue-200">
                  {totalsByMaterial?.flori?.qty > 0 && (
                    <tr className="text-xs bg-amber-50 border-b border-amber-100">
                      <td colSpan={4} className="px-3 py-1.5 text-right text-amber-800 font-semibold">🟡 Flori:</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-amber-900">{fmtQty(totalsByMaterial.flori.qty)}</td>
                      <td></td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-amber-800">
                        {totalsByMaterial.flori.discount_lek > 0.005 ? `-${fmt(totalsByMaterial.flori.discount_lek)}` : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-amber-900">{fmt(totalsByMaterial.flori.value_no_vat_lek)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-amber-700">{fmt(totalsByMaterial.flori.vat_lek)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-amber-900 font-semibold">{fmt(totalsByMaterial.flori.value_with_vat_lek)}</td>
                      <td></td>
                    </tr>
                  )}
                  {totalsByMaterial?.diamant?.qty > 0 && (
                    <tr className="text-xs bg-sky-50 border-b border-sky-100">
                      <td colSpan={4} className="px-3 py-1.5 text-right text-sky-800 font-semibold">💎 Diamant:</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-sky-900">{fmtQty(totalsByMaterial.diamant.qty)}</td>
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
                    <tr className="text-xs bg-slate-100 border-b border-slate-200">
                      <td colSpan={4} className="px-3 py-1.5 text-right text-slate-600 font-semibold">— Pa material:</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">{fmtQty(totalsByMaterial.tjeter.qty)}</td>
                      <td></td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">
                        {totalsByMaterial.tjeter.discount_lek > 0.005 ? `-${fmt(totalsByMaterial.tjeter.discount_lek)}` : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">{fmt(totalsByMaterial.tjeter.value_no_vat_lek)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{fmt(totalsByMaterial.tjeter.vat_lek)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">{fmt(totalsByMaterial.tjeter.value_with_vat_lek)}</td>
                      <td></td>
                    </tr>
                  )}
                  <tr className="font-bold text-xs bg-slate-100 border-t border-slate-300">
                    <td colSpan={4} className="px-3 py-2 text-right text-slate-500 uppercase tracking-wide">TOTALI në LEK (kombinuar):</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">{fmtQty(totals.qty)}</td>
                    <td></td>
                    <td className="px-3 py-2 text-right tabular-nums text-orange-600">
                      {totals.discount_lek > 0.005 ? `-${fmt(totals.discount_lek)}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">{fmt(totals.value_no_vat_lek)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">{fmt(totals.vat_lek)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">{fmt(totals.value_with_vat_lek)}</td>
                    <td></td>
                  </tr>
                  {totalsByCurrency && Object.keys(totalsByCurrency).sort().map((cur, idx, arr) => {
                    const t = totalsByCurrency[cur]
                    return (
                      <tr key={cur} className={`font-bold text-xs bg-emerald-50 ${idx === 0 ? 'border-t-2 border-emerald-300' : 'border-t border-emerald-200'}`}>
                        <td colSpan={4} className="px-3 py-2 text-right text-emerald-700 uppercase tracking-wide">💵 TOTAL ({cur}):</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-900">{fmtQty(t.qty)}</td>
                        <td></td>
                        <td className="px-3 py-2 text-right tabular-nums text-orange-700">
                          {t.discount > 0.005 ? `-${fmt(t.discount)}` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-900">{fmt(t.value_no_vat)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-700">{fmt(t.vat)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-emerald-800 text-sm">{fmt(t.value_with_vat)}</td>
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
