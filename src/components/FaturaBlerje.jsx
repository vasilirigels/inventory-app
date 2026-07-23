import { useState, useEffect, useRef } from 'react'
import { generateBarcode, printLabels } from '../lib/barcode.js'
import MoneyInput from './MoneyInput.jsx'

const CURRENCIES = ['LEK', 'EUR', 'USD', 'GBP', 'CHF']

function n(v) { return parseFloat(v) || 0 }
function fmt(v) {
  return n(v).toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function emptyItem() {
  return {
    product_id: null, serial_no: '', barcode: '', name: '',
    category: '', unit: 'copë', gram: 0,
    qty: 1, purchase_price_no_vat: 0, cost_price: 0, discount_percent: 0,
    vat_rate: 20, sell_price: 0, material: '',
    is_promotion: false, promo_discount_pct: 0,
  }
}

// ── Excel column auto-detector ─────────────────────────────────────────────
// Detektim me prioritet + përjashtim: kolonat më specifike (p.sh. barkodi,
// "Cmimi PA TVSH") kërkohen para atyre gjenerike, dhe një kolonë e mapuar
// një herë nuk ripërdoret. Kjo zgjidh rastin kur një Excel ka "SHITJET"
// (flag me 1) por s'ka çmim shitjeje — nuk duhet të keqinterpretohet si
// `sell_price`.
function detectMapping(headers) {
  const norm = h => String(h ?? '')
    .toLowerCase()
    .replace(/[çÇ]/g, 'c')
    .replace(/[ëË]/g, 'e')
    .replace(/\s+/g, '_')
  const normalized = headers.map(norm)
  const used = new Set()

  const findFirst = patterns => {
    for (const p of patterns) {
      for (let i = 0; i < normalized.length; i++) {
        if (used.has(i)) continue
        if (normalized[i].includes(p)) { used.add(i); return i }
      }
    }
    return -1
  }

  // Renditja e prioritetit: e specifikja para përgjithësisë.
  const barcode    = findFirst(['barkod', 'barcode'])
  const sku        = findFirst([
    'sku', 'numer_serial', 'nr_serial', 'numer_seri', 'nr_seri', 'nr._seri',
    'seri', 'kodi_art', 'kodi', 'code', 'ref_no', 'ref',
  ])
  const cost_price = findFirst([
    'cmimi_pa_tvsh', 'cmimi_bler', 'cm_bler',
    'pa_tvsh', 'blerje', 'kosto', 'cost', 'cmimi_k',
  ])
  const sell_price = findFirst([
    'cmimi_shitj', 'cm_shitj', 'shitje_pa', 'shit_pa_tvsh',
    'sell_price', 'sell', 'price', 'cmimi_sh',
  ])
  const stock      = findFirst(['sasia', 'sasi', 'stoku', 'stock', 'qty', 'quantity', 'gjendje', 'cope'])
  const min_stock  = findFirst(['stok_min', 'min_stock', 'minim', 'alarm'])
  const category   = findFirst(['kategori', 'category', 'tip', 'lloj'])
  const brand      = findFirst(['brendi', 'brand', 'prodhu'])
  const name       = findFirst(['pershkrim', 'emri', 'name', 'produkt', 'article', 'description', 'artikull'])

  return { name, category, brand, sku, barcode, cost_price, sell_price, stock, min_stock }
}

function rowToProduct(row, m) {
  const get = (idx, def = '') => idx >= 0 ? (row[idx] ?? def) : def
  return {
    name:       String(get(m.name, '')).trim(),
    category:   String(get(m.category, 'Tjeter')).trim() || 'Tjeter',
    brand:      String(get(m.brand, '')).trim(),
    sku:        String(get(m.sku, '')).trim(),
    barcode:    String(get(m.barcode, '')).trim(),
    cost_price: parseFloat(get(m.cost_price, 0)) || 0,
    sell_price: parseFloat(get(m.sell_price, 0)) || 0,
    stock:      parseInt(get(m.stock, 0)) || 0,
    min_stock:  parseInt(get(m.min_stock, 5)) || 5,
  }
}

function computeLine(it) {
  const qty   = n(it.qty)
  const price = n(it.purchase_price_no_vat)
  const disc  = n(it.discount_percent)
  const vatR  = n(it.vat_rate)
  const gross = qty * price
  const subtotal_no_vat = gross * (1 - disc / 100)
  const vat_amount      = subtotal_no_vat * (vatR / 100)
  const total_with_vat  = subtotal_no_vat + vat_amount
  return { subtotal_no_vat, vat_amount, total_with_vat }
}

// ── Supplier picker (autocomplete by name / NIPT / phone) ───────────────────
function SupplierPicker({ value, onChange }) {
  const [query, setQuery] = useState(value?.name || '')
  const [results, setResults] = useState([])
  const [open, setOpen]       = useState(false)
  const [loading, setLoading] = useState(false)
  const timerRef = useRef(null)
  const boxRef   = useRef(null)

  useEffect(() => { setQuery(value?.name || '') }, [value?.name])

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
        const data = await fetch(`/api/suppliers/search?q=${encodeURIComponent(q)}`).then(r => r.json())
        setResults(Array.isArray(data) ? data : [])
      } catch { setResults([]) }
      setLoading(false)
    }, 250)
  }

  const pick = (s) => {
    onChange({ name: s.name || '', nipt: s.nipt || '', phone: s.phone || '' })
    setQuery(s.name || s.nipt || '')
    setOpen(false)
  }

  return (
    <div ref={boxRef} className="relative col-span-2">
      <label className="form-label">Furnitori</label>
      <div className="flex gap-1">
        <input
          type="text" value={query}
          placeholder="Kërko furnitor — emër, NIPT, telefon..."
          onChange={e => { setQuery(e.target.value); onChange({ name: e.target.value, nipt: value?.nipt || '' }); search(e.target.value); setOpen(true) }}
          onFocus={() => query && setOpen(true)}
          className="input-field flex-1"
        />
        {value?.name && (
          <button type="button" onClick={() => { onChange({ name: '', nipt: '', phone: '' }); setQuery('') }}
            className="px-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 text-xs" title="Pastro">✕</button>
        )}
      </div>
      {value?.nipt && (
        <p className="text-[10px] text-slate-500 mt-0.5">
          NIPT: <span className="font-mono">{value.nipt}</span>
          {value.phone && <> · Tel: <span className="font-mono">{value.phone}</span></>}
        </p>
      )}
      {open && (results.length > 0 || loading) && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-64 overflow-y-auto">
          {loading && <div className="p-2 text-xs text-slate-400">Duke kërkuar...</div>}
          {results.map(s => (
            <button
              key={s.id} type="button" onClick={() => pick(s)}
              className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-slate-100 last:border-0"
            >
              <div className="text-sm font-medium text-slate-800">
                {s.name || <span className="italic text-slate-400">— pa emër —</span>}
              </div>
              <div className="text-[11px] text-slate-500 font-mono">
                {s.nipt || '—'}{s.phone ? ` · ${s.phone}` : ''}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Product picker for purchase rows ────────────────────────────────────────
function ProductPickerCell({ value, onPick }) {
  const [query, setQuery] = useState(value?.name || value?.barcode || '')
  const [results, setResults] = useState([])
  const [open, setOpen]       = useState(false)
  const [loading, setLoading] = useState(false)
  const timerRef = useRef(null)
  const boxRef   = useRef(null)

  useEffect(() => { setQuery(value?.name || value?.barcode || '') }, [value?.name, value?.barcode])

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

  const pick = (p) => { onPick(p); setOpen(false) }

  return (
    <div ref={boxRef} className="relative">
      <input
        type="text" value={query}
        placeholder="barkod ose emër..."
        onChange={e => { setQuery(e.target.value); search(e.target.value); setOpen(true) }}
        onFocus={() => query && setOpen(true)}
        onKeyDown={e => {
          if (e.key === 'Enter' && results.length > 0) { e.preventDefault(); pick(results[0]) }
        }}
        className="input-field-sm"
      />
      {open && (results.length > 0 || loading) && (
        <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-60 overflow-y-auto min-w-[280px]">
          {loading && <div className="p-2 text-[11px] text-slate-400">Duke kërkuar...</div>}
          {results.map(p => (
            <button
              key={p.id} type="button" onClick={() => pick(p)}
              className="w-full text-left px-3 py-1.5 hover:bg-blue-50 border-b border-slate-100 last:border-0"
            >
              <div className="text-xs font-medium text-slate-800 truncate">{p.name}</div>
              <div className="flex items-center justify-between text-[10px] text-slate-500">
                <span className="font-mono">{p.barcode || p.sku || '—'}</span>
                <span>kosto: {p.cost_price || '—'} · stok: {p.stock}{p.vat_rate != null ? ` · TVSH ${p.vat_rate}%` : ''}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── List view: all purchase invoices for the day ────────────────────────────
function PurchaseList({ date, onOpen, onCreate, onDelete, refreshKey }) {
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [fromDate, setFromDate] = useState(date)
  const [toDate, setToDate]     = useState(date)

  useEffect(() => { setFromDate(date); setToDate(date) }, [date])

  useEffect(() => {
    if (!fromDate || !toDate) return
    setLoading(true)
    const url = fromDate === toDate
      ? `/api/purchase-invoices/by-date/${fromDate}`
      : `/api/purchase-invoices/by-range?from=${fromDate}&to=${toDate}`
    fetch(url)
      .then(r => r.json())
      .then(d => { setList(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => { setList([]); setLoading(false) })
  }, [fromDate, toDate, refreshKey])

  const rangeActive = fromDate !== date || toDate !== date

  // Daily snapshot — use the amount paid AT INVOICE CREATION TIME (not current state).
  // Later payments via Detyrime Furnitor reflect in Detyrime + Analize Veprime but
  // must NOT shift the daily totals on the purchase invoice list.
  const totals = list.reduce((acc, inv) => {
    const rate = n(inv.exchange_rate) || 1
    const initPaid = inv.initial_amount_paid != null ? n(inv.initial_amount_paid) : n(inv.amount_paid)
    const initDue  = Math.max(0, n(inv.total_with_vat) - initPaid)
    const gross = n(inv.subtotal_no_vat) + n(inv.total_discount)
    acc.count += 1
    acc.gross += gross
    acc.sub += n(inv.subtotal_no_vat)
    acc.disc += n(inv.total_discount)
    acc.vat += n(inv.total_vat)
    acc.tot += n(inv.total_with_vat)
    acc.paid += initPaid
    acc.due  += initDue
    acc.grossLek += gross * rate
    acc.discLek  += n(inv.total_discount) * rate
    acc.subLek   += n(inv.subtotal_no_vat) * rate
    acc.vatLek   += n(inv.total_vat) * rate
    acc.totLek   += n(inv.total_with_vat) * rate
    acc.paidLek  += initPaid * rate
    acc.dueLek   += initDue * rate
    return acc
  }, {
    count: 0, gross: 0, sub: 0, disc: 0, vat: 0, tot: 0, paid: 0, due: 0,
    grossLek: 0, discLek: 0, subLek: 0, vatLek: 0, totLek: 0, paidLek: 0, dueLek: 0,
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Fatura Blerje</h2>
          <p className="text-xs text-slate-500">
            {fromDate === toDate
              ? 'Lista e faturave të blerjes për këtë datë'
              : `Lista e faturave të blerjes nga ${fromDate} në ${toDate}`}
          </p>
        </div>
        <button onClick={onCreate} className="btn-primary">+ Faturë Blerje e Re</button>
      </div>

      {/* Date range filter */}
      <div className="card flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">📅</span>
          <span className="text-sm font-semibold text-slate-700">Filtër data</span>
        </div>
        <div>
          <label className="form-label">Nga data</label>
          <input
            type="date" value={fromDate}
            max={toDate}
            onChange={e => setFromDate(e.target.value)}
            className="input-field"
          />
        </div>
        <div>
          <label className="form-label">Deri më datë</label>
          <input
            type="date" value={toDate}
            min={fromDate}
            onChange={e => setToDate(e.target.value)}
            className="input-field"
          />
        </div>
        {rangeActive && (
          <button
            onClick={() => { setFromDate(date); setToDate(date) }}
            className="btn-secondary text-xs"
          >Pastro filtrin</button>
        )}
      </div>

      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-400 text-sm">Duke ngarkuar...</div>
        ) : list.length === 0 ? (
          <div className="p-10 text-center">
            <div className="text-5xl mb-3">📦</div>
            <p className="text-slate-500 mb-4">
              {fromDate === toDate
                ? 'Nuk ka fatura blerje për këtë datë.'
                : 'Nuk ka fatura blerje në këtë periudhë.'}
            </p>
            <button onClick={onCreate} className="btn-primary mx-auto">+ Krijo Faturën e Parë</button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Nr. Fature</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Furnitori</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">NIPT</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase">Monedha</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase">Pagesa</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase">Pa Zbritje</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase">Zbritja</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase">Pa TVSH</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase">TVSH</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase">TOTALI</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase">Paguar</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase">Borxh</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase">Veprime</th>
              </tr>
            </thead>
            <tbody>
              {list.map(inv => {
                // Snapshot from the invoice's creation moment — later payments via the
                // Detyrime Furnitor modal are ignored here so daily totals stay stable.
                const initPaid = inv.initial_amount_paid != null ? n(inv.initial_amount_paid) : n(inv.amount_paid)
                const due = Math.max(0, n(inv.total_with_vat) - initPaid)
                const pm = inv.payment_method
                const pmBadge = pm === 'debt'
                  ? <span className="badge bg-amber-100 text-amber-700">⚠️ Borxh</span>
                  : pm === 'bank'
                  ? <span className="badge bg-blue-100 text-blue-700">🏦 Bankë</span>
                  : pm === 'pos'
                  ? <span className="badge bg-purple-100 text-purple-700">💳 POS</span>
                  : <span className="badge bg-emerald-100 text-emerald-700">💵 Cash</span>
                const rate = n(inv.exchange_rate) || 1
                const isForeign = (inv.currency || 'LEK') !== 'LEK'
                return (
                <tr key={inv.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">
                    <button onClick={() => onOpen(inv.id)} className="text-blue-600 hover:underline">{inv.invoice_no}</button>
                  </td>
                  <td className="px-4 py-3 text-slate-800">{inv.supplier_name || <span className="text-slate-400 italic">— pa furnitor —</span>}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{inv.supplier_nipt || '—'}</td>
                  <td className="px-4 py-3 text-center"><span className="badge bg-blue-100 text-blue-700">{inv.currency}</span></td>
                  <td className="px-4 py-3 text-center text-xs">{pmBadge}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                    {fmt(n(inv.subtotal_no_vat) + n(inv.total_discount))}
                    {isForeign && (
                      <div className="text-[10px] font-normal text-slate-500 italic">
                        = {fmt((n(inv.subtotal_no_vat) + n(inv.total_discount)) * rate)} LEK
                      </div>
                    )}
                  </td>
                  <td className={`px-4 py-3 text-right tabular-nums ${n(inv.total_discount) > 0.005 ? 'text-orange-600 font-semibold' : 'text-slate-400'}`}>
                    {n(inv.total_discount) > 0.005 ? `-${fmt(inv.total_discount)}` : '—'}
                    {isForeign && n(inv.total_discount) > 0.005 && (
                      <div className="text-[10px] font-normal text-orange-500/80 italic">
                        = -{fmt(n(inv.total_discount) * rate)} LEK
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                    {fmt(inv.subtotal_no_vat)}
                    {isForeign && (
                      <div className="text-[10px] font-normal text-slate-500 italic">
                        = {fmt(n(inv.subtotal_no_vat) * rate)} LEK
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                    {fmt(inv.total_vat)}
                    {isForeign && n(inv.total_vat) > 0.005 && (
                      <div className="text-[10px] font-normal text-slate-500 italic">
                        = {fmt(n(inv.total_vat) * rate)} LEK
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-bold text-slate-900">
                    {fmt(inv.total_with_vat)}
                    {isForeign && (
                      <div className="text-[10px] font-normal text-slate-500 italic">
                        = {fmt(n(inv.total_with_vat) * rate)} LEK
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold text-emerald-700">
                    {fmt(initPaid)}
                    {isForeign && initPaid > 0.005 && (
                      <div className="text-[10px] font-normal text-emerald-600/70 italic">
                        = {fmt(initPaid * rate)} LEK
                      </div>
                    )}
                  </td>
                  <td className={`px-4 py-3 text-right tabular-nums font-semibold ${due > 0.005 ? 'text-red-600' : 'text-emerald-600'}`}>
                    {due > 0.005 ? fmt(due) : '✓'}
                    {isForeign && due > 0.005 && (
                      <div className="text-[10px] font-normal text-red-500/80 italic">
                        = {fmt(due * rate)} LEK
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1.5">
                      <button onClick={() => onOpen(inv.id)} className="px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 text-xs font-medium">Hap</button>
                      <button onClick={() => onDelete(inv.id, inv.invoice_no)} className="px-2.5 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 text-xs font-medium">Fshi</button>
                    </div>
                  </td>
                </tr>
              )})}
            </tbody>
            <tfoot className="bg-emerald-50 border-t-2 border-emerald-300">
              <tr>
                <td colSpan={5} className="px-4 py-3 text-xs font-bold text-emerald-700 uppercase tracking-wide">
                  💵 TOTAL CASH (LEK) <span className="text-[10px] font-normal text-emerald-600">— {totals.count} fatura, të konvertuara me kursin e çdo fature</span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-extrabold text-slate-800">{fmt(totals.grossLek)}</td>
                <td className="px-4 py-3 text-right tabular-nums font-extrabold text-orange-600">
                  {totals.discLek > 0.005 ? `-${fmt(totals.discLek)}` : '—'}
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-extrabold text-slate-800">{fmt(totals.subLek)}</td>
                <td className="px-4 py-3 text-right tabular-nums font-extrabold text-slate-800">{fmt(totals.vatLek)}</td>
                <td className="px-4 py-3 text-right tabular-nums font-extrabold text-blue-700 text-base">{fmt(totals.totLek)}</td>
                <td className="px-4 py-3 text-right tabular-nums font-extrabold text-emerald-700 text-base">{fmt(totals.paidLek)}</td>
                <td className={`px-4 py-3 text-right tabular-nums font-extrabold text-base ${totals.dueLek > 0.005 ? 'text-red-600' : 'text-emerald-700'}`}>
                  {totals.dueLek > 0.005 ? fmt(totals.dueLek) : '✓'}
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  )
}

// ── Import Excel Modal (Purchase Invoice) ──────────────────────────────────
// Two-purpose flow: ➊ Inserts each row into the products table (so they show
// up in the Products page), then ➋ appends them as line items on the open
// purchase invoice — linked by the freshly-minted product_id so saving the
// invoice tracks stock correctly via adjustPurchaseStock.
function ImportExcelModal({ onClose, onImported }) {
  const fileRef = useRef()
  const [step, setStep]               = useState('upload') // upload | preview
  const [fileName, setFileName]       = useState('')
  const [headers, setHeaders]         = useState([])
  const [mapping, setMapping]         = useState({})
  const [dataRows, setDataRows]       = useState([])
  const [error, setError]             = useState('')
  const [importing, setImporting]     = useState(false)

  const handleFile = e => {
    const file = e.target.files[0]
    if (!file) return
    setFileName(file.name)
    setError('')
    const reader = new FileReader()
    reader.onload = async evt => {
      try {
        // Ngarko XLSX (~300KB gzip) vetëm tani që user hapi importin.
        const XLSX = await import('xlsx')
        const wb  = XLSX.read(evt.target.result, { type: 'array' })
        const ws  = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
        const hdrIdx = raw.findIndex(r => r.filter(c => String(c).trim()).length >= 2)
        if (hdrIdx === -1) { setError('Nuk u gjet asnjë rresht me të dhëna.'); return }
        const hdrs = raw[hdrIdx].map(c => String(c ?? '').trim())
        const rows = raw.slice(hdrIdx + 1).filter(r => r.some(c => String(c).trim() !== ''))
        setHeaders(hdrs)
        setDataRows(rows)
        setMapping(detectMapping(hdrs))
        setStep('preview')
      } catch (err) {
        setError('Gabim gjatë leximit: ' + err.message)
      }
    }
    reader.readAsArrayBuffer(file)
  }

  const products = dataRows.map(r => rowToProduct(r, mapping)).filter(p => p.name)

  const handleImport = async () => {
    if (products.length === 0) return
    setImporting(true)
    setError('')
    try {
      // Set stock=0 in the products payload; the purchase invoice's qty will
      // drive stock via adjustPurchaseStock, otherwise we'd double-count.
      const payload = products.map(p => ({ ...p, stock: 0 }))
      const res = await fetch('/api/products/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ products: payload }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Gabim importi')
      const matched = data.matched || 0
      if (matched > 0) {
        alert(`✓ ${data.imported || 0} produkte të reja u krijuan.\n♻️ ${matched} ekzistonin tashmë (sipas barkodit / SKU-së) — u përdorën të njëjtët.`)
      }
      onImported(products, Array.isArray(data.ids) ? data.ids : [])
      onClose()
    } catch (err) {
      setError('Gabim gjatë importit: ' + err.message)
    } finally {
      setImporting(false)
    }
  }

  const setMap = (key, val) => setMapping(m => ({ ...m, [key]: parseInt(val) }))

  const COL_FIELDS = [
    { key: 'name',       label: 'Emri *' },
    { key: 'category',   label: 'Kategoria' },
    { key: 'brand',      label: 'Brendi' },
    { key: 'sku',        label: 'Kodi SKU' },
    { key: 'barcode',    label: 'Barcode' },
    { key: 'cost_price', label: 'Çm. Blerje (€)' },
    { key: 'sell_price', label: 'Çm. Shitje (€)' },
    { key: 'stock',      label: 'Sasia' },
    { key: 'min_stock',  label: 'Stok Minimal' },
  ]

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="modal-header">
          <div>
            <h3 className="font-bold text-slate-800 text-lg">Import Artikujsh nga Excel</h3>
            {fileName && step !== 'upload' && (
              <p className="text-xs text-slate-500 mt-0.5">📄 {fileName}</p>
            )}
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 text-xl">×</button>
        </div>
        <div className="p-6">
          {step === 'upload' && (
            <div className="space-y-5">
              <div
                onClick={() => fileRef.current.click()}
                className="border-2 border-dashed border-slate-300 hover:border-blue-400 rounded-2xl p-10 text-center cursor-pointer transition-colors group"
              >
                <div className="text-5xl mb-3">📂</div>
                <p className="font-semibold text-slate-700 group-hover:text-blue-600">Klikoni për të zgjedhur Excel-in</p>
                <p className="text-sm text-slate-400 mt-1">Mbështet: .xlsx, .xls</p>
                <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleFile} className="hidden" />
              </div>
              {error && <p className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{error}</p>}
              <div className="p-3 bg-blue-50 rounded-xl border border-blue-100 text-xs text-blue-700">
                Çdo rresht do regjistrohet si <b>produkt i ri</b> dhe do shtohet si <b>artikull</b> në këtë faturë blerje.
                Sasia do të shtohet automatikisht në stok kur ruani faturën.
              </div>
            </div>
          )}
          {step === 'preview' && (
            <div className="space-y-5">
              <div>
                <p className="section-title mb-3">Lidhja e kolonave</p>
                <div className="grid grid-cols-3 gap-2">
                  {COL_FIELDS.map(f => (
                    <div key={f.key} className="flex items-center gap-2">
                      <span className="text-xs text-slate-600 w-32 flex-shrink-0">{f.label}</span>
                      <select
                        value={mapping[f.key] ?? -1}
                        onChange={e => setMap(f.key, e.target.value)}
                        className={`input-field-sm flex-1 ${mapping[f.key] >= 0 ? 'border-green-400' : 'border-slate-300'}`}
                      >
                        <option value={-1}>— Nuk ka —</option>
                        {headers.map((h, i) => (
                          <option key={i} value={i}>{h || `Kolona ${i + 1}`}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex-1 p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-center">
                  <p className="text-2xl font-bold text-emerald-700">{products.length}</p>
                  <p className="text-xs text-emerald-600">Artikuj të gatshëm</p>
                </div>
                <div className="flex-1 p-3 bg-slate-50 rounded-xl border border-slate-200 text-center">
                  <p className="text-2xl font-bold text-slate-700">{dataRows.length - products.length}</p>
                  <p className="text-xs text-slate-500">Rreshta të zbrazur</p>
                </div>
                <div className="flex-1 p-3 bg-blue-50 rounded-xl border border-blue-200 text-center">
                  <p className="text-2xl font-bold text-blue-700">{headers.length}</p>
                  <p className="text-xs text-blue-600">Kolona totale</p>
                </div>
              </div>
              <div>
                <p className="section-title">Shembull — 5 të parët</p>
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold text-slate-500">Nr.</th>
                        <th className="px-3 py-2 text-left font-semibold text-slate-500">Emri</th>
                        <th className="px-3 py-2 text-left font-semibold text-slate-500">Barkodi</th>
                        <th className="px-3 py-2 text-right font-semibold text-slate-500">Sasia</th>
                        <th className="px-3 py-2 text-right font-semibold text-slate-500">Kosto €</th>
                        <th className="px-3 py-2 text-right font-semibold text-slate-500">Shitje €</th>
                      </tr>
                    </thead>
                    <tbody>
                      {products.slice(0, 5).map((p, i) => (
                        <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                          <td className="px-3 py-2 font-mono text-slate-400">{i + 1}</td>
                          <td className="px-3 py-2 font-medium text-slate-800 max-w-[180px] truncate">{p.name}</td>
                          <td className="px-3 py-2 font-mono text-slate-500">{p.barcode || '—'}</td>
                          <td className="px-3 py-2 text-right">{p.stock || '—'}</td>
                          <td className="px-3 py-2 text-right text-slate-700">{p.cost_price || '—'}</td>
                          <td className="px-3 py-2 text-right font-semibold text-slate-900">{p.sell_price || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {products.length > 5 && (
                  <p className="text-xs text-slate-400 mt-2 text-center">+ {products.length - 5} të tjerë...</p>
                )}
              </div>
              {error && <p className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{error}</p>}
              <div className="flex gap-3">
                <button onClick={() => setStep('upload')} className="btn-secondary">← Ndrysho Skedarin</button>
                <button
                  onClick={handleImport}
                  disabled={products.length === 0 || importing}
                  className="btn-primary flex-1 justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {importing ? '⏳ Duke importuar...' : `⬆️ Importo ${products.length} Artikuj`}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Editor ──────────────────────────────────────────────────────────────────
function PurchaseEditor({ date, invoiceId, onClose, onSaved }) {
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [invoiceDate, setInvoiceDate] = useState(date)
  const [invoiceNo, setInvoiceNo] = useState('')
  const [supplierName, setSupplierName] = useState('')
  const [supplierNipt, setSupplierNipt] = useState('')
  const [currency, setCurrency] = useState('EUR')
  const [exchangeRate, setExchangeRate] = useState(1)
  const [rateSource, setRateSource]   = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [amountPaid, setAmountPaid]   = useState('')
  const [notes, setNotes]       = useState('')
  const [category, setCategory] = useState('')
  const [items, setItems]       = useState([emptyItem()])
  const [allRates, setAllRates] = useState({ LEK: 1 })
  const [showImport, setShowImport] = useState(false)
  const [bulkPromoPct, setBulkPromoPct] = useState('20')

  useEffect(() => {
    let cancel = false
    async function init() {
      try {
        const ratesRes = await fetch(`/api/exchange-rates/${date}`).then(r => r.json())
        if (cancel) return
        setAllRates(ratesRes.rates || { LEK: 1 })
        setRateSource(ratesRes.source || '')
        if (invoiceId) {
          const inv = await fetch(`/api/purchase-invoices/${invoiceId}`).then(r => r.json())
          if (cancel) return
          setInvoiceDate(inv.date || date)
          setInvoiceNo(inv.invoice_no || '')
          setSupplierName(inv.supplier_name || '')
          setSupplierNipt(inv.supplier_nipt || '')
          setCurrency(inv.currency || 'LEK')
          setExchangeRate(inv.exchange_rate || 1)
          setPaymentMethod(['cash','bank','debt','pos'].includes(inv.payment_method) ? inv.payment_method : 'cash')
          // Show what was recorded at registration, not the current paid total —
          // later payments from Detyrime Furnitor must not shift the editor either.
          const initPaid = inv.initial_amount_paid != null ? inv.initial_amount_paid : inv.amount_paid
          setAmountPaid(initPaid != null ? String(initPaid) : '')
          setNotes(inv.notes || '')
          const invItems = (inv.items && inv.items.length > 0) ? inv.items : [emptyItem()]
          const mats = invItems.map(it => it.material).filter(m => m === 'flori' || m === 'diamant' || m === 'ora')
          setCategory(mats.length > 0 && mats.every(m => m === mats[0]) ? mats[0] : '')
          setItems(invItems)
        } else {
          setInvoiceDate(date)
          const r = await fetch(`/api/purchase-invoices/next-no?date=${date}`).then(r => r.json())
          if (cancel) return
          setInvoiceNo(r.invoice_no || '')
          setItems([emptyItem()])
        }
      } finally { if (!cancel) setLoading(false) }
    }
    init()
    return () => { cancel = true }
  }, [date, invoiceId])

  // When the user changes the invoice date: refresh rates, and refresh next-no for new invoices
  useEffect(() => {
    if (loading || !invoiceDate) return
    let cancel = false
    async function syncForDate() {
      try {
        const ratesRes = await fetch(`/api/exchange-rates/${invoiceDate}`).then(r => r.json())
        if (cancel) return
        setAllRates(ratesRes.rates || { LEK: 1 })
        setRateSource(ratesRes.source || '')
        if (!invoiceId) {
          const r = await fetch(`/api/purchase-invoices/next-no?date=${invoiceDate}`).then(r => r.json())
          if (cancel) return
          setInvoiceNo(r.invoice_no || '')
        }
      } catch { /* ignore */ }
    }
    syncForDate()
    return () => { cancel = true }
  }, [invoiceDate])

  useEffect(() => {
    if (allRates && allRates[currency] != null) setExchangeRate(allRates[currency])
  }, [currency, allRates])

  const setItem = (idx, patch) =>
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, ...patch } : it))

  const addItem = () => setItems(prev => [...prev, emptyItem()])
  const removeItem = (idx) =>
    setItems(prev => prev.length === 1 ? [emptyItem()] : prev.filter((_, i) => i !== idx))

  // Gjenero barkod për një rresht. Nëse rreshti është produkt ekzistues, e
  // ruajmë menjëherë në DB që skaneri të gjejë produktin edhe para se të
  // ruhet fatura. Në produktet e reja, mbetet vetëm në state deri në ruajtje.
  const generateForRow = async (idx) => {
    const it = items[idx]
    if (it.barcode && !confirm('Ky rresht ka tashmë një barkod. Zëvendëso me një të ri?')) return
    const code = generateBarcode()
    setItem(idx, { barcode: code })
    if (it.product_id) {
      try {
        await fetch(`/api/products/${it.product_id}/barcode`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ barcode: code }),
        })
      } catch (e) {
        alert('Barkodi u gjenerua por s\'u ruajt në produkt: ' + (e.message || e))
      }
    }
  }

  const generateForEmptyRows = async () => {
    const targets = items
      .map((it, i) => ({ it, i }))
      .filter(({ it }) => !it.barcode || !String(it.barcode).trim())
    if (targets.length === 0) { alert('Të gjithë rreshtat kanë tashmë barkod.'); return }
    if (!confirm(`Gjenero barkod për ${targets.length} rreshta bosh?`)) return
    // Gjenero lokalisht të gjithë; shto në state njëherësh që të mos përplasen
    // update-t sekuenciale.
    const codes = targets.map(() => generateBarcode())
    setItems(prev => prev.map((it, i) => {
      const idx = targets.findIndex(t => t.i === i)
      return idx === -1 ? it : { ...it, barcode: codes[idx] }
    }))
    // Persist për ata me product_id.
    for (let k = 0; k < targets.length; k++) {
      const { it } = targets[k]
      if (it.product_id) {
        try {
          await fetch(`/api/products/${it.product_id}/barcode`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ barcode: codes[k] }),
          })
        } catch { /* ruhet përsëri kur ruhet fatura */ }
      }
    }
  }

  const printAllLabels = () => {
    const eligible = items.filter(it => it.barcode && String(it.barcode).trim())
    if (eligible.length === 0) { alert('Asnjë rresht me barkod. Gjenero ose plotëso barkodet së pari.'); return }
    printLabels(eligible)
  }

  // Products / Excel imports are stored with prices in EUR. When the invoice
  // uses a different currency, convert via the LEK pivot using rates fetched
  // for this invoice's date.
  const eurToInvoiceCurrency = (eur) => {
    const amt = n(eur)
    if (!amt) return 0
    if (currency === 'EUR') return +amt.toFixed(2)
    const eurRate    = n(allRates.EUR) || 1
    const targetRate = n(allRates[currency]) || 1
    if (!targetRate) return +amt.toFixed(2)
    return +(amt * eurRate / targetRate).toFixed(2)
  }

  // Switch currency AND re-price existing line items so amounts stay equivalent
  // in real money. Manual edits afterwards are preserved.
  const changeCurrency = (newCurrency) => {
    const oldCurrency = currency
    if (newCurrency === oldCurrency) return
    const oldRate = n(allRates[oldCurrency]) || 1
    const newRate = n(allRates[newCurrency]) || 1
    const factor  = newRate > 0 ? oldRate / newRate : 1
    if (Math.abs(factor - 1) > 1e-9) {
      setItems(prev => prev.map(it => ({
        ...it,
        purchase_price_no_vat: +(n(it.purchase_price_no_vat) * factor).toFixed(2),
        sell_price:            +(n(it.sell_price) * factor).toFixed(2),
      })))
    }
    setCurrency(newCurrency)
  }

  // Map imported products → invoice items. Drop the leading empty placeholder
  // row if the user hasn't touched it, otherwise append.
  const handleImported = (products, ids) => {
    const newItems = products.map((p, i) => ({
      product_id: ids[i] || null,
      barcode:               p.barcode || '',
      name:                  p.name,
      qty:                   p.stock > 0 ? p.stock : 1,
      purchase_price_no_vat: eurToInvoiceCurrency(p.cost_price || 0),
      discount_percent:      0,
      vat_rate:              20,
      sell_price:            eurToInvoiceCurrency(p.sell_price || 0),
    }))
    setItems(prev => {
      const onlyEmpty = prev.length === 1 && !prev[0].name && !prev[0].barcode && !prev[0].product_id
      return onlyEmpty ? newItems : [...prev, ...newItems]
    })
  }

  const pickProduct = (idx, p) => {
    setItem(idx, {
      product_id: p.id,
      serial_no: p.serial_no || '',
      barcode: p.barcode || '',
      name: p.name,
      category: p.category || '',
      unit: p.unit || 'copë',
      gram: p.gram != null ? p.gram : 0,
      purchase_price_no_vat: eurToInvoiceCurrency(p.purchase_price_no_vat || 0),
      cost_price:            eurToInvoiceCurrency(p.cost_price || 0),
      sell_price:            eurToInvoiceCurrency(p.sell_price || 0),
      vat_rate: p.vat_rate != null ? p.vat_rate : 20,
      material: p.material || '',
      is_promotion: !!p.is_promotion,
      promo_discount_pct: p.is_promotion ? (parseFloat(p.promo_discount_pct) || 0) : 0,
    })
  }

  const lineTotals = items.map(computeLine)
  const totals = lineTotals.reduce((acc, l) => ({
    sub: acc.sub + l.subtotal_no_vat,
    vat: acc.vat + l.vat_amount,
    tot: acc.tot + l.total_with_vat,
  }), { sub: 0, vat: 0, tot: 0 })

  const save = async () => {
    if (saving) return
    const valid = items
      .filter(it => (it.name && it.name.trim()) || n(it.qty) > 0 || n(it.purchase_price_no_vat) > 0)
      .map(it => category ? { ...it, material: category } : it)
    if (valid.length === 0) { alert('Shtoni të paktën një artikull.'); return }
    setSaving(true)
    try {
      const payload = {
        date: invoiceDate, invoice_no: invoiceNo,
        supplier_name: supplierName,
        supplier_nipt: supplierNipt,
        currency,
        exchange_rate: parseFloat(exchangeRate) || 1,
        payment_method: paymentMethod,
        amount_paid: amountPaid === '' ? null : parseFloat(amountPaid),
        notes,
        items: valid,
      }
      const url = invoiceId ? `/api/purchase-invoices/${invoiceId}` : '/api/purchase-invoices'
      const method = invoiceId ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Gabim në ruajtje')
      }
      onSaved?.()
    } catch (e) { alert(e.message) }
    finally { setSaving(false) }
  }

  if (loading) {
    return <div className="card p-8 text-center text-slate-400">Duke ngarkuar faturën...</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="btn-secondary">← Mbrapa</button>
          <div>
            <h2 className="text-lg font-bold text-slate-800">
              {invoiceId ? 'Edito Faturën Blerje' : 'Faturë Blerje e Re'}
            </h2>
            <p className="text-xs text-slate-500 font-mono">Nr. {invoiceNo}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="btn-secondary">Anulo</button>
          <button onClick={save} disabled={saving} className="btn-primary disabled:opacity-50">
            {saving ? '⏳ Duke ruajtur...' : '💾 Ruaj Faturën'}
          </button>
        </div>
      </div>

      <div className="card grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <label className="form-label">Nr. Fature <span className="text-[10px] text-slate-400">(auto)</span></label>
          <input type="text" value={invoiceNo} readOnly className="input-field font-mono bg-slate-50 cursor-not-allowed" />
        </div>
        <div>
          <label className="form-label">Datë</label>
          <input
            type="date" value={invoiceDate}
            onChange={e => setInvoiceDate(e.target.value)}
            className="input-field"
          />
        </div>
        <SupplierPicker
          value={{ name: supplierName, nipt: supplierNipt }}
          onChange={(s) => { setSupplierName(s.name || ''); setSupplierNipt(s.nipt || '') }}
        />
        <div>
          <label className="form-label">Monedha</label>
          <select value={currency} onChange={e => changeCurrency(e.target.value)} className="input-field">
            {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="form-label">
            Kursi i Këmbimit
            <span className="ml-1 text-[10px] text-slate-400">(1 {currency} = ? LEK)</span>
          </label>
          <input type="number" step="0.0001" min="0"
            value={exchangeRate} onChange={e => setExchangeRate(e.target.value)}
            disabled={currency === 'LEK'} className="input-field disabled:bg-slate-50" />
          <p className="text-[10px] text-slate-400 mt-0.5">Burimi: <span className="font-medium">{rateSource || '—'}</span></p>
        </div>
        <div>
          <label className="form-label">Kategoria</label>
          <select value={category} onChange={e => setCategory(e.target.value)} className="input-field">
            <option value="">— pa kategori —</option>
            <option value="flori">🟡 Flori</option>
            <option value="diamant">💎 Diamant</option>
            <option value="ora">⌚ Ora</option>
          </select>
          <p className="text-[10px] text-slate-400 mt-0.5">Aplikohet për të gjithë artikujt e faturës</p>
        </div>
        <div className="col-span-2 md:col-span-4">
          <label className="form-label">Lloji i Pagesës ndaj Furnitorit</label>
          <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => { setPaymentMethod('cash'); setAmountPaid('') }}
              className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
                paymentMethod === 'cash' ? 'bg-white shadow-sm text-emerald-700' : 'text-slate-500 hover:text-slate-700'
              }`}
              title="E paguar plotësisht në Cash"
            >💵 Cash</button>
            <button
              type="button"
              onClick={() => { setPaymentMethod('pos'); setAmountPaid('') }}
              className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
                paymentMethod === 'pos' ? 'bg-white shadow-sm text-purple-700' : 'text-slate-500 hover:text-slate-700'
              }`}
              title="POS / Kartë — e paguar plotësisht"
            >💳 POS</button>
            <button
              type="button"
              onClick={() => { setPaymentMethod('bank'); setAmountPaid('0') }}
              className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
                paymentMethod === 'bank' ? 'bg-white shadow-sm text-blue-700' : 'text-slate-500 hover:text-slate-700'
              }`}
              title="Do paguhet me bankë — borxh i hapur"
            >🏦 Bankë</button>
            <button
              type="button"
              onClick={() => { setPaymentMethod('debt'); setAmountPaid('0') }}
              className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
                paymentMethod === 'debt' ? 'bg-white shadow-sm text-amber-700' : 'text-slate-500 hover:text-slate-700'
              }`}
              title="Borxh ndaj furnitorit — vendos manualisht sa është paguar"
            >⚠️ Borxh</button>
          </div>
          {(() => {
            const tot = totals.tot
            const paidVal = amountPaid === '' ? tot : n(amountPaid)
            const due = +(tot - paidVal).toFixed(2)
            return (
              <div className="grid grid-cols-3 gap-3 mt-3">
                <div>
                  <label className="text-[10px] text-slate-500 uppercase font-semibold">Totali ({currency})</label>
                  <div className="input-field bg-slate-50 text-slate-700 tabular-nums font-bold">{fmt(tot)}</div>
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 uppercase font-semibold">Shuma e Paguar ({currency})</label>
                  <MoneyInput
                    value={amountPaid}
                    onChange={v => setAmountPaid(String(v))}
                    className="input-field tabular-nums"
                    placeholder={tot.toFixed(2)}
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 uppercase font-semibold">Borxh ndaj Furnitorit ({currency})</label>
                  <div className={`input-field tabular-nums font-bold ${due > 0.005 ? 'bg-red-50 text-red-700 border-red-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
                    {due > 0.005 ? fmt(due) : '✓ Paguar plotësisht'}
                  </div>
                </div>
              </div>
            )
          })()}
        </div>
        <div className="col-span-2">
          <label className="form-label">Shënime</label>
          <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
            className="input-field" placeholder="opsional" />
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-slate-500">
                <th className="px-2 py-2 text-left font-semibold w-8">Nr.</th>
                <th className="px-2 py-2 text-left font-semibold w-40">Barkodi</th>
                <th className="px-2 py-2 text-left font-semibold w-28">Nr Serie</th>
                <th className="px-2 py-2 text-left font-semibold w-56">Pershkrimi</th>
                <th className="px-2 py-2 text-left font-semibold w-28">Kategoria</th>
                <th className="px-2 py-2 text-left font-semibold w-16">Njesi</th>
                <th className="px-2 py-2 text-right font-semibold w-14">Sasi</th>
                <th className="px-2 py-2 text-right font-semibold w-16">Gram</th>
                <th className="px-2 py-2 text-right font-semibold w-24">Cmimi PA</th>
                <th className="px-2 py-2 text-right font-semibold w-14">TVSH %</th>
                <th className="px-2 py-2 text-right font-semibold w-24">Cmim Kosto €</th>
                <th className="px-2 py-2 text-right font-semibold w-24 bg-emerald-100 text-emerald-800">Cmim Shitje €</th>
                <th className="px-2 py-2 text-center font-semibold w-24 bg-rose-50 text-rose-700" title="Shënoje si produkt në promocion; jep % ulje">Promo · %</th>
                <th className="px-2 py-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => {
                return (
                  <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-2 py-1 text-center text-slate-400">{idx + 1}</td>
                    <td className="px-1 py-1">
                      <div className="flex items-center gap-0.5">
                        <input
                          type="text" value={it.barcode}
                          onChange={e => setItem(idx, { barcode: e.target.value })}
                          className="input-field-sm font-mono flex-1 min-w-0"
                          placeholder="—"
                        />
                        <button
                          type="button"
                          onClick={() => generateForRow(idx)}
                          className="w-6 h-6 flex items-center justify-center rounded hover:bg-slate-100 text-slate-500 text-sm"
                          title="Gjenero barkod të ri (Code128, GS-XXXXXXXX)"
                        >🔀</button>
                        <button
                          type="button"
                          onClick={() => printLabels([it])}
                          disabled={!it.barcode}
                          className="w-6 h-6 flex items-center justify-center rounded hover:bg-slate-100 text-slate-500 text-sm disabled:opacity-30 disabled:cursor-not-allowed"
                          title="Printo etiketë për këtë produkt"
                        >🖨️</button>
                      </div>
                    </td>
                    <td className="px-1 py-1">
                      <input type="text" value={it.serial_no || ''}
                        onChange={e => setItem(idx, { serial_no: e.target.value })}
                        className="input-field-sm font-mono" placeholder="—" />
                    </td>
                    <td className="px-1 py-1">
                      <ProductPickerCell value={it} onPick={p => pickProduct(idx, p)} />
                    </td>
                    <td className="px-1 py-1">
                      <input type="text" value={it.category || ''}
                        onChange={e => setItem(idx, { category: e.target.value })}
                        className="input-field-sm" placeholder="—" />
                    </td>
                    <td className="px-1 py-1">
                      <input type="text" value={it.unit || ''}
                        onChange={e => setItem(idx, { unit: e.target.value })}
                        className="input-field-sm" placeholder="copë" />
                    </td>
                    <td className="px-1 py-1">
                      <input type="number" step="any" value={it.qty}
                        onChange={e => setItem(idx, { qty: e.target.value })}
                        className="input-field-sm text-right" />
                    </td>
                    <td className="px-1 py-1">
                      <input type="number" step="0.001" min="0" value={it.gram}
                        onChange={e => setItem(idx, { gram: e.target.value })}
                        className="input-field-sm text-right" />
                    </td>
                    <td className="px-1 py-1">
                      <MoneyInput value={it.purchase_price_no_vat}
                        onChange={v => setItem(idx, { purchase_price_no_vat: v })}
                        className="input-field-sm text-right" />
                    </td>
                    <td className="px-1 py-1">
                      <input type="number" step="0.01" min="0" max="100" value={it.vat_rate}
                        onChange={e => setItem(idx, { vat_rate: e.target.value })}
                        className="input-field-sm text-right" />
                    </td>
                    <td className="px-1 py-1">
                      <MoneyInput value={it.cost_price}
                        onChange={v => setItem(idx, { cost_price: v })}
                        className="input-field-sm text-right" />
                    </td>
                    <td className="px-1 py-1 bg-emerald-50">
                      <MoneyInput value={it.sell_price}
                        onChange={v => setItem(idx, { sell_price: v })}
                        className="input-field-sm text-right font-semibold text-emerald-800" />
                    </td>
                    <td className="px-1 py-1 text-center bg-rose-50/40">
                      <div className="flex items-center justify-center gap-1">
                        <input
                          type="checkbox"
                          checked={!!it.is_promotion}
                          disabled={!it.product_id}
                          onChange={e => setItem(idx, {
                            is_promotion: e.target.checked,
                            promo_discount_pct: e.target.checked ? (n(it.promo_discount_pct) || 0) : 0,
                          })}
                          className="w-4 h-4 accent-rose-600 disabled:opacity-30"
                          title={it.product_id
                            ? 'Shënoje këtë produkt si në promocion'
                            : 'Zgjidh një produkt ekzistues për ta shënuar si promocion'}
                        />
                        <input
                          type="number" step="0.01" min="0" max="100"
                          value={it.is_promotion ? (it.promo_discount_pct ?? 0) : ''}
                          disabled={!it.is_promotion}
                          onChange={e => setItem(idx, { promo_discount_pct: e.target.value })}
                          className="input-field-sm text-right w-14 disabled:bg-slate-100 disabled:text-slate-300"
                          placeholder="%"
                          title="Zbritja % për këtë produkt gjatë promocionit"
                        />
                      </div>
                    </td>
                    <td className="px-1 py-1 text-center">
                      <button onClick={() => removeItem(idx)} className="text-red-500 hover:text-red-700 text-sm" title="Hiq">✕</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="bg-blue-50 border-t-2 border-blue-200">
              <tr className="font-bold text-xs">
                <td colSpan={13} className="px-2 py-2 text-right text-slate-600">
                  TOTALI ({currency}) — pa TVSH: <span className="tabular-nums text-slate-800">{fmt(totals.sub)}</span>
                  {' · '}TVSH: <span className="tabular-nums text-slate-800">{fmt(totals.vat)}</span>
                  {' · '}me TVSH: <span className="tabular-nums text-blue-700 text-sm">{fmt(totals.tot)}</span>
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="p-3 border-t border-slate-100 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={addItem} className="btn-secondary text-xs">+ Shto Artikull</button>
            <button onClick={() => setShowImport(true)} className="btn-secondary text-xs">📥 Importo Excel</button>
            <button
              onClick={generateForEmptyRows}
              className="btn-secondary text-xs"
              title="Gjenero barkod Code128 (GS-XXXXXXXX) për çdo rresht që s'ka ende barkod"
            >🔀 Gjenero Barkodet</button>
            <button
              onClick={printAllLabels}
              className="text-xs bg-slate-900 hover:bg-slate-800 text-white font-semibold px-2 py-1.5 rounded-lg"
              title="Printo etiketa (50×30mm) për të gjithë rreshtat me barkod"
            >🖨️ Printo Etiketat</button>
            <select
              value=""
              onChange={e => {
                const m = parseFloat(e.target.value)
                e.target.selectedIndex = 0
                if (!m) return
                const eligible = items.filter(it => n(it.purchase_price_no_vat) > 0).length
                if (eligible === 0) { alert('Asnjë rresht me Çm. Blerje > 0.'); return }
                if (!confirm(`Vendos Çm. Shitje = Çm. Blerje × ${m} për ${eligible} rreshta?`)) return
                setItems(prev => prev.map(it => ({
                  ...it,
                  sell_price: +(n(it.purchase_price_no_vat) * m).toFixed(2),
                })))
              }}
              title="Vendos Çm. Shitje = Çm. Blerje × shumëzues për të gjithë rreshtat"
              className="text-xs bg-white border border-emerald-300 rounded-lg px-2 py-1.5 text-emerald-700 font-semibold cursor-pointer hover:bg-emerald-50"
            >
              <option value="">⚡ Apliko × për të gjithë...</option>
              <option value="0.5">×0.5 (blerje × 0.5)</option>
              <option value="1">×1 (blerje × 1)</option>
              <option value="1.5">×1.5 (blerje × 1.5)</option>
              <option value="2">×2 (blerje × 2)</option>
              <option value="2.5">×2.5 (blerje × 2.5)</option>
              <option value="3">×3 (blerje × 3)</option>
              <option value="3.5">×3.5 (blerje × 3.5)</option>
              <option value="4">×4 (blerje × 4)</option>
              <option value="4.5">×4.5 (blerje × 4.5)</option>
              <option value="5">×5 (blerje × 5)</option>
            </select>
            <div className="flex items-center gap-1 pl-2 border-l border-slate-200">
              <span className="text-[10px] text-rose-700 font-semibold uppercase">Promo Bulk:</span>
              <input
                type="number" step="0.01" min="0" max="100"
                value={bulkPromoPct}
                onChange={e => setBulkPromoPct(e.target.value)}
                className="input-field-sm text-right w-16"
                placeholder="% ulje"
                title="Zbritja % që do aplikohet për të gjitha produktet e faturës"
              />
              <button
                onClick={() => {
                  const pct = Math.max(0, Math.min(100, parseFloat(bulkPromoPct) || 0))
                  const eligible = items.filter(it => it.product_id).length
                  if (eligible === 0) { alert('Asnjë rresht me produkt të lidhur. Zgjidh një produkt ekzistues për çdo rresht.'); return }
                  if (!confirm(`Vër ${eligible} produkte në promocion me ${pct}% ulje?`)) return
                  setItems(prev => prev.map(it => it.product_id
                    ? { ...it, is_promotion: true, promo_discount_pct: pct }
                    : it))
                }}
                className="text-xs bg-rose-600 hover:bg-rose-500 text-white font-semibold px-2 py-1.5 rounded-lg"
                title="Shënoji të gjitha produktet e lidhur si promocion me % e mësipërme"
              >🏷️ Vër të gjitha</button>
              <button
                onClick={() => {
                  const eligible = items.filter(it => it.is_promotion).length
                  if (eligible === 0) return
                  if (!confirm(`Hiq ${eligible} produkte nga promocioni?`)) return
                  setItems(prev => prev.map(it => it.is_promotion
                    ? { ...it, is_promotion: false, promo_discount_pct: 0 }
                    : it))
                }}
                className="text-xs bg-white border border-slate-300 hover:bg-slate-50 text-slate-600 px-2 py-1.5 rounded-lg"
                title="Hiq promocionin nga të gjithë rreshtat e faturës aktuale"
              >Hiq</button>
            </div>
          </div>
          <p className="text-[10px] text-slate-500">
            <span className="inline-block w-3 h-3 bg-emerald-100 mr-1 align-middle border border-emerald-300"></span>
            Çmimi i Shitjes do aplikohet automatikisht në produkt → përdoret te FATURA SHITJE
          </p>
        </div>
      </div>

      {showImport && (
        <ImportExcelModal
          onClose={() => setShowImport(false)}
          onImported={handleImported}
        />
      )}
    </div>
  )
}

export default function FaturaBlerje({ date, openInvoiceId, onConsumeOpen }) {
  const [mode, setMode] = useState('list')
  const [editingId, setEditingId] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)

  // External request to open a specific invoice (e.g. from AnalizeVeprime / Detyrime Furnitor)
  useEffect(() => {
    if (openInvoiceId) {
      setEditingId(openInvoiceId)
      setMode('edit')
      onConsumeOpen?.()
    }
  }, [openInvoiceId, onConsumeOpen])

  const openInvoice = (id) => { setEditingId(id); setMode('edit') }
  const createNew   = ()   => { setEditingId(null); setMode('edit') }
  const backToList  = ()   => { setEditingId(null); setMode('list') }
  const onSaved     = ()   => { setRefreshKey(k => k + 1); backToList() }

  const deleteInvoice = async (id, no) => {
    if (!confirm(`Fshi faturën e blerjes ${no}? Stoku do të zbritet.`)) return
    await fetch(`/api/purchase-invoices/${id}`, { method: 'DELETE' })
    setRefreshKey(k => k + 1)
  }

  if (mode === 'edit') {
    return <PurchaseEditor date={date} invoiceId={editingId} onClose={backToList} onSaved={onSaved} />
  }
  return (
    <PurchaseList
      date={date}
      onOpen={openInvoice}
      onCreate={createNew}
      onDelete={deleteInvoice}
      refreshKey={refreshKey}
    />
  )
}
