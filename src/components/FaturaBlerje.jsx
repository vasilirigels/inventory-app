import { useState, useEffect, useRef } from 'react'
import { generateBarcode, printLabels } from '../lib/barcode.js'
import MoneyInput from './MoneyInput.jsx'
import { showConfirm } from './ConfirmDialog.jsx'

const CURRENCIES = ['LEK', 'EUR', 'USD', 'GBP', 'CHF']

// Konverto vlerën e një kursi (has_rate/sell_rate) nga një valutë në tjetrën
// duke përdorur `allRates` (LEK për njësi të secilës valutë). Nëse vlera është
// bosh/zero ose ndonjë kurs mungon, kthehet si-është.
function convertRateCurrency(value, from, to, allRates) {
  if (from === to) return value
  const num = Number(String(value ?? '').replace(',', '.'))
  if (!Number.isFinite(num) || num === 0) return value
  const fromRate = Number(allRates?.[from])
  const toRate   = Number(allRates?.[to])
  if (!Number.isFinite(fromRate) || !Number.isFinite(toRate) || fromRate <= 0 || toRate <= 0) return value
  return +(num * fromRate / toRate).toFixed(4)
}

// Toggle €/$ për kolonat e kursit — konverton vlerën numerike sipas allRates
// (LEK/valutë) kur ndryshohet valuta.
function CurrencyToggle({ value, onChange }) {
  const cur = value === 'USD' ? 'USD' : 'EUR'
  const symbol = cur === 'USD' ? '$' : '€'
  return (
    <button
      type="button"
      onClick={() => onChange(cur === 'EUR' ? 'USD' : 'EUR')}
      title={`Valuta: ${cur} (kliko për të ndryshuar)`}
      className="px-1.5 py-0.5 rounded border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-800 text-xs font-bold text-amber-800 dark:text-amber-200 hover:bg-amber-50 dark:hover:bg-amber-900/20 leading-none shrink-0"
    >
      {symbol}
    </button>
  )
}

