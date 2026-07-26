import { useState, useEffect, useCallback, useRef } from 'react'
import DateRangeFilter from './DateRangeFilter.jsx'
import MoneyInput from './MoneyInput.jsx'

// Zgjedhës produkti — I NJËJTI stil me ProductPickerCell të Fatura Shitje:
// input i vetëm me emrin e produktit; kur shkruan, hapet dropdown me rezultate
// (barkod, çmim, promo, stok). Kur zgjidhet, emri qëndron te input-i dhe
// mund të rishkruash për ta ndryshuar.
function MarketingProductPicker({ product, onPick, className = 'input-field-sm' }) {
  const [query, setQuery] = useState(product?.name || '')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const timerRef = useRef(null)
  const boxRef = useRef(null)

  useEffect(() => { setQuery(product?.name || '') }, [product?.name])

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
        type="text"
        value={query}
        placeholder="barkod ose emër..."
        onChange={e => { setQuery(e.target.value); search(e.target.value); setOpen(true) }}
        onFocus={() => query && setOpen(true)}
        onKeyDown={e => {
          if (e.key === 'Enter' && results.length > 0) { e.preventDefault(); pick(results[0]) }
        }}
        className={className}
      />
      {open && (results.length > 0 || loading) && (
        <div className="absolute z-20 left-0 right-0 mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg max-h-60 overflow-y-auto min-w-[280px]">
          {loading && <div className="p-2 text-[11px] text-slate-400 dark:text-slate-500">Duke kërkuar...</div>}
          {results.map(p => {
            const basePrice = parseFloat(p.sell_price) || 0
            const onPromo = !!p.is_promotion && (parseFloat(p.promo_discount_pct) || 0) > 0
            const promoPrice = onPromo ? basePrice * (1 - parseFloat(p.promo_discount_pct) / 100) : basePrice
            return (
              <button
                key={p.id} type="button" onClick={() => pick(p)}
                className={`w-full text-left px-3 py-1.5 border-b border-slate-100 dark:border-slate-800 last:border-0 ${onPromo ? 'hover:bg-rose-50 bg-rose-50/30' : 'hover:bg-blue-50'}`}
              >
                <div className="text-xs font-medium text-slate-800 dark:text-slate-100 truncate flex items-center gap-1">
                  {p.name}
                  {onPromo && <span className="text-[9px] bg-rose-100 text-rose-700 px-1 rounded font-semibold">🏷️ -{p.promo_discount_pct}%</span>}
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400">
                  <span className="font-mono">{p.barcode || p.sku || '—'}</span>
                  <span>
                    {basePrice > 0 && (
                      onPromo
                        ? <><span className="line-through text-slate-400 dark:text-slate-500 mr-1">€{basePrice.toFixed(2)}</span><span className="text-rose-700 font-bold">€{promoPrice.toFixed(2)}</span></>
                        : `€${basePrice}`
                    )}
                    {' · '}stok: {p.stock}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Zgjedhës i zërit të marketingut me krijim/editim/fshirje inline.
// - `➕ Krijo zër të ri` → kthen picker-in në modalitet krijimi
// - ✏️ pranë select-it → riemërto zërin ekzistues (kur është zgjedhur)
// - ✕ pranë select-it → fshi zërin ekzistues (me konfirmim)
function MarketingCategoryPicker({
  value, onChange, categories, onCreated, onUpdated, onDeleted,
  disabled, className = 'input-field',
}) {
  const [mode, setMode] = useState('view') // 'view' | 'create' | 'edit'
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  const selectedId = value ? parseInt(value) : null
  const selected = categories.find(c => c.id === selectedId)

  const onSelectChange = (e) => {
    const v = e.target.value
    if (v === '__new__') { setMode('create'); setName('') }
    else onChange(v)
  }

  const startEdit = () => {
    if (!selected) return
    setMode('edit'); setName(selected.name)
  }

  const saveCreate = async () => {
    const trimmed = name.trim()
    if (!trimmed || saving) return
    setSaving(true)
    try {
      const res = await fetch('/api/marketing-categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, description: '', active: 1 }),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e.error || 'Gabim'); return }
      const created = await res.json()
      if (created?.id) await onCreated?.(created.id)
      setMode('view'); setName('')
    } finally { setSaving(false) }
  }

  const saveEdit = async () => {
    const trimmed = name.trim()
    if (!trimmed || saving || !selected) return
    setSaving(true)
    try {
      const res = await fetch(`/api/marketing-categories/${selected.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, description: selected.description || '', active: 1 }),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e.error || 'Gabim'); return }
      await onUpdated?.()
      setMode('view'); setName('')
    } finally { setSaving(false) }
  }

  const doDelete = async () => {
    if (!selected) return
    if (!confirm(`Fshi zërin "${selected.name}"?\nShpenzimet ekzistuese mbeten, por pa zër të lidhur.`)) return
    setSaving(true)
    try {
      const res = await fetch(`/api/marketing-categories/${selected.id}`, { method: 'DELETE' })
      if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e.error || 'Gabim'); return }
      onChange('')
      await onDeleted?.()
    } finally { setSaving(false) }
  }

  if (mode === 'create' || mode === 'edit') {
    const submit = mode === 'edit' ? saveEdit : saveCreate
    return (
      <div className="flex gap-1">
        <input
          type="text" autoFocus value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); submit() }
            else if (e.key === 'Escape') { e.preventDefault(); setMode('view'); setName('') }
          }}
          className={`${className} flex-1`}
          placeholder={mode === 'edit' ? 'Riemërto zërin...' : 'Emri i zërit të ri (p.sh. Facebook Ads)...'}
        />
        <button type="button" onClick={submit} disabled={saving || !name.trim()}
          className="px-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 hover:bg-emerald-100 text-emerald-700 dark:text-emerald-300 text-sm font-semibold disabled:opacity-50"
          title="Ruaj zërin">✓</button>
        <button type="button" onClick={() => { setMode('view'); setName('') }}
          className="px-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-sm"
          title="Anulo">✕</button>
      </div>
    )
  }

  return (
    <div className="flex gap-1">
      <select value={value || ''} onChange={onSelectChange} disabled={disabled} className={`${className} flex-1`}>
        <option value="">— zgjidh —</option>
        {categories.map(c => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
        <option value="__new__">➕ Krijo zër të ri...</option>
      </select>
      {selected && (
        <>
          <button type="button" onClick={startEdit} disabled={disabled || saving}
            className="px-2 rounded-lg bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 text-blue-700 dark:text-blue-300 text-sm font-semibold disabled:opacity-50"
            title={`Riemërto "${selected.name}"`}>✏️</button>
          <button type="button" onClick={doDelete} disabled={disabled || saving}
            className="px-2 rounded-lg bg-red-50 dark:bg-red-900/30 hover:bg-red-100 text-red-600 dark:text-red-300 text-sm font-semibold disabled:opacity-50"
            title={`Fshi "${selected.name}"`}>✕</button>
        </>
      )}
    </div>
  )
}

const CURRENCIES = ['LEK', 'EUR', 'USD', 'GBP', 'CHF']
// Për filtër-in e historikut duhen të gjitha monedhat (regjistrimet e vjetra
// mund të jenë në LEK/USD etj.), por për krijim të ri e editim lejohen vetëm
// EUR (monedha bazë e biznesit) dhe PRODUKT (marketing "in kind" nga inventari).
const CURRENCY_OPTIONS = ['EUR', 'PRODUKT']

function fmtDate(d) {
  if (!d) return ''
  return d.split('-').reverse().join('.')
}

function n(v) { return parseFloat(v) || 0 }
function fmt(v) {
  const x = n(v)
  if (x === 0) return '—'
  return x.toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function emptyDraft() {
  return {
    category_id: '', description: '', currency: 'EUR', amount: '', exchange_rate: '1',
    // Për modalitetin PRODUKT: e njëjta logjikë si rreshti i Fatura Shitje.
    // - product_qty: sasia që hiqet nga stoku
    // - unit_price: sell_price me promo (EUR/copë) — snapshot i marrë kur zgjidhet produkti
    // - discount_percent, vat_rate: si te FaturaShitje.computeLine
    product: null, product_qty: '1',
    unit_price: '', discount_percent: '0', vat_rate: '',
  }
}

// I njëjti computeLine me FaturaShitje: totali = qty × unit_price × (1 - disc%/100) × (1 + vat%/100)
function computeProductLine({ qty, unit_price, discount_percent, vat_rate }) {
  const q = parseFloat(qty) || 0
  const p = parseFloat(unit_price) || 0
  const d = parseFloat(discount_percent) || 0
  const v = parseFloat(vat_rate) || 0
  const gross = q * p
  const subtotal = gross * (1 - d / 100)
  const vat_amount = subtotal * (v / 100)
  const total_with_vat = subtotal + vat_amount
  return { gross, subtotal, vat_amount, total_with_vat }
}

// I njëjti me FaturaShitje.pickProduct: kur zgjidhet produkti, plotëso unit_price
// (sell_price me promo të aplikuar) dhe vat_rate.
function snapshotFromProduct(p) {
  const basePrice = parseFloat(p?.sell_price) || 0
  const onPromo = !!p?.is_promotion && (parseFloat(p?.promo_discount_pct) || 0) > 0
  const effectivePrice = onPromo ? basePrice * (1 - parseFloat(p.promo_discount_pct) / 100) : basePrice
  return {
    unit_price: String(effectivePrice || ''),
    vat_rate: String(p?.vat_rate != null ? p.vat_rate : ''),
  }
}

export default function Marketing({ date }) {
  const [categories, setCategories] = useState([])
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState(emptyDraft())
  const [filterCur, setFilterCur] = useState('all')
  const [rates, setRates] = useState({ LEK: 1 })
  const [rateSource, setRateSource] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState(null)
  const [dateRange, setDateRange] = useState({ from: '', to: '' })

  const rangeActive = !!(dateRange.from || dateRange.to)
  const showDateCol = rangeActive && dateRange.from !== dateRange.to

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const entriesUrl = rangeActive
        ? `/api/reports/marketing?from=${dateRange.from || '2000-01-01'}&to=${dateRange.to || date}`
        : `/api/marketing-entries/${date}`
      const [cats, entries, ratesRes] = await Promise.all([
        fetch('/api/marketing-categories').then(r => r.json()),
        fetch(entriesUrl).then(r => r.json()),
        fetch(`/api/exchange-rates/${date}`).then(r => r.json()).catch(() => ({})),
      ])
      setCategories(Array.isArray(cats) ? cats : [])
      setRows(Array.isArray(entries?.rows) ? entries.rows : [])
      const r = ratesRes?.rates || { LEK: 1 }
      setRates(r)
      setRateSource(ratesRes?.source || '')
      setDraft(d => {
        if (d.currency === 'LEK') return d
        const autoRate = r[d.currency]
        if (autoRate && (d.exchange_rate === '' || d.exchange_rate === '1')) {
          return { ...d, exchange_rate: String(autoRate) }
        }
        return d
      })
    } catch (e) {
      console.error(e)
      setCategories([]); setRows([])
    } finally {
      setLoading(false)
    }
  }, [date, rangeActive, dateRange.from, dateRange.to])

  useEffect(() => { load() }, [load])

  const addEntry = async () => {
    if (!draft.category_id) { alert('Zgjidh një zër marketingu.'); return }
    const cur = draft.currency || 'LEK'
    const isProduct = cur === 'PRODUKT'
    if (isProduct) {
      if (!draft.product?.id) { alert('Zgjidh një produkt nga inventari.'); return }
      const qty = parseInt(draft.product_qty) || 1
      if (qty <= 0) { alert('Sasia duhet të jetë të paktën 1.'); return }
      if ((draft.product.stock || 0) < qty) {
        alert(`Stoku nuk mjafton (aktual: ${draft.product.stock || 0}).`); return
      }
    } else {
      if (!n(draft.amount)) { alert('Vendos vlerën.'); return }
      const rate = cur === 'LEK' ? 1 : n(draft.exchange_rate)
      if (cur !== 'LEK' && rate <= 0) { alert(`Vendos kursin për 1 ${cur} (në LEK).`); return }
    }
    setSaving(true)
    try {
      const productLine = isProduct ? computeProductLine({
        qty: draft.product_qty, unit_price: draft.unit_price,
        discount_percent: draft.discount_percent, vat_rate: draft.vat_rate,
      }) : null
      const body = isProduct
        ? {
            date,
            category_id: parseInt(draft.category_id) || null,
            description: draft.description,
            product_id: draft.product.id,
            product_qty: parseInt(draft.product_qty) || 1,
            // Amount i llogaritur si te FaturaShitje (unit_price × qty × (1-disc%) × (1+vat%))
            amount: +productLine.total_with_vat.toFixed(2),
            unit_price: parseFloat(draft.unit_price) || 0,
            discount_percent: parseFloat(draft.discount_percent) || 0,
            vat_rate: parseFloat(draft.vat_rate) || 0,
            exchange_rate: n(rates.EUR) || 1,
          }
        : {
            date,
            category_id: parseInt(draft.category_id) || null,
            description: draft.description,
            currency: cur,
            amount: n(draft.amount),
            exchange_rate: cur === 'LEK' ? 1 : n(draft.exchange_rate),
          }
      const res = await fetch('/api/marketing-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e.error || 'Gabim'); return }
      // Ruaj monedhën aktuale për shtimin pasues (produkt vs. cash).
      setDraft({ ...emptyDraft(), currency: cur, exchange_rate: isProduct ? '1' : String(n(draft.exchange_rate) || 1) })
      load()
    } finally { setSaving(false) }
  }

  const startEdit = (row) => {
    setEditingId(row.id)
    const isProductRow = !!row.product_id
    const prod = isProductRow ? {
      id: row.product_id,
      name: row.product_name || '(produkt i fshirë)',
      barcode: row.product_barcode || '',
      cost_price: row.product_cost_price || 0,
      sell_price: row.product_sell_price || 0,
      vat_rate: row.product_vat_rate || 0,
      gram: row.product_gram || 0,
      serial_no: row.product_serial_no || '',
      // Stok i disponueshëm për validim = stok aktual + sasia ekzistuese (që
      // do të rikthehet nëse ndryshohet).
      stock: (row.product_stock || 0) + (row.product_qty || 0),
    } : null
    // Ri-llogarit unit_price që Çmimi final të japë vlerën e ruajtur:
    // amount = qty × unit_price × (1 - disc%/100) × (1 + vat%/100)
    // Pasi zbritja/TVSH nuk ruhen aktualisht si kolona të veçanta, ne fillojmë
    // me disc=0, vat=produkti, dhe kalibrojmë unit_price prapa nga amount.
    const qty = row.product_qty || 1
    const savedAmount = parseFloat(row.amount) || 0
    const vatDefault = prod?.vat_rate || 0
    const derivedUnitPrice = qty > 0 && vatDefault >= 0
      ? savedAmount / (qty * (1 + vatDefault / 100))
      : 0
    setEditDraft({
      date: row.date || date,
      category_id: row.category_id || '',
      description: row.description || '',
      currency: isProductRow ? 'PRODUKT' : (row.currency || 'LEK'),
      amount: row.amount != null ? String(row.amount) : '',
      exchange_rate: row.exchange_rate != null ? String(row.exchange_rate) : '1',
      product: prod,
      product_qty: String(qty),
      unit_price: isProductRow ? String(+derivedUnitPrice.toFixed(4)) : '',
      discount_percent: '0',
      vat_rate: isProductRow ? String(vatDefault) : '',
    })
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditDraft(null)
  }

  const saveEdit = async () => {
    if (!editDraft || editingId == null) return
    const cur = editDraft.currency || 'LEK'
    const isProduct = cur === 'PRODUKT'
    if (isProduct) {
      if (!editDraft.product?.id) { alert('Zgjidh një produkt nga inventari.'); return }
      const qty = parseInt(editDraft.product_qty) || 1
      if (qty <= 0) { alert('Sasia duhet të jetë të paktën 1.'); return }
      if ((editDraft.product.stock || 0) < qty) {
        alert(`Stoku nuk mjafton (i disponueshëm: ${editDraft.product.stock || 0}).`); return
      }
    } else {
      const rate = cur === 'LEK' ? 1 : n(editDraft.exchange_rate)
      if (cur !== 'LEK' && rate <= 0) { alert(`Vendos kursin për 1 ${cur} (në LEK).`); return }
      if (!n(editDraft.amount)) { alert('Vendos vlerën.'); return }
    }
    const eLine = isProduct ? computeProductLine({
      qty: editDraft.product_qty, unit_price: editDraft.unit_price,
      discount_percent: editDraft.discount_percent, vat_rate: editDraft.vat_rate,
    }) : null
    const body = isProduct
      ? {
          date: editDraft.date || date,
          category_id: parseInt(editDraft.category_id) || null,
          description: editDraft.description || '',
          product_id: editDraft.product.id,
          product_qty: parseInt(editDraft.product_qty) || 1,
          amount: +eLine.total_with_vat.toFixed(2),
          unit_price: parseFloat(editDraft.unit_price) || 0,
          discount_percent: parseFloat(editDraft.discount_percent) || 0,
          vat_rate: parseFloat(editDraft.vat_rate) || 0,
          exchange_rate: n(rates.EUR) || 1,
        }
      : {
          date: editDraft.date || date,
          category_id: parseInt(editDraft.category_id) || null,
          description: editDraft.description || '',
          currency: cur,
          amount: n(editDraft.amount),
          exchange_rate: cur === 'LEK' ? 1 : n(editDraft.exchange_rate),
        }
    const res = await fetch(`/api/marketing-entries/${editingId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e.error || 'Gabim'); return }
    cancelEdit()
    load()
  }

  const removeEntry = async (id) => {
    if (!confirm('Fshi këtë zë marketingu?')) return
    await fetch(`/api/marketing-entries/${id}`, { method: 'DELETE' })
    if (editingId === id) cancelEdit()
    load()
  }

  const categoryName = (id) => {
    const c = categories.find(c => c.id === id)
    return c?.name || ''
  }

  const visibleRows = filterCur === 'all' ? rows : rows.filter(r => (r.currency || 'LEK') === filterCur)

  const eurRateToday = n(rates.EUR) || 1
  // Konvertim uniform në EUR: amount × rate (→ LEK) ÷ kursi EUR i datës aktuale.
  // Për regjistrimet në EUR, kjo thjeshtohet në amount.
  const toEur = (r) => {
    const cur = r.currency || 'LEK'
    if (cur === 'EUR') return n(r.amount)
    if (cur === 'LEK') return n(r.amount) / eurRateToday
    return n(r.amount) * n(r.exchange_rate || 1) / eurRateToday
  }
  const totals = visibleRows.reduce((a, r) => {
    const cur = r.currency || 'LEK'
    a.by_currency[cur] = (a.by_currency[cur] || 0) + n(r.amount)
    a.total_eur += toEur(r)
    return a
  }, { by_currency: {}, total_eur: 0 })

  const totalsList = Object.entries(totals.by_currency).filter(([, v]) => Math.abs(v) > 0.005)

  if (loading && rows.length === 0) return <div className="card p-8 text-center text-slate-400 dark:text-slate-500">Duke ngarkuar...</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">Fleta e Marketingut</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Kursi për monedhat e huaja merret automatikisht nga kursi zyrtar i datës
            {rateSource && <span className="ml-1 text-slate-400 dark:text-slate-500">(burimi: <span className="font-medium">{rateSource}</span>)</span>}.
            Mund të mbishkruhet dorazi nëse duhet.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="form-label">Filtër Monedha</label>
            <select
              value={filterCur}
              onChange={e => setFilterCur(e.target.value)}
              className="input-field w-36"
            >
              <option value="all">Të gjitha</option>
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* New entry row */}
      <div className="card">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3">+ Shto Shpenzim Marketingu</h3>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 items-end">
          <div className="md:col-span-2">
            <label className="form-label">Zëri</label>
            <MarketingCategoryPicker
              value={draft.category_id}
              onChange={v => setDraft(d => ({ ...d, category_id: v }))}
              categories={categories}
              onCreated={async (newId) => {
                await load()
                setDraft(d => ({ ...d, category_id: String(newId) }))
              }}
              onUpdated={load}
              onDeleted={() => { setDraft(d => ({ ...d, category_id: '' })); return load() }}
            />
          </div>
          <div className="md:col-span-2">
            <label className="form-label">Përshkrimi</label>
            <input
              type="text" value={draft.description}
              onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
              className="input-field" placeholder="opsional"
            />
          </div>
          <div>
            <label className="form-label">Monedha</label>
            <select
              value={draft.currency}
              onChange={e => {
                const newCur = e.target.value
                setDraft(d => {
                  if (newCur === 'PRODUKT') {
                    return { ...d, currency: newCur, amount: '', exchange_rate: '1' }
                  }
                  if (newCur === 'LEK') return { ...d, currency: newCur, exchange_rate: '1', product: null }
                  const autoRate = rates[newCur]
                  return {
                    ...d,
                    currency: newCur,
                    exchange_rate: autoRate ? String(autoRate) : '',
                    product: null,
                  }
                })
              }}
              className="input-field"
            >
              {CURRENCY_OPTIONS.map(c => (
                <option key={c} value={c}>{c === 'PRODUKT' ? '🎁 PRODUKT (nga inventari)' : c}</option>
              ))}
            </select>
          </div>
          {draft.currency !== 'PRODUKT' && (
            <div>
              <label className="form-label">Vlera ({draft.currency})</label>
              <MoneyInput
                value={draft.amount}
                onChange={v => setDraft(d => ({ ...d, amount: String(v) }))}
                className="input-field text-right tabular-nums"
              />
            </div>
          )}
          {draft.currency === 'PRODUKT' && (() => {
            const p = draft.product
            const gram   = p ? Number(p.gram || 0) : 0
            const serial = p?.serial_no || ''
            const line = computeProductLine({
              qty: draft.product_qty,
              unit_price: draft.unit_price,
              discount_percent: draft.discount_percent,
              vat_rate: draft.vat_rate,
            })
            const qtyNum = parseInt(draft.product_qty) || 1
            const base = (parseFloat(draft.unit_price) || 0) * qtyNum
            const discEur = base * ((parseFloat(draft.discount_percent) || 0) / 100)
            return (
              <div className="md:col-span-6 border-2 border-blue-200 dark:border-blue-800 rounded-xl p-3 bg-blue-50/40 dark:bg-blue-900/20 overflow-x-auto">
                <div className="text-xs font-semibold text-blue-800 dark:text-blue-200 mb-2 flex items-center gap-1">
                  🎁 Produkti nga inventari {p && <span className="ml-2 text-[10px] font-normal text-slate-500 dark:text-slate-400">Stok aktual: <span className={`font-semibold ${qtyNum > (p.stock || 0) ? 'text-rose-600' : ''}`}>{p.stock || 0}</span></span>}
                </div>
                <table className="w-full text-xs">
                  <thead className="text-slate-600 dark:text-slate-400 uppercase text-[10px] font-semibold">
                    <tr className="border-b border-blue-200 dark:border-blue-800">
                      <th className="px-2 py-1 text-left">Produkti (barkod ose emër)</th>
                      <th className="px-2 py-1 text-left w-24">Nr Serie</th>
                      <th className="px-2 py-1 text-left w-28">Barkodi</th>
                      <th className="px-2 py-1 text-right w-16">Sasia</th>
                      <th className="px-2 py-1 text-right w-20">Gramatura</th>
                      <th className="px-2 py-1 text-right w-24">Çmimi €</th>
                      <th className="px-2 py-1 text-right w-24">Zbritje €</th>
                      <th className="px-2 py-1 text-right w-16">Zbritje %</th>
                      <th className="px-2 py-1 text-right w-14">TVSH %</th>
                      <th className="px-2 py-1 text-right w-24">Çmimi final</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="px-1 py-1 min-w-[220px]">
                        <MarketingProductPicker
                          product={p}
                          onPick={pp => setDraft(d => ({
                            ...d, product: pp, ...snapshotFromProduct(pp),
                          }))}
                        />
                      </td>
                      <td className="px-1 py-1">
                        <input type="text" value={serial} readOnly
                          className="input-field-sm font-mono bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-300"
                          placeholder="—" />
                      </td>
                      <td className="px-1 py-1">
                        <input type="text" value={p?.barcode || ''} readOnly
                          className="input-field-sm font-mono bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-300"
                          placeholder="—" />
                      </td>
                      <td className="px-1 py-1">
                        <input type="number" min="1" step="1"
                          value={draft.product_qty}
                          onChange={e => setDraft(d => ({ ...d, product_qty: e.target.value }))}
                          className="input-field-sm text-right tabular-nums" />
                      </td>
                      <td className="px-1 py-1">
                        <input type="text" value={gram ? gram.toFixed(3) : ''} readOnly
                          className="input-field-sm text-right tabular-nums bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-300"
                          placeholder="—" />
                      </td>
                      <td className="px-1 py-1">
                        <MoneyInput
                          value={draft.unit_price}
                          onChange={v => setDraft(d => ({ ...d, unit_price: String(v) }))}
                          className="input-field-sm text-right tabular-nums"
                          placeholder="0.00"
                        />
                      </td>
                      <td className="px-1 py-1">
                        <MoneyInput
                          value={discEur}
                          onChange={eur => {
                            if (base <= 0) { setDraft(d => ({ ...d, discount_percent: '0' })); return }
                            const pct = Math.max(0, Math.min(100, (parseFloat(eur) || 0) / base * 100))
                            setDraft(d => ({ ...d, discount_percent: String(+pct.toFixed(4)) }))
                          }}
                          className="input-field-sm text-right tabular-nums"
                          placeholder="0.00"
                        />
                      </td>
                      <td className="px-1 py-1">
                        <input type="number" step="0.01" min="0" max="100"
                          value={draft.discount_percent}
                          onChange={e => setDraft(d => ({ ...d, discount_percent: e.target.value }))}
                          className="input-field-sm text-right tabular-nums" />
                      </td>
                      <td className="px-1 py-1">
                        <input type="number" step="0.01" min="0" max="100"
                          value={draft.vat_rate}
                          onChange={e => setDraft(d => ({ ...d, vat_rate: e.target.value }))}
                          className="input-field-sm text-right tabular-nums"
                          placeholder="0" />
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums font-semibold text-blue-700 dark:text-blue-300">
                        €{line.total_with_vat.toFixed(2)}
                      </td>
                    </tr>
                  </tbody>
                </table>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-2">
                  Produkti do të hiqet nga stoku dhe do të regjistrohet si shpenzim marketingu me vlerë = "Çmimi final" (EUR). Nuk hyn te xhiro ditore.
                </p>
              </div>
            )
          })()}
          <div className="md:col-span-6 flex items-center justify-between">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {draft.currency === 'PRODUKT' ? (
                <>Total EUR (Çmimi final): <span className="font-bold text-blue-700 dark:text-blue-300 tabular-nums">
                  {draft.product
                    ? `€${computeProductLine({
                        qty: draft.product_qty, unit_price: draft.unit_price,
                        discount_percent: draft.discount_percent, vat_rate: draft.vat_rate,
                      }).total_with_vat.toFixed(2)}`
                    : '—'}
                </span></>
              ) : (
                <>Total EUR: <span className="font-bold text-blue-700 dark:text-blue-300 tabular-nums">
                  €{n(draft.amount).toFixed(2)}
                </span></>
              )}
            </p>
            <button
              onClick={addEntry}
              disabled={saving || categories.length === 0}
              className="btn-primary disabled:opacity-50"
            >
              {saving ? '⏳ Duke ruajtur...' : '+ Shto'}
            </button>
          </div>
        </div>
      </div>

      {/* Filtër Periudhe */}
      <DateRangeFilter
        from={dateRange.from}
        to={dateRange.to}
        onChange={setDateRange}
        loading={loading}
        emptyForAll
        compact
        hint={rangeActive
          ? 'Shpenzimet e marketingut për periudhën e zgjedhur'
          : `Vetëm data ${date} · zgjidh periudhë për historik më të gjerë`}
      />

      {/* Existing entries */}
      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Shpenzimet e Marketingut</h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              {rangeActive
                ? 'Kliko ✏️ për të edituar. Data mbetet ajo origjinale e regjistrimit.'
                : 'Kliko ✏️ për të edituar një zë. Ndryshimet ruhen kur klikon ✓.'}
            </p>
          </div>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {visibleRows.length} {visibleRows.length === 1 ? 'rresht' : 'rreshta'}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
              <tr>
                {showDateCol && (
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase w-24">Data</th>
                )}
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase w-48">Zëri</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Përshkrimi</th>
                <th className="px-3 py-2 text-center text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase w-24">Monedha</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase w-32">Vlera</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase w-32 bg-blue-50/60">Total EUR</th>
                <th className="px-3 py-2 text-center text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase w-12"></th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={showDateCol ? 7 : 6} className="p-6 text-center text-slate-400 dark:text-slate-500 text-sm italic">
                    {rows.length === 0
                      ? (rangeActive
                        ? 'Asnjë shpenzim marketingu në periudhën e zgjedhur.'
                        : 'Asnjë shpenzim marketingu për këtë datë. Shto rreshtin e parë më lart.')
                      : `Asnjë shpenzim në ${filterCur}. Ndrysho filtrin për të parë të tjerët.`}
                  </td>
                </tr>
              ) : visibleRows.map(r => {
                const isEditing = editingId === r.id
                if (isEditing && editDraft) {
                  const eCur = editDraft.currency || 'LEK'
                  const eIsLek = eCur === 'LEK'
                  const eIsProduct = eCur === 'PRODUKT'
                  // Për editimin e PRODUKT, përdor një rresht të gjerë me colSpan
                  // që të kemi të njëjtat kolona si te forma e shtimit.
                  if (eIsProduct) {
                    const p = editDraft.product
                    const eLine = computeProductLine({
                      qty: editDraft.product_qty, unit_price: editDraft.unit_price,
                      discount_percent: editDraft.discount_percent, vat_rate: editDraft.vat_rate,
                    })
                    const qtyNum = parseInt(editDraft.product_qty) || 1
                    const base = (parseFloat(editDraft.unit_price) || 0) * qtyNum
                    const discEur = base * ((parseFloat(editDraft.discount_percent) || 0) / 100)
                    // PRODUKT është gjithmonë në EUR — total_with_vat është drejtpërdrejt EUR.
                    const eTotalEur = eLine.total_with_vat
                    const colSpan = showDateCol ? 7 : 6
                    return (
                      <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800 bg-amber-50/40">
                        <td colSpan={colSpan} className="px-3 py-2">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-2">
                            <div>
                              <label className="form-label">Zëri</label>
                              <MarketingCategoryPicker
                                value={editDraft.category_id}
                                onChange={v => setEditDraft(d => ({ ...d, category_id: v }))}
                                categories={
                                  editDraft.category_id && !categories.some(c => c.id === parseInt(editDraft.category_id))
                                    ? [...categories, { id: parseInt(editDraft.category_id), name: r.category_name || '(zër i fshirë)' }]
                                    : categories
                                }
                                onCreated={async (newId) => { await load(); setEditDraft(d => ({ ...d, category_id: String(newId) })) }}
                                onUpdated={load}
                                onDeleted={() => { setEditDraft(d => ({ ...d, category_id: '' })); return load() }}
                                className="input-field-sm"
                              />
                            </div>
                            <div>
                              <label className="form-label">Përshkrimi</label>
                              <input type="text" value={editDraft.description}
                                onChange={e => setEditDraft(d => ({ ...d, description: e.target.value }))}
                                className="input-field-sm" placeholder="opsional" />
                            </div>
                          </div>
                          <div className="border-2 border-blue-200 dark:border-blue-800 rounded-xl p-2 bg-blue-50/40 dark:bg-blue-900/20 overflow-x-auto">
                            <div className="text-[10px] font-semibold text-blue-800 dark:text-blue-200 mb-1 flex items-center gap-1">
                              🎁 Produkti (edito) {p && <span className="ml-2 font-normal text-slate-500 dark:text-slate-400">Stok i disponueshëm: <span className={`font-semibold ${qtyNum > (p.stock || 0) ? 'text-rose-600' : ''}`}>{p.stock || 0}</span></span>}
                            </div>
                            <table className="w-full text-xs">
                              <thead className="text-slate-600 dark:text-slate-400 uppercase text-[10px] font-semibold">
                                <tr className="border-b border-blue-200 dark:border-blue-800">
                                  <th className="px-2 py-1 text-left">Produkti (barkod ose emër)</th>
                                  <th className="px-2 py-1 text-left w-24">Nr Serie</th>
                                  <th className="px-2 py-1 text-left w-28">Barkodi</th>
                                  <th className="px-2 py-1 text-right w-16">Sasia</th>
                                  <th className="px-2 py-1 text-right w-20">Gramatura</th>
                                  <th className="px-2 py-1 text-right w-24">Çmimi €</th>
                                  <th className="px-2 py-1 text-right w-24">Zbritje €</th>
                                  <th className="px-2 py-1 text-right w-16">Zbritje %</th>
                                  <th className="px-2 py-1 text-right w-14">TVSH %</th>
                                  <th className="px-2 py-1 text-right w-24">Çmimi final</th>
                                </tr>
                              </thead>
                              <tbody>
                                <tr>
                                  <td className="px-1 py-1 min-w-[220px]">
                                    <MarketingProductPicker
                                      product={p}
                                      onPick={pp => setEditDraft(d => ({ ...d, product: pp, ...snapshotFromProduct(pp) }))}
                                    />
                                  </td>
                                  <td className="px-1 py-1">
                                    <input type="text" value={p?.serial_no || ''} readOnly
                                      className="input-field-sm font-mono bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-300" placeholder="—" />
                                  </td>
                                  <td className="px-1 py-1">
                                    <input type="text" value={p?.barcode || ''} readOnly
                                      className="input-field-sm font-mono bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-300" placeholder="—" />
                                  </td>
                                  <td className="px-1 py-1">
                                    <input type="number" min="1" step="1"
                                      value={editDraft.product_qty}
                                      onChange={e => setEditDraft(d => ({ ...d, product_qty: e.target.value }))}
                                      className="input-field-sm text-right tabular-nums" />
                                  </td>
                                  <td className="px-1 py-1">
                                    <input type="text" value={p?.gram ? Number(p.gram).toFixed(3) : ''} readOnly
                                      className="input-field-sm text-right tabular-nums bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-300" placeholder="—" />
                                  </td>
                                  <td className="px-1 py-1">
                                    <MoneyInput value={editDraft.unit_price}
                                      onChange={v => setEditDraft(d => ({ ...d, unit_price: String(v) }))}
                                      className="input-field-sm text-right tabular-nums" placeholder="0.00" />
                                  </td>
                                  <td className="px-1 py-1">
                                    <MoneyInput value={discEur}
                                      onChange={eur => {
                                        if (base <= 0) { setEditDraft(d => ({ ...d, discount_percent: '0' })); return }
                                        const pct = Math.max(0, Math.min(100, (parseFloat(eur) || 0) / base * 100))
                                        setEditDraft(d => ({ ...d, discount_percent: String(+pct.toFixed(4)) }))
                                      }}
                                      className="input-field-sm text-right tabular-nums" placeholder="0.00" />
                                  </td>
                                  <td className="px-1 py-1">
                                    <input type="number" step="0.01" min="0" max="100"
                                      value={editDraft.discount_percent}
                                      onChange={e => setEditDraft(d => ({ ...d, discount_percent: e.target.value }))}
                                      className="input-field-sm text-right tabular-nums" />
                                  </td>
                                  <td className="px-1 py-1">
                                    <input type="number" step="0.01" min="0" max="100"
                                      value={editDraft.vat_rate}
                                      onChange={e => setEditDraft(d => ({ ...d, vat_rate: e.target.value }))}
                                      className="input-field-sm text-right tabular-nums" placeholder="0" />
                                  </td>
                                  <td className="px-2 py-1 text-right tabular-nums font-semibold text-blue-700 dark:text-blue-300">
                                    €{eLine.total_with_vat.toFixed(2)}
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                          <div className="flex items-center justify-between mt-2 flex-wrap gap-2">
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                              Total EUR: <span className="font-bold text-blue-700 dark:text-blue-300 tabular-nums">€{eTotalEur.toFixed(2)}</span>
                            </p>
                            <div className="flex gap-1">
                              <button onClick={saveEdit} className="px-3 py-1 rounded bg-emerald-50 dark:bg-emerald-900/30 hover:bg-emerald-100 text-emerald-700 dark:text-emerald-300 text-xs font-semibold" title="Ruaj">✓ Ruaj</button>
                              <button onClick={cancelEdit} className="px-3 py-1 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-semibold" title="Anulo">✕ Anulo</button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )
                  }
                  // Konvertim në EUR: EUR direkt; LEK ndaj kursit sotëm; të tjera → LEK → EUR.
                  const eAmt = n(editDraft.amount)
                  const eTotalEur = eCur === 'EUR'
                    ? eAmt
                    : eCur === 'LEK'
                      ? eAmt / eurRateToday
                      : eAmt * n(editDraft.exchange_rate || 1) / eurRateToday
                  return (
                    <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800 bg-amber-50/40">
                      {showDateCol && (
                        <td className="px-3 py-2 text-slate-600 dark:text-slate-300 text-xs font-mono">
                          {fmtDate(editDraft.date || r.date)}
                        </td>
                      )}
                      <td className="px-2 py-1">
                        <MarketingCategoryPicker
                          value={editDraft.category_id}
                          onChange={v => setEditDraft(d => ({ ...d, category_id: v }))}
                          categories={
                            editDraft.category_id && !categories.some(c => c.id === parseInt(editDraft.category_id))
                              ? [...categories, { id: parseInt(editDraft.category_id), name: r.category_name || '(zër i fshirë)' }]
                              : categories
                          }
                          onCreated={async (newId) => { await load(); setEditDraft(d => ({ ...d, category_id: String(newId) })) }}
                          onUpdated={load}
                          onDeleted={() => { setEditDraft(d => ({ ...d, category_id: '' })); return load() }}
                          className="input-field-sm"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input type="text" value={editDraft.description}
                          onChange={e => setEditDraft(d => ({ ...d, description: e.target.value }))}
                          className="input-field-sm" placeholder="opsional" />
                      </td>
                      <td className="px-2 py-1">
                        <select
                          value={eCur}
                          onChange={e => {
                            const newCur = e.target.value
                            setEditDraft(d => {
                              if (newCur === 'LEK') return { ...d, currency: newCur, exchange_rate: '1' }
                              const autoRate = rates[newCur]
                              return { ...d, currency: newCur, exchange_rate: autoRate ? String(autoRate) : d.exchange_rate }
                            })
                          }}
                          className="input-field-sm"
                        >
                          {/* EUR + PRODUKT = opsionet e reja; ruaj edhe monedhën
                              origjinale nëse regjistrimi i vjetër e ka ndryshe. */}
                          {[...new Set(['EUR', eCur].filter(c => c !== 'PRODUKT'))].map(c => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-1">
                        <MoneyInput value={editDraft.amount}
                          onChange={v => setEditDraft(d => ({ ...d, amount: String(v) }))}
                          className="input-field-sm text-right tabular-nums" />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-blue-700 dark:text-blue-300 bg-blue-50/40">
                        €{eTotalEur.toFixed(2)}
                      </td>
                      <td className="px-2 py-1 text-center whitespace-nowrap">
                        <button onClick={saveEdit} className="px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-900/30 hover:bg-emerald-100 text-emerald-700 dark:text-emerald-300 text-xs font-medium mr-1" title="Ruaj">✓</button>
                        <button onClick={cancelEdit} className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-medium" title="Anulo">✕</button>
                      </td>
                    </tr>
                  )
                }
                const cur = r.currency || 'LEK'
                const isProductRow = !!r.product_id
                const totalEur = toEur(r)
                return (
                  <tr key={r.id} className={`border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 ${isProductRow ? 'bg-blue-50/30 dark:bg-blue-900/10' : ''}`}>
                    {showDateCol && (
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-300 text-xs font-mono">{fmtDate(r.date)}</td>
                    )}
                    <td className="px-3 py-2 text-slate-800 dark:text-slate-100">
                      {categoryName(r.category_id) || r.category_name || <span className="italic text-slate-400 dark:text-slate-500">— pa zër —</span>}
                    </td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                      {isProductRow ? (
                        <div>
                          <div className="text-sm font-semibold text-blue-800 dark:text-blue-200 flex items-center gap-1">
                            🎁 {r.product_name || '(produkt i fshirë)'}
                            <span className="ml-1 text-[10px] font-normal text-slate-500 dark:text-slate-400">× {r.product_qty}</span>
                          </div>
                          {r.product_barcode && <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400">{r.product_barcode}</div>}
                          {r.description && <div className="text-xs mt-0.5">{r.description}</div>}
                        </div>
                      ) : (
                        r.description || <span className="italic text-slate-400 dark:text-slate-500">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {isProductRow
                        ? <span className="badge bg-blue-200 text-blue-800 dark:text-blue-100" title="Produkt nga inventari">🎁 PROD</span>
                        : <span className="badge bg-blue-100 text-blue-700 dark:text-blue-300">{cur}</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-800 dark:text-slate-100 font-semibold">
                      {fmt(r.amount)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-blue-700 dark:text-blue-300 bg-blue-50/40">
                      €{totalEur.toFixed(2)}
                    </td>
                    <td className="px-2 py-1 text-center whitespace-nowrap">
                      <button
                        onClick={() => startEdit(r)}
                        className="px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 text-blue-700 dark:text-blue-300 text-xs font-medium mr-1"
                        title={isProductRow ? 'Edito produktin / sasinë' : 'Edito'}
                      >✏️</button>
                      <button
                        onClick={() => removeEntry(r.id)}
                        className="px-2 py-0.5 rounded bg-red-50 dark:bg-red-900/30 hover:bg-red-100 text-red-600 text-xs font-medium"
                        title={isProductRow ? 'Fshi + riktheji stokun' : 'Fshi'}
                      >✕</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="bg-blue-50 dark:bg-blue-900/30 border-t-2 border-blue-200">
              <tr className="font-bold text-xs">
                <td colSpan={showDateCol ? 4 : 3} className="px-3 py-2 text-right text-slate-700 dark:text-slate-200 uppercase">TOTALI:</td>
                <td className="px-3 py-2 text-right text-slate-600 dark:text-slate-300 text-[11px]">
                  {totalsList.length === 0
                    ? '—'
                    : totalsList.map(([c, v]) => `${fmt(v)} ${c}`).join(' · ')}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-blue-900 text-sm bg-blue-100/60">
                  €{totals.total_eur.toFixed(2)}
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-slate-400 dark:text-slate-500 italic px-1">
        Kursi për monedhat e huaja plotësohet automatikisht nga kursi zyrtar i datës — mund të mbishkruhet
        dorazi për raste specifike.
      </p>
    </div>
  )
}
