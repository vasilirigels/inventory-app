import { useState, useEffect, useCallback, useRef } from 'react'

const CURRENCIES = ['LEK', 'EUR', 'USD', 'GBP', 'CHF']

function n(v) { return parseFloat(v) || 0 }
function fmt(v) {
  const x = n(v)
  return x.toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Pjesa e faturës e paguar realisht me cash/POS në momentin e regjistrimit.
// Snapshot — nuk merr parasysh pagesat e mëvonshme nga Detyrime modal.
// Për 'debt' merret parapagimi (mund të jetë > 0 nëse klienti la një pjesë kesh).
function truePaidCashPos(inv) {
  const pm = inv.payment_method || 'cash'
  if (pm === 'mikse') return n(inv.paid_cash) + n(inv.paid_pos)
  const init = inv.initial_amount_paid != null ? n(inv.initial_amount_paid) : n(inv.amount_paid)
  return init
}

function emptyItem() {
  return {
    product_id: null, barcode: '', name: '',
    qty: 1, unit_price_no_vat: 0, discount_percent: 0,
    vat_rate: 20,
  }
}

function computeLine(it) {
  const qty   = n(it.qty)
  const price = n(it.unit_price_no_vat)
  const disc  = n(it.discount_percent)
  const vatR  = n(it.vat_rate)
  const gross = qty * price
  const subtotal_no_vat = gross * (1 - disc / 100)
  const vat_amount      = subtotal_no_vat * (vatR / 100)
  const total_with_vat  = subtotal_no_vat + vat_amount
  return { subtotal_no_vat, vat_amount, total_with_vat }
}

function clientFullName(c) {
  return [c?.first_name, c?.last_name].filter(Boolean).join(' ').trim()
}

// ── Client picker (autocomplete by name / NIPT / phone) ─────────────────────
function ClientPicker({ value, onChange }) {
  // value = { customer_name, customer_nipt, address?, phone? }
  const [query, setQuery]     = useState(value?.customer_name || '')
  const [results, setResults] = useState([])
  const [open, setOpen]       = useState(false)
  const [loading, setLoading] = useState(false)
  const timerRef = useRef(null)
  const boxRef   = useRef(null)

  useEffect(() => { setQuery(value?.customer_name || '') }, [value?.customer_name])

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
        const data = await fetch(`/api/clients/search?q=${encodeURIComponent(q)}`).then(r => r.json())
        setResults(Array.isArray(data) ? data : [])
      } catch { setResults([]) }
      setLoading(false)
    }, 250)
  }

  const pick = (c) => {
    onChange({
      customer_name: clientFullName(c) || c.nipt || '',
      customer_nipt: c.nipt || '',
      address:       c.address || '',
      phone:         c.phone   || '',
    })
    setQuery(clientFullName(c) || c.nipt || '')
    setOpen(false)
  }

  const clear = () => {
    onChange({ customer_name: '', customer_nipt: '', address: '', phone: '' })
    setQuery('')
    setOpen(false)
  }

  // Split a free-text name into first / last using the first whitespace.
  // "Gjon Buzuku" → { first: "Gjon", last: "Buzuku" }; single token → all first.
  const splitName = (full) => {
    const parts = (full || '').trim().split(/\s+/)
    return { first: parts[0] || '', last: parts.slice(1).join(' ') }
  }

  const createNew = async () => {
    const name = query.trim()
    if (!name) return
    const { first, last } = splitName(name)
    try {
      await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ first_name: first, last_name: last }),
      })
    } catch { /* ignore — pick() still wires the name into the invoice */ }
    pick({ id: null, nipt: '', first_name: first, last_name: last, address: '', phone: '' })
  }

  const trimmedQuery = query.trim()
  const exactMatch = results.some(c =>
    (clientFullName(c) || '').toLowerCase() === trimmedQuery.toLowerCase()
  )
  const showCreate = trimmedQuery.length > 0 && !loading && !exactMatch
  const { first: previewFirst, last: previewLast } = splitName(trimmedQuery)

  return (
    <div ref={boxRef} className="relative col-span-2">
      <label className="form-label">Klienti</label>
      <div className="flex gap-1">
        <input
          type="text"
          value={query}
          placeholder="Kërko klient — emër, NIPT, telefon..."
          onChange={e => { setQuery(e.target.value); search(e.target.value); setOpen(true) }}
          onFocus={() => query && setOpen(true)}
          className="input-field flex-1"
        />
        {value?.customer_name && (
          <button type="button" onClick={clear}
            className="px-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 text-xs" title="Pastro">✕</button>
        )}
      </div>
      {value?.customer_nipt && (
        <p className="text-[10px] text-slate-500 mt-0.5">
          NIPT: <span className="font-mono">{value.customer_nipt}</span>
          {value.phone && <> · Tel: <span className="font-mono">{value.phone}</span></>}
        </p>
      )}
      {open && (results.length > 0 || loading || showCreate) && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-64 overflow-y-auto">
          {loading && <div className="p-2 text-xs text-slate-400">Duke kërkuar...</div>}
          {results.map(c => (
            <button
              key={c.id}
              type="button"
              onClick={() => pick(c)}
              className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-slate-100 last:border-0"
            >
              <div className="text-sm font-medium text-slate-800">
                {clientFullName(c) || <span className="italic text-slate-400">— pa emër —</span>}
              </div>
              <div className="text-[11px] text-slate-500 font-mono">
                {c.nipt || '—'}{c.phone ? ` · ${c.phone}` : ''}
              </div>
            </button>
          ))}
          {showCreate && (
            <button
              type="button"
              onClick={createNew}
              className="w-full text-left px-3 py-2 hover:bg-emerald-50 bg-emerald-50/40 border-t border-emerald-100"
            >
              <div className="text-sm font-semibold text-emerald-700">
                + Krijo klient të ri: <span className="font-bold">{trimmedQuery}</span>
              </div>
              <div className="text-[11px] text-slate-500">
                Emri: <span className="font-medium text-slate-700">{previewFirst || '—'}</span>
                {' · '}Mbiemri: <span className="font-medium text-slate-700">{previewLast || '—'}</span>
              </div>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Product picker for a single row (searches barcode/SKU/name) ─────────────
function ProductPickerCell({ value, onPick }) {
  // value = { name, barcode }
  const [query, setQuery] = useState(value?.name || value?.barcode || '')
  const [results, setResults] = useState([])
  const [open, setOpen]       = useState(false)
  const [loading, setLoading] = useState(false)
  const timerRef = useRef(null)
  const boxRef   = useRef(null)

  useEffect(() => {
    setQuery(value?.name || value?.barcode || '')
  }, [value?.name, value?.barcode])

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

  const handleChange = (val) => {
    setQuery(val)
    search(val)
    setOpen(true)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && results.length > 0) {
      e.preventDefault()
      pick(results[0])
    }
  }

  const pick = (p) => {
    onPick(p)
    setOpen(false)
  }

  return (
    <div ref={boxRef} className="relative">
      <input
        type="text"
        value={query}
        placeholder="barkod ose emër..."
        onChange={e => handleChange(e.target.value)}
        onFocus={() => query && setOpen(true)}
        onKeyDown={handleKeyDown}
        className="input-field-sm"
      />
      {open && (results.length > 0 || loading) && (
        <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-60 overflow-y-auto min-w-[280px]">
          {loading && <div className="p-2 text-[11px] text-slate-400">Duke kërkuar...</div>}
          {results.map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => pick(p)}
              className="w-full text-left px-3 py-1.5 hover:bg-blue-50 border-b border-slate-100 last:border-0"
            >
              <div className="text-xs font-medium text-slate-800 truncate">{p.name}</div>
              <div className="flex items-center justify-between text-[10px] text-slate-500">
                <span className="font-mono">{p.barcode || p.sku || '—'}</span>
                <span>
                  {p.sell_price ? `€${p.sell_price}` : ''} · stok: {p.stock}
                  {p.vat_rate != null ? ` · TVSH ${p.vat_rate}%` : ''}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Credit-note picker modal ────────────────────────────────────────────────
function CreditNotePicker({ date, onClose, onPicked }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  useEffect(() => {
    setLoading(true)
    fetch(`/api/invoices/by-date/${date}`)
      .then(r => r.json())
      .then(data => {
        const eligible = (Array.isArray(data) ? data : []).filter(i => !i.cancelled && !i.is_credit_note)
        setRows(eligible); setLoading(false)
      })
      .catch(() => { setRows([]); setLoading(false) })
  }, [date])
  const ql = q.toLowerCase().trim()
  const filtered = !ql ? rows : rows.filter(i =>
    (i.invoice_no || '').toLowerCase().includes(ql) ||
    (i.customer_name || '').toLowerCase().includes(ql) ||
    (i.customer_nipt || '').toLowerCase().includes(ql)
  )
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="modal-header">
          <div>
            <h3 className="font-bold text-slate-800 text-lg">↩️ Anulim me Minus — Zgjidh Faturën</h3>
            <p className="text-xs text-slate-500">Zgjidh një faturë ekzistuese për të krijuar kreditoren (me minus)</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 text-xl">×</button>
        </div>
        <div className="px-6 pt-4">
          <input type="text" autoFocus value={q} onChange={e => setQ(e.target.value)}
            className="input-field" placeholder="Kërko nr.fature, klient, NIPT..." />
        </div>
        <div className="flex-1 overflow-y-auto p-6 pt-3">
          {loading ? (
            <div className="text-center text-slate-400 py-8">Duke ngarkuar...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center text-slate-400 py-8">
              {rows.length === 0 ? 'Asnjë faturë e vlefshme në këtë datë.' : 'Asnjë faturë nuk përputhet me kërkimin.'}
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map(inv => (
                <button key={inv.id}
                  onClick={() => onPicked(inv)}
                  className="w-full text-left p-3 rounded-xl border border-slate-200 hover:border-purple-400 hover:bg-purple-50 transition-colors">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-mono font-bold text-slate-800">{inv.invoice_no}</div>
                      <div className="text-sm text-slate-600 truncate">
                        {inv.customer_name || <span className="italic text-slate-400">— pa klient —</span>}
                        {inv.customer_nipt && <span className="ml-2 text-xs font-mono text-slate-500">({inv.customer_nipt})</span>}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-lg font-bold text-slate-900 tabular-nums">
                        {n(inv.total_with_vat).toLocaleString('sq-AL', { minimumFractionDigits: 2 })}
                      </div>
                      <div className="text-xs text-slate-500">{inv.currency} · {inv.date}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="btn-secondary">Anulo</button>
        </div>
      </div>
    </div>
  )
}

// ── List view: all invoices for the day ──────────────────────────────────────
function InvoiceList({ date, onOpen, onCreate, onDelete, onStornim, refreshKey }) {
  const [rawList, setRawList] = useState([])
  const [loading, setLoading] = useState(true)
  const [fClient, setFClient]   = useState('')
  const [fCurrency, setFCurrency] = useState('all')
  const [fPayment, setFPayment]   = useState('all')
  // 'all' | 'sale' | 'return' | 'cancelled'
  const [fType, setFType]         = useState('all')
  // Filtër material: '' | 'flori' | 'diamant' — dërgohet në backend (EXISTS invoice_items)
  const [fMaterial, setFMaterial] = useState('')
  // Filtër kategorie: '' | një nga kategoritë e produkteve
  const [fCategory, setFCategory] = useState('')
  const [categories, setCategories] = useState([])
  const [fromDate, setFromDate] = useState(date)
  const [toDate, setToDate]     = useState(date)

  useEffect(() => { setFromDate(date); setToDate(date) }, [date])

  // Kategoritë e produkteve (fetch një herë).
  useEffect(() => {
    fetch('/api/products/categories')
      .then(r => r.json())
      .then(d => setCategories(Array.isArray(d) ? d : []))
      .catch(() => setCategories([]))
  }, [])

  useEffect(() => {
    if (!fromDate || !toDate) return
    setLoading(true)
    const params = new URLSearchParams()
    if (fMaterial) params.set('material', fMaterial)
    if (fCategory) params.set('category', fCategory)
    const qs = params.toString()
    const base = fromDate === toDate
      ? `/api/invoices/by-date/${fromDate}`
      : `/api/invoices/by-range?from=${fromDate}&to=${toDate}`
    const url = qs ? `${base}${base.includes('?') ? '&' : '?'}${qs}` : base
    fetch(url)
      .then(r => r.json())
      .then(data => { setRawList(Array.isArray(data) ? data : []); setLoading(false) })
      .catch(() => { setRawList([]); setLoading(false) })
  }, [fromDate, toDate, refreshKey, fMaterial, fCategory])

  const rangeActive = fromDate !== date || toDate !== date

  const fc = fClient.toLowerCase().trim()
  const list = rawList.filter(inv => {
    if (fCurrency !== 'all' && (inv.currency || 'LEK') !== fCurrency) return false
    if (fPayment !== 'all' && (inv.payment_method || 'cash') !== fPayment) return false
    if (fType === 'sale'      && (inv.cancelled || inv.is_credit_note)) return false
    if (fType === 'return'    && (inv.cancelled || !inv.is_credit_note)) return false
    if (fType === 'cancelled' && !inv.cancelled) return false
    if (fc) {
      const hay = `${inv.customer_name || ''} ${inv.customer_nipt || ''}`.toLowerCase()
      if (!hay.includes(fc)) return false
    }
    return true
  })

  // Numërime të shpejta për të shfaqur në header (nga rawList, para filtrave të mësipërm).
  const counts = rawList.reduce((a, inv) => {
    if (inv.cancelled) a.cancelled += 1
    else if (inv.is_credit_note) {
      a.return += 1
      // Vetëm produktet — jo çdo rresht (p.sh. shërbime). Përdor sasi absolute.
      // Rreshtat individualë nuk vijnë me by-date, kështu që numërojmë vetëm faturat.
    }
    else a.sale += 1
    return a
  }, { sale: 0, return: 0, cancelled: 0 })

  // Daily snapshot: use the amount paid AT INVOICE CREATION TIME (not the current state).
  // Later payments registered via the Detyrime Klienti modal show up in Detyrime + Analize
  // Veprime but must NOT shift the day's xhiro on the invoice list.
  // Vetëm cash + POS llogariten si "të paguara" — Borxhi është në pritje (i papaguar).
  // Totalet grupohen sipas monedhës origjinale të faturës — nuk konvertohen në LEK.
  const totalsByCur = list.reduce((acc, inv) => {
    const cur = inv.currency || 'LEK'
    if (!acc[cur]) acc[cur] = {
      count: 0, gross: 0, disc: 0, sub: 0, vat: 0, tot: 0, paid: 0, due: 0,
    }
    const t = acc[cur]
    const initPaid = truePaidCashPos(inv)
    const initDue  = Math.max(0, n(inv.total_with_vat) - initPaid)
    const gross    = n(inv.subtotal_no_vat) + n(inv.total_discount)
    t.count += 1
    t.gross += gross
    t.disc  += n(inv.total_discount)
    t.sub   += n(inv.subtotal_no_vat)
    t.vat   += n(inv.total_vat)
    t.tot   += n(inv.total_with_vat)
    t.paid  += initPaid
    t.due   += initDue
    return acc
  }, {})
  const currenciesInList = Object.keys(totalsByCur).sort()

  const filtersActive = fc || fCurrency !== 'all' || fPayment !== 'all' || fType !== 'all' || fMaterial || fCategory

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Fatura të Shitjes</h2>
          <p className="text-xs text-slate-500">
            {fromDate === toDate
              ? 'Lista e faturave për këtë datë'
              : `Lista e faturave nga ${fromDate} në ${toDate}`}
            {filtersActive && <span className="ml-2 text-blue-600">· {list.length} të filtruara nga {rawList.length}</span>}
          </p>
          {(counts.sale + counts.return + counts.cancelled) > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              <button
                onClick={() => setFType('all')}
                className={`badge cursor-pointer ${fType === 'all' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                title="Shfaq të gjitha"
              >📋 Të gjitha: {rawList.length}</button>
              <button
                onClick={() => setFType('sale')}
                className={`badge cursor-pointer ${fType === 'sale' ? 'bg-emerald-600 text-white' : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'}`}
                title="Shfaq vetëm shitjet e rregullta"
              >🧾 Shitje: {counts.sale}</button>
              <button
                onClick={() => setFType('return')}
                className={`badge cursor-pointer ${fType === 'return' ? 'bg-red-600 text-white' : 'bg-red-100 text-red-700 hover:bg-red-200'}`}
                title="Shfaq vetëm kthimet (faturat kreditore)"
              >↩️ Kthime: {counts.return}</button>
              {counts.cancelled > 0 && (
                <button
                  onClick={() => setFType('cancelled')}
                  className={`badge cursor-pointer ${fType === 'cancelled' ? 'bg-slate-600 text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'}`}
                  title="Shfaq vetëm faturat e anuluara"
                >🚫 Anuluar: {counts.cancelled}</button>
              )}
            </div>
          )}
        </div>
        <button onClick={onCreate} className="btn-primary">+ Faturë e Re</button>
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
        <div className="flex-1 min-w-[200px]">
          <label className="form-label">Klienti (emër / NIPT)</label>
          <input
            type="text" value={fClient} onChange={e => setFClient(e.target.value)}
            className="input-field" placeholder="kërko..."
          />
        </div>
        <div>
          <label className="form-label">Monedha</label>
          <select value={fCurrency} onChange={e => setFCurrency(e.target.value)} className="input-field w-32">
            <option value="all">Të gjitha</option>
            <option value="LEK">LEK</option>
            <option value="EUR">EUR</option>
            <option value="USD">USD</option>
            <option value="GBP">GBP</option>
            <option value="CHF">CHF</option>
          </select>
        </div>
        <div>
          <label className="form-label">Lloji i Pagesës</label>
          <select value={fPayment} onChange={e => setFPayment(e.target.value)} className="input-field w-36">
            <option value="all">Të gjitha</option>
            <option value="mikse">🔀 Mikse</option>
            <option value="cash">💵 Cash</option>
            <option value="pos">💳 POS</option>
            <option value="debt">⚠️ Borxh</option>
          </select>
        </div>
        <div>
          <label className="form-label">Lloji i Faturës</label>
          <select value={fType} onChange={e => setFType(e.target.value)} className="input-field w-40">
            <option value="all">Të gjitha</option>
            <option value="sale">🧾 Vetëm shitje</option>
            <option value="return">↩️ Vetëm kthime</option>
            <option value="cancelled">🚫 Vetëm anuluara</option>
          </select>
        </div>
        <div>
          <label className="form-label">Materiali</label>
          <select value={fMaterial} onChange={e => setFMaterial(e.target.value)} className="input-field w-32">
            <option value="">Të gjitha</option>
            <option value="flori">🟡 Flori</option>
            <option value="diamant">💎 Diamant</option>
          </select>
        </div>
        <div>
          <label className="form-label">Kategoria e Produktit</label>
          <select value={fCategory} onChange={e => setFCategory(e.target.value)} className="input-field w-40">
            <option value="">Të gjitha</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {(filtersActive || rangeActive) && (
          <button
            onClick={() => { setFClient(''); setFCurrency('all'); setFPayment('all'); setFType('all'); setFMaterial(''); setFCategory(''); setFromDate(date); setToDate(date) }}
            className="btn-secondary text-xs"
          >Pastro filtrat</button>
        )}
      </div>

      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-400 text-sm">Duke ngarkuar...</div>
        ) : list.length === 0 ? (
          <div className="p-10 text-center">
            <div className="text-5xl mb-3">🧾</div>
            <p className="text-slate-500 mb-4">
              {fromDate === toDate
                ? 'Nuk ka fatura për këtë datë.'
                : 'Nuk ka fatura në këtë periudhë.'}
            </p>
            <button onClick={onCreate} className="btn-primary mx-auto">+ Krijo Faturën e Parë</button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Nr. Fature</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Klienti</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">NIPT</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase">Monedha</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase">Pagesa</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase">Pa Zbritje</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase">Zbritja</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase">Pa TVSH</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase">TVSH</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase">TOTALI</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase">Shuma e Paguar</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase">Shuma Pa Paguar</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase">Veprime</th>
              </tr>
            </thead>
            <tbody>
              {list.map(inv => {
                // Snapshot from the invoice's creation moment — later payments via the
                // Detyrime Klienti modal are ignored here so daily xhiro stays stable.
                // Vetëm pjesa cash + POS quhet e paguar; Borxhi shfaqet si i papaguar.
                const initPaid = truePaidCashPos(inv)
                const due = Math.max(0, n(inv.total_with_vat) - initPaid)
                const pm  = inv.payment_method
                const pmBadge = pm === 'debt'
                  ? <span className="badge bg-amber-100 text-amber-700">⚠️ Borxh</span>
                  : pm === 'pos'
                  ? <span className="badge bg-purple-100 text-purple-700">💳 POS</span>
                  : pm === 'mikse'
                  ? <span className="badge bg-teal-100 text-teal-700">🔀 Mikse</span>
                  : <span className="badge bg-emerald-100 text-emerald-700">💵 Cash</span>
                const isCancelled = !!inv.cancelled
                const isCredit    = !!inv.is_credit_note
                const rate        = n(inv.exchange_rate) || 1
                const isForeign   = (inv.currency || 'LEK') !== 'LEK'
                const rowCls = isCancelled
                  ? 'border-b border-slate-100 bg-slate-50 line-through opacity-60'
                  : isCredit
                  ? 'border-b border-slate-100 bg-red-50/40 hover:bg-red-50'
                  : 'border-b border-slate-100 hover:bg-slate-50'
                return (
                <tr key={inv.id} className={rowCls}>
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">
                    {inv.invoice_no}
                    {isCancelled && <span className="ml-1.5 badge bg-slate-200 text-slate-600 text-[9px]">ANULUAR</span>}
                    {isCredit && <span className="ml-1.5 badge bg-red-100 text-red-700 text-[9px]">KREDITORE</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-800">{inv.customer_name || <span className="text-slate-400 italic">— pa klient —</span>}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{inv.customer_nipt || '—'}</td>
                  <td className="px-4 py-3 text-center text-xs">
                    <span className="badge badge-blue">{inv.currency}</span>
                  </td>
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
                  <td className={`px-4 py-3 text-right tabular-nums font-semibold ${due > 0.005 ? 'text-red-600' : due < -0.005 ? 'text-purple-700' : 'text-emerald-600'}`}>
                    {Math.abs(due) > 0.005 ? fmt(due) : '✓'}
                    {isForeign && Math.abs(due) > 0.005 && (
                      <div className={`text-[10px] font-normal italic ${due > 0.005 ? 'text-red-500/80' : 'text-purple-600/80'}`}>
                        = {fmt(due * rate)} LEK
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1 flex-wrap">
                      <button onClick={() => onOpen(inv.id)} className="px-2 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 text-[11px] font-medium">Hap</button>
                      {!isCancelled && !isCredit && (
                        <button
                          onClick={() => onStornim?.(inv.id, inv.invoice_no)}
                          className="px-2 py-1 rounded-lg bg-purple-50 hover:bg-purple-100 text-purple-700 text-[11px] font-medium"
                          title="Krijo faturë me minus dhe hape"
                        >↩️ Stornim</button>
                      )}
                      <button onClick={() => onDelete(inv.id, inv.invoice_no)} className="px-2 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 text-[11px] font-medium">Fshi</button>
                    </div>
                  </td>
                </tr>
              )})}
            </tbody>
            <tfoot className="bg-emerald-50 border-t-2 border-emerald-300">
              {currenciesInList.map((cur, idx) => {
                const t = totalsByCur[cur]
                return (
                  <tr key={cur} className={idx > 0 ? 'border-t border-emerald-200' : ''}>
                    <td colSpan={5} className="px-4 py-3 text-xs font-bold text-emerald-700 uppercase tracking-wide">
                      💵 TOTAL ({cur}) <span className="text-[10px] font-normal text-emerald-600">— {t.count} {t.count === 1 ? 'faturë' : 'fatura'}</span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-extrabold text-slate-800">{fmt(t.gross)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-extrabold text-orange-600">
                      {t.disc > 0.005 ? `-${fmt(t.disc)}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-extrabold text-slate-800">{fmt(t.sub)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-extrabold text-slate-800">{fmt(t.vat)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-extrabold text-blue-700 text-base">{fmt(t.tot)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-extrabold text-emerald-700 text-base">{fmt(t.paid)}</td>
                    <td className={`px-4 py-3 text-right tabular-nums font-extrabold text-base ${t.due > 0.005 ? 'text-red-600' : 'text-emerald-700'}`}>
                      {t.due > 0.005 ? fmt(t.due) : '✓'}
                    </td>
                    <td></td>
                  </tr>
                )
              })}
            </tfoot>
          </table>
        )}
      </div>
    </div>
  )
}

// ── Editor: single invoice with line items ───────────────────────────────────
function InvoiceEditor({ date, invoiceId, onClose, onSaved }) {
  const [loading, setLoading]         = useState(true)
  const [saving, setSaving]           = useState(false)
  const [invoiceDate, setInvoiceDate] = useState(date)
  const [invoiceNo, setInvoiceNo]     = useState('')
  const [customer, setCustomer]       = useState({ customer_name: '', customer_nipt: '', address: '', phone: '' })
  const [currency, setCurrency]       = useState('LEK')
  const [exchangeRate, setExchangeRate] = useState(1)
  const [rateSource, setRateSource]   = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [amountPaid, setAmountPaid]   = useState('')
  const [paidTouched, setPaidTouched] = useState(false)
  // Mixed-payment breakdown (used only when paymentMethod === 'mikse')
  const [paidCash, setPaidCash]       = useState('')
  const [paidPos,  setPaidPos]        = useState('')
  const [notes, setNotes]             = useState('')
  const [items, setItems]             = useState([emptyItem()])
  const [allRates, setAllRates]       = useState({ LEK: 1 })

  // Initial load: existing invoice OR fresh new invoice
  useEffect(() => {
    let cancel = false
    async function init() {
      try {
        // Always load rates first
        const ratesRes = await fetch(`/api/exchange-rates/${date}`).then(r => r.json())
        if (cancel) return
        const r = ratesRes.rates || { LEK: 1 }
        setAllRates(r)
        setRateSource(ratesRes.source || '')

        if (invoiceId) {
          const inv = await fetch(`/api/invoices/${invoiceId}`).then(r => r.json())
          if (cancel) return
          setInvoiceDate(inv.date || date)
          setInvoiceNo(inv.invoice_no || '')
          setCustomer({
            customer_name: inv.customer_name || '',
            customer_nipt: inv.customer_nipt || '',
            address: '', phone: '',
          })
          setCurrency(inv.currency || 'LEK')
          setExchangeRate(inv.exchange_rate || 1)
          const pm = ['cash','debt','pos','mikse'].includes(inv.payment_method) ? inv.payment_method : 'cash'
          setPaymentMethod(pm)
          // Show what was recorded at sale registration, not the current paid total —
          // later payments from Detyrime Klienti must not shift the editor either.
          const initPaid = inv.initial_amount_paid != null ? inv.initial_amount_paid : inv.amount_paid
          // Për cash/POS ku paid përputhet me total-in (rasti normal, dhe kreditore),
          // e lëmë bosh që "Shuma e Paguar" të sinkronizohet automatikisht kur user
          // ndryshon çmimet e artikujve. Ndryshe faturat kreditore mbanin paid=old-total
          // dhe krijonin një "due" të rrejshëm.
          const totalInv = n(inv.total_with_vat)
          const paidMatchesTotal = initPaid != null && Math.abs(n(initPaid) - totalInv) < 0.01
          if ((pm === 'cash' || pm === 'pos') && paidMatchesTotal) {
            setAmountPaid('')
            setPaidTouched(false)
          } else {
            setAmountPaid(initPaid != null ? String(initPaid) : '')
            setPaidTouched(true)
          }
          setPaidCash(inv.paid_cash != null ? String(inv.paid_cash) : '')
          setPaidPos (inv.paid_pos  != null ? String(inv.paid_pos)  : '')
          setNotes(inv.notes || '')
          setItems((inv.items && inv.items.length > 0) ? inv.items : [emptyItem()])
        } else {
          setInvoiceDate(date)
          const noRes = await fetch(`/api/invoices/next-no?date=${date}`).then(r => r.json())
          if (cancel) return
          setInvoiceNo(noRes.invoice_no || '')
          setCurrency('LEK')
          setExchangeRate(1)
          setItems([emptyItem()])
        }
      } finally {
        if (!cancel) setLoading(false)
      }
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
          const noRes = await fetch(`/api/invoices/next-no?date=${invoiceDate}`).then(r => r.json())
          if (cancel) return
          setInvoiceNo(noRes.invoice_no || '')
        }
      } catch { /* ignore */ }
    }
    syncForDate()
    return () => { cancel = true }
  }, [invoiceDate])

  // When currency changes, fill exchange rate automatically
  useEffect(() => {
    if (allRates && allRates[currency] != null) {
      setExchangeRate(allRates[currency])
    }
  }, [currency, allRates])

  const setItem = (idx, patch) => {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, ...patch } : it))
  }

  const removeItem = (idx) => {
    setItems(prev => prev.length === 1 ? [emptyItem()] : prev.filter((_, i) => i !== idx))
  }

  const addItem = () => setItems(prev => [...prev, emptyItem()])

  // Products are stored with prices in EUR. When the invoice uses a different
  // currency, convert via the LEK pivot using the rates fetched for this date.
  const eurToInvoiceCurrency = (eur) => {
    const amt = n(eur)
    if (!amt) return 0
    if (currency === 'EUR') return +amt.toFixed(2)
    const eurRate    = n(allRates.EUR) || 1
    const targetRate = n(allRates[currency]) || 1
    if (!targetRate) return +amt.toFixed(2)
    return +(amt * eurRate / targetRate).toFixed(2)
  }

  // Switch currency AND re-price existing line items so the amounts stay
  // equivalent in real money. Manual edits afterwards are preserved.
  const changeCurrency = (newCurrency) => {
    const oldCurrency = currency
    if (newCurrency === oldCurrency) return
    const oldRate = n(allRates[oldCurrency]) || 1
    const newRate = n(allRates[newCurrency]) || 1
    const factor  = newRate > 0 ? oldRate / newRate : 1
    if (Math.abs(factor - 1) > 1e-9) {
      setItems(prev => prev.map(it => ({
        ...it,
        unit_price_no_vat: +(n(it.unit_price_no_vat) * factor).toFixed(2),
      })))
    }
    setCurrency(newCurrency)
  }

  const pickProduct = (idx, p) => {
    setItem(idx, {
      product_id: p.id,
      barcode: p.barcode || '',
      name: p.name,
      unit_price_no_vat: eurToInvoiceCurrency(p.sell_price || 0),
      vat_rate: p.vat_rate != null ? p.vat_rate : 20,
    })
  }

  const refreshRates = async () => {
    try {
      const res = await fetch(`/api/exchange-rates/${invoiceDate}`).then(r => r.json())
      if (res.rates) {
        setAllRates(res.rates)
        setRateSource(res.source || '')
        if (res.rates[currency] != null) setExchangeRate(res.rates[currency])
      }
    } catch { /* ignore */ }
  }

  // Totals
  const lineTotals = items.map(computeLine)
  const totals = lineTotals.reduce((acc, l) => ({
    sub: acc.sub + l.subtotal_no_vat,
    vat: acc.vat + l.vat_amount,
    tot: acc.tot + l.total_with_vat,
  }), { sub: 0, vat: 0, tot: 0 })

  const save = async () => {
    if (saving) return
    const validItems = items.filter(it => (it.name && it.name.trim()) || n(it.qty) > 0 || n(it.unit_price_no_vat) > 0)
    if (validItems.length === 0) { alert('Shtoni të paktën një artikull.'); return }
    setSaving(true)
    try {
      const payload = {
        date: invoiceDate,
        invoice_no: invoiceNo,
        customer_name: customer.customer_name,
        customer_nipt: customer.customer_nipt,
        currency,
        exchange_rate: parseFloat(exchangeRate) || 1,
        payment_method: paymentMethod,
        amount_paid: amountPaid === '' ? null : parseFloat(amountPaid),
        paid_cash: paymentMethod === 'mikse' ? (parseFloat(paidCash) || 0) : 0,
        paid_pos:  paymentMethod === 'mikse' ? (parseFloat(paidPos)  || 0) : 0,
        notes,
        items: validItems,
      }
      const url = invoiceId ? `/api/invoices/${invoiceId}` : '/api/invoices'
      const method = invoiceId ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Gabim ne ruajtje')
      }
      onSaved?.()
    } catch (e) {
      alert(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="card p-8 text-center text-slate-400">Duke ngarkuar faturën...</div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="btn-secondary">← Mbrapa</button>
          <div>
            <h2 className="text-lg font-bold text-slate-800">
              {invoiceId ? 'Edito Faturën' : 'Faturë e Re Shitje'}
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

      {/* Header card */}
      <div className="card grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <label className="form-label">Nr. Fature <span className="text-[10px] text-slate-400">(auto)</span></label>
          <input
            type="text" value={invoiceNo} readOnly
            className="input-field font-mono bg-slate-50 text-slate-700 cursor-not-allowed"
          />
        </div>
        <div>
          <label className="form-label">Datë</label>
          <input
            type="date" value={invoiceDate}
            onChange={e => setInvoiceDate(e.target.value)}
            className="input-field"
          />
        </div>
        <ClientPicker value={customer} onChange={setCustomer} />
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
          <div className="flex gap-1">
            <input
              type="number" step="0.0001" min="0"
              value={exchangeRate}
              onChange={e => setExchangeRate(e.target.value)}
              disabled={currency === 'LEK'}
              className="input-field flex-1 disabled:bg-slate-50"
            />
            <button onClick={refreshRates} title="Rifresko kursin"
              className="px-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs">↻</button>
          </div>
          <p className="text-[10px] text-slate-400 mt-0.5">
            Burimi: <span className="font-medium">{rateSource || '—'}</span>
          </p>
        </div>
        <div className="col-span-2 md:col-span-4">
          <label className="form-label">Lloji i Pagesës</label>
          <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => { setPaymentMethod('cash'); setAmountPaid(''); setPaidTouched(false) }}
              className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
                paymentMethod === 'cash' ? 'bg-white shadow-sm text-emerald-700' : 'text-slate-500 hover:text-slate-700'
              }`}
              title="Shuma e Paguar = Totali (i paguar plotësisht)"
            >💵 Cash</button>
            <button
              type="button"
              onClick={() => { setPaymentMethod('pos'); setAmountPaid(''); setPaidTouched(false) }}
              className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
                paymentMethod === 'pos' ? 'bg-white shadow-sm text-purple-700' : 'text-slate-500 hover:text-slate-700'
              }`}
              title="POS / Kartë — Shuma e Paguar = Totali (i paguar plotësisht)"
            >💳 POS</button>
            <button
              type="button"
              onClick={() => { setPaymentMethod('debt'); setAmountPaid('0'); setPaidTouched(true) }}
              className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
                paymentMethod === 'debt' ? 'bg-white shadow-sm text-amber-700' : 'text-slate-500 hover:text-slate-700'
              }`}
              title="Shuma e Paguar vendoset manualisht; Pa Paguar = Totali − Shuma e Paguar"
            >⚠️ Borxh</button>
            <button
              type="button"
              onClick={() => {
                const half = +(totals.tot / 2).toFixed(2)
                setPaymentMethod('mikse')
                setPaidCash(String(half))
                setPaidPos(String(+(totals.tot - half).toFixed(2)))
                setPaidTouched(true)
              }}
              className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
                paymentMethod === 'mikse' ? 'bg-white shadow-sm text-teal-700' : 'text-slate-500 hover:text-slate-700'
              }`}
              title="Ndaj pagesën në Cash + POS (psh. 50% cash, 50% pos)"
            >🔀 Mikse</button>
          </div>
          {paymentMethod === 'mikse' ? (() => {
            const tot = totals.tot
            const sumPaid = +(n(paidCash) + n(paidPos)).toFixed(2)
            const due = +(tot - sumPaid).toFixed(2)
            return (
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] text-emerald-700 uppercase font-semibold">💵 Cash ({currency})</label>
                    <input type="number" step="0.01" min="0" value={paidCash}
                      onChange={e => setPaidCash(e.target.value)}
                      className="input-field tabular-nums" placeholder="0.00" />
                  </div>
                  <div>
                    <label className="text-[10px] text-purple-700 uppercase font-semibold">💳 POS ({currency})</label>
                    <input type="number" step="0.01" min="0" value={paidPos}
                      onChange={e => setPaidPos(e.target.value)}
                      className="input-field tabular-nums" placeholder="0.00" />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase font-semibold">Totali ({currency})</label>
                    <div className="input-field bg-slate-50 text-slate-700 tabular-nums font-bold">{fmt(tot)}</div>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase font-semibold">Shuma e Paguar ({currency})</label>
                    <div className="input-field bg-teal-50 text-teal-700 border-teal-200 tabular-nums font-bold">{fmt(sumPaid)}</div>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase font-semibold">Pa Paguar / Borxh ({currency})</label>
                    <div className={`input-field tabular-nums font-bold ${due > 0.005 ? 'bg-red-50 text-red-700 border-red-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
                      {due > 0.005 ? fmt(due) : '✓ Paguar plotësisht'}
                    </div>
                  </div>
                </div>
              </div>
            )
          })() : (() => {
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
                  <input
                    type="number" step="0.01" min="0"
                    value={amountPaid}
                    onChange={e => { setAmountPaid(e.target.value); setPaidTouched(true) }}
                    className="input-field tabular-nums"
                    placeholder={tot.toFixed(2)}
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 uppercase font-semibold">Pa Paguar / Borxh ({currency})</label>
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
          <input
            type="text" value={notes}
            onChange={e => setNotes(e.target.value)}
            className="input-field" placeholder="opsional"
          />
        </div>
      </div>

      {/* Items table */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-slate-500">
                <th className="px-2 py-2 text-left font-semibold w-8">#</th>
                <th className="px-2 py-2 text-left font-semibold w-64">Produkti (barkod ose emër)</th>
                <th className="px-2 py-2 text-left font-semibold w-32">Barkodi</th>
                <th className="px-2 py-2 text-right font-semibold w-16">Sasia</th>
                <th className="px-2 py-2 text-right font-semibold w-24">Çm. pa TVSH</th>
                <th className="px-2 py-2 text-right font-semibold w-16">Zbritje %</th>
                <th className="px-2 py-2 text-right font-semibold w-24">Vlera pa TVSH</th>
                <th className="px-2 py-2 text-right font-semibold w-14">TVSH %</th>
                <th className="px-2 py-2 text-right font-semibold w-20">TVSH</th>
                <th className="px-2 py-2 text-right font-semibold w-24">Vlera me TVSH (TOTAL)</th>
                <th className="px-2 py-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => {
                const lt = lineTotals[idx]
                return (
                  <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-2 py-1 text-center text-slate-400">{idx + 1}</td>
                    <td className="px-1 py-1">
                      <ProductPickerCell value={it} onPick={p => pickProduct(idx, p)} />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="text" value={it.barcode} readOnly
                        className="input-field-sm font-mono bg-slate-50 text-slate-600"
                        placeholder="—"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="number" step="any" value={it.qty}
                        onChange={e => setItem(idx, { qty: e.target.value })}
                        className="input-field-sm text-right"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="number" step="0.01" value={it.unit_price_no_vat}
                        onChange={e => setItem(idx, { unit_price_no_vat: e.target.value })}
                        className="input-field-sm text-right"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="number" step="0.01" min="0" max="100" value={it.discount_percent}
                        onChange={e => setItem(idx, { discount_percent: e.target.value })}
                        className="input-field-sm text-right"
                      />
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums text-slate-700">{fmt(lt.subtotal_no_vat)}</td>
                    <td className="px-1 py-1">
                      <input
                        type="number" step="0.01" min="0" max="100" value={it.vat_rate}
                        onChange={e => setItem(idx, { vat_rate: e.target.value })}
                        className="input-field-sm text-right"
                      />
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums text-slate-700">{fmt(lt.vat_amount)}</td>
                    <td className="px-2 py-1 text-right tabular-nums font-semibold text-slate-900">{fmt(lt.total_with_vat)}</td>
                    <td className="px-1 py-1 text-center">
                      <button onClick={() => removeItem(idx)} className="text-red-500 hover:text-red-700 text-sm" title="Hiq">✕</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="bg-blue-50 border-t-2 border-blue-200">
              <tr className="font-bold text-xs">
                <td colSpan={6} className="px-2 py-2 text-right text-slate-600">TOTALI ({currency}):</td>
                <td className="px-2 py-2 text-right tabular-nums text-slate-800">{fmt(totals.sub)}</td>
                <td></td>
                <td className="px-2 py-2 text-right tabular-nums text-slate-800">{fmt(totals.vat)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-blue-700 text-sm">{fmt(totals.tot)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="p-3 border-t border-slate-100">
          <button onClick={addItem} className="btn-secondary text-xs">+ Shto Artikull</button>
        </div>
      </div>
    </div>
  )
}

// ── Main entry ───────────────────────────────────────────────────────────────
export default function FaturaShitje({ date, openInvoiceId, onConsumeOpen }) {
  const [mode, setMode]               = useState('list')   // list | edit
  const [editingId, setEditingId]     = useState(null)
  const [refreshKey, setRefreshKey]   = useState(0)
  // Stornimi krijohet menjëherë në DB për të hapur redaktuesin; nëse përdoruesi
  // del me Anulo/Mbrapa pa e ruajtur, e fshijmë në vend që ta lëmë në bazë.
  const [pendingStornoId, setPendingStornoId] = useState(null)

  // When a parent route asks us to open a specific invoice, switch into edit mode
  useEffect(() => {
    if (openInvoiceId) {
      setEditingId(openInvoiceId)
      setMode('edit')
      onConsumeOpen?.()
    }
  }, [openInvoiceId, onConsumeOpen])

  const openInvoice = (id) => { setEditingId(id); setMode('edit') }
  const createNew   = ()   => { setEditingId(null); setMode('edit') }

  const closeEditor = async () => {
    if (pendingStornoId != null && pendingStornoId === editingId) {
      try { await fetch(`/api/invoices/${pendingStornoId}`, { method: 'DELETE' }) } catch { /* ignore */ }
    }
    setPendingStornoId(null)
    setEditingId(null)
    setMode('list')
    setRefreshKey(k => k + 1)
  }

  const onSaved = () => {
    setPendingStornoId(null)
    setEditingId(null)
    setMode('list')
    setRefreshKey(k => k + 1)
  }

  const deleteInvoice = async (id, no) => {
    if (!confirm(`Fshi faturën ${no}? Stoku do të kthehet në inventar.`)) return
    await fetch(`/api/invoices/${id}`, { method: 'DELETE' })
    setRefreshKey(k => k + 1)
  }

  const stornoInvoice = async (id, no) => {
    if (!confirm(`Krijo faturë stornim (me minus) për ${no}?`)) return
    const res = await fetch(`/api/invoices/${id}/credit-note`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    if (!res.ok) {
      const e = await res.json().catch(() => ({}))
      alert(e.error || 'Gabim')
      return
    }
    const r = await res.json()
    setRefreshKey(k => k + 1)
    if (r.id) {
      setPendingStornoId(r.id)
      setEditingId(r.id)
      setMode('edit')
    }
  }

  if (mode === 'edit') {
    return <InvoiceEditor date={date} invoiceId={editingId} onClose={closeEditor} onSaved={onSaved} />
  }
  return (
    <InvoiceList
      date={date}
      onOpen={openInvoice}
      onCreate={createNew}
      onDelete={deleteInvoice}
      onStornim={stornoInvoice}
      refreshKey={refreshKey}
    />
  )
}