// Zgjedhës kategorie materiali me krijim/editim/fshirje inline. Slug ruhet te
// products.material dhe label te products.category kur admin zgjedh një
// kategori. Kategoritë built_in (flori/diamant/ora) mbrohen nga fshirja.
function MaterialCategoryPicker({ value, onChange, categories, onChanged }) {
  const [mode, setMode] = useState('view') // 'view' | 'create' | 'edit'
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('')
  const [saving, setSaving] = useState(false)

  const selected = categories.find(c => c.slug === value)

  const onSelectChange = (e) => {
    const v = e.target.value
    if (v === '__new__') { setMode('create'); setName(''); setIcon('') }
    else onChange(v)
  }

  const startEdit = () => {
    if (!selected) return
    setMode('edit'); setName(selected.label); setIcon(selected.icon || '')
  }

  const saveCreate = async () => {
    const trimmed = name.trim()
    if (!trimmed || saving) return
    setSaving(true)
    try {
      const res = await fetch('/api/material-categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: trimmed, icon: icon.trim() }),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e.error || 'Gabim'); return }
      const created = await res.json()
      await onChanged?.()
      if (created?.slug) onChange(created.slug)
      setMode('view'); setName(''); setIcon('')
    } finally { setSaving(false) }
  }

  const saveEdit = async () => {
    const trimmed = name.trim()
    if (!trimmed || saving || !selected) return
    setSaving(true)
    try {
      const res = await fetch(`/api/material-categories/${selected.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: trimmed, icon: icon.trim(), active: 1 }),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e.error || 'Gabim'); return }
      await onChanged?.()
      setMode('view'); setName(''); setIcon('')
    } finally { setSaving(false) }
  }

  const doDelete = async () => {
    if (!selected) return
    if (selected.built_in) { alert('Kategoria bazë nuk mund të fshihet.'); return }
    if (!(await showConfirm(`Fshi kategorinë "${selected.label}"?`, {
      title: 'Fshi kategorinë', confirmLabel: 'Fshi', danger: true,
    }))) return
    setSaving(true)
    try {
      const res = await fetch(`/api/material-categories/${selected.id}`, { method: 'DELETE' })
      if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e.error || 'Gabim'); return }
      onChange('')
      await onChanged?.()
    } finally { setSaving(false) }
  }

  if (mode === 'create' || mode === 'edit') {
    const submit = mode === 'edit' ? saveEdit : saveCreate
    return (
      <div className="flex gap-1">
        <input
          type="text" value={icon} maxLength={2}
          onChange={e => setIcon(e.target.value)}
          className="input-field w-12 text-center"
          placeholder="🏷️"
          title="Emoji opsional"
        />
        <input
          type="text" autoFocus value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); submit() }
            else if (e.key === 'Escape') { e.preventDefault(); setMode('view') }
          }}
          className="input-field flex-1"
          placeholder={mode === 'edit' ? 'Riemërto kategorinë...' : 'Emri i kategorisë (p.sh. Argjend)...'}
        />
        <button type="button" onClick={submit} disabled={saving || !name.trim()}
          className="px-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 hover:bg-emerald-100 text-emerald-700 dark:text-emerald-300 text-sm font-semibold disabled:opacity-50"
          title="Ruaj">✓</button>
        <button type="button" onClick={() => setMode('view')}
          className="px-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-sm"
          title="Anulo">✕</button>
      </div>
    )
  }

  return (
    <div className="flex gap-1">
      <select value={value || ''} onChange={onSelectChange} className="input-field flex-1">
        <option value="">— pa kategori —</option>
        {categories.map(c => (
          <option key={c.id} value={c.slug}>{c.icon ? `${c.icon} ${c.label}` : c.label}</option>
        ))}
        <option value="__new__">➕ Krijo kategori të re...</option>
      </select>
      {selected && (
        <>
          <button type="button" onClick={startEdit} disabled={saving}
            className="px-2 rounded-lg bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 text-blue-700 dark:text-blue-300 text-sm font-semibold disabled:opacity-50"
            title={`Riemërto "${selected.label}"`}>✏️</button>
          {!selected.built_in && (
            <button type="button" onClick={doDelete} disabled={saving}
              className="px-2 rounded-lg bg-red-50 dark:bg-red-900/30 hover:bg-red-100 text-red-600 dark:text-red-300 text-sm font-semibold disabled:opacity-50"
              title={`Fshi "${selected.label}"`}>✕</button>
          )}
        </>
      )}
    </div>
  )
}

function n(v) { return parseFloat(v) || 0 }
function fmt(v) {
  return n(v).toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function emptyItem() {
  return {
    product_id: null, serial_no: '', barcode: '', name: '',
    category: '', unit: 'copë', gram: 0,
    qty: 1, purchase_price_no_vat: 0, cost_price: 0, discount_percent: 0,
    vat_rate: 0, sell_price: 0, material: '',
    // Zbritje mbi Cmim Shitje (përdoret vetëm te Blerje Diamant për të reduktuar
    // sell_price nga formula bazë cost_price × multiplier). Nuk ndikon në total-in
    // e blerjes (discount_percent bën atë).
    sell_discount_percent: 0,
    is_promotion: false, promo_discount_pct: 0,
    // Blerje në gram HAS (peshë floriri të pastër) + kursi EUR/gram HAS që
    // mbushet automatikisht nga /api/gold-spot-price kur hapet editori.
    has_gram: 0, has_currency: 'HAS', has_rate: 0,
    // Kodi i floririt (p.sh. 585, 750) — përdoret si kodi/1000 në formulën:
    // has_gram = (kodi/1000) × gram. Shumëzuesi për çmim shitjeje.
    kodi: 0, multiplier: 0,
    // Kursi i shitjes për këtë rresht — përdoret në formulën flori për të
    // llogaritur `sell_price` të pavarur nga kursi i blerjes (`has_rate`).
    // Default = has_rate kur rreshti krijohet; user-i mund ta ndryshojë manualisht.
    sell_rate: 0,
    // Etiketa valute për kursin e blerjes/shitjes — marker (EUR/USD) që user-i
    // të dijë në ç'valutë ka futur numrin. Formula përdor vlerën si-është.
    has_rate_currency: 'USD', sell_rate_currency: 'EUR',
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

  // Renditja e prioritetit: e specifikja para përgjithësisë. Fushat flori
  // (kodi, has_gram, has_rate) detektohen PARA cost_price/sku sepse "Cmim Blerje
  // Has" / "Kursi Blerje" / "Kodi" përndryshe do të kapeshin nga pattern-et
  // gjenerike 'blerje', 'kosto', 'kodi' të fushave të tjera.
  const barcode    = findFirst(['barkod', 'barcode'])
  const name       = findFirst(['pershkrim', 'emri', 'name', 'produkt', 'article', 'description', 'artikull'])
  const stock      = findFirst(['sasia', 'sasi', 'stoku', 'stock', 'qty', 'quantity', 'gjendje', 'cope'])
  const gram       = findFirst(['gram', 'peshe', 'weight', 'pesha'])
  const kodi       = findFirst(['kodi_flori', 'kodi'])
  const has_gram   = findFirst(['cmim_blerje_has', 'blerje_has', 'has_gram'])
  const has_rate   = findFirst(['kursi_blerje', 'kursi', 'has_rate'])
  const sku        = findFirst([
    'sku', 'numer_serial', 'nr_serial', 'numer_seri', 'nr_seri', 'nr._seri',
    'seri', 'kodi_art', 'code', 'ref_no', 'ref',
  ])
  const cost_price = findFirst([
    'cmimi_pa_tvsh', 'cmimi_bler', 'cm_bler', 'cmim_bler',
    'pa_tvsh', 'blerje', 'kosto', 'cost', 'cmimi_k',
  ])
  const sell_price = findFirst([
    'cmimi_shitj', 'cm_shitj', 'shitje_pa', 'shit_pa_tvsh',
    'sell_price', 'sell', 'price', 'cmimi_sh',
  ])
  const min_stock  = findFirst(['stok_min', 'min_stock', 'minim', 'alarm'])
  const category   = findFirst(['kategori', 'category', 'tip', 'lloj'])
  const brand      = findFirst(['brendi', 'brand', 'prodhu'])

  return { name, category, brand, sku, barcode, cost_price, sell_price, stock, min_stock, gram, kodi, has_gram, has_rate }
}

function rowToProduct(row, m) {
  const get = (idx, def = '') => idx >= 0 ? (row[idx] ?? def) : def
  const num = (idx) => parseFloat(String(get(idx, 0)).replace(',', '.')) || 0
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
    gram:       num(m.gram),
    kodi:       parseInt(get(m.kodi, 0)) || 0,
    has_gram:   num(m.has_gram),
    has_rate:   num(m.has_rate),
  }
}

// Përputhje case-insensitive për filtër kërkimi të rreshtave në një faturë
// blerjeje me shumë artikuj — kontrollon fushat më të përdorura që user-i
// mban mend (barkod, pershkrim, SKU, seri).
function matchesItemSearch(it, q) {
  if (!q) return true
  const needle = String(q).toLowerCase().trim()
  if (!needle) return true
  const haystack = [
    it.barcode, it.name, it.sku, it.serial_no, it.category,
  ].map(x => String(x || '').toLowerCase()).join(' ')
  return haystack.includes(needle)
}

function computeLine(it) {
  const qty   = n(it.qty)
  // "Cmimi PA" opsionale — fallback te "Cmim Kosto" (jo Cmim Shitje) sepse
  // për blerje totali duhet të reflektojë sa ka kushtuar, jo sa do të shitet.
  const price = n(it.purchase_price_no_vat) || n(it.cost_price)
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
            className="px-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 text-xs" title="Pastro">✕</button>
        )}
      </div>
      {value?.nipt && (
        <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
          NIPT: <span className="font-mono">{value.nipt}</span>
          {value.phone && <> · Tel: <span className="font-mono">{value.phone}</span></>}
        </p>
      )}
      {open && (results.length > 0 || loading) && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg max-h-64 overflow-y-auto">
          {loading && <div className="p-2 text-xs text-slate-400 dark:text-slate-500">Duke kërkuar...</div>}
          {results.map(s => (
            <button
              key={s.id} type="button" onClick={() => pick(s)}
              className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-slate-100 dark:border-slate-800 last:border-0"
            >
              <div className="text-sm font-medium text-slate-800 dark:text-slate-100">
                {s.name || <span className="italic text-slate-400 dark:text-slate-500">— pa emër —</span>}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
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
function ProductPickerCell({ value, onPick, onNameChange }) {
  // Pershkrimi është i pavarur nga kolona e barkodit — mos ridiktoj vlerën nga
  // barcode-i, sepse ndryshe kur user-i shkruan barkodin, ai duket edhe këtu.
  // Emri vjen nga produkti i importuar (pickProduct → setItem({ name })) ose
  // shkruhet me dorë. Kur shkruhet me dorë, `onNameChange` sinkronizon vlerën
  // te state-i i prindit — pa këtë, `it.name` mbetet bosh dhe backend-i s'e
  // krijon produktin e ri.
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
        onChange={e => {
          const v = e.target.value
          setQuery(v)
          onNameChange?.(v)
          search(v)
          setOpen(true)
        }}
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
function PurchaseList({ date, onOpen, onCreate, onDelete, refreshKey, title, materialFilter,
                       fromDate, setFromDate, toDate, setToDate }) {
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [usdByDate, setUsdByDate] = useState({})
  // fromDate/toDate janë ngritur te parent-i (FaturaBlerje) që të mbahen kur
  // user-i hap një faturë për editim dhe kthehet mbrapa — përndryshe state-i
  // lokal humbet çdo herë që PurchaseList unmount-ohet.

  useEffect(() => {
    if (!fromDate || !toDate) return
    setLoading(true)
    const matQ = materialFilter ? `?material=${encodeURIComponent(materialFilter)}` : ''
    const url = fromDate === toDate
      ? `/api/purchase-invoices/by-date/${fromDate}${matQ}`
      : `/api/purchase-invoices/by-range?from=${fromDate}&to=${toDate}${materialFilter ? `&material=${encodeURIComponent(materialFilter)}` : ''}`
    fetch(url)
      .then(r => r.json())
      .then(d => { setList(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => { setList([]); setLoading(false) })
  }, [fromDate, toDate, refreshKey, materialFilter])

  // Convert per-invoice LEK subtotals into USD: need USD rate for each invoice's date.
  useEffect(() => {
    const dates = Array.from(new Set(list.map(inv => inv.date).filter(Boolean)))
    const missing = dates.filter(d => usdByDate[d] == null)
    if (missing.length === 0) return
    let cancelled = false
    Promise.all(missing.map(d =>
      fetch(`/api/exchange-rates/${d}`).then(r => r.json()).then(res => [d, n(res?.rates?.USD) || 0]).catch(() => [d, 0])
    )).then(pairs => {
      if (cancelled) return
      setUsdByDate(prev => {
        const next = { ...prev }
        for (const [d, r] of pairs) next[d] = r
        return next
      })
    })
    return () => { cancelled = true }
  }, [list])

  const rangeActive = fromDate !== date || toDate !== date

  // Daily snapshot — use the amount paid AT INVOICE CREATION TIME (not current state).
  // Later payments via Detyrime Furnitor reflect in Detyrime + Analize Veprime but
  // must NOT shift the daily totals on the purchase invoice list.
  const totals = list.reduce((acc, inv) => {
    const rate = n(inv.exchange_rate) || 1
    const usdRate = n(usdByDate[inv.date]) || 0
    // value_USD = value_original * (invoice→LEK rate) / (USD→LEK rate)
    const toUsd = usdRate > 0 ? (rate / usdRate) : 0
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
    acc.grossUsd += gross * toUsd
    acc.discUsd  += n(inv.total_discount) * toUsd
    acc.subUsd   += n(inv.subtotal_no_vat) * toUsd
    acc.vatUsd   += n(inv.total_vat) * toUsd
    acc.totUsd   += n(inv.total_with_vat) * toUsd
    acc.paidUsd  += initPaid * toUsd
    acc.dueUsd   += initDue * toUsd
    acc.gram     += n(inv.total_gram)
    acc.buy      += n(inv.total_buy_price)
    acc.sell     += n(inv.total_sell_price)
    return acc
  }, {
    count: 0, gross: 0, sub: 0, disc: 0, vat: 0, tot: 0, paid: 0, due: 0,
    grossUsd: 0, discUsd: 0, subUsd: 0, vatUsd: 0, totUsd: 0, paidUsd: 0, dueUsd: 0,
    gram: 0, buy: 0, sell: 0,
  })

  const showGram = !!materialFilter
  // Fitim/Marzh mesatar shfaqet vetëm për Blerje Flori/Diamant. Llogaritje e
  // ponderuar: (ΣShitje − ΣBlerje) / ΣBlerje për Fitim, / ΣShitje për Marzh.
  const showProfit = materialFilter === 'flori' || materialFilter === 'diamant'
  const avgFitim = showProfit && totals.buy > 0.005 ? ((totals.sell - totals.buy) / totals.buy) * 100 : 0
  const avgMarzh = showProfit && totals.sell > 0.005 ? ((totals.sell - totals.buy) / totals.sell) * 100 : 0

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">{title || 'Fatura Blerje'}</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {fromDate === toDate
              ? 'Lista e faturave të blerjes për këtë datë'
              : `Lista e faturave të blerjes nga ${fromDate} në ${toDate}`}
          </p>
        </div>
        <button onClick={onCreate} className="btn-primary">+ {title ? `${title} e Re` : 'Faturë Blerje e Re'}</button>
      </div>

      {/* Date range filter */}
      <div className="card flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">📅</span>
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Filtër data</span>
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
          <div className="p-8 text-center text-slate-400 dark:text-slate-500 text-sm">Duke ngarkuar...</div>
        ) : list.length === 0 ? (
          <div className="p-10 text-center">
            <div className="text-5xl mb-3">📦</div>
            <p className="text-slate-500 dark:text-slate-400 mb-4">
              {fromDate === toDate
                ? 'Nuk ka fatura blerje për këtë datë.'
                : 'Nuk ka fatura blerje në këtë periudhë.'}
            </p>
            <button onClick={onCreate} className="btn-primary mx-auto">+ Krijo Faturën e Parë</button>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1200px]">
            <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Nr. Fature</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Data</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Furnitori</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">NIPT</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Monedha</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Pagesa</th>
                {showGram && (
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">Gram</th>
                )}
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Pa Zbritje</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Zbritja</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Pa TVSH</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">TVSH</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">TOTALI</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Paguar</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Borxh</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Veprime</th>
              </tr>
            </thead>
            <tbody>
              {list.map(inv => {
                // Snapshot from the invoice's creation moment — later payments via the
                // Detyrime Furnitor modal are ignored here so daily totals stay stable.
                const initPaid = inv.initial_amount_paid != null ? n(inv.initial_amount_paid) : n(inv.amount_paid)
                // Raw due (mund të jetë negativ nëse pagesa tepron totalin).
                const dueRaw = +(n(inv.total_with_vat) - initPaid).toFixed(2)
                const due = Math.max(0, dueRaw)
                // Kur totali = 0 por është regjistruar pagesë ("Cmimi PA" opsional),
                // trajto pagesën si totalin efektiv — s'ka borxh të pashfaqur.
                const noTotalButPaid = n(inv.total_with_vat) <= 0.005 && initPaid > 0.005
                const pm = inv.payment_method
                const pmBadge = pm === 'debt'
                  ? <span className="badge bg-amber-100 text-amber-700 dark:text-amber-300">⚠️ Borxh</span>
                  : pm === 'bank'
                  ? <span className="badge bg-blue-100 text-blue-700 dark:text-blue-300">🏦 Bankë</span>
                  : pm === 'pos'
                  ? <span className="badge bg-purple-100 text-purple-700 dark:text-purple-300">💳 POS</span>
                  : <span className="badge bg-emerald-100 text-emerald-700 dark:text-emerald-300">💵 Cash</span>
                const rate = n(inv.exchange_rate) || 1
                const isForeign = (inv.currency || 'LEK') !== 'LEK'
                return (
                <tr key={inv.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-slate-700 dark:text-slate-200">
                    <button onClick={() => onOpen(inv.id)} className="text-blue-600 hover:underline">{inv.invoice_no}</button>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300 tabular-nums whitespace-nowrap">{inv.date || '—'}</td>
                  <td className="px-4 py-3 text-slate-800 dark:text-slate-100">{inv.supplier_name || <span className="text-slate-400 dark:text-slate-500 italic">— pa furnitor —</span>}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500 dark:text-slate-400">{inv.supplier_nipt || '—'}</td>
                  <td className="px-4 py-3 text-center"><span className="badge bg-blue-100 text-blue-700 dark:text-blue-300">{inv.currency}</span></td>
                  <td className="px-4 py-3 text-center text-xs">{pmBadge}</td>
                  {showGram && (
                    <td className="px-4 py-3 text-right tabular-nums font-semibold bg-amber-50/40 dark:bg-amber-900/10 text-amber-800 dark:text-amber-200">
                      {n(inv.total_gram) > 0 ? `${n(inv.total_gram).toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}gr` : <span className="text-slate-300">—</span>}
                    </td>
                  )}
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700 dark:text-slate-200">
                    {fmt(n(inv.subtotal_no_vat) + n(inv.total_discount))}
                  </td>
                  <td className={`px-4 py-3 text-right tabular-nums ${n(inv.total_discount) > 0.005 ? 'text-orange-600 font-semibold' : 'text-slate-400 dark:text-slate-500'}`}>
                    {n(inv.total_discount) > 0.005 ? `-${fmt(inv.total_discount)}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700 dark:text-slate-200">
                    {fmt(inv.subtotal_no_vat)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700 dark:text-slate-200">
                    {fmt(inv.total_vat)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-bold text-slate-900 dark:text-white">
                    {fmt(inv.total_with_vat)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold text-emerald-700 dark:text-emerald-300">
                    {fmt(initPaid)}
                  </td>
                  <td className={`px-4 py-3 text-right tabular-nums font-semibold ${due > 0.005 ? 'text-red-600' : 'text-emerald-600'}`}>
                    {due > 0.005 ? fmt(due) : '✓ Paguar'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1.5">
                      <button onClick={() => onOpen(inv.id)} className="px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 text-blue-600 text-xs font-medium">Hap</button>
                      <button onClick={() => onDelete(inv.id, inv.invoice_no)} className="px-2.5 py-1 rounded-lg bg-red-50 dark:bg-red-900/30 hover:bg-red-100 text-red-600 text-xs font-medium">Fshi</button>
                    </div>
                  </td>
                </tr>
              )})}
            </tbody>
            <tfoot className="bg-emerald-50 dark:bg-emerald-900/30 border-t-2 border-emerald-300">
              <tr>
                <td colSpan={5} className="px-4 py-3 text-xs font-bold text-emerald-700 dark:text-emerald-300 uppercase tracking-wide">
                  💵 TOTAL CASH (USD) <span className="text-[10px] font-normal text-emerald-600">— {totals.count} fatura, të konvertuara me kursin e çdo fature</span>
                </td>
                {showGram && (
                  <td className="px-4 py-3 text-right tabular-nums font-extrabold bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200 text-base">
                    {totals.gram > 0.0005 ? `${totals.gram.toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}gr` : '—'}
                  </td>
                )}
                <td className="px-4 py-3 text-right tabular-nums font-extrabold text-slate-800 dark:text-slate-100">{fmt(totals.grossUsd)}</td>
                <td className="px-4 py-3 text-right tabular-nums font-extrabold text-orange-600">
                  {totals.discUsd > 0.005 ? `-${fmt(totals.discUsd)}` : '—'}
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-extrabold text-slate-800 dark:text-slate-100">{fmt(totals.subUsd)}</td>
                <td className="px-4 py-3 text-right tabular-nums font-extrabold text-slate-800 dark:text-slate-100">{fmt(totals.vatUsd)}</td>
                <td className="px-4 py-3 text-right tabular-nums font-extrabold text-blue-700 dark:text-blue-300 text-base">{fmt(totals.totUsd)}</td>
                <td className="px-4 py-3 text-right tabular-nums font-extrabold text-emerald-700 dark:text-emerald-300 text-base">{fmt(totals.paidUsd)}</td>
                <td className={`px-4 py-3 text-right tabular-nums font-extrabold text-base ${totals.dueUsd > 0.005 ? 'text-red-600' : 'text-emerald-700 dark:text-emerald-300'}`}>
                  {totals.dueUsd > 0.005 ? fmt(totals.dueUsd) : '✓'}
                </td>
                <td></td>
              </tr>
              {showProfit && (
                <tr className="border-t border-emerald-200 dark:border-emerald-800">
                  <td colSpan={showGram ? 15 : 14} className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
                      <span className="text-xs font-bold text-emerald-700 dark:text-emerald-300 uppercase tracking-wide">
                        📈 Mesatare — Fitim / Marzh <span className="text-[10px] font-normal text-emerald-600">(mbi Σ Cmim Blerje vs Σ Cmim Shitje)</span>
                      </span>
                      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 tabular-nums text-sm">
                        <span className="text-slate-500 dark:text-slate-400">Σ Blerje: <span className="font-bold text-slate-800 dark:text-slate-100">{fmt(totals.buy)}</span></span>
                        <span className="text-slate-500 dark:text-slate-400">Σ Shitje: <span className="font-bold text-emerald-700 dark:text-emerald-300">{fmt(totals.sell)}</span></span>
                        <span className="text-slate-500 dark:text-slate-400">Fitim %: <span className={`font-extrabold text-base ${avgFitim > 0 ? 'text-emerald-700 dark:text-emerald-300' : avgFitim < 0 ? 'text-rose-600' : 'text-slate-500'}`}>{totals.buy > 0.005 ? `${avgFitim.toFixed(1)}%` : '—'}</span></span>
                        <span className="text-slate-500 dark:text-slate-400">Marzh %: <span className={`font-extrabold text-base ${avgMarzh > 0 ? 'text-emerald-700 dark:text-emerald-300' : avgMarzh < 0 ? 'text-rose-600' : 'text-slate-500'}`}>{totals.sell > 0.005 ? `${avgMarzh.toFixed(1)}%` : '—'}</span></span>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </tfoot>
          </table>
          </div>
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
function ImportExcelModal({ onClose, onImported, overrideCategoryLabel, forcedCategory }) {
  const fileRef = useRef()
  const [step, setStep]               = useState('upload') // upload | preview
  const [fileName, setFileName]       = useState('')
  const [headers, setHeaders]         = useState([])
  const [mapping, setMapping]         = useState({})
  const [dataRows, setDataRows]       = useState([])
  const [error, setError]             = useState('')
  const [importing, setImporting]     = useState(false)

  // Për Blerje Diamant lejohen vetëm 5 fusha nga Excel-i — të tjerat s'shfaqen
  // dhe s'importohen. Për Blerje Flori / Artikuj të tjerë, të gjitha fushat.
  const allowedFields = forcedCategory === 'diamant'
    ? ['barcode', 'name', 'stock', 'gram', 'cost_price']
    : null // null = të gjitha

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
        const detected = detectMapping(hdrs)
        // Nëse janë të lejuara vetëm disa fusha, pastrojmë të tjerat te -1
        // që të mos importohen edhe nëse Excel-i i ka.
        if (allowedFields) {
          for (const k of Object.keys(detected)) {
            if (!allowedFields.includes(k)) detected[k] = -1
          }
        }
        setMapping(detected)
        setStep('preview')
      } catch (err) {
        setError('Gabim gjatë leximit: ' + err.message)
      }
    }
    reader.readAsArrayBuffer(file)
  }

  // Blerje Flori/Diamant shpesh nuk kanë kolonën "Pershkrim" — artikulli
  // identifikohet nga gram/kodi/barkod. Nëse mungon emri por rreshti ka ndonjë
  // të dhënë tjetër, gjenerohet një emër placeholder (barkod → SKU → "Kategoria
  // #rresht") që produkti të importohet. User-i mund ta editojë më vonë.
  const products = dataRows
    .map((r, idx) => {
      const p = rowToProduct(r, mapping)
      const hasAny = p.name || p.barcode || p.sku
        || p.gram > 0 || p.stock > 0 || p.cost_price > 0
      if (!hasAny) return null
      if (!p.name) {
        p.name = p.barcode || p.sku
          || `${overrideCategoryLabel || 'Artikull'} #${idx + 1}`
      }
      return p
    })
    .filter(Boolean)

  const handleImport = async () => {
    if (products.length === 0) return
    setImporting(true)
    setError('')
    try {
      // Set stock=0 in the products payload; the purchase invoice's qty will
      // drive stock via adjustPurchaseStock, otherwise we'd double-count.
      // Nëse fatura ka një kategori të fiksuar (p.sh. Blerje Flori) e vendosim
      // te çdo produkt — kolona "Kategori" e Excel-it shpesh mbushet vetëm te
      // rreshti i parë (merged cells), duke bërë që të tjerët të bien te 'Tjeter'.
      const payload = products.map(p => ({
        ...p,
        stock: 0,
        ...(overrideCategoryLabel ? { category: overrideCategoryLabel } : {}),
      }))
      const res = await fetch('/api/products/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ products: payload }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Gabim importi')
      const matched = data.matched || 0
      if (matched > 0) {
        const dups = Array.isArray(data.duplicates) ? data.duplicates : []
        const list = dups.length > 0
          ? '\n\nDublikatat:\n' + dups.slice(0, 20).map((d, i) => {
              const where = d.existingInvoiceNo
                ? `në faturën ${d.existingInvoiceNo}${d.existingInvoiceDate ? ` (${d.existingInvoiceDate})` : ''}`
                : 'në DB'
              return `  ${i + 1}. ${d.name} — ${d.matchedBy} — ekziston ${where}`
            }).join('\n') + (dups.length > 20 ? `\n  … dhe ${dups.length - 20} të tjera` : '')
          : ''
        alert(
          `✓ ${data.imported || 0} produkte të reja u krijuan.\n` +
          `⚠️ ${matched} rresht${matched === 1 ? '' : 'a'} me barkod/SKU të dublikuar — u përdor produkti ekzistues.\n` +
          `Kontrollo Excel-in për të hequr dublikatat.${list}`
        )
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

  const ALL_COL_FIELDS = [
    { key: 'name',       label: 'Pershkrimi *' },
    { key: 'category',   label: 'Kategoria' },
    { key: 'brand',      label: 'Brendi' },
    { key: 'sku',        label: 'Kodi SKU' },
    { key: 'barcode',    label: 'Barkodi' },
    { key: 'stock',      label: 'Sasi / Sasia' },
    { key: 'gram',       label: 'Gram' },
    { key: 'kodi',       label: 'Kodi (585/750...)' },
    { key: 'has_gram',   label: 'Cmim Blerje Has' },
    { key: 'has_rate',   label: 'Kursi Blerje' },
    { key: 'cost_price', label: 'Cmim Blerje (€)' },
    { key: 'sell_price', label: 'Çm. Shitje (€)' },
    { key: 'min_stock',  label: 'Stok Minimal' },
  ]
  const COL_FIELDS = allowedFields
    ? ALL_COL_FIELDS.filter(f => allowedFields.includes(f.key))
    : ALL_COL_FIELDS

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="modal-header">
          <div>
            <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">Import Artikujsh nga Excel</h3>
            {fileName && step !== 'upload' && (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">📄 {fileName}</p>
            )}
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 text-xl">×</button>
        </div>
        <div className="p-6">
          {step === 'upload' && (
            <div className="space-y-5">
              <div
                onClick={() => fileRef.current.click()}
                className="border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-blue-400 rounded-2xl p-10 text-center cursor-pointer transition-colors group"
              >
                <div className="text-5xl mb-3">📂</div>
                <p className="font-semibold text-slate-700 dark:text-slate-200 group-hover:text-blue-600">Klikoni për të zgjedhur Excel-in</p>
                <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">Mbështet: .xlsx, .xls</p>
                <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleFile} className="hidden" />
              </div>
              {error && <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/30 p-3 rounded-lg">{error}</p>}
              <div className="p-3 bg-blue-50 dark:bg-blue-900/30 rounded-xl border border-blue-100 text-xs text-blue-700 dark:text-blue-300">
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
                      <span className="text-xs text-slate-600 dark:text-slate-300 w-32 flex-shrink-0">{f.label}</span>
                      <select
                        value={mapping[f.key] ?? -1}
                        onChange={e => setMap(f.key, e.target.value)}
                        className={`input-field-sm flex-1 ${mapping[f.key] >= 0 ? 'border-green-400' : 'border-slate-300 dark:border-slate-700'}`}
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
                <div className="flex-1 p-3 bg-emerald-50 dark:bg-emerald-900/30 rounded-xl border border-emerald-200 text-center">
                  <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">{products.length}</p>
                  <p className="text-xs text-emerald-600">Artikuj të gatshëm</p>
                </div>
                <div className="flex-1 p-3 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 text-center">
                  <p className="text-2xl font-bold text-slate-700 dark:text-slate-200">{dataRows.length - products.length}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Rreshta të zbrazur</p>
                </div>
                <div className="flex-1 p-3 bg-blue-50 dark:bg-blue-900/30 rounded-xl border border-blue-200 text-center">
                  <p className="text-2xl font-bold text-blue-700 dark:text-blue-300">{headers.length}</p>
                  <p className="text-xs text-blue-600">Kolona totale</p>
                </div>
              </div>
              <div>
                <p className="section-title">Shembull — 5 të parët</p>
                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-900">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold text-slate-500 dark:text-slate-400">Nr.</th>
                        <th className="px-3 py-2 text-left font-semibold text-slate-500 dark:text-slate-400">Emri</th>
                        <th className="px-3 py-2 text-left font-semibold text-slate-500 dark:text-slate-400">Barkodi</th>
                        <th className="px-3 py-2 text-right font-semibold text-slate-500 dark:text-slate-400">Sasia</th>
                        <th className="px-3 py-2 text-right font-semibold text-slate-500 dark:text-slate-400">Kosto €</th>
                        <th className="px-3 py-2 text-right font-semibold text-slate-500 dark:text-slate-400">Shitje €</th>
                      </tr>
                    </thead>
                    <tbody>
                      {products.slice(0, 5).map((p, i) => (
                        <tr key={i} className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <td className="px-3 py-2 font-mono text-slate-400 dark:text-slate-500">{i + 1}</td>
                          <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-100 max-w-[180px] truncate">{p.name}</td>
                          <td className="px-3 py-2 font-mono text-slate-500 dark:text-slate-400">{p.barcode || '—'}</td>
                          <td className="px-3 py-2 text-right">{p.stock || '—'}</td>
                          <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-200">{p.cost_price || '—'}</td>
                          <td className="px-3 py-2 text-right font-semibold text-slate-900 dark:text-white">{p.sell_price || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {products.length > 5 && (
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-2 text-center">+ {products.length - 5} të tjerë...</p>
                )}
              </div>
              {error && <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/30 p-3 rounded-lg">{error}</p>}
              <div className="flex gap-3">
                <button onClick={() => setStep('upload')} className="btn-secondary">← Ndrysho Skedarin</button>
                <button
                  onClick={handleImport}
                  disabled={products.length === 0 || importing}
                  className="btn-primary flex-1 justify-center disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {importing ? (
                    <>
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
                        <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                      </svg>
                      Duke importuar {products.length} artikuj...
                    </>
                  ) : `⬆️ Importo ${products.length} Artikuj`}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {importing && (
        <div className="fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl px-8 py-6 flex items-center gap-4 max-w-sm">
            <svg className="animate-spin h-8 w-8 text-blue-600 flex-shrink-0" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
              <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
            </svg>
            <div>
              <p className="font-semibold text-slate-800 dark:text-slate-100">Duke importuar artikujt...</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {products.length} {products.length === 1 ? 'artikull' : 'artikuj'} — mund të zgjasë disa sekonda
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Editor ──────────────────────────────────────────────────────────────────
function PurchaseEditor({ date, invoiceId, onClose, onSaved, title, forcedCategory }) {
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [invoiceDate, setInvoiceDate] = useState(date)
  const [invoiceNo, setInvoiceNo] = useState('')
  const [supplierName, setSupplierName] = useState('')
  const [supplierNipt, setSupplierNipt] = useState('')
  // Blerjet bëhen gjithmonë në USD — default për fatura të reja. Fatura
  // ekzistuese ngarkohen me monedhën e vet të ruajtur.
  const [currency, setCurrency] = useState('USD')
  const [exchangeRate, setExchangeRate] = useState(1)
  const [rateSource, setRateSource]   = useState('')
  // Payment splits — pasqyrim i sistemit të FaturaShitje. Çdo split ka
  // method (cash|bank), monedhë, shumë dhe kurs drejt LEK.
  const [paymentSplits, setPaymentSplits] = useState([])
  const [notes, setNotes]       = useState('')
  // Flag "Dhuratë" — kur aktivizohet për Blerje Artikuj të Tjerë, të gjithë
  // produktet e faturës markohen te products.is_gift = 1 që të shfaqen si
  // mundësi te "+ Shto Dhuratë" në Fatura Shitje.
  const [isGift, setIsGift]     = useState(false)
  const [category, setCategory] = useState(forcedCategory || '')
  const [items, setItems]       = useState([emptyItem()])
  // Filtër kërkimi mbi rreshtat e faturës — për fatura me shumë artikuj
  // (p.sh. 300 rreshta) që user-i të gjejë atë që kërkon me barkod/pershkrim/SKU.
  // Filtrimi bëhet vetëm në render; state-i i items mbetet i plotë kështu që
  // save/edit ruajnë të gjitha rreshtat.
  const [itemsSearch, setItemsSearch] = useState('')
  const [allRates, setAllRates] = useState({ LEK: 1 })
  const [showImport, setShowImport] = useState(false)
  const [bulkPromoPct, setBulkPromoPct] = useState('20')
  const [bulkMultiplier, setBulkMultiplier] = useState('')
  const [materialCategories, setMaterialCategories] = useState([])
  // Kursi aktual EUR / gram HAS (nga /api/gold-spot-price). Ruhet globalisht
  // për të gjithë rreshtat e faturës — çdo rresht mund ta shohë por kursi
  // vjen njësoj se blerja bëhet në të njëjtën ditë.
  const [hasRate, setHasRate]           = useState(0)
  const [hasRateLoading, setHasRateLoading] = useState(false)

  const loadMaterialCategories = async () => {
    try {
      const rows = await fetch('/api/material-categories').then(r => r.json())
      setMaterialCategories(Array.isArray(rows) ? rows : [])
    } catch { setMaterialCategories([]) }
  }
  useEffect(() => { loadMaterialCategories() }, [])

  // Merr kursin aktual EUR/gram HAS nga /api/gold-spot-price. Timeout 5s që
  // të mos ngec në Windows nëse firewall-i bllokon lidhjen dalëse.
  const fetchHasRate = async () => {
    setHasRateLoading(true)
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 5000)
    try {
      const d = await fetch('/api/gold-spot-price', { signal: ctrl.signal })
        .then(r => r.ok ? r.json() : Promise.reject(r))
      const rate = n(d.eur_per_gram)
      if (rate > 0) setHasRate(rate)
      return rate
    } catch {
      return 0
    } finally { clearTimeout(timer); setHasRateLoading(false) }
  }
  useEffect(() => { fetchHasRate() }, [])

  // Auto-mbush has_rate + sell_rate te çdo rresht që ende s'ka kurs të vetin,
  // kur hasRate vjen nga API-ja. Nuk mbishkruajmë kursin që erdhi tashmë me
  // faturën ekzistuese. Fire edhe kur items ndryshojnë (p.sh. fatura ekzistuese
  // ngarkohet pas hasRate). Për Blerje Flori NUK auto-mbushim has_rate — user-i
  // e vendos vetë Kursin e Blerjes.
  useEffect(() => {
    if (!hasRate) return
    const skipHasRate = forcedCategory === 'flori'
    setItems(prev => {
      if (!prev.some(it => (!skipHasRate && !(n(it.has_rate) > 0)) || !(n(it.sell_rate) > 0))) return prev
      return prev.map(it => {
        const patch = {}
        if (!skipHasRate && !(n(it.has_rate) > 0)) patch.has_rate = hasRate
        if (!(n(it.sell_rate) > 0)) patch.sell_rate = hasRate
        return Object.keys(patch).length ? { ...it, ...patch } : it
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasRate, items.length])

  // Blerje Flori — llogarit auto vetëm çmimin e shitjes:
  //   sell_price = has_gram × multiplier × kursi_shitje × (1 + tvsh/100)
  //                 (sell_rate — per rresht; fallback te has_rate)
  // has_gram, kodi, gram, has_rate merren nga importi/user-i pa formulë.
  useEffect(() => {
    if (forcedCategory !== 'flori') return
    setItems(prev => {
      let changed = false
      const next = prev.map(it => {
        const hg  = n(it.has_gram)
        const mul = n(it.multiplier)
        const hr  = n(it.has_rate)
        const sr  = n(it.sell_rate)
        const vat = n(it.vat_rate) || 0
        if (hg <= 0 || mul <= 0) return it
        const sellR   = sr > 0 ? sr : hr
        if (sellR <= 0) return it
        const newSell = +(hg * mul * sellR * (1 + vat / 100)).toFixed(2)
        if (Math.abs(newSell - n(it.sell_price)) < 0.005) return it
        changed = true
        return { ...it, sell_price: newSell }
      })
      return changed ? next : prev
    })
  }, [items, forcedCategory])

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
          // Rifresko splits — preferoj array-in e ruajtur; ndryshe krijoj një
          // split nga fushat legacy (payment_method + initial_amount_paid).
          const invCur = inv.currency || 'LEK'
          const invR = inv.exchange_rate || 1
          if (Array.isArray(inv.payment_splits) && inv.payment_splits.length > 0) {
            setPaymentSplits(inv.payment_splits.map(s => ({
              method: s.method === 'bank' ? 'bank' : 'cash',
              currency: (s.currency || 'LEK').toUpperCase(),
              amount: String(s.amount ?? ''),
              exchange_rate: String(s.exchange_rate ?? 1),
            })))
          } else {
            const rawPm = inv.payment_method === 'pos' ? 'bank' : inv.payment_method
            const pm = ['cash','bank','debt'].includes(rawPm) ? rawPm : 'cash'
            const initPaid = inv.initial_amount_paid != null ? inv.initial_amount_paid : inv.amount_paid
            const paid = parseFloat(initPaid) || 0
            if (pm === 'debt' || paid === 0) {
              setPaymentSplits([])
            } else {
              setPaymentSplits([{ method: pm === 'bank' ? 'bank' : 'cash', currency: invCur, amount: String(paid), exchange_rate: String(invR) }])
            }
          }
          setNotes(inv.notes || '')
          setIsGift(!!inv.is_gift)
          const invItems = (inv.items && inv.items.length > 0) ? inv.items : [emptyItem()]
          const mats = invItems.map(it => it.material).filter(Boolean)
          setCategory(forcedCategory || (mats.length > 0 && mats.every(m => m === mats[0]) ? mats[0] : ''))
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

  const addItem = () => setItems(prev => [...prev, {
    ...emptyItem(),
    // Për Blerje Flori, Kursi Blerje (has_rate) vendoset manualisht.
    has_rate: forcedCategory === 'flori' ? 0 : (hasRate || 0),
    sell_rate: hasRate || 0,
  }])

  // Blerje Diamant: (1) migro çdo discount_percent të vjetër → sell_discount_percent
  // dhe reseto discount_percent në 0 (që të mos zbresë nga total-i i blerjes).
  // (2) llogarit sell_price = cost_price × multiplier × (1 + tvsh/100) × (1 − sell_disc/100).
  useEffect(() => {
    if (forcedCategory !== 'diamant') return
    setItems(prev => {
      let changed = false
      const next = prev.map(it => {
        let out = it
        // Migrimi i njëhershëm: nëse discount_percent > 0 dhe sell_discount_percent
        // është ende bosh, transfero. Pastaj hiq discount_percent.
        if (n(it.discount_percent) > 0) {
          out = {
            ...out,
            sell_discount_percent: n(out.sell_discount_percent) > 0
              ? n(out.sell_discount_percent)
              : n(it.discount_percent),
            discount_percent: 0,
          }
          changed = true
        }
        const cp  = n(out.cost_price)
        const mul = n(out.multiplier)
        const vat = n(out.vat_rate) || 0
        const dsc = n(out.sell_discount_percent) || 0
        if (cp <= 0 || mul <= 0) return out
        const newSell = +(cp * mul * (1 + vat / 100) * (1 - dsc / 100)).toFixed(2)
        if (Math.abs(newSell - n(out.sell_price)) < 0.005) return out
        changed = true
        return { ...out, sell_price: newSell }
      })
      return changed ? next : prev
    })
  }, [items, forcedCategory])
  const removeItem = async (idx) => {
    // Kërko konfirmim vetëm nëse rreshti ka të dhëna — që klikim aksidental te
    // ✕ mos të fshijë punën e user-it. Rreshtat totalisht bosh (template
    // fillestar) fshihen menjëherë sepse s'ka çfarë të humbet.
    const it = items[idx] || {}
    const hasData = !!(
      String(it.barcode || '').trim() ||
      String(it.name || '').trim() ||
      String(it.serial_no || '').trim() ||
      (parseFloat(it.qty) || 0) > 0 ||
      (parseFloat(it.gram) || 0) > 0 ||
      (parseFloat(it.purchase_price_no_vat) || 0) > 0 ||
      (parseFloat(it.cost_price) || 0) > 0 ||
      (parseFloat(it.has_gram) || 0) > 0
    )
    if (hasData) {
      const label = String(it.name || '').trim() || String(it.barcode || '').trim() || `rreshti #${idx + 1}`
      const ok = await showConfirm(`Të fshihet rreshti "${label}" nga fatura?`, {
        title: 'Fshi rreshtin', confirmLabel: 'Fshi', danger: true,
      })
      if (!ok) return
    }
    setItems(prev => prev.length === 1 ? [emptyItem()] : prev.filter((_, i) => i !== idx))
  }

  // Gjenero barkod për një rresht. Nëse rreshti është produkt ekzistues, e
  // ruajmë menjëherë në DB që skaneri të gjejë produktin edhe para se të
  // ruhet fatura. Në produktet e reja, mbetet vetëm në state deri në ruajtje.
  const generateForRow = async (idx) => {
    const it = items[idx]
    if (it.barcode && !(await showConfirm('Ky rresht ka tashmë një barkod. Zëvendëso me një të ri?', {
      title: 'Zëvendëso barkodin', confirmLabel: 'Zëvendëso',
    }))) return
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

  // Vazhdon sekuencën e barkodit duke marrë atë të rreshtit të parë të plotësuar
  // si "seed" (p.sh. "PRE00001" → prefiks "PRE", numër fillestar 1, padding 5).
  // Rreshtat pa barkod pas seed-it marrin automatikisht numrat pasues (PRE00002,
  // PRE00003, ...). Rreshtat me barkod nuk preken.
  const continueBarcodeSequence = async () => {
    const seedIdx = items.findIndex(it => it.barcode && String(it.barcode).trim())
    if (seedIdx === -1) {
      alert('Shkruaj një barkod si "PRE00001" te rreshti i parë, pastaj kliko përsëri.')
      return
    }
    const seed = String(items[seedIdx].barcode).trim()
    const m = seed.match(/^(.*?)(\d+)$/)
    if (!m) {
      alert(`Barkodi "${seed}" duhet të mbarojë me shifra (p.sh. PRE00001).`)
      return
    }
    const prefix = m[1]
    const padding = m[2].length
    const start = parseInt(m[2], 10)
    const targets = items
      .map((it, i) => ({ it, i }))
      .filter(({ it, i }) => i > seedIdx && (!it.barcode || !String(it.barcode).trim()))
    if (targets.length === 0) {
      alert('S\'ka rreshta bosh pas seed-it për të plotësuar.')
      return
    }
    if (!(await showConfirm(
      `Plotëso ${targets.length} rreshta me sekuencën ${prefix}${String(start + 1).padStart(padding, '0')} … ${prefix}${String(start + targets.length).padStart(padding, '0')}?`,
      { title: 'Plotëso sekuencën', confirmLabel: 'Plotëso' }
    ))) return
    setItems(prev => prev.map((it, i) => {
      const t = targets.find(x => x.i === i)
      if (!t) return it
      const seq = start + (targets.indexOf(t) + 1)
      return { ...it, barcode: `${prefix}${String(seq).padStart(padding, '0')}` }
    }))
  }

  const generateForEmptyRows = async () => {
    const targets = items
      .map((it, i) => ({ it, i }))
      .filter(({ it }) => !it.barcode || !String(it.barcode).trim())
    if (targets.length === 0) { alert('Të gjithë rreshtat kanë tashmë barkod.'); return }
    if (!(await showConfirm(`Gjenero barkod për ${targets.length} rreshta bosh?`, {
      title: 'Gjenero barkod', confirmLabel: 'Gjenero',
    }))) return
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

  // ── Splits pagese ─────────────────────────────────────────────────────────
  const addSplit = (method = 'cash') => {
    const cur = currency
    const rate = allRates[cur] != null ? String(allRates[cur]) : String(exchangeRate || 1)
    setPaymentSplits(prev => [...prev, { method, currency: cur, amount: '', exchange_rate: rate }])
  }

  const updateSplit = (idx, patch) => {
    setPaymentSplits(prev => {
      const nextArr = prev.map((s, i) => {
        if (i !== idx) return s
        const next = { ...s, ...patch }
        if (patch.currency && patch.currency !== s.currency) {
          const r = allRates[patch.currency]
          next.exchange_rate = r != null ? String(r) : '1'
        }
        return next
      })
      if (patch.currency && nextArr.length > 0) {
        const first = nextArr[0].currency
        const allSame = nextArr.every(s => s.currency === first)
        if (allSame && first !== currency) changeCurrency(first)
      }
      return nextArr
    })
  }

  const removeSplit = (idx) => setPaymentSplits(prev => prev.filter((_, i) => i !== idx))

  // Kur user-i editon manualisht kursin e faturës, sinkronizo edhe kursin e
  // çdo splits që është në monedhën e faturës — kështu "shuma e paguar në
  // monedhën e faturës" mbetet e njëjtë (p.sh. 5000 EUR mbetet 5000 EUR,
  // s'ndryshohet në 4200 EUR sepse kursi ndryshoi).
  const changeExchangeRate = (newRate) => {
    setExchangeRate(newRate)
    const r = String(newRate)
    setPaymentSplits(prev => prev.map(s => s.currency === currency ? { ...s, exchange_rate: r } : s))
  }

  // Total i paguar në monedhën e faturës — konverton çdo split → LEK → faturës.
  const splitsPaidInInvoice = (() => {
    const invR = parseFloat(exchangeRate) || 1
    let lek = 0
    for (const s of paymentSplits) {
      const amt = parseFloat(s.amount) || 0
      const r = parseFloat(s.exchange_rate) || 1
      lek += amt * r
    }
    return invR > 0 ? +(lek / invR).toFixed(2) : 0
  })()

  const inferPaymentMethod = (splits, invoiceCurrency) => {
    if (splits.length === 0) return 'debt'
    if (splits.length === 1 && splits[0].currency === invoiceCurrency) {
      return splits[0].method === 'bank' ? 'bank' : 'cash'
    }
    return 'mikse'
  }

  // Map imported products → invoice items. Drop the leading empty placeholder
  // row if the user hasn't touched it, otherwise append.
  const handleImported = (products, ids) => {
    const newItems = products.map((p, i) => ({
      product_id: ids[i] || null,
      barcode:               p.barcode || '',
      name:                  p.name,
      qty:                   p.stock > 0 ? p.stock : 1,
      gram:                  p.gram || 0,
      kodi:                  p.kodi || 0,
      has_gram:              p.has_gram || 0,
      has_rate:              p.has_rate || 0,
      has_rate_currency:     'USD',
      cost_price:            eurToInvoiceCurrency(p.cost_price || 0),
      purchase_price_no_vat: eurToInvoiceCurrency(p.cost_price || 0),
      discount_percent:      0,
      vat_rate:              0,
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
      vat_rate: 0,
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
    // Bllokim absolut për rreshta me përshkrim por sasi 0 — përndryshe produkti
    // krijohet me stock=0 dhe kalon në inventar bosh. User-i duhet të mbushë
    // sasinë ose të fshijë rreshtin para ruajtjes.
    const zeroQty = valid.filter(it => it.name && it.name.trim() && n(it.qty) <= 0)
    if (zeroQty.length > 0) {
      const list = zeroQty.slice(0, 15).map((it, i) => `  ${i + 1}. ${it.name}${it.barcode ? ` [${it.barcode}]` : ''}`).join('\n')
      const more = zeroQty.length > 15 ? `\n  … dhe ${zeroQty.length - 15} të tjera` : ''
      const noun = zeroQty.length === 1 ? 'një produkt' : `${zeroQty.length} produkte`
      const verb = zeroQty.length === 1 ? 'do të mbetet' : 'do të mbeten'
      await showConfirm(
        `⛔ Keni ${noun} me stok 0!\n\n${zeroQty.length === 1 ? 'Ky produkt' : 'Këto produkte'} ${verb} pa stok në inventar sepse ${zeroQty.length === 1 ? 'sasia është' : 'sasitë janë'} = 0:\n\n${list}${more}\n\nMbush sasinë (ose fshi rreshtin) para se të ruash faturën.`,
        { title: 'Sasi e paplotësuar — nuk mund të ruhet', confirmLabel: 'Kuptohet', danger: true, hideCancel: true }
      )
      return
    }
    setSaving(true)
    try {
      const splitsPayload = paymentSplits
        .map(s => ({
          method: s.method === 'bank' ? 'bank' : 'cash',
          currency: (s.currency || 'LEK').toUpperCase(),
          amount: parseFloat(s.amount) || 0,
          exchange_rate: parseFloat(s.exchange_rate) || 1,
        }))
        .filter(s => s.amount !== 0)
      const inferredPm = inferPaymentMethod(splitsPayload, currency)
      const payload = {
        date: invoiceDate, invoice_no: invoiceNo,
        supplier_name: supplierName,
        supplier_nipt: supplierNipt,
        currency,
        exchange_rate: parseFloat(exchangeRate) || 1,
        payment_method: inferredPm,
        payment_splits: splitsPayload,
        // Fushat legacy — backend-i i injoron kur ka payment_splits, por i mbajmë
        // për backward compat me çdo konsumator të vjetër që lexon nga payload-i.
        amount_paid: 0,
        notes,
        is_gift: isGift ? 1 : 0,
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
    return <div className="card p-8 text-center text-slate-400 dark:text-slate-500">Duke ngarkuar faturën...</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="btn-secondary">← Mbrapa</button>
          <div>
            <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">
              {invoiceId
                ? (title ? `Edito ${title}` : 'Edito Faturën Blerje')
                : (title ? `${title} e Re` : 'Faturë Blerje e Re')}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">Nr. {invoiceNo}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="btn-secondary">Anulo</button>
          <button onClick={save} disabled={saving} className="btn-primary disabled:opacity-50 flex items-center gap-2">
            {saving ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
                  <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                </svg>
                Duke ruajtur...
              </>
            ) : '💾 Ruaj Faturën'}
          </button>
        </div>
      </div>

      <div className="card grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <label className="form-label">Nr. Fature <span className="text-[10px] text-slate-400 dark:text-slate-500">(auto)</span></label>
          <input type="text" value={invoiceNo} readOnly className="input-field font-mono bg-slate-50 dark:bg-slate-900 cursor-not-allowed" />
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
            <span className="ml-1 text-[10px] text-slate-400 dark:text-slate-500">(1 {currency} = ? LEK)</span>
          </label>
          <input type="number" step="0.0001" min="0"
            value={exchangeRate} onChange={e => changeExchangeRate(e.target.value)}
            disabled={currency === 'LEK'} className="input-field disabled:bg-slate-50" />
          <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">Burimi: <span className="font-medium">{rateSource || '—'}</span></p>
        </div>
        <div>
          <label className="form-label">Kategoria</label>
          {forcedCategory ? (() => {
            const cat = materialCategories.find(c => c.slug === forcedCategory)
            const label = cat ? (cat.icon ? `${cat.icon} ${cat.label}` : cat.label) : forcedCategory
            return (
              <div className="input-field bg-slate-50 dark:bg-slate-900 cursor-not-allowed font-semibold text-slate-700 dark:text-slate-200">
                {label} <span className="text-[10px] text-slate-400 ml-1">(e kyçur)</span>
              </div>
            )
          })() : (
            <MaterialCategoryPicker
              value={category}
              onChange={setCategory}
              categories={materialCategories}
              onChanged={loadMaterialCategories}
            />
          )}
          <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">Aplikohet për të gjithë artikujt e faturës</p>
        </div>
        <div className="col-span-2 md:col-span-4">
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <label className="form-label !mb-0">Pagesa ndaj Furnitorit</label>
          </div>
          {(() => {
            const tot = totals.tot
            const sumPaid = splitsPaidInInvoice
            const due = +(tot - sumPaid).toFixed(2)
            const invR = parseFloat(exchangeRate) || 1
            return (
              <div className="mt-3 space-y-3">
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400">
                      <tr>
                        <th className="px-2 py-2 text-left font-semibold w-28">Metoda</th>
                        <th className="px-2 py-2 text-left font-semibold w-24">Monedha</th>
                        <th className="px-2 py-2 text-right font-semibold">Shuma</th>
                        <th className="px-2 py-2 text-right font-semibold w-32">= në {currency}</th>
                        <th className="px-2 py-2 w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {paymentSplits.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-3 py-4 text-center text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 text-xs">
                            ⚠️ Asnjë pagesë — fatura do të mbetet <span className="font-semibold">borxh i plotë ndaj furnitorit</span>. Përdor butonat më poshtë për të shtuar pagesë.
                          </td>
                        </tr>
                      )}
                      {paymentSplits.map((s, idx) => {
                        const amt = parseFloat(s.amount) || 0
                        const r = parseFloat(s.exchange_rate) || 1
                        const inInv = invR > 0 ? +((amt * r) / invR).toFixed(2) : 0
                        return (
                          <tr key={idx} className="border-t border-slate-100 dark:border-slate-800">
                            <td className="px-1 py-1">
                              <select value={s.method} onChange={e => updateSplit(idx, { method: e.target.value })}
                                className="input-field-sm">
                                <option value="cash">💵 Cash</option>
                                <option value="bank">💳 POS/Bankë</option>
                              </select>
                            </td>
                            <td className="px-1 py-1">
                              <select value={s.currency} onChange={e => updateSplit(idx, { currency: e.target.value })}
                                className="input-field-sm">
                                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                              </select>
                            </td>
                            <td className="px-1 py-1">
                              <MoneyInput value={s.amount}
                                onChange={v => updateSplit(idx, { amount: v })}
                                className="input-field-sm text-right tabular-nums" placeholder="0.00" />
                            </td>
                            <td className="px-2 py-1 text-right tabular-nums text-slate-700 dark:text-slate-200">{fmt(inInv)}</td>
                            <td className="px-1 py-1 text-center">
                              <button type="button" onClick={() => removeSplit(idx)} className="text-red-500 hover:text-red-700 text-sm" title="Hiq">✕</button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  <div className="p-2 border-t border-slate-100 dark:border-slate-800 flex gap-2">
                    <button type="button" onClick={() => addSplit('cash')} className="btn-secondary text-xs">+ Shto Cash</button>
                    <button type="button" onClick={() => addSplit('bank')} className="btn-secondary text-xs">+ Shto POS/Bankë</button>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-semibold">Totali ({currency})</label>
                    <div className="input-field bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-200 tabular-nums font-bold">{fmt(tot)}</div>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-semibold">Shuma e Paguar ({currency})</label>
                    <div className="input-field bg-teal-50 text-teal-700 border-teal-200 tabular-nums font-bold">{fmt(sumPaid)}</div>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-semibold">Borxh ndaj Furnitorit ({currency})</label>
                    {(() => {
                      // Kur totali është 0 por s'ka pagesa, ekrani është ende bosh — mesazh i thjeshtë.
                      // Kur totali është 0 por ka pagesa, ka gjasa që user-i s'ka vënë "Cmim blerje".
                      const hasAnyItemContent = items.some(it => it.product_id || (it.name && it.name.trim()) || n(it.qty) > 0 || n(it.purchase_price_no_vat) > 0)
                      if (tot <= 0.005) {
                        const msg = hasAnyItemContent
                          ? '— vendos "Cmim blerje" tek artikujt'
                          : '— shto artikuj së pari'
                        return (
                          <div className="input-field tabular-nums font-bold bg-slate-50 dark:bg-slate-900 text-slate-400 dark:text-slate-500 border-slate-200">{msg}</div>
                        )
                      }
                      return (
                        <div className={`input-field tabular-nums font-bold ${due > 0.005 ? 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-200' : due < -0.005 ? 'bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border-purple-200' : 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-200'}`}>
                          {due > 0.005 ? fmt(due) : due < -0.005 ? `+${fmt(-due)} tepër` : '✓ Paguar plotësisht'}
                        </div>
                      )
                    })()}
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
        {!forcedCategory && (
          <div className="col-span-2">
            <label className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer transition-colors ${isGift ? 'bg-rose-50 border-rose-300 text-rose-700 dark:bg-rose-900/30 dark:border-rose-800 dark:text-rose-300' : 'bg-white border-slate-200 text-slate-600 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300'}`}>
              <input type="checkbox" checked={isGift}
                onChange={e => setIsGift(e.target.checked)}
                className="w-4 h-4 accent-rose-600" />
              <span className="text-sm font-semibold">🎁 Kjo faturë përmban <span className="underline">dhurata</span></span>
              <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400">(produktet do të markohen si dhurata në inventar)</span>
            </label>
          </div>
        )}
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 flex items-center gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-400">🔍</span>
          <input
            type="text"
            value={itemsSearch}
            onChange={e => setItemsSearch(e.target.value)}
            placeholder="Kërko në rreshta: barkod, pershkrim, SKU, seri..."
            className="input-field-sm flex-1 max-w-md"
          />
          {itemsSearch && (
            <button
              type="button"
              onClick={() => setItemsSearch('')}
              className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 px-2 py-1"
              title="Pastro filtrin"
            >✕</button>
          )}
          {itemsSearch && (
            <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              {items.filter(it => matchesItemSearch(it, itemsSearch)).length} / {items.length}
            </span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[1800px]">
            <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
              <tr className="text-slate-500 dark:text-slate-400">
                <th className="px-2 py-2 text-left font-semibold w-8">Nr.</th>
                <th className="px-2 py-2 text-left font-semibold w-56">Barkodi</th>
                <th className="px-2 py-2 text-left font-semibold w-80">Pershkrimi</th>
                <th className="px-2 py-2 text-right font-semibold w-14">Sasi</th>
                <th className="px-2 py-2 text-right font-semibold w-16">Gram</th>
                {forcedCategory === 'flori' && (
                  <th className="px-2 py-2 text-right font-semibold w-16 bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200" title="Kodi i floririt (p.sh. 585, 750) — përdoret si kodi/1000 në formulë">Kodi</th>
                )}
                {forcedCategory !== 'diamant' && (
                  <>
                    <th className="px-2 py-2 text-right font-semibold w-20 bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200" title="Pesha e florit të pastër (gram HAS)">Cmim Blerje Has</th>
                    <th className="px-2 py-2 text-right font-semibold w-28 bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200" title={forcedCategory === 'flori' ? 'Kursi i Blerjes — USD / gram HAS; vendoset manualisht nga user-i' : 'Kursi i Blerjes — USD / gram HAS; mbushet automatikisht nga çmimi aktual i florit'}>Kursi Blerje</th>
                  </>
                )}
                <th className="px-2 py-2 text-right font-semibold w-24">Cmim Blerje</th>
                {forcedCategory === 'diamant' && (
                  <>
                    <th className="px-2 py-2 text-right font-semibold w-24 bg-orange-50 text-orange-800 dark:bg-orange-900/30 dark:text-orange-200" title="Zbritje në € — konvertohet auto në % dhe zbritet nga totali (pa TVSH)">Zbritje €</th>
                    <th className="px-2 py-2 text-right font-semibold w-16 bg-orange-50 text-orange-800 dark:bg-orange-900/30 dark:text-orange-200" title="Zbritje në % mbi çmimin pa TVSH">Zbritje %</th>
                  </>
                )}
                {forcedCategory === 'flori' && (
                  <>
                    <th className="px-2 py-2 text-right font-semibold w-16 bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200" title="Shumëzues për çdo rresht — mbushet auto nga 'Shumëzues Shitjeje' në krye, mund të ndryshohet per rresht">Shumëzues</th>
                    <th className="px-2 py-2 text-right font-semibold w-24 bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200" title="Cmim Shitje Has = Cmim Blerje Has × Shumëzues">Cmim Shitje Has</th>
                  </>
                )}
                {forcedCategory !== 'diamant' && (
                  <th className="px-2 py-2 text-right font-semibold w-28 bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200" title="Kursi i Shitjes — EUR / gram HAS që përdoret për të llogaritur Çmimin e Shitjes">Kursi Shitje</th>
                )}
                <th className="px-2 py-2 text-right font-semibold w-14">TVSH %</th>
                {forcedCategory === 'diamant' && (
                  <th className="px-2 py-2 text-right font-semibold w-16 bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200" title="Shumëzues për çdo rresht — mbushet auto nga 'Shumëzues Shitjeje' në krye, mund të ndryshohet per rresht">Shumëzues</th>
                )}
                <th className="px-2 py-2 text-right font-semibold w-24 bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200">Cmim Shitje €</th>
                {forcedCategory === 'flori' && (
                  <>
                    <th className="px-2 py-2 text-right font-semibold w-16 bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200" title="Fitim % = (Cmim Shitje − Cmim Blerje) / Cmim Blerje × 100">Fitim %</th>
                    <th className="px-2 py-2 text-right font-semibold w-16 bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200" title="Marzh % = (Cmim Shitje − Cmim Blerje) / Cmim Shitje × 100">Marzh %</th>
                  </>
                )}
                <th className="px-2 py-2 text-center font-semibold w-24 bg-rose-600 text-white" title="Shënoje si produkt në promocion; jep % ulje">Promo · %</th>
                <th className="px-2 py-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {items
                .map((it, idx) => ({ it, idx }))
                .filter(({ it }) => matchesItemSearch(it, itemsSearch))
                .map(({ it, idx }) => {
                return (
                  <tr key={idx} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors">
                    <td className="px-2 py-1 text-center text-slate-400 dark:text-slate-500">{idx + 1}</td>
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
                          className="w-6 h-6 flex items-center justify-center rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 text-sm"
                          title="Gjenero barkod të ri (Code128, GS-XXXXXXXX)"
                        >🔀</button>
                        <button
                          type="button"
                          onClick={() => printLabels([it])}
                          disabled={!it.barcode}
                          className="w-6 h-6 flex items-center justify-center rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 text-sm disabled:opacity-30 disabled:cursor-not-allowed"
                          title="Printo etiketë për këtë produkt"
                        >🖨️</button>
                      </div>
                    </td>
                    <td className="px-1 py-1">
                      <ProductPickerCell
                        value={it}
                        onPick={p => pickProduct(idx, p)}
                        onNameChange={n => setItem(idx, { name: n })}
                      />
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
                    {forcedCategory === 'flori' && (
                      <td className="px-1 py-1 bg-amber-50/40 dark:bg-amber-900/10">
                        <input type="number" step="1" min="0" value={it.kodi || ''}
                          onChange={e => setItem(idx, { kodi: e.target.value })}
                          className="input-field-sm text-right font-semibold text-amber-800 dark:text-amber-200"
                          placeholder="585" />
                      </td>
                    )}
                    {forcedCategory !== 'diamant' && (
                      <>
                        <td className="px-1 py-1 bg-amber-50/40 dark:bg-amber-900/10">
                          <input type="number" step="0.001" min="0" value={it.has_gram || ''}
                            onChange={e => setItem(idx, { has_gram: e.target.value })}
                            className="input-field-sm text-right font-semibold text-amber-800 dark:text-amber-200"
                            placeholder="0.00" />
                        </td>
                        <td className="px-1 py-1 bg-amber-50/40 dark:bg-amber-900/10">
                          <div className="flex items-center gap-1">
                            <MoneyInput value={it.has_rate}
                              onChange={v => setItem(idx, { has_rate: v })}
                              className="input-field-sm text-right font-semibold text-amber-800 dark:text-amber-200 flex-1 min-w-0"
                              placeholder={forcedCategory !== 'flori' && hasRateLoading ? '…' : '0.00'} />
                            <span
                              title="Valuta: USD (fikse për Kursi Blerje)"
                              className="px-1.5 py-0.5 rounded border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-800 text-xs font-bold text-amber-800 dark:text-amber-200 leading-none shrink-0"
                            >$</span>
                          </div>
                        </td>
                      </>
                    )}
                    <td className="px-1 py-1">
                      <MoneyInput value={it.cost_price}
                        onChange={v => setItem(idx, { cost_price: v })}
                        className="input-field-sm text-right"
                      />
                    </td>
                    {forcedCategory === 'diamant' && (() => {
                      // Zbritja mbi Cmim Shitje: reduktohet sell_price = cost × mul × (1 + tvsh/100) × (1 − disc/100).
                      // Base = qty × cost_price × multiplier × (1 + tvsh/100) (para zbritjes, me TVSH).
                      // Zbritje € interpretohet me TVSH — përputhet me Cmim Shitje që shfaqet me TVSH.
                      const qty  = n(it.qty)
                      const cp   = n(it.cost_price)
                      const mul  = n(it.multiplier)
                      const vat  = n(it.vat_rate) || 0
                      const dsc  = n(it.sell_discount_percent) || 0
                      const base = qty * cp * mul * (1 + vat / 100)
                      const discEur = base > 0 ? +(base * dsc / 100).toFixed(2) : 0
                      return (
                        <>
                          <td className="px-1 py-1 bg-orange-50/40 dark:bg-orange-900/10">
                            <MoneyInput
                              value={discEur}
                              onChange={eur => {
                                if (base <= 0) { setItem(idx, { sell_discount_percent: 0 }); return }
                                const pct = Math.max(0, Math.min(100, (eur / base) * 100))
                                setItem(idx, { sell_discount_percent: +pct.toFixed(4) })
                              }}
                              className="input-field-sm text-right font-semibold text-orange-800 dark:text-orange-200"
                              placeholder="0.00"
                            />
                          </td>
                          <td className="px-1 py-1 bg-orange-50/40 dark:bg-orange-900/10">
                            <input
                              type="number" step="0.01" min="0" max="100" value={it.sell_discount_percent ?? 0}
                              onChange={e => setItem(idx, { sell_discount_percent: e.target.value })}
                              className="input-field-sm text-right font-semibold text-orange-800 dark:text-orange-200"
                              placeholder="0"
                            />
                          </td>
                        </>
                      )
                    })()}
                    {forcedCategory === 'flori' && (() => {
                      // Cmim Shitje Has = Cmim Blerje Has × Shumëzues
                      const hg  = n(it.has_gram)
                      const mul = n(it.multiplier)
                      const hasSell = hg > 0 && mul > 0 ? +(hg * mul).toFixed(2) : 0
                      return (
                        <>
                          <td className="px-1 py-1 bg-emerald-50/40 dark:bg-emerald-900/10">
                            <input type="number" step="0.01" min="0" value={it.multiplier || ''}
                              onChange={e => setItem(idx, { multiplier: e.target.value })}
                              className="input-field-sm text-right font-semibold text-emerald-800 dark:text-emerald-200"
                              placeholder="1.8"
                              title="Shumëzues per rresht — override i vlerës globale" />
                          </td>
                          <td className="px-1 py-1 bg-emerald-50/40 dark:bg-emerald-900/10 text-right font-semibold text-emerald-800 dark:text-emerald-200"
                              title="Auto: Cmim Blerje Has × Shumëzues">
                            {hasSell > 0 ? hasSell.toFixed(2) : '—'}
                          </td>
                        </>
                      )
                    })()}
                    {forcedCategory !== 'diamant' && (
                      <td className="px-1 py-1 bg-emerald-50/40 dark:bg-emerald-900/10">
                        <div className="flex items-center gap-1">
                          <MoneyInput value={it.sell_rate}
                            onChange={v => setItem(idx, { sell_rate: v })}
                            className="input-field-sm text-right font-semibold text-emerald-800 dark:text-emerald-200 flex-1 min-w-0"
                            placeholder={hasRateLoading ? '…' : '0.00'} />
                          <CurrencyToggle value={it.sell_rate_currency}
                            onChange={v => setItem(idx, {
                              sell_rate_currency: v,
                              sell_rate: convertRateCurrency(it.sell_rate, it.sell_rate_currency, v, allRates),
                            })} />
                        </div>
                      </td>
                    )}
                    <td className="px-1 py-1">
                      <input type="number" step="0.01" min="0" max="100" value={it.vat_rate}
                        onChange={e => setItem(idx, { vat_rate: e.target.value })}
                        className="input-field-sm text-right" />
                    </td>
                    {forcedCategory === 'diamant' && (
                      <td className="px-1 py-1 bg-emerald-50/40 dark:bg-emerald-900/10">
                        <input type="number" step="0.01" min="0" value={it.multiplier || ''}
                          onChange={e => setItem(idx, { multiplier: e.target.value })}
                          className="input-field-sm text-right font-semibold text-emerald-800 dark:text-emerald-200"
                          placeholder="1.8"
                          title="Shumëzues per rresht — override i vlerës globale" />
                      </td>
                    )}
<td className="px-1 py-1 bg-emerald-50 dark:bg-emerald-900/30">
                      {(() => {
                        const floriAuto = forcedCategory === 'flori' && n(it.kodi) > 0 && n(it.multiplier) > 0
                        const diamAuto  = forcedCategory === 'diamant' && n(it.cost_price) > 0 && n(it.multiplier) > 0
                        const auto      = floriAuto || diamAuto
                        const autoTitle = floriAuto ? 'Auto: has_gram × Shumëzues × Kursi × (1 + TVSH%)'
                                        : diamAuto  ? 'Auto: Cmim Blerje × Shumëzues × (1 + TVSH%)'
                                                    : undefined
                        return (
                          <MoneyInput value={it.sell_price}
                            onChange={v => setItem(idx, { sell_price: v })}
                            disabled={auto}
                            className={`input-field-sm text-right font-semibold text-emerald-800 dark:text-emerald-200 ${auto ? 'bg-slate-100 dark:bg-slate-800 cursor-not-allowed' : ''}`}
                            {...(autoTitle ? { title: autoTitle } : {})} />
                        )
                      })()}
                    </td>
                    {forcedCategory === 'flori' && (() => {
                      const cp = n(it.cost_price), sp = n(it.sell_price)
                      const fit = cp > 0 ? ((sp - cp) / cp) * 100 : 0
                      const mar = sp > 0 ? ((sp - cp) / sp) * 100 : 0
                      const cls = (v) => v > 0
                        ? 'text-emerald-700 dark:text-emerald-300'
                        : v < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400 dark:text-slate-500'
                      return (
                        <>
                          <td className={`px-1 py-1 text-right tabular-nums font-semibold ${cls(fit)}`}>
                            {cp > 0 ? fit.toFixed(1) + '%' : '—'}
                          </td>
                          <td className={`px-1 py-1 text-right tabular-nums font-semibold ${cls(mar)}`}>
                            {sp > 0 ? mar.toFixed(1) + '%' : '—'}
                          </td>
                        </>
                      )
                    })()}
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
            <tfoot className="bg-blue-50 dark:bg-blue-900/30 border-t-2 border-blue-200">
              <tr className="font-bold text-xs">
                <td colSpan={forcedCategory === 'flori' ? 17 : forcedCategory === 'diamant' ? 12 : 11} className="px-2 py-2 text-right text-slate-600 dark:text-slate-300">
                  TOTALI ({currency}) — pa TVSH: <span className="tabular-nums text-slate-800 dark:text-slate-100">{fmt(totals.sub)}</span>
                  {' · '}TVSH: <span className="tabular-nums text-slate-800 dark:text-slate-100">{fmt(totals.vat)}</span>
                  {' · '}me TVSH: <span className="tabular-nums text-blue-700 dark:text-blue-300 text-sm">{fmt(totals.tot)}</span>
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="p-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={addItem} className="btn-secondary text-xs">+ Shto Artikull</button>
            <button onClick={() => setShowImport(true)} className="btn-secondary text-xs">📥 Importo Excel</button>
            <button
              onClick={generateForEmptyRows}
              className="btn-secondary text-xs"
              title="Gjenero barkod Code128 (GS-XXXXXXXX) për çdo rresht që s'ka ende barkod"
            >🔀 Gjenero Barkodet</button>
            <button
              onClick={continueBarcodeSequence}
              className="btn-secondary text-xs"
              title="Shkruaj p.sh. PRE00001 te rreshti i parë, pastaj kliko këtu — rreshtat pa barkod plotësohen me PRE00002, PRE00003, ..."
            >🔢 Numëro Barkod</button>
            <button
              onClick={printAllLabels}
              className="text-xs bg-slate-900 dark:bg-slate-950 hover:bg-slate-800 text-white font-semibold px-2 py-1.5 rounded-lg"
              title="Printo etiketa (50×30mm) për të gjithë rreshtat me barkod"
            >🖨️ Printo Barkod</button>
            <div className="flex items-center gap-1 pl-2 border-l border-slate-200 dark:border-slate-700">
              <span className="text-[10px] text-emerald-700 dark:text-emerald-300 font-semibold uppercase">Shumëzues:</span>
              <input
                type="text"
                inputMode="decimal"
                value={bulkMultiplier}
                onChange={e => setBulkMultiplier(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.nextElementSibling?.click() } }}
                className="input-field-sm text-center w-24 font-bold text-emerald-700 dark:text-emerald-300"
                placeholder="p.sh. 2.5"
                title="Vendos vetë shumëzuesin (p.sh. 2.5 = blerje × 2.5)"
              />
              <button
                onClick={async () => {
                  const m = parseFloat(String(bulkMultiplier).replace(',', '.'))
                  if (!m || m <= 0) { alert('Vendos një shumëzues > 0.'); return }
                  const isEligible = (it) => {
                    if (forcedCategory === 'flori')   return n(it.has_gram) > 0
                    if (forcedCategory === 'diamant') return n(it.cost_price) > 0
                    return n(it.purchase_price_no_vat) > 0
                  }
                  const eligible = items.filter(isEligible).length
                  if (eligible === 0) {
                    const msg = forcedCategory === 'flori'
                      ? 'Asnjë rresht me Has Gram > 0.'
                      : forcedCategory === 'diamant'
                        ? 'Asnjë rresht me Cmim Blerje > 0.'
                        : 'Asnjë rresht me Çm. Blerje > 0.'
                    alert(msg); return
                  }
                  if (!(await showConfirm(`Vendos Shumëzues = ${m} për ${eligible} rreshta?`, {
                    title: 'Apliko shumëzuesin', confirmLabel: 'Apliko',
                  }))) return
                  // Setojmë `multiplier` në të gjithë rreshtat eligible:
                  //  (1) kolona "Shumëzues" shfaqet e mbushur për çdo rresht
                  //  (2) formula e Cmim Shitje HAS (has_gram × multiplier × sell_rate)
                  //      te Flori/Diamant aktivizohet auto nga useEffect-i.
                  // Për kategori të tjera vendos edhe `sell_price` si fallback.
                  setItems(prev => prev.map(it => {
                    if (!isEligible(it)) return it
                    if (forcedCategory === 'flori' || forcedCategory === 'diamant') {
                      return { ...it, multiplier: m }
                    }
                    return {
                      ...it,
                      multiplier: m,
                      sell_price: +(n(it.purchase_price_no_vat) * m).toFixed(2),
                    }
                  }))
                }}
                className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-2 py-1.5 rounded-lg"
                title="Vendos Çm. Shitje = Çm. Blerje × shumëzues për të gjithë rreshtat"
              >⚡ Apliko ×</button>
            </div>
            <div className="flex items-center gap-1 pl-2 border-l border-slate-200 dark:border-slate-700">
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
                onClick={async () => {
                  const pct = Math.max(0, Math.min(100, parseFloat(bulkPromoPct) || 0))
                  const eligible = items.filter(it => it.product_id).length
                  if (eligible === 0) { alert('Asnjë rresht me produkt të lidhur. Zgjidh një produkt ekzistues për çdo rresht.'); return }
                  if (!(await showConfirm(`Vër ${eligible} produkte në promocion me ${pct}% ulje?`, {
                    title: 'Vër në promocion', confirmLabel: 'Apliko',
                  }))) return
                  setItems(prev => prev.map(it => it.product_id
                    ? { ...it, is_promotion: true, promo_discount_pct: pct }
                    : it))
                }}
                className="text-xs bg-rose-600 hover:bg-rose-500 text-white font-semibold px-2 py-1.5 rounded-lg"
                title="Shënoji të gjitha produktet e lidhur si promocion me % e mësipërme"
              >🏷️ Vër të gjitha</button>
              <button
                onClick={async () => {
                  const eligible = items.filter(it => it.is_promotion).length
                  if (eligible === 0) return
                  if (!(await showConfirm(`Hiq ${eligible} produkte nga promocioni?`, {
                    title: 'Hiq nga promocioni', confirmLabel: 'Hiq', danger: true,
                  }))) return
                  setItems(prev => prev.map(it => it.is_promotion
                    ? { ...it, is_promotion: false, promo_discount_pct: 0 }
                    : it))
                }}
                className="text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50 text-slate-600 dark:text-slate-300 px-2 py-1.5 rounded-lg"
                title="Hiq promocionin nga të gjithë rreshtat e faturës aktuale"
              >Hiq</button>
            </div>
          </div>
          <p className="text-[10px] text-slate-500 dark:text-slate-400">
            <span className="inline-block w-3 h-3 bg-emerald-100 mr-1 align-middle border border-emerald-300"></span>
            Çmimi i Shitjes do aplikohet automatikisht në produkt → përdoret te FATURA SHITJE
          </p>
        </div>
      </div>

      {showImport && (
        <ImportExcelModal
          onClose={() => setShowImport(false)}
          onImported={handleImported}
          forcedCategory={forcedCategory}
          overrideCategoryLabel={(() => {
            if (!category) return null
            const found = materialCategories.find(c => c.slug === category)?.label
            if (found) return found
            // Fallback kur material_categories është bosh (p.sh. pas reset-i):
            // kapitalizo slug-un — 'flori' → 'Flori', 'diamant' → 'Diamant'.
            return category.charAt(0).toUpperCase() + category.slice(1)
          })()}
        />
      )}

      {saving && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl px-8 py-6 flex items-center gap-4 max-w-sm">
            <svg className="animate-spin h-8 w-8 text-blue-600 flex-shrink-0" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
              <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
            </svg>
            <div>
              <p className="font-semibold text-slate-800 dark:text-slate-100">Duke ruajtur faturën...</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {items.length} {items.length === 1 ? 'artikull' : 'artikuj'} — mund të zgjasë disa sekonda
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function FaturaBlerje({ date, openInvoiceId, onConsumeOpen, title, forcedCategory }) {
  const [mode, setMode] = useState('list')
  const [editingId, setEditingId] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)
  // Range i kërkimit ngrihet këtu (jo brenda PurchaseList) që të mbahet kur
  // user-i hap një faturë për ta modifikuar dhe kthehet mbrapa. Lazy init:
  // fillon te `date` (zakonisht sot), dhe s'reset-ohet kur `date` ndryshon —
  // vetëm butoni "Sot" ose ndërrimi i faqes e kthen te default-i.
  const [fromDate, setFromDate] = useState(() => date)
  const [toDate,   setToDate]   = useState(() => date)

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
    if (!(await showConfirm(`Fshi faturën e blerjes ${no}? Stoku do të zbritet.`, {
      title: 'Fshi faturën', confirmLabel: 'Fshi', danger: true,
    }))) return
    await fetch(`/api/purchase-invoices/${id}`, { method: 'DELETE' })
    setRefreshKey(k => k + 1)
  }

  if (mode === 'edit') {
    return <PurchaseEditor date={date} invoiceId={editingId} onClose={backToList} onSaved={onSaved} title={title} forcedCategory={forcedCategory} />
  }
  return (
    <PurchaseList
      date={date}
      onOpen={openInvoice}
      onCreate={createNew}
      onDelete={deleteInvoice}
      refreshKey={refreshKey}
      title={title}
      materialFilter={forcedCategory}
      fromDate={fromDate}
      setFromDate={setFromDate}
      toDate={toDate}
      setToDate={setToDate}
    />
  )
}
