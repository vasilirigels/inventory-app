import { useState, useEffect, useRef } from 'react'
import MoneyInput from './MoneyInput.jsx'
import { showConfirm } from './ConfirmDialog.jsx'

const CURRENCIES = ['LEK', 'EUR', 'USD', 'GBP', 'CHF']

function n(v) { return parseFloat(v) || 0 }
function fmt(v) {
  return n(v).toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function emptyItem() {
  return {
    product_id: null, barcode: '', name: '',
    qty: 1, unit_price: 0, discount_percent: 0,
  }
}

function computeLine(it) {
  const qty   = n(it.qty)
  const price = n(it.unit_price)
  const disc  = n(it.discount_percent)
  const gross = qty * price
  const subtotal = gross * (1 - disc / 100)
  return { gross, subtotal }
}

function ProductPickerCell({ value, onPick }) {
  const [query, setQuery] = useState(value?.name || value?.barcode || '')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const timerRef = useRef(null)
  const boxRef = useRef(null)

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
        <div className="absolute z-20 left-0 right-0 mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg max-h-60 overflow-y-auto min-w-[280px]">
          {loading && <div className="p-2 text-[11px] text-slate-400 dark:text-slate-500">Duke kërkuar...</div>}
          {results.map(p => (
            <button
              key={p.id} type="button" onClick={() => pick(p)}
              className="w-full text-left px-3 py-1.5 hover:bg-blue-50 border-b border-slate-100 dark:border-slate-800 last:border-0"
            >
              <div className="text-xs font-medium text-slate-800 dark:text-slate-100 truncate">{p.name}</div>
              <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400">
                <span className="font-mono">{p.barcode || p.sku || '—'}</span>
                <span>kosto: {p.cost_price || '—'} · stok: {p.stock}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Picker that searches existing warehouses, shows the selected code, and offers
// to create a new one inline without leaving the magazina editor.
function WarehousePicker({ value, onChange }) {
  const [query, setQuery]     = useState(value || '')
  const [results, setResults] = useState([])
  const [open, setOpen]       = useState(false)
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newCode, setNewCode] = useState('')
  const [newName, setNewName] = useState('')
  const [createErr, setCreateErr] = useState('')
  const timerRef = useRef(null)
  const boxRef = useRef(null)

  useEffect(() => { setQuery(value || '') }, [value])

  useEffect(() => {
    function onDoc(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) {
        setOpen(false); setCreating(false); setCreateErr('')
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const search = (q) => {
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const data = await fetch(`/api/warehouses/search?q=${encodeURIComponent(q)}`).then(r => r.json())
        setResults(Array.isArray(data) ? data : [])
      } catch { setResults([]) }
      setLoading(false)
    }, 200)
  }

  const openDropdown = () => {
    setOpen(true); setCreating(false); setCreateErr('')
    if (results.length === 0) search('')
  }

  const pick = (w) => {
    onChange(w.code)
    setQuery(w.code)
    setOpen(false); setCreating(false)
  }

  const startCreate = () => {
    setCreating(true); setCreateErr('')
    setNewCode((query || '').trim().toUpperCase()); setNewName('')
  }

  const submitCreate = async (e) => {
    e?.preventDefault?.()
    const code = newCode.trim()
    if (!code) { setCreateErr('Kodi është i detyrueshëm.'); return }
    try {
      const res = await fetch('/api/warehouses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, name: newName.trim() }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setCreateErr(err.error || 'Gabim në ruajtje'); return
      }
      const r = await res.json()
      const w = r.warehouse || { code }
      pick(w)
    } catch (err) {
      setCreateErr(err.message || 'Gabim')
    }
  }

  return (
    <div ref={boxRef} className="relative">
      <input
        type="text" value={query}
        placeholder="Kërko ose zgjidh kod..."
        onChange={e => {
          const v = e.target.value.toUpperCase()
          setQuery(v); onChange(v); search(v); setOpen(true); setCreating(false)
        }}
        onFocus={openDropdown}
        className="input-field font-mono uppercase"
      />
      {open && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg max-h-72 overflow-y-auto">
          {creating ? (
            <form onSubmit={submitCreate} className="p-3 space-y-2">
              <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 uppercase">Magazinë e Re</div>
              <input
                type="text" value={newCode}
                onChange={e => setNewCode(e.target.value.toUpperCase())}
                className="input-field-sm font-mono uppercase w-full"
                placeholder="Kodi (p.sh. MAG-01)" autoFocus
              />
              <input
                type="text" value={newName}
                onChange={e => setNewName(e.target.value)}
                className="input-field-sm w-full"
                placeholder="Emri (opsional)"
              />
              {createErr && <div className="text-[11px] text-red-600">{createErr}</div>}
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setCreating(false)} className="btn-secondary text-xs flex-1">Anulo</button>
                <button type="submit" className="btn-primary text-xs flex-1">+ Krijo</button>
              </div>
            </form>
          ) : (
            <>
              {loading && <div className="p-2 text-xs text-slate-400 dark:text-slate-500">Duke kërkuar...</div>}
              {!loading && results.length === 0 && (
                <div className="p-3 text-xs text-slate-400 dark:text-slate-500">Nuk ka magazina të regjistruara.</div>
              )}
              {results.map(w => (
                <button
                  key={w.id} type="button" onClick={() => pick(w)}
                  className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-slate-100 dark:border-slate-800 last:border-0"
                >
                  <div className="text-sm font-mono font-bold text-slate-800 dark:text-slate-100">{w.code}</div>
                  {w.name && <div className="text-[11px] text-slate-500 dark:text-slate-400">{w.name}</div>}
                </button>
              ))}
              <button
                type="button" onClick={startCreate}
                className="w-full text-left px-3 py-2 bg-emerald-50 dark:bg-emerald-900/30 hover:bg-emerald-100 text-emerald-700 dark:text-emerald-300 text-xs font-semibold border-t border-slate-200 dark:border-slate-700"
              >+ Krijo magazinë të re{query ? ` "${query}"` : ''}</button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function MagazinaList({ kind, date, onOpen, onCreate, onDelete, refreshKey }) {
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [fromDate, setFromDate] = useState(date)
  const [toDate, setToDate]     = useState(date)

  useEffect(() => { setFromDate(date); setToDate(date) }, [date])

  useEffect(() => {
    if (!fromDate || !toDate) return
    setLoading(true)
    const url = fromDate === toDate
      ? `/api/magazina-${kind}/by-date/${fromDate}`
      : `/api/magazina-${kind}/by-range?from=${fromDate}&to=${toDate}`
    fetch(url)
      .then(r => r.json())
      .then(d => { setList(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => { setList([]); setLoading(false) })
  }, [kind, fromDate, toDate, refreshKey])

  const rangeActive = fromDate !== date || toDate !== date
  const title = kind === 'hyrje' ? 'Magazina — Fletë Hyrje' : 'Magazina — Fletë Dalje'
  const icon  = kind === 'hyrje' ? '⬇️' : '⬆️'
  const verb  = kind === 'hyrje' ? 'hyrjes' : 'daljes'

  const totals = list.reduce((acc, r) => {
    const rate = n(r.exchange_rate) || 1
    acc.count   += 1
    acc.qty     += n(r.total_qty)
    acc.totLek  += n(r.total) * rate
    return acc
  }, { count: 0, qty: 0, totLek: 0 })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">{icon} {title}</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {fromDate === toDate
              ? `Lista e fletëve të ${verb} për këtë datë`
              : `Lista e fletëve të ${verb} nga ${fromDate} në ${toDate}`}
          </p>
        </div>
        <button onClick={onCreate} className="btn-primary">+ Fletë e Re</button>
      </div>

      <div className="card flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">📅</span>
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Filtër data</span>
        </div>
        <div>
          <label className="form-label">Nga data</label>
          <input type="date" value={fromDate} max={toDate}
            onChange={e => setFromDate(e.target.value)} className="input-field" />
        </div>
        <div>
          <label className="form-label">Deri më datë</label>
          <input type="date" value={toDate} min={fromDate}
            onChange={e => setToDate(e.target.value)} className="input-field" />
        </div>
        {rangeActive && (
          <button onClick={() => { setFromDate(date); setToDate(date) }} className="btn-secondary text-xs">
            Pastro filtrin
          </button>
        )}
      </div>

      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-400 dark:text-slate-500 text-sm">Duke ngarkuar...</div>
        ) : list.length === 0 ? (
          <div className="p-10 text-center">
            <div className="text-5xl mb-3">{icon}</div>
            <p className="text-slate-500 dark:text-slate-400 mb-4">Nuk ka fletë magazine për këtë periudhë.</p>
            <button onClick={onCreate} className="btn-primary mx-auto">+ Krijo Fletën e Parë</button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Data</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Nr. Dokumenti</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Kod Magazine</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Monedha</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Kursi</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Artikuj</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Sasi Totale</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Totali</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Veprime</th>
              </tr>
            </thead>
            <tbody>
              {list.map(f => {
                const rate = n(f.exchange_rate) || 1
                const isForeign = (f.currency || 'LEK') !== 'LEK'
                return (
                  <tr key={f.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{f.date}</td>
                    <td className="px-4 py-3 font-mono text-xs">
                      <button onClick={() => onOpen(f.id)} className="text-blue-600 hover:underline font-semibold">
                        {f.ref_no}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-200 font-mono text-xs">{f.warehouse_code || '—'}</td>
                    <td className="px-4 py-3 text-center"><span className="badge bg-blue-100 text-blue-700 dark:text-blue-300">{f.currency}</span></td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600 dark:text-slate-300 text-xs">{n(rate).toFixed(4)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700 dark:text-slate-200">{f.item_count}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold text-slate-800 dark:text-slate-100">{n(f.total_qty).toLocaleString('sq-AL')}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-bold text-slate-900 dark:text-white">
                      {fmt(f.total)}
                      {isForeign && (
                        <div className="text-[10px] font-normal text-slate-500 dark:text-slate-400 italic">
                          = {fmt(n(f.total) * rate)} LEK
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1.5">
                        <button onClick={() => onOpen(f.id)} className="px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 text-blue-600 text-xs font-medium">Hap</button>
                        <button onClick={() => onDelete(f.id, f.ref_no)} className="px-2.5 py-1 rounded-lg bg-red-50 dark:bg-red-900/30 hover:bg-red-100 text-red-600 text-xs font-medium">Fshi</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="bg-blue-50 dark:bg-blue-900/30 border-t-2 border-blue-200">
              <tr>
                <td colSpan={5} className="px-4 py-3 text-xs font-bold text-blue-700 dark:text-blue-300 uppercase tracking-wide">
                  TOTALI (LEK) <span className="text-[10px] font-normal text-blue-600">— {totals.count} fletë</span>
                </td>
                <td></td>
                <td className="px-4 py-3 text-right tabular-nums font-extrabold text-slate-800 dark:text-slate-100">{n(totals.qty).toLocaleString('sq-AL')}</td>
                <td className="px-4 py-3 text-right tabular-nums font-extrabold text-blue-700 dark:text-blue-300 text-base">{fmt(totals.totLek)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  )
}

function MagazinaEditor({ kind, date, fleteId, onClose, onSaved }) {
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [fleteDate, setFleteDate] = useState(date)
  const [refNo, setRefNo]       = useState('')
  const [warehouseCode, setWarehouseCode] = useState('')
  const [currency, setCurrency] = useState('EUR')
  const [exchangeRate, setExchangeRate] = useState(1)
  const [rateSource, setRateSource]   = useState('')
  const [notes, setNotes]       = useState('')
  const [items, setItems]       = useState([emptyItem()])
  const [allRates, setAllRates] = useState({ LEK: 1 })

  useEffect(() => {
    let cancel = false
    async function init() {
      try {
        const ratesRes = await fetch(`/api/exchange-rates/${date}`).then(r => r.json())
        if (cancel) return
        setAllRates(ratesRes.rates || { LEK: 1 })
        setRateSource(ratesRes.source || '')
        if (fleteId) {
          const f = await fetch(`/api/magazina-${kind}/${fleteId}`).then(r => r.json())
          if (cancel) return
          setFleteDate(f.date || date)
          setRefNo(f.ref_no || '')
          setWarehouseCode(f.warehouse_code || '')
          setCurrency(f.currency || 'LEK')
          setExchangeRate(f.exchange_rate || 1)
          setNotes(f.notes || '')
          setItems((f.items && f.items.length > 0) ? f.items : [emptyItem()])
        } else {
          setFleteDate(date)
          const r = await fetch(`/api/magazina-${kind}/next-no?date=${date}`).then(r => r.json())
          if (cancel) return
          setRefNo(r.ref_no || '')
          setItems([emptyItem()])
        }
      } finally { if (!cancel) setLoading(false) }
    }
    init()
    return () => { cancel = true }
  }, [kind, date, fleteId])

  // Refresh rates and ref_no when date changes (for new fletë)
  useEffect(() => {
    if (loading || !fleteDate) return
    let cancel = false
    async function syncForDate() {
      try {
        const ratesRes = await fetch(`/api/exchange-rates/${fleteDate}`).then(r => r.json())
        if (cancel) return
        setAllRates(ratesRes.rates || { LEK: 1 })
        setRateSource(ratesRes.source || '')
        if (!fleteId) {
          const r = await fetch(`/api/magazina-${kind}/next-no?date=${fleteDate}`).then(r => r.json())
          if (cancel) return
          setRefNo(r.ref_no || '')
        }
      } catch { /* ignore */ }
    }
    syncForDate()
    return () => { cancel = true }
  }, [fleteDate])

  // Auto-fill exchange rate when currency changes
  useEffect(() => {
    if (allRates && allRates[currency] != null) setExchangeRate(allRates[currency])
  }, [currency, allRates])

  const setItem = (idx, patch) =>
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, ...patch } : it))
  const addItem = () => setItems(prev => [...prev, emptyItem()])
  const removeItem = (idx) =>
    setItems(prev => prev.length === 1 ? [emptyItem()] : prev.filter((_, i) => i !== idx))
  const pickProduct = (idx, p) => {
    setItem(idx, {
      product_id: p.id,
      barcode: p.barcode || '',
      name: p.name,
      unit_price: kind === 'hyrje' ? (p.cost_price || 0) : (p.sell_price || 0),
    })
  }

  const lineTotals = items.map(computeLine)
  const totals = lineTotals.reduce((acc, l) => ({
    sub: acc.sub + l.subtotal,
    qty: acc.qty,
  }), { sub: 0, qty: 0 })
  totals.qty = items.reduce((s, it) => s + n(it.qty), 0)

  const refreshRates = async () => {
    try {
      const res = await fetch(`/api/exchange-rates/${fleteDate}`).then(r => r.json())
      if (res.rates) {
        setAllRates(res.rates)
        setRateSource(res.source || '')
        if (res.rates[currency] != null) setExchangeRate(res.rates[currency])
      }
    } catch { /* ignore */ }
  }

  const save = async () => {
    if (saving) return
    const valid = items.filter(it => (it.name && it.name.trim()) || n(it.qty) > 0 || n(it.unit_price) > 0)
    if (valid.length === 0) { alert('Shtoni të paktën një artikull.'); return }
    setSaving(true)
    try {
      const payload = {
        date: fleteDate,
        warehouse_code: warehouseCode,
        ref_no: refNo,
        currency,
        exchange_rate: parseFloat(exchangeRate) || 1,
        notes,
        items: valid,
      }
      const url = fleteId ? `/api/magazina-${kind}/${fleteId}` : `/api/magazina-${kind}`
      const method = fleteId ? 'PUT' : 'POST'
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
    return <div className="card p-8 text-center text-slate-400 dark:text-slate-500">Duke ngarkuar...</div>
  }

  const title = kind === 'hyrje' ? 'Fletë Hyrje Magazine' : 'Fletë Dalje Magazine'
  const icon  = kind === 'hyrje' ? '⬇️' : '⬆️'
  const stockEffect = kind === 'hyrje'
    ? 'Stoku do të rritet me sasitë e mëposhtme.'
    : 'Stoku do të zbritet me sasitë e mëposhtme.'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="btn-secondary">← Mbrapa</button>
          <div>
            <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">
              {icon} {fleteId ? `Edito ${title}` : `${title} e Re`}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">Nr. {refNo}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="btn-secondary">Anulo</button>
          <button onClick={save} disabled={saving} className="btn-primary disabled:opacity-50">
            {saving ? '⏳ Duke ruajtur...' : '💾 Ruaj Fletën'}
          </button>
        </div>
      </div>

      <div className="card grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <label className="form-label">Nr. Dokumenti <span className="text-[10px] text-slate-400 dark:text-slate-500">(auto)</span></label>
          <input type="text" value={refNo} readOnly className="input-field font-mono bg-slate-50 dark:bg-slate-900 cursor-not-allowed" />
        </div>
        <div>
          <label className="form-label">Datë</label>
          <input type="date" value={fleteDate} onChange={e => setFleteDate(e.target.value)} className="input-field" />
        </div>
        <div>
          <label className="form-label">Kod Magazine</label>
          <WarehousePicker value={warehouseCode} onChange={setWarehouseCode} />
        </div>
        <div>
          <label className="form-label">Monedha</label>
          <select value={currency} onChange={e => setCurrency(e.target.value)} className="input-field">
            {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="form-label">
            Kursi i Këmbimit
            <span className="ml-1 text-[10px] text-slate-400 dark:text-slate-500">(1 {currency} = ? LEK)</span>
          </label>
          <div className="flex gap-1">
            <input type="number" step="0.0001" min="0"
              value={exchangeRate} onChange={e => setExchangeRate(e.target.value)}
              disabled={currency === 'LEK'} className="input-field flex-1 disabled:bg-slate-50" />
            <button onClick={refreshRates} title="Rifresko kursin"
              className="px-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs">↻</button>
          </div>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">Burimi: <span className="font-medium">{rateSource || '—'}</span></p>
        </div>
        <div className="col-span-2 md:col-span-3">
          <label className="form-label">Shënime</label>
          <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
            className="input-field" placeholder="opsional" />
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-2 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300">
          ℹ️ {stockEffect} <span className="text-slate-400 dark:text-slate-500">— pa TVSH</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
              <tr className="text-slate-500 dark:text-slate-400">
                <th className="px-2 py-2 text-left font-semibold w-8">#</th>
                <th className="px-2 py-2 text-left font-semibold w-64">Produkti (barkod ose emër)</th>
                <th className="px-2 py-2 text-left font-semibold w-32">Barkodi</th>
                <th className="px-2 py-2 text-right font-semibold w-16">Sasia</th>
                <th className="px-2 py-2 text-right font-semibold w-28">Çm. njësi ({currency})</th>
                <th className="px-2 py-2 text-right font-semibold w-16">Zbritje %</th>
                <th className="px-2 py-2 text-right font-semibold w-28">Vlera ({currency})</th>
                <th className="px-2 py-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => {
                const lt = lineTotals[idx]
                return (
                  <tr key={idx} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="px-2 py-1 text-center text-slate-400 dark:text-slate-500">{idx + 1}</td>
                    <td className="px-1 py-1">
                      <ProductPickerCell value={it} onPick={p => pickProduct(idx, p)} />
                    </td>
                    <td className="px-1 py-1">
                      <input type="text" value={it.barcode} readOnly
                        className="input-field-sm font-mono bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-300" placeholder="—" />
                    </td>
                    <td className="px-1 py-1">
                      <input type="number" step="any" value={it.qty}
                        onChange={e => setItem(idx, { qty: e.target.value })}
                        className="input-field-sm text-right" />
                    </td>
                    <td className="px-1 py-1">
                      <MoneyInput value={it.unit_price}
                        onChange={v => setItem(idx, { unit_price: v })}
                        className="input-field-sm text-right" />
                    </td>
                    <td className="px-1 py-1">
                      <input type="number" step="0.01" min="0" max="100" value={it.discount_percent}
                        onChange={e => setItem(idx, { discount_percent: e.target.value })}
                        className="input-field-sm text-right" />
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums font-semibold text-slate-900 dark:text-white">{fmt(lt.subtotal)}</td>
                    <td className="px-1 py-1 text-center">
                      <button onClick={() => removeItem(idx)} className="text-red-500 hover:text-red-700 text-sm" title="Hiq">✕</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="bg-blue-50 dark:bg-blue-900/30 border-t-2 border-blue-200">
              <tr className="font-bold text-xs">
                <td colSpan={3} className="px-2 py-2 text-right text-slate-600 dark:text-slate-300">
                  TOTALI ({currency}) — {items.filter(it => (it.name && it.name.trim()) || n(it.qty) > 0).length} artikuj
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-blue-700 dark:text-blue-300">{n(totals.qty).toLocaleString('sq-AL')}</td>
                <td colSpan={2}></td>
                <td className="px-2 py-2 text-right tabular-nums text-blue-700 dark:text-blue-300 text-sm">{fmt(totals.sub)}</td>
                <td></td>
              </tr>
              {currency !== 'LEK' && (
                <tr className="text-[11px] bg-blue-100/60 border-t border-blue-200">
                  <td colSpan={6} className="px-2 py-1.5 text-right text-slate-600 dark:text-slate-300 italic">
                    Në LEK <span className="text-slate-400 dark:text-slate-500">(1 {currency} = {n(exchangeRate)} LEK)</span>:
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-bold text-blue-800 dark:text-blue-200">{fmt(totals.sub * n(exchangeRate))} LEK</td>
                  <td></td>
                </tr>
              )}
            </tfoot>
          </table>
        </div>
        <div className="p-3 border-t border-slate-100 dark:border-slate-800">
          <button onClick={addItem} className="btn-secondary text-xs">+ Shto Artikull</button>
        </div>
      </div>
    </div>
  )
}

export default function Magazina({ kind, date }) {
  const [mode, setMode] = useState('list')
  const [editingId, setEditingId] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)

  // Reset to list when kind changes (switching between hyrje/dalje)
  useEffect(() => { setMode('list'); setEditingId(null) }, [kind])

  const openFlete = (id) => { setEditingId(id); setMode('edit') }
  const createNew = ()   => { setEditingId(null); setMode('edit') }
  const backToList = ()  => { setEditingId(null); setMode('list') }
  const onSaved = ()     => { setRefreshKey(k => k + 1); backToList() }

  const deleteFlete = async (id, ref) => {
    const verb = kind === 'hyrje' ? 'rritur' : 'zbritur'
    if (!(await showConfirm(`Fshi fletën ${ref}? Stoku që ishte ${verb} do të kthehet.`, {
      title: 'Fshi fletën', confirmLabel: 'Fshi', danger: true,
    }))) return
    await fetch(`/api/magazina-${kind}/${id}`, { method: 'DELETE' })
    setRefreshKey(k => k + 1)
  }

  if (mode === 'edit') {
    return <MagazinaEditor kind={kind} date={date} fleteId={editingId} onClose={backToList} onSaved={onSaved} />
  }
  return (
    <MagazinaList kind={kind} date={date}
      onOpen={openFlete} onCreate={createNew} onDelete={deleteFlete} refreshKey={refreshKey} />
  )
}
