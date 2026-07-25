import { useState, useEffect, useRef, useCallback } from 'react'
import { loadXLSX } from '../lib/xlsx.js'
import DateRangeFilter from './DateRangeFilter.jsx'

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
function getMonthStart() {
  const d = new Date()
  d.setDate(1)
  return d.toISOString().split('T')[0]
}

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
    fetch(`/api/reports/purchase-items/docs?${params}`)
      .then(r => r.json())
      .then(d => { setDocs(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => { setDocs([]); setLoading(false) })
  }, [row, from, to])

  if (!row) return null

  const openDoc = (d) => {
    if (d.source === 'purchase') {
      onNavigate?.('fatura-blerje', { date: d.date, invoiceId: d.doc_id })
    } else {
      onNavigate?.('magazina-hyrje', { date: d.date })
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="modal-header">
          <div>
            <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">Dokumentat e Blerjes</h3>
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
            <div className="p-8 text-center text-slate-500 dark:text-slate-400 text-sm">S'ka dokumente për këtë artikull në periudhë.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Burimi</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Data</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Nr.</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Furnitor / Magazinë</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Sasia</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Çm. Blerje (LEK)</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Pa TVSH (LEK)</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Me TVSH (LEK)</th>
                  <th className="px-3 py-2 text-center text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Veprime</th>
                </tr>
              </thead>
              <tbody>
                {docs.map(d => (
                  <tr key={`${d.source}-${d.doc_id}`} className="border-b border-slate-100 dark:border-slate-800 hover:bg-blue-50 cursor-pointer"
                      onClick={() => openDoc(d)}>
                    <td className="px-3 py-2">
                      {d.source === 'purchase'
                        ? <span className="badge bg-blue-100 text-blue-700 dark:text-blue-300 text-[10px]">🧾 Fatura</span>
                        : <span className="badge bg-amber-100 text-amber-700 dark:text-amber-300 text-[10px]">🏬 Magazina</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-300">{d.date}</td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-700 dark:text-slate-200">{d.doc_no}</td>
                    <td className="px-3 py-2 text-slate-800 dark:text-slate-100">{d.party_name || <span className="italic text-slate-400 dark:text-slate-500">— —</span>}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmtQty(d.qty)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">{fmt(d.unit_price_lek)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(d.value_no_vat_lek)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-bold text-blue-700 dark:text-blue-300">{fmt(d.value_with_vat_lek)}</td>
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={e => { e.stopPropagation(); openDoc(d) }}
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

export default function RaportBlerjeArtikuj({ onNavigate }) {
  const [from, setFrom]       = useState(getMonthStart())
  const [to, setTo]           = useState(getToday())
  const [filter, setFilter]   = useState('')
  const [category, setCategory] = useState('')
  const [rows, setRows]       = useState([])
  const [totals, setTotals]   = useState(null)
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [docsRow, setDocsRow] = useState(null)

  const load = useCallback(async () => {
    if (!from || !to) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ from, to })
      if (filter.trim()) params.set('q', filter.trim())
      if (category) params.set('category', category)
      const data = await fetch(`/api/reports/purchase-items?${params}`).then(r => r.json())
      setRows(Array.isArray(data?.rows) ? data.rows : [])
      setTotals(data?.totals || null)
      if (Array.isArray(data?.categories)) setCategories(data.categories)
      setSearched(true)
    } catch (e) {
      console.error(e)
      setRows([]); setTotals(null)
    } finally {
      setLoading(false)
    }
  }, [from, to, filter, category])

  useEffect(() => { load() }, []) // eslint-disable-line
  // Auto-load kur ndryshojnë filtrat "atomikë" (data, kategoria).
  useEffect(() => {
    if (searched) load()
    // eslint-disable-next-line
  }, [from, to, category])
  // Debounce për filtrin tekstual.
  useEffect(() => {
    if (!searched) return
    const t = setTimeout(() => { load() }, 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line
  }, [filter])

  const exportXlsx = async () => {
    const XLSX = await loadXLSX()
    const out = rows.map(r => ({
      Barkodi: r.barcode || '',
      SKU: r.sku || '',
      Artikulli: r.name || '',
      Kategoria: r.category || '',
      'Sasia': r.qty,
      'Çm. Blerje (LEK)': r.unit_price_lek,
      'Zbritje (LEK)': r.discount_lek,
      'Vlera pa TVSH (LEK)': r.value_no_vat_lek,
      'TVSH (LEK)': r.vat_lek,
      'Vlera me TVSH (LEK)': r.value_with_vat_lek,
      'Nr. Dokumentash': r.docs_count,
    }))
    if (totals) {
      out.push({
        Barkodi: '', SKU: '', Artikulli: 'TOTALI', Kategoria: '',
        'Sasia': totals.qty,
        'Çm. Blerje (LEK)': '',
        'Zbritje (LEK)': totals.discount_lek,
        'Vlera pa TVSH (LEK)': totals.value_no_vat_lek,
        'TVSH (LEK)': totals.vat_lek,
        'Vlera me TVSH (LEK)': totals.value_with_vat_lek,
        'Nr. Dokumentash': '',
      })
    }
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.json_to_sheet(out)
    ws['!cols'] = [14, 12, 32, 14, 10, 14, 14, 16, 14, 16, 12].map(w => ({ wch: w }))
    XLSX.utils.book_append_sheet(wb, ws, 'Raport Blerje Artikuj')
    XLSX.writeFile(wb, `raport_blerje_artikuj_${from}_${to}.xlsx`)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">Raport Blerje — Artikuj</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Burimet: Fatura Blerje + Magazina Hyrje · Të gjitha vlerat janë në LEK (Magazina Hyrje është pa TVSH)
          </p>
        </div>
        <button onClick={exportXlsx} disabled={!rows.length} className="btn-secondary disabled:opacity-40">
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
          <ProductFilterPicker value={filter} onChange={setFilter} />
          <div>
            <label className="form-label">Kategoria</label>
            <select value={category} onChange={e => setCategory(e.target.value)} className="input-field">
              <option value="">Të gjitha</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={load} className="btn-secondary flex-1" title="Rifresko manualisht — filtrat aplikohen automatikisht">
              🔄 Rifresko
            </button>
            <button
              onClick={() => { setFilter(''); setCategory(''); setFrom(getMonthStart()); setTo(getToday()) }}
              className="btn-secondary"
              title="Pastro filtrat"
            >✕</button>
          </div>
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-400 dark:text-slate-500 text-sm">Duke ngarkuar...</div>
        ) : !searched ? (
          <div className="p-8 text-center text-slate-400 dark:text-slate-500 text-sm">Vendos filtrat dhe kliko Kërko.</div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center">
            <div className="text-5xl mb-3">📦</div>
            <p className="text-slate-500 dark:text-slate-400">Nuk u gjetën artikuj të blerë në këtë periudhë.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Barkodi</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Artikulli</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Kategoria</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Sasia</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Çm. Blerje</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Zbritje</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Vlera pa TVSH</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">TVSH</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Vlera me TVSH</th>
                  <th className="px-3 py-2 text-center text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Dokumente</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => (
                  <tr key={`${r.product_id}-${r.barcode}-${idx}`} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="px-3 py-2 font-mono text-xs text-slate-600 dark:text-slate-300">{r.barcode || '—'}</td>
                    <td className="px-3 py-2 text-slate-800 dark:text-slate-100">{r.name || <span className="italic text-slate-400 dark:text-slate-500">— pa emër —</span>}</td>
                    <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{r.category || '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-800 dark:text-slate-100">
                      {fmtQty(r.qty)} <span className="text-[10px] text-slate-400 dark:text-slate-500">{r.unit}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">{fmt(r.unit_price_lek)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${r.discount_lek > 0.005 ? 'text-orange-600' : 'text-slate-400 dark:text-slate-500'}`}>
                      {r.discount_lek > 0.005 ? `-${fmt(r.discount_lek)}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">{fmt(r.value_no_vat_lek)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500 dark:text-slate-400">{fmt(r.vat_lek)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-bold text-blue-700 dark:text-blue-300">{fmt(r.value_with_vat_lek)}</td>
                    <td className="px-3 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => setDocsRow(r)}
                        disabled={!r.docs_count}
                        className="px-2 py-0.5 rounded-md text-xs font-semibold text-blue-600 hover:bg-blue-50 disabled:text-slate-400 disabled:hover:bg-transparent"
                        title={r.docs_count ? 'Shih dokumentat e këtij artikulli' : ''}
                      >{r.docs_count}{r.docs_count > 0 && <span className="ml-1 text-[10px]">📄</span>}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
              {totals && (
                <tfoot className="bg-blue-50 dark:bg-blue-900/30 border-t-2 border-blue-200">
                  <tr className="font-bold text-xs">
                    <td colSpan={3} className="px-3 py-2 text-right text-slate-700 dark:text-slate-200 uppercase tracking-wide">TOTALI (LEK):</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-900 dark:text-white">{fmtQty(totals.qty)}</td>
                    <td></td>
                    <td className="px-3 py-2 text-right tabular-nums text-orange-700 dark:text-orange-300">
                      {totals.discount_lek > 0.005 ? `-${fmt(totals.discount_lek)}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-900 dark:text-white">{fmt(totals.value_no_vat_lek)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">{fmt(totals.vat_lek)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-blue-800 dark:text-blue-200 text-sm">{fmt(totals.value_with_vat_lek)}</td>
                    <td></td>
                  </tr>
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
