import { useState, useEffect, useCallback, useRef } from 'react'
import { getUser } from '../lib/auth.js'
import MoneyInput from './MoneyInput.jsx'
import { showConfirm } from './ConfirmDialog.jsx'

const CURRENCIES = ['LEK', 'EUR', 'USD', 'GBP', 'CHF']

function n(v) { return parseFloat(v) || 0 }
function fmt(v) {
  const x = n(v)
  return x.toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Pjesa e faturës e paguar realisht me cash/bankë në momentin e regjistrimit.
// Snapshot — nuk merr parasysh pagesat e mëvonshme nga Detyrime modal.
// Për 'debt' merret parapagimi (mund të jetë > 0 nëse klienti la një pjesë kesh).
function truePaidCashPos(inv) {
  const pm = inv.payment_method || 'cash'
  if (pm === 'mikse') return n(inv.paid_cash) + n(inv.paid_pos) + n(inv.paid_bank)
  const init = inv.initial_amount_paid != null ? n(inv.initial_amount_paid) : n(inv.amount_paid)
  return init
}

// Ndanjë splits (nga endpoint list-i si string `method:cur:amount|...`) sipas
// (metodë, monedhë) dhe kthen array {method, currency, amount} për shfaqje.
function parseSplitsSummary(str) {
  if (!str) return []
  const map = new Map()
  for (const part of String(str).split('|')) {
    const [method, currency, amount] = part.split(':')
    if (!method || !currency) continue
    const key = `${method}:${currency}`
    const amt = parseFloat(amount) || 0
    map.set(key, (map.get(key) || 0) + amt)
  }
  return Array.from(map, ([key, amount]) => {
    const [method, currency] = key.split(':')
    return { method, currency, amount }
  })
}

function emptyItem() {
  return {
    product_id: null, serial_no: '', barcode: '', name: '',
    qty: 1, gram: 0, unit_price_no_vat: 0, discount_percent: 0,
    vat_rate: 0,
    on_promotion: 0, promo_discount_pct: 0,
    // Fusha flori per rresht — kur has_gram + multiplier + sell_rate > 0,
    // unit_price_no_vat llogaritet auto = has_gram × multiplier × sell_rate.
    // Përndryshe (produkte jo-flori) mbeten 0 dhe unit_price ndryshohet vetëm
    // proporcionalisht kur ndryshohet sell_rate.
    sell_rate: 0, has_gram: 0, multiplier: 0,
    // Dhuratë — kur 1, rreshti zbret stokun por nuk hyn në totalin e faturës.
    is_gift: 0,
  }
}

// Zbritje euro derivohet nga zbritje % dhe totali bruto i rreshtit ME TVSH.
// User-i mendon te "shitja finale" (303€) kur shkruan zbritje 3€ — do te dojë
// finalin -3€ (300€), jo -3€ off bazes pa TVSH (qe do te ishte -3.60€ off finalit).
function discountEurFor(it) {
  const base = (parseFloat(it.qty) || 0) * (parseFloat(it.unit_price_no_vat) || 0)
  const vatFactor = 1 + (parseFloat(it.vat_rate) || 0) / 100
  return base * vatFactor * ((parseFloat(it.discount_percent) || 0) / 100)
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
            className="px-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 text-xs" title="Pastro">✕</button>
        )}
      </div>
      {value?.customer_nipt && (
        <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
          NIPT: <span className="font-mono">{value.customer_nipt}</span>
          {value.phone && <> · Tel: <span className="font-mono">{value.phone}</span></>}
        </p>
      )}
      {open && (results.length > 0 || loading || showCreate) && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg max-h-64 overflow-y-auto">
          {loading && <div className="p-2 text-xs text-slate-400 dark:text-slate-500">Duke kërkuar...</div>}
          {results.map(c => (
            <button
              key={c.id}
              type="button"
              onClick={() => pick(c)}
              className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-slate-100 dark:border-slate-800 last:border-0"
            >
              <div className="text-sm font-medium text-slate-800 dark:text-slate-100">
                {clientFullName(c) || <span className="italic text-slate-400 dark:text-slate-500">— pa emër —</span>}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
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
              <div className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                + Krijo klient të ri: <span className="font-bold">{trimmedQuery}</span>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Emri: <span className="font-medium text-slate-700 dark:text-slate-200">{previewFirst || '—'}</span>
                {' · '}Mbiemri: <span className="font-medium text-slate-700 dark:text-slate-200">{previewLast || '—'}</span>
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
  // Pershkrimi është i pavarur nga barkodi — mos ridiktoj vlerën nga barcode-i,
  // sepse ndryshe kur user-i shkruan barkodin, ai duket edhe këtu.
  const [query, setQuery] = useState(value?.name || '')
  const [results, setResults] = useState([])
  const [open, setOpen]       = useState(false)
  const [loading, setLoading] = useState(false)
  const timerRef = useRef(null)
  const boxRef   = useRef(null)

  useEffect(() => {
    setQuery(value?.name || '')
  }, [value?.name])

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

  const handleKeyDown = async (e) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (results.length > 0) { pick(results[0]); return }
    // Skanerët e barkodit e dërgojnë Enter menjëherë pas karaktereve — më shpejt
    // se debounce-i 200ms. Bëj një kërkim direkt sinkron dhe zgjidh të parin
    // (backend-i e rendit exact-barcode të parin).
    const q = query.trim()
    if (!q) return
    clearTimeout(timerRef.current)
    setLoading(true)
    try {
      const data = await fetch(`/api/products/search?q=${encodeURIComponent(q)}`).then(r => r.json())
      const arr = Array.isArray(data) ? data : []
      if (arr.length > 0) pick(arr[0])
      else setResults([])
    } catch { /* ignore */ }
    setLoading(false)
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
        <div className="absolute z-20 left-0 right-0 mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl max-h-96 overflow-y-auto min-w-[420px]">
          {loading && <div className="p-3 text-xs text-slate-400 dark:text-slate-500">Duke kërkuar...</div>}
          {results.map(p => (
            <ProductResultItem key={p.id} product={p} onPick={pick} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Barcode input për kolonën Barkodi te secili rresht ─────────────────────
// Lejon shkrim/skanim manual: kërkon produkte me barkodin e shkruar dhe hap
// dropdown me rezultatet; me Enter (nga skaneri ose tastiera) zgjedh të parin.
function BarcodeSearchInput({ value, onTypedChange, onPick }) {
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

  const runSearch = (q, immediate = false) => {
    clearTimeout(timerRef.current)
    if (!q.trim()) { setResults([]); return }
    const fire = async () => {
      setLoading(true)
      try {
        const data = await fetch(`/api/products/search?q=${encodeURIComponent(q)}`).then(r => r.json())
        setResults(Array.isArray(data) ? data : [])
      } catch { setResults([]) }
      setLoading(false)
    }
    if (immediate) return fire()
    timerRef.current = setTimeout(fire, 200)
  }

  const pick = (p) => {
    onPick(p)
    setOpen(false)
  }

  const handleKeyDown = async (e) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (results.length > 0) { pick(results[0]); return }
    // Skaneri e dërgon Enter menjëherë — bëj kërkim sinkron dhe pick të parin.
    const q = query.trim()
    if (!q) return
    clearTimeout(timerRef.current)
    setLoading(true)
    try {
      const data = await fetch(`/api/products/search?q=${encodeURIComponent(q)}`).then(r => r.json())
      const arr = Array.isArray(data) ? data : []
      if (arr.length > 0) pick(arr[0])
      else setResults([])
    } catch { /* ignore */ }
    setLoading(false)
  }

  return (
    <div ref={boxRef} className="relative">
      <input
        type="text"
        value={query}
        placeholder="—"
        onChange={e => {
          const v = e.target.value
          setQuery(v)
          onTypedChange?.(v)
          runSearch(v)
          setOpen(true)
        }}
        onFocus={() => query && setOpen(true)}
        onKeyDown={handleKeyDown}
        className="input-field-sm font-mono"
      />
      {open && (results.length > 0 || loading) && (
        <div className="absolute z-20 left-0 mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl max-h-96 overflow-y-auto min-w-[420px]">
          {loading && <div className="p-3 text-xs text-slate-400 dark:text-slate-500">Duke kërkuar...</div>}
          {results.map(p => (
            <ProductResultItem key={p.id} product={p} onPick={pick} />
          ))}
        </div>
      )}
    </div>
  )
}

// Rresht i vetëm në dropdown-in e kërkimit: thumbnail + emër + badge kategorie
// + barkod + çmim (me PROMO nëse ka) + stok me ngjyra sipas gjendjes.
const CAT_EMOJI = {
  'Flori': '🟡', 'Diamant': '💎', 'Ora': '⌚', 'Unazë': '💍', 'Vathë': '✨',
  'Byzylyk': '📿', 'Gjerdan / Varëse': '🏅', 'Komplet': '🎁', 'Tjeter': '📦',
}
function ProductResultItem({ product: p, onPick }) {
  const basePrice  = parseFloat(p.sell_price) || 0
  const onPromo    = !!p.is_promotion && (parseFloat(p.promo_discount_pct) || 0) > 0
  const promoPrice = onPromo ? basePrice * (1 - parseFloat(p.promo_discount_pct) / 100) : basePrice
  const stock      = parseInt(p.stock) || 0
  const stockCls   = stock <= 0
    ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'
    : stock < 3
      ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
      : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
  const emoji      = CAT_EMOJI[p.category] || '📦'
  return (
    <button
      type="button"
      onClick={() => onPick(p)}
      className={`w-full text-left px-3 py-2 flex items-center gap-3 border-b border-slate-100 dark:border-slate-800 last:border-0 transition-colors ${onPromo ? 'hover:bg-rose-50 dark:hover:bg-rose-900/20' : 'hover:bg-blue-50 dark:hover:bg-blue-900/20'}`}
    >
      <div className="shrink-0 w-11 h-11 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 flex items-center justify-center overflow-hidden">
        {p.image_path ? (
          <img src={`/uploads/products/${p.image_path}`} alt="" className="w-full h-full object-cover" onError={e => { e.currentTarget.style.display = 'none' }} />
        ) : (
          <span className="text-xl leading-none">{emoji}</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <div className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{p.name}</div>
          {onPromo && <span className="text-[10px] bg-rose-600 text-white px-1.5 py-0.5 rounded font-bold shrink-0">-{p.promo_discount_pct}%</span>}
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200">{p.barcode || p.sku || '—'}</span>
          {p.category && <span className="text-slate-500 dark:text-slate-400">{emoji} {p.category}</span>}
          {p.gram > 0 && <span className="text-slate-400 dark:text-slate-500">· {parseFloat(p.gram).toFixed(2)}g</span>}
        </div>
      </div>
      <div className="shrink-0 text-right">
        {basePrice > 0 && (
          onPromo ? (
            <>
              <div className="text-[10px] line-through text-slate-400 dark:text-slate-500 leading-none">€{basePrice.toFixed(2)}</div>
              <div className="text-base font-bold text-rose-600 dark:text-rose-400 leading-tight">€{promoPrice.toFixed(2)}</div>
            </>
          ) : (
            <div className="text-base font-bold text-slate-800 dark:text-slate-100 leading-tight">€{basePrice.toFixed(2)}</div>
          )
        )}
        <div className={`inline-block mt-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded ${stockCls}`}>Stok: {stock}</div>
      </div>
    </button>
  )
}

// ── Partial return modal ────────────────────────────────────────────────────
// Ngarkon artikujt e faturës origjinale me sasi editable + checkbox. User
// zgjedh çfarë kthehet dhe në ç'sasi. Totali i rimbursimit rillogaritet live.
// Në submit thërret /api/invoices/:id/credit-note me `items: [{item_id, qty}]`.
function PartialReturnModal({ invoice, onClose, onCreated }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  // Për çdo item id: { selected: bool, qty: string }
  const [rows, setRows] = useState({})
  // Rimbursim manual — default '' (automatik nga totali i artikujve).
  // Kur user e ndryshon, dërgohet si refund_amount te backend-i.
  const [refundOverride, setRefundOverride] = useState('')
  const [refundTouched, setRefundTouched] = useState(false)
  // Metoda e rimbursimit — default cash për borxh/mikse, ose ai i faturës.
  // User mund ta ndryshojë (p.sh. pagesë me bankë, rimbursim me cash).
  const parentPm = (invoice.payment_method || 'cash').toLowerCase()
  const defaultRefundMethod = ['cash', 'bank', 'pos'].includes(parentPm) ? parentPm : 'cash'
  const [refundMethod, setRefundMethod] = useState(defaultRefundMethod)

  useEffect(() => {
    let cancel = false
    async function load() {
      setLoading(true)
      try {
        const inv = await fetch(`/api/invoices/${invoice.id}`).then(r => r.json())
        if (cancel) return
        const its = Array.isArray(inv.items) ? inv.items : []
        setItems(its)
        // Fillo me të gjitha të pazgjedhura + sasia = origjinali (që klienti të
        // klikojë vetëm ato që kthen dhe të përshtatë sasinë nëse duhet).
        const initial = {}
        for (const it of its) {
          initial[it.id] = { selected: false, qty: String(Math.abs(parseFloat(it.qty) || 0)) }
        }
        setRows(initial)
      } catch (_) {
        setItems([])
      } finally { if (!cancel) setLoading(false) }
    }
    load()
    return () => { cancel = true }
  }, [invoice.id])

  const toggle = (id) => setRows(r => ({ ...r, [id]: { ...r[id], selected: !r[id]?.selected } }))
  const setQty = (id, q) => setRows(r => ({ ...r, [id]: { ...r[id], qty: q } }))
  const selectAll = () => {
    setRows(r => {
      const next = { ...r }
      for (const it of items) next[it.id] = { ...next[it.id], selected: true }
      return next
    })
  }
  const selectNone = () => {
    setRows(r => {
      const next = { ...r }
      for (const it of items) next[it.id] = { ...next[it.id], selected: false }
      return next
    })
  }

  // Rreshtat e zgjedhur me sasi > 0 dhe totali i rimbursimit.
  const currency = invoice.currency || 'LEK'
  const selected = items
    .map(it => {
      const r = rows[it.id]
      if (!r?.selected) return null
      const retQty = parseFloat(r.qty) || 0
      const origQty = Math.abs(parseFloat(it.qty) || 0)
      const ratio = origQty > 0 ? Math.min(1, retQty / origQty) : 0
      const refund = (parseFloat(it.total_with_vat) || 0) * ratio
      return { it, retQty, refund }
    })
    .filter(x => x && x.retQty > 0)
  const refundTotal = selected.reduce((s, x) => s + x.refund, 0)

  // Sasia që aktualisht do të rimbursohet — default = totali auto, ose vlera
  // që ka shkruar user-i nëse e ka mbishkruar.
  const effectiveRefund = refundTouched
    ? Math.max(0, parseFloat(refundOverride) || 0)
    : refundTotal
  const refundDiff = +(refundTotal - effectiveRefund).toFixed(2)

  const submit = async () => {
    if (saving) return
    if (selected.length === 0) { alert('Zgjidh të paktën një artikull për kthim.'); return }
    if (refundTouched && effectiveRefund > refundTotal + 0.005) {
      alert(`Rimbursimi (${fmt(effectiveRefund)}) nuk mund të jetë më i madh se totali i artikujve të kthyer (${fmt(refundTotal)}).`)
      return
    }
    setSaving(true)
    try {
      const payload = {
        items: selected.map(x => ({ item_id: x.it.id, qty: x.retQty })),
        refund_method: refundMethod,
        ...(refundTouched ? { refund_amount: effectiveRefund } : {}),
      }
      const res = await fetch(`/api/invoices/${invoice.id}/credit-note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e.error || 'Gabim'); return }
      const r = await res.json()
      onCreated?.(r)
    } finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="modal-header">
          <div>
            <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">↩️ Kthim nga fatura {invoice.invoice_no}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {invoice.customer_name || 'Pa klient'} · Zgjidh artikujt që klienti po kthen dhe përshtat sasinë
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 dark:text-slate-500 text-xl">×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="text-center text-slate-400 dark:text-slate-500 py-8">Duke ngarkuar artikujt...</div>
          ) : items.length === 0 ? (
            <div className="text-center text-slate-400 dark:text-slate-500 py-8">Kjo faturë nuk ka artikuj.</div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-slate-500 dark:text-slate-400">{items.length} artikuj në faturë</span>
                <div className="flex gap-1">
                  <button onClick={selectAll} className="px-2 py-1 text-[11px] rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200">Zgjidh të gjitha</button>
                  <button onClick={selectNone} className="px-2 py-1 text-[11px] rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200">Pastro</button>
                </div>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900 text-xs text-slate-500 dark:text-slate-400 uppercase">
                  <tr>
                    <th className="px-2 py-2 w-8"></th>
                    <th className="px-2 py-2 text-left font-semibold">Produkti</th>
                    <th className="px-2 py-2 text-right font-semibold w-20">Sasia orig.</th>
                    <th className="px-2 py-2 text-right font-semibold w-24">Kthen</th>
                    <th className="px-2 py-2 text-right font-semibold w-28">Rimbursim</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(it => {
                    const r = rows[it.id] || { selected: false, qty: '0' }
                    const origQty = Math.abs(parseFloat(it.qty) || 0)
                    const retQty = parseFloat(r.qty) || 0
                    const ratio = origQty > 0 ? Math.min(1, retQty / origQty) : 0
                    const refund = (parseFloat(it.total_with_vat) || 0) * ratio
                    return (
                      <tr key={it.id} className={`border-b border-slate-100 dark:border-slate-800 ${r.selected ? 'bg-purple-50/50' : ''}`}>
                        <td className="px-2 py-2 text-center">
                          <input type="checkbox" checked={!!r.selected} onChange={() => toggle(it.id)} className="w-4 h-4 accent-purple-600" />
                        </td>
                        <td className="px-2 py-2">
                          <div className="text-slate-800 dark:text-slate-100 font-medium">{it.name || <span className="italic text-slate-400 dark:text-slate-500">— pa emër —</span>}</div>
                          {it.barcode && <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400">{it.barcode}</div>}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{origQty}</td>
                        <td className="px-2 py-2">
                          <input type="number" step="any" min="0" max={origQty}
                            value={r.qty}
                            disabled={!r.selected}
                            onChange={e => setQty(it.id, e.target.value)}
                            className="input-field-sm text-right tabular-nums disabled:bg-slate-50 disabled:text-slate-400"
                          />
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums font-semibold text-slate-800 dark:text-slate-100">
                          {r.selected && retQty > 0 ? fmt(refund) : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>
        <div className="modal-footer flex-col items-stretch gap-3">
          <div>
            <label className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-semibold block mb-1">
              Metoda e Rimbursimit
              <span className="ml-1 text-[9px] text-slate-400 normal-case">(fatura origjinale: {parentPm})</span>
            </label>
            <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
              {[
                { v: 'cash', label: '💵 Cash' },
                { v: 'bank', label: '🏦 Bankë' },
                { v: 'pos',  label: '💳 POS' },
              ].map(opt => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => setRefundMethod(opt.v)}
                  className={`px-3 py-1.5 text-xs font-semibold transition-colors ${refundMethod === opt.v
                    ? 'bg-purple-600 text-white'
                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
              Reflekton te xhiro ditore me shenjë negative sipas metodës së zgjedhur.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-semibold">Totali i artikujve ({currency})</label>
              <div className="input-field bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-200 tabular-nums font-bold">{fmt(refundTotal)}</div>
            </div>
            <div>
              <label className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-semibold">Rimbursimi aktual ({currency})</label>
              <input
                type="number" step="0.01" min="0" max={refundTotal || undefined}
                value={refundTouched ? refundOverride : (refundTotal ? refundTotal.toFixed(2) : '')}
                onChange={e => { setRefundOverride(e.target.value); setRefundTouched(true) }}
                className="input-field tabular-nums font-bold text-purple-700 dark:text-purple-300"
                placeholder={refundTotal.toFixed(2)}
                disabled={selected.length === 0}
              />
              <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
                Default = totali i artikujve. Mund të japësh më pak (p.sh. amortizim).
              </p>
            </div>
            <div>
              <label className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-semibold">Fee / e mbajtur nga shopi</label>
              <div className={`input-field tabular-nums font-bold ${refundDiff > 0.005 ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-200' : 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-200'}`}>
                {refundDiff > 0.005 ? `${fmt(refundDiff)} ${currency}` : '✓ Rimbursim i plotë'}
              </div>
              {refundDiff > 0.005 && (
                <p className="text-[10px] text-amber-600 mt-0.5">Nuk regjistrohet si borxh.</p>
              )}
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 pt-1">
            <button onClick={onClose} className="btn-secondary">Anulo</button>
            <button onClick={submit} disabled={saving || selected.length === 0}
              className="btn-primary disabled:opacity-50">
              {saving ? '⏳ Duke krijuar...' : `↩️ Krijo kthimin (${selected.length})`}
            </button>
          </div>
        </div>
      </div>
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
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="modal-header">
          <div>
            <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">↩️ Anulim me Minus — Zgjidh Faturën</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">Zgjidh një faturë ekzistuese për të krijuar kreditoren (me minus)</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 dark:text-slate-500 text-xl">×</button>
        </div>
        <div className="px-6 pt-4">
          <input type="text" autoFocus value={q} onChange={e => setQ(e.target.value)}
            className="input-field" placeholder="Kërko nr.fature, klient, NIPT..." />
        </div>
        <div className="flex-1 overflow-y-auto p-6 pt-3">
          {loading ? (
            <div className="text-center text-slate-400 dark:text-slate-500 py-8">Duke ngarkuar...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center text-slate-400 dark:text-slate-500 py-8">
              {rows.length === 0 ? 'Asnjë faturë e vlefshme në këtë datë.' : 'Asnjë faturë nuk përputhet me kërkimin.'}
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map(inv => (
                <button key={inv.id}
                  onClick={() => onPicked(inv)}
                  className="w-full text-left p-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-purple-400 hover:bg-purple-50 transition-colors">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-mono font-bold text-slate-800 dark:text-slate-100">{inv.invoice_no}</div>
                      <div className="text-sm text-slate-600 dark:text-slate-300 truncate">
                        {inv.customer_name || <span className="italic text-slate-400 dark:text-slate-500">— pa klient —</span>}
                        {inv.customer_nipt && <span className="ml-2 text-xs font-mono text-slate-500 dark:text-slate-400">({inv.customer_nipt})</span>}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-lg font-bold text-slate-900 dark:text-white tabular-nums">
                        {n(inv.total_with_vat).toLocaleString('sq-AL', { minimumFractionDigits: 2 })}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">{inv.currency} · {inv.date}</div>
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
function InvoiceList({ date, onOpen, onCreate, onDelete, onStornim, refreshKey, online = false }) {
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
  // Vetëm në modalitet online: filtër statusi porosie.
  const [fOrderStatus, setFOrderStatus] = useState('all')

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
    // Filtër i domosdoshëm: online=1 për "Shitje Online", online=0 për shitjet
    // e zakonshme të dyqanit. Kështu të dy modulet nuk shohin njëri-tjetrin.
    params.set('online', online ? '1' : '0')
    if (online && fOrderStatus !== 'all') params.set('status', fOrderStatus)
    const qs = params.toString()
    const base = fromDate === toDate
      ? `/api/invoices/by-date/${fromDate}`
      : `/api/invoices/by-range?from=${fromDate}&to=${toDate}`
    const url = qs ? `${base}${base.includes('?') ? '&' : '?'}${qs}` : base
    fetch(url)
      .then(r => r.json())
      .then(data => { setRawList(Array.isArray(data) ? data : []); setLoading(false) })
      .catch(() => { setRawList([]); setLoading(false) })
  }, [fromDate, toDate, refreshKey, fMaterial, fCategory, online, fOrderStatus])

  const rangeActive = fromDate !== date || toDate !== date

  const fc = fClient.toLowerCase().trim()
  const list = rawList.filter(inv => {
    if (fCurrency !== 'all' && (inv.currency || 'LEK') !== fCurrency) return false
    if (fPayment !== 'all') {
      const ipm = inv.payment_method || 'cash'
      // 'bank' në filtër përfshin edhe faturat e vjetra me pm='pos'
      const matches = fPayment === 'bank' ? (ipm === 'bank' || ipm === 'pos') : ipm === fPayment
      if (!matches) return false
    }
    if (fType === 'sale'      && (inv.cancelled || inv.is_credit_note)) return false
    if (fType === 'return'    && (inv.cancelled || !inv.is_credit_note)) return false
    if (fType === 'cancelled' && !inv.cancelled) return false
    if (fc) {
      const hay = `${inv.customer_name || ''} ${inv.barcodes || ''}`.toLowerCase()
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
      cost: 0, profit: 0,
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
    t.gram  = (t.gram || 0) + n(inv.total_gram)
    // Kosto & Fitim përjashtojnë faturat e anuluara; kthimet (credit notes)
    // futen me shenjë negative dhe balancohen natyrshëm.
    if (!inv.cancelled) {
      const c = n(inv.total_cost)
      t.cost   += c
      t.profit += n(inv.subtotal_no_vat) - c
    }
    return acc
  }, {})
  const currenciesInList = Object.keys(totalsByCur).sort()

  // Totalet e pagesave sipas monedhës REALE (nga splits) — jo nga monedha e
  // faturës. P.sh. një faturë në EUR e paguar pjesërisht në GBP/CHF do të shfaqë
  // shumat e sakta për secilën monedhë. Për faturat pa splits (legacy),
  // përdoret monedha e faturës si fallback.
  const paidByRealCurrency = list.reduce((acc, inv) => {
    const splits = parseSplitsSummary(inv.splits_summary)
    if (splits.length === 0) {
      const cur = inv.currency || 'LEK'
      const paid = truePaidCashPos(inv)
      if (paid > 0.005) acc[cur] = (acc[cur] || 0) + paid
    } else {
      splits.forEach(s => {
        if (s.amount > 0.005) acc[s.currency] = (acc[s.currency] || 0) + s.amount
      })
    }
    return acc
  }, {})
  const realPaymentCurrencies = Object.keys(paidByRealCurrency).sort()

  const filtersActive = fc || fCurrency !== 'all' || fPayment !== 'all' || fType !== 'all' || fMaterial || fCategory

  // Statuset e porosisë online — pills në krye kur online.
  const ONLINE_STATUS_META = {
    e_re:          { label: 'E re',          cls: 'bg-blue-100 text-blue-700 dark:text-blue-300',    activeCls: 'bg-blue-600 text-white',    icon: '🆕' },
    ne_pergatitje: { label: 'Në përgatitje', cls: 'bg-amber-100 text-amber-700 dark:text-amber-300',  activeCls: 'bg-amber-600 text-white',   icon: '📦' },
    derguar:       { label: 'Dërguar',       cls: 'bg-purple-100 text-purple-700 dark:text-purple-300',activeCls: 'bg-purple-600 text-white',  icon: '🚚' },
    dorezuar:      { label: 'Dorëzuar',      cls: 'bg-emerald-100 text-emerald-700 dark:text-emerald-300', activeCls: 'bg-emerald-600 text-white', icon: '✓' },
    anuluar:       { label: 'Anuluar',       cls: 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400',  activeCls: 'bg-slate-600 text-white',   icon: '❌' },
  }
  const onlineStatusCounts = online
    ? rawList.reduce((a, i) => { const s = i.order_status || 'e_re'; a[s] = (a[s] || 0) + 1; return a }, {})
    : {}
  const me = getUser()
  const isAdmin = me?.role === 'admin'

  const patchStatus = async (id, status) => {
    try {
      const res = await fetch(`/api/invoices/${id}/order-status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_status: status }),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e.error || 'Gabim'); return }
      // Rifresko listën
      setRawList(prev => prev.map(i => i.id === id ? { ...i, order_status: status } : i))
    } catch (_) { /* ignore */ }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">
            {online ? '🛒 Shitje Online' : 'Fatura të Shitjes'}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {fromDate === toDate
              ? (online ? 'Porositë online për këtë datë' : 'Lista e faturave për këtë datë')
              : (online ? `Porositë online nga ${fromDate} në ${toDate}` : `Lista e faturave nga ${fromDate} në ${toDate}`)}
            {filtersActive && <span className="ml-2 text-blue-600">· {list.length} të filtruara nga {rawList.length}</span>}
          </p>
          {online && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              <button
                onClick={() => setFOrderStatus('all')}
                className={`badge cursor-pointer ${fOrderStatus === 'all' ? 'bg-slate-800 dark:bg-slate-900 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700'}`}
              >📋 Të gjitha: {rawList.length}</button>
              {Object.entries(ONLINE_STATUS_META).map(([id, meta]) => (
                <button key={id}
                  onClick={() => setFOrderStatus(id)}
                  className={`badge cursor-pointer ${fOrderStatus === id ? meta.activeCls : meta.cls + ' hover:opacity-80'}`}
                >{meta.icon} {meta.label}: {onlineStatusCounts[id] || 0}</button>
              ))}
            </div>
          )}
          {!online && (counts.sale + counts.return + counts.cancelled) > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              <button
                onClick={() => setFType('all')}
                className={`badge cursor-pointer ${fType === 'all' ? 'bg-slate-800 dark:bg-slate-900 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700'}`}
                title="Shfaq të gjitha"
              >📋 Të gjitha: {rawList.length}</button>
              <button
                onClick={() => setFType('sale')}
                className={`badge cursor-pointer ${fType === 'sale' ? 'bg-emerald-600 text-white' : 'bg-emerald-100 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200'}`}
                title="Shfaq vetëm shitjet e rregullta"
              >🧾 Shitje: {counts.sale}</button>
              <button
                onClick={() => setFType('return')}
                className={`badge cursor-pointer ${fType === 'return' ? 'bg-red-600 text-white' : 'bg-red-100 text-red-700 dark:text-red-300 hover:bg-red-200'}`}
                title="Shfaq vetëm kthimet (faturat kreditore)"
              >↩️ Kthime: {counts.return}</button>
              {counts.cancelled > 0 && (
                <button
                  onClick={() => setFType('cancelled')}
                  className={`badge cursor-pointer ${fType === 'cancelled' ? 'bg-slate-600 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-600'}`}
                  title="Shfaq vetëm faturat e anuluara"
                >🚫 Anuluar: {counts.cancelled}</button>
              )}
            </div>
          )}
        </div>
        <button onClick={onCreate} className="btn-primary">{online ? '+ Porosi e Re' : '+ Faturë e Re'}</button>
      </div>

      {/* Filters */}
      <div className="card flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">🔎</span>
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Filtra</span>
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
          <label className="form-label">Klient / Barkod (emër ose barkod)</label>
          <input
            type="text" value={fClient} onChange={e => setFClient(e.target.value)}
            className="input-field" placeholder="kërko emër ose barkod..."
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
            <option value="bank">💳 Me POS</option>
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
          <div className="p-8 text-center text-slate-400 dark:text-slate-500 text-sm">Duke ngarkuar...</div>
        ) : list.length === 0 ? (
          <div className="p-10 text-center">
            <div className="text-5xl mb-3">🧾</div>
            <p className="text-slate-500 dark:text-slate-400 mb-4">
              {fromDate === toDate
                ? 'Nuk ka fatura për këtë datë.'
                : 'Nuk ka fatura në këtë periudhë.'}
            </p>
            <button onClick={onCreate} className="btn-primary mx-auto">+ Krijo Faturën e Parë</button>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1200px]">
            <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="px-2 py-2 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Nr. Fature</th>
                <th className="px-2 py-2 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Data</th>
                <th className="px-2 py-2 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Klienti</th>
                <th className="px-2 py-2 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">NIPT</th>
                <th className="px-2 py-2 text-center text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Monedha</th>
                <th className="px-2 py-2 text-center text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Pagesa</th>
                <th className="px-2 py-2 text-right text-xs font-semibold uppercase bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">Gram</th>
                <th className="px-2 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Pa Zbritje</th>
                <th className="px-2 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Zbritja</th>
                <th className="px-2 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Pa TVSH</th>
                <th className="px-2 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">TVSH</th>
                <th className="px-2 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">TOTALI</th>
                {isAdmin && (
                  <>
                    <th className="px-2 py-2 text-right text-xs font-semibold uppercase bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">Fitim</th>
                    <th className="px-2 py-2 text-right text-xs font-semibold uppercase bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">Fitim %</th>
                    <th className="px-2 py-2 text-right text-xs font-semibold uppercase bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">Marzh %</th>
                  </>
                )}
                <th className="px-2 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Shuma e Paguar</th>
                <th className="px-2 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Shuma Pa Paguar</th>
                {online && <th className="px-2 py-2 text-center text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Statusi</th>}
                <th className="px-2 py-2 text-center text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase w-40">Veprime</th>
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
                  ? <span className="badge bg-amber-100 text-amber-700 dark:text-amber-300">⚠️ Borxh</span>
                  : (pm === 'bank' || pm === 'pos')
                  ? <span className="badge bg-blue-100 text-blue-700 dark:text-blue-300">💳 Me POS</span>
                  : pm === 'mikse'
                  ? <span className="badge bg-teal-100 text-teal-700">🔀 Mikse</span>
                  : <span className="badge bg-emerald-100 text-emerald-700 dark:text-emerald-300">💵 Cash</span>
                const isCancelled = !!inv.cancelled
                const isCredit    = !!inv.is_credit_note
                const rate        = n(inv.exchange_rate) || 1
                const isForeign   = (inv.currency || 'LEK') !== 'LEK'
                const rowCls = isCancelled
                  ? 'border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 line-through opacity-60'
                  : isCredit
                  ? 'border-b border-slate-100 dark:border-slate-800 bg-red-50/40 hover:bg-red-50'
                  : 'border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                return (
                <tr key={inv.id} className={rowCls}>
                  <td className="px-2 py-2 font-mono text-xs text-slate-700 dark:text-slate-200">
                    {inv.invoice_no}
                    {isCancelled && <span className="ml-1.5 badge bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[9px]">ANULUAR</span>}
                    {isCredit && <span className="ml-1.5 badge bg-red-100 text-red-700 dark:text-red-300 text-[9px]">KREDITORE</span>}
                  </td>
                  <td className="px-2 py-2 text-[16px] text-slate-600 dark:text-slate-300 tabular-nums whitespace-nowrap">
                    <div>{inv.date || '—'}</div>
                    {inv.created_at && (
                      <div className="text-[16px] text-slate-400 dark:text-slate-500">
                        {new Date(String(inv.created_at).replace(' ', 'T') + 'Z').toLocaleTimeString('sq-AL', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2 text-slate-800 dark:text-slate-100">{inv.customer_name || <span className="text-slate-400 dark:text-slate-500 italic">— pa klient —</span>}</td>
                  <td className="px-2 py-2 font-mono text-xs text-slate-500 dark:text-slate-400">{inv.customer_nipt || '—'}</td>
                  <td className="px-2 py-2 text-center text-xs">
                    <span className="badge badge-blue">{inv.currency}</span>
                  </td>
                  <td className="px-2 py-2 text-center text-xs">{pmBadge}</td>
                  <td className="px-2 py-2 text-right tabular-nums font-semibold bg-amber-50/40 dark:bg-amber-900/10 text-amber-800 dark:text-amber-200">
                    {n(inv.total_gram) > 0 ? `${n(inv.total_gram).toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}gr` : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">
                    {fmt(n(inv.subtotal_no_vat) + n(inv.total_discount))}
                    {isForeign && (
                      <div className="text-[10px] font-normal text-slate-500 dark:text-slate-400 italic">
                        = {fmt((n(inv.subtotal_no_vat) + n(inv.total_discount)) * rate)} LEK
                      </div>
                    )}
                  </td>
                  <td className={`px-2 py-2 text-right tabular-nums ${n(inv.total_discount) > 0.005 ? 'text-orange-600 font-semibold' : 'text-slate-400 dark:text-slate-500'}`}>
                    {n(inv.total_discount) > 0.005 ? `-${fmt(inv.total_discount)}` : '—'}
                    {isForeign && n(inv.total_discount) > 0.005 && (
                      <div className="text-[10px] font-normal text-orange-500/80 italic">
                        = -{fmt(n(inv.total_discount) * rate)} LEK
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">
                    {fmt(inv.subtotal_no_vat)}
                    {isForeign && (
                      <div className="text-[10px] font-normal text-slate-500 dark:text-slate-400 italic">
                        = {fmt(n(inv.subtotal_no_vat) * rate)} LEK
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">
                    {fmt(inv.total_vat)}
                    {isForeign && n(inv.total_vat) > 0.005 && (
                      <div className="text-[10px] font-normal text-slate-500 dark:text-slate-400 italic">
                        = {fmt(n(inv.total_vat) * rate)} LEK
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums font-bold text-slate-900 dark:text-white">
                    {fmt(inv.total_with_vat)}
                    {isForeign && (
                      <div className="text-[10px] font-normal text-slate-500 dark:text-slate-400 italic">
                        = {fmt(n(inv.total_with_vat) * rate)} LEK
                      </div>
                    )}
                  </td>
                  {isAdmin && (() => {
                    const cost   = n(inv.total_cost)
                    const sales  = n(inv.subtotal_no_vat)
                    const profit = sales - cost
                    const marginPct = sales !== 0 ? (profit / sales) * 100 : 0
                    const profitPct = cost  !== 0 ? (profit / cost)  * 100 : 0
                    const cancelled = !!inv.cancelled
                    const hasCost   = cost > 0.005
                    const clsProfit = cancelled ? 'text-slate-400 dark:text-slate-500' : profit < 0 ? 'text-red-600' : 'text-emerald-700 dark:text-emerald-300'
                    const clsPct    = cancelled ? 'text-slate-400 dark:text-slate-500' : profitPct < 0 ? 'text-red-600' : 'text-emerald-700 dark:text-emerald-300'
                    const clsMar    = cancelled ? 'text-slate-400 dark:text-slate-500' : marginPct < 0 ? 'text-red-600' : 'text-emerald-700 dark:text-emerald-300'
                    return (
                      <>
                        <td className={`px-2 py-2 text-right tabular-nums font-semibold bg-emerald-50/40 dark:bg-emerald-900/10 ${clsProfit}`}>
                          {hasCost ? fmt(profit) : <span className="text-slate-300">—</span>}
                          {hasCost && (
                            <div className="text-[10px] font-normal text-slate-500 dark:text-slate-400 italic">
                              kosto: {fmt(cost)}
                            </div>
                          )}
                        </td>
                        <td className={`px-2 py-2 text-right tabular-nums font-semibold bg-emerald-50/40 dark:bg-emerald-900/10 ${clsPct}`}>
                          {hasCost ? `${profitPct.toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%` : <span className="text-slate-300">—</span>}
                        </td>
                        <td className={`px-2 py-2 text-right tabular-nums font-semibold bg-emerald-50/40 dark:bg-emerald-900/10 ${clsMar}`}>
                          {sales > 0.005 && hasCost ? `${marginPct.toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%` : <span className="text-slate-300">—</span>}
                        </td>
                      </>
                    )
                  })()}
                  <td className="px-2 py-2 text-right tabular-nums font-semibold text-emerald-700 dark:text-emerald-300">
                    {fmt(initPaid)}
                    {isForeign && initPaid > 0.005 && (
                      <div className="text-[10px] font-normal text-emerald-600/70 italic">
                        = {fmt(initPaid * rate)} LEK
                      </div>
                    )}
                    {(() => {
                      const splits = parseSplitsSummary(inv.splits_summary)
                      if (splits.length === 0) return null
                      // Fshi breakdown-in vetëm kur është krejt i tepërt: një split
                      // i vetëm në të njëjtën monedhë me faturën dhe metodë
                      // klasike (cash ose bank/POS) — dmth "Shuma e Paguar" + badge-i
                      // i monedhës e komunikojnë të njëjtin informacion. Për çdo
                      // rast tjetër (mikse ose monedhë e ndryshme nga fatura),
                      // shfaqim ndarjen që përdoruesi të shohë çdo monedhë reale.
                      const invCur = inv.currency || 'LEK'
                      const isRedundant =
                        pm !== 'mikse' &&
                        splits.length === 1 &&
                        splits[0].currency === invCur
                      if (isRedundant) return null
                      return (
                        <div className="mt-0.5 flex flex-wrap gap-0.5 justify-end">
                          {splits.map((s, i) => (
                            <span
                              key={i}
                              className={`inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-medium ${
                                s.method === 'cash'
                                  ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200'
                                  : 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200'
                              }`}
                              title={`${s.method === 'cash' ? 'Cash' : 'POS/Bankë'} · ${s.currency}`}
                            >
                              {s.method === 'cash' ? '💵' : '💳'} {fmt(s.amount)} {s.currency}
                            </span>
                          ))}
                        </div>
                      )
                    })()}
                  </td>
                  <td className={`px-2 py-2 text-right tabular-nums font-semibold ${due > 0.005 ? 'text-red-600' : due < -0.005 ? 'text-purple-700 dark:text-purple-300' : 'text-emerald-600'}`}>
                    {Math.abs(due) > 0.005 ? fmt(due) : '✓'}
                    {isForeign && Math.abs(due) > 0.005 && (
                      <div className={`text-[10px] font-normal italic ${due > 0.005 ? 'text-red-500/80' : 'text-purple-600/80'}`}>
                        = {fmt(due * rate)} LEK
                      </div>
                    )}
                  </td>
                  {online && (() => {
                    const cur = inv.order_status || 'e_re'
                    const meta = ONLINE_STATUS_META[cur]
                    return (
                      <td className="px-2 py-2 text-center">
                        <span className={`badge whitespace-nowrap ${meta?.cls || ''}`} title={`Statusi: ${meta?.label}`}>
                          {meta?.icon} {meta?.label}
                        </span>
                      </td>
                    )
                  })()}
                  <td className="px-2 py-3">
                    <div className="flex items-center justify-center gap-1 flex-wrap">
                      <button onClick={() => onOpen(inv.id)} className="px-2 py-1 rounded-lg bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 text-blue-600 text-[11px] font-medium">Hap</button>
                      {online && (() => {
                        const cur = inv.order_status || 'e_re'
                        // Klasat statike (Tailwind s'suporton dinamike te build).
                        const BTN_CLS = {
                          ne_pergatitje: 'bg-amber-50 dark:bg-amber-900/30 hover:bg-amber-100 text-amber-700 dark:text-amber-300',
                          derguar:       'bg-purple-50 dark:bg-purple-900/30 hover:bg-purple-100 text-purple-700 dark:text-purple-300',
                          dorezuar:      'bg-emerald-50 dark:bg-emerald-900/30 hover:bg-emerald-100 text-emerald-700 dark:text-emerald-300',
                          anuluar:       'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200',
                        }
                        const btns = []
                        if (cur === 'e_re')          btns.push(['ne_pergatitje', '📦'])
                        if (cur === 'ne_pergatitje') btns.push(['derguar', '🚚'])
                        if (cur === 'derguar')       btns.push(['dorezuar', '✓'])
                        if (cur !== 'anuluar' && cur !== 'dorezuar') btns.push(['anuluar', '❌'])
                        return btns.map(([s, icon]) => (
                          <button key={s} onClick={() => patchStatus(inv.id, s)}
                            className={`px-2 py-1 rounded-lg text-[11px] font-medium ${BTN_CLS[s]}`}
                            title={`Shëno "${ONLINE_STATUS_META[s]?.label}"`}
                          >{icon}</button>
                        ))
                      })()}
                      {!online && !isCancelled && !isCredit && (
                        <button
                          onClick={() => onStornim?.(inv.id, inv.invoice_no)}
                          className="px-2 py-1 rounded-lg bg-purple-50 dark:bg-purple-900/30 hover:bg-purple-100 text-purple-700 dark:text-purple-300 text-[11px] font-medium"
                          title="Zgjidh artikujt që kthehen (mund të jetë kthim i pjesshëm)"
                        >↩️ Kthim</button>
                      )}
                      {isAdmin && (
                        <button onClick={() => onDelete(inv.id, inv.invoice_no)}
                          className="px-2 py-1 rounded-lg bg-red-50 dark:bg-red-900/30 hover:bg-red-100 text-red-600 text-[11px] font-medium">Fshi</button>
                      )}
                    </div>
                  </td>
                </tr>
              )})}
            </tbody>
            <tfoot className="bg-emerald-50 dark:bg-emerald-900/30 border-t-2 border-emerald-300">
              {currenciesInList.map((cur, idx) => {
                const t = totalsByCur[cur]
                return (
                  <tr key={cur} className={idx > 0 ? 'border-t border-emerald-200' : ''}>
                    <td colSpan={5} className="px-2 py-2 text-xs font-bold text-emerald-700 dark:text-emerald-300 uppercase tracking-wide">
                      💵 TOTAL ({cur}) <span className="text-[10px] font-normal text-emerald-600">— {t.count} {t.count === 1 ? 'faturë' : 'fatura'}</span>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums font-extrabold bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200 text-base">
                      {(t.gram || 0) > 0.0005 ? `${(t.gram || 0).toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}gr` : '—'}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums font-extrabold text-slate-800 dark:text-slate-100">{fmt(t.gross)}</td>
                    <td className="px-2 py-2 text-right tabular-nums font-extrabold text-orange-600">
                      {t.disc > 0.005 ? `-${fmt(t.disc)}` : '—'}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums font-extrabold text-slate-800 dark:text-slate-100">{fmt(t.sub)}</td>
                    <td className="px-2 py-2 text-right tabular-nums font-extrabold text-slate-800 dark:text-slate-100">{fmt(t.vat)}</td>
                    <td className="px-2 py-2 text-right tabular-nums font-extrabold text-blue-700 dark:text-blue-300 text-base">{fmt(t.tot)}</td>
                    {isAdmin && (() => {
                      const tProfitPct = t.cost !== 0 ? (t.profit / t.cost) * 100 : 0
                      const tMarginPct = t.sub  !== 0 ? (t.profit / t.sub)  * 100 : 0
                      const hasCost    = t.cost > 0.005
                      const clsProfit  = t.profit < 0 ? 'text-red-600' : 'text-emerald-700 dark:text-emerald-300'
                      const clsPct     = tProfitPct < 0 ? 'text-red-600' : 'text-emerald-700 dark:text-emerald-300'
                      const clsMar     = tMarginPct < 0 ? 'text-red-600' : 'text-emerald-700 dark:text-emerald-300'
                      return (
                        <>
                          <td className={`px-2 py-2 text-right tabular-nums font-extrabold bg-emerald-100/70 dark:bg-emerald-900/40 text-base ${clsProfit}`}>
                            {hasCost ? fmt(t.profit) : '—'}
                            {hasCost && (
                              <div className="text-[10px] font-normal text-slate-500 dark:text-slate-400 italic">
                                kosto: {fmt(t.cost)}
                              </div>
                            )}
                          </td>
                          <td className={`px-2 py-2 text-right tabular-nums font-extrabold bg-emerald-100/70 dark:bg-emerald-900/40 text-base ${clsPct}`}>
                            {hasCost ? `${tProfitPct.toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%` : '—'}
                          </td>
                          <td className={`px-2 py-2 text-right tabular-nums font-extrabold bg-emerald-100/70 dark:bg-emerald-900/40 text-base ${clsMar}`}>
                            {t.sub > 0.005 && hasCost ? `${tMarginPct.toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%` : '—'}
                          </td>
                        </>
                      )
                    })()}
                    <td className="px-2 py-2 text-right tabular-nums font-extrabold text-emerald-700 dark:text-emerald-300 text-base">{fmt(t.paid)}</td>
                    <td className={`px-2 py-2 text-right tabular-nums font-extrabold text-base ${t.due > 0.005 ? 'text-red-600' : 'text-emerald-700 dark:text-emerald-300'}`}>
                      {t.due > 0.005 ? fmt(t.due) : '✓'}
                    </td>
                    {online && <td></td>}
                    <td></td>
                  </tr>
                )
              })}
            </tfoot>
          </table>
          </div>
        )}
      </div>

      {/* ── Pagesa sipas Monedhës Reale — panel me madhësi mesatare ── */}
      {realPaymentCurrencies.length > 0 && (
        <div className="rounded-xl border-2 border-emerald-300 dark:border-emerald-700 bg-emerald-50/70 dark:bg-emerald-900/20 px-4 py-3 flex items-center gap-4 flex-wrap shadow-sm">
          <span className="text-sm font-bold text-emerald-800 dark:text-emerald-200 uppercase tracking-wide flex items-center gap-1.5 flex-shrink-0">
            <span className="text-lg">🏦</span> Pagesa sipas Monedhës
          </span>
          <div className="flex flex-wrap gap-2">
            {realPaymentCurrencies.map(cur => {
              const palette = {
                EUR: 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/40 dark:text-blue-200 dark:border-blue-700',
                LEK: 'bg-red-100 text-red-800 border-red-300 dark:bg-red-900/40 dark:text-red-200 dark:border-red-700',
                USD: 'bg-green-100 text-green-800 border-green-300 dark:bg-green-900/40 dark:text-green-200 dark:border-green-700',
                GBP: 'bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-900/40 dark:text-purple-200 dark:border-purple-700',
                CHF: 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-900/40 dark:text-rose-200 dark:border-rose-700',
              }[cur] || 'bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600'
              return (
                <span
                  key={cur}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border-2 text-sm font-bold tabular-nums shadow-sm ${palette}`}
                  title={`Shuma totale e paguar në ${cur}`}
                >
                  <span className="text-base">💵</span> {fmt(paidByRealCurrency[cur])} <span className="text-xs opacity-80">{cur}</span>
                </span>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Editor: single invoice with line items ───────────────────────────────────
function InvoiceEditor({ date, invoiceId, onClose, onSaved, online = false }) {
  const [loading, setLoading]         = useState(true)
  const [saving, setSaving]           = useState(false)
  const [invoiceDate, setInvoiceDate] = useState(date)
  const [invoiceNo, setInvoiceNo]     = useState('')
  const [customer, setCustomer]       = useState({ customer_name: '', customer_nipt: '', address: '', phone: '' })
  const [currency, setCurrency]       = useState('EUR')
  const [exchangeRate, setExchangeRate] = useState(1)
  const [rateSource, setRateSource]   = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [amountPaid, setAmountPaid]   = useState('')
  const [paidTouched, setPaidTouched] = useState(false)
  // Mixed-payment breakdown (used only when paymentMethod === 'mikse')
  const [paidCash, setPaidCash]       = useState('')
  const [paidBank, setPaidBank]       = useState('')
  // Fushat për porosi online — përdoren vetëm kur `online === true`.
  const [channel, setChannel]         = useState('Instagram')
  const [shippingAddress, setShippingAddress] = useState('')
  const [trackingNo, setTrackingNo]   = useState('')
  const [orderStatus, setOrderStatus] = useState('e_re')
  // Splits pagese për "mikse" — çdo rresht ka metodë + monedhë + shumë + kurs
  // drejt LEK. Backend-i konverton në monedhën e faturës për amount_paid.
  const [paymentSplits, setPaymentSplits] = useState([])
  const [notes, setNotes]             = useState('')
  const [items, setItems]             = useState([emptyItem()])
  const [allRates, setAllRates]       = useState({ LEK: 1 })

  const isAdmin = getUser()?.role === 'admin'
  const today = new Date().toISOString().split('T')[0]

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
          // Legacy 'pos' normalizohet në 'bank' kur ngarkohet.
          const rawPm = inv.payment_method === 'pos' ? 'bank' : inv.payment_method
          const pm = ['cash','bank','debt','mikse'].includes(rawPm) ? rawPm : 'cash'
          setPaymentMethod(pm)
          // Show what was recorded at sale registration, not the current paid total —
          // later payments from Detyrime Klienti must not shift the editor either.
          const initPaid = inv.initial_amount_paid != null ? inv.initial_amount_paid : inv.amount_paid
          // Për cash/bankë ku paid përputhet me total-in (rasti normal, dhe kreditore),
          // e lëmë bosh që "Shuma e Paguar" të sinkronizohet automatikisht kur user
          // ndryshon çmimet e artikujve. Ndryshe faturat kreditore mbanin paid=old-total
          // dhe krijonin një "due" të rrejshëm.
          const totalInv = n(inv.total_with_vat)
          const paidMatchesTotal = initPaid != null && Math.abs(n(initPaid) - totalInv) < 0.01
          if ((pm === 'cash' || pm === 'bank') && paidMatchesTotal) {
            setAmountPaid('')
            setPaidTouched(false)
          } else {
            setAmountPaid(initPaid != null ? String(initPaid) : '')
            setPaidTouched(true)
          }
          setPaidCash(inv.paid_cash != null ? String(inv.paid_cash) : '')
          // Prefer paid_bank; fall back to legacy paid_pos.
          const legacyBank = inv.paid_bank != null ? inv.paid_bank : inv.paid_pos
          setPaidBank(legacyBank != null ? String(legacyBank) : '')
          // Splits hidrohen nga backend-i; për fatura legacy pa splits
          // krijojmë rreshta nga payment_method + paid_cash/paid_bank/amount_paid
          // që UI e unifikuar të mos shohë kurrë një faturë pa splits.
          if (Array.isArray(inv.payment_splits) && inv.payment_splits.length > 0) {
            setPaymentSplits(inv.payment_splits.map(s => ({
              method: s.method,
              currency: s.currency,
              amount: String(s.amount),
              exchange_rate: String(s.exchange_rate),
            })))
          } else {
            const invCur = inv.currency || 'LEK'
            const invR = String(inv.exchange_rate || 1)
            const legacy = []
            if (pm === 'mikse') {
              if (n(inv.paid_cash) !== 0) legacy.push({ method: 'cash', currency: invCur, amount: String(inv.paid_cash), exchange_rate: invR })
              if (n(legacyBank)     !== 0) legacy.push({ method: 'bank', currency: invCur, amount: String(legacyBank), exchange_rate: invR })
            } else if (pm === 'cash' || pm === 'bank') {
              const paid = initPaid != null ? n(initPaid) : n(inv.total_with_vat)
              if (paid !== 0) legacy.push({ method: pm, currency: invCur, amount: String(paid), exchange_rate: invR })
            }
            // 'debt' → splits mbeten bosh (asgjë nuk u pagua)
            setPaymentSplits(legacy)
          }
          setNotes(inv.notes || '')
          setItems((inv.items && inv.items.length > 0) ? inv.items : [emptyItem()])
          // Fushat online — hidrohen edhe kur faturën po e hapim nga moduli
          // klasik, kështu që të mos i humbasim rastësisht.
          setChannel(inv.channel || 'Instagram')
          setShippingAddress(inv.shipping_address || '')
          setTrackingNo(inv.tracking_no || '')
          setOrderStatus(inv.order_status || 'e_re')
        } else {
          setInvoiceDate(date)
          const noRes = await fetch(`/api/invoices/next-no?date=${date}`).then(r => r.json())
          if (cancel) return
          setInvoiceNo(noRes.invoice_no || '')
          setCurrency('EUR')
          setExchangeRate(r.EUR || 1)
          setItems([emptyItem()])
          setPaymentSplits([])
          setChannel('Instagram')
          setShippingAddress('')
          setTrackingNo('')
          setOrderStatus('e_re')
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

  // Dhuratë — hap pickerin që liston produkte me is_gift=1 & stok>0, dhe
  // shto një rresht të ri me unit_price=0, disc=0, vat=0, is_gift=1.
  const [showGiftPicker, setShowGiftPicker] = useState(false)
  const [giftOptions, setGiftOptions] = useState([])
  const [giftLoading, setGiftLoading] = useState(false)
  const openGiftPicker = async () => {
    setShowGiftPicker(true)
    setGiftLoading(true)
    try {
      const rows = await fetch('/api/products/search?gifts_only=1').then(r => r.json())
      setGiftOptions(Array.isArray(rows) ? rows : [])
    } catch { setGiftOptions([]) }
    finally { setGiftLoading(false) }
  }
  const addGift = (p) => {
    setItems(prev => [...prev, {
      ...emptyItem(),
      product_id: p.id,
      serial_no: p.serial_no || '',
      barcode: p.barcode || '',
      name: p.name,
      gram: parseFloat(p.gram) || 0,
      qty: 1,
      unit_price_no_vat: 0,
      discount_percent: 0,
      vat_rate: 0,
      is_gift: 1,
    }])
    setShowGiftPicker(false)
  }

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
    // Produktet me promocion aktive përdorin çmimin e reduktuar direkt si çmim
    // bazë të rreshtit. Çdo zbritje shtesë që fut përdoruesi (Zbritje €/%) do
    // të aplikohet mbi çmimin e promocionit. Snapshot i promocionit ruhet edhe
    // te rreshti (`on_promotion` + `promo_discount_pct`) që të shfaqet badge-i
    // "PROMO" edhe kur hapim faturën më vonë.
    const basePrice = n(p.sell_price)
    const onPromo = p.is_promotion && n(p.promo_discount_pct) > 0
    const effectivePrice = onPromo
      ? basePrice * (1 - n(p.promo_discount_pct) / 100)
      : basePrice
    // Fusha "Has ne shitje" duhet të shfaqë Cmim Shitje Has = Cmim Blerje Has
    // × Shumëzues (siç është përcaktuar te faqja Produkte). Për të mos dyfishuar
    // shumëzuesin kur unit_price rillogaritet me formulën `has × mul × sell_rate`,
    // ruajmë multiplier=1 dhe të gjithë efektin e shumëzuesit të kalkuluar te has_gram.
    const buyHas    = n(p.has_gram)
    const mult      = n(p.multiplier)
    const sellHas   = buyHas > 0 && mult > 0 ? +(buyHas * mult).toFixed(4) : buyHas
    setItem(idx, {
      product_id: p.id,
      serial_no: p.serial_no || '',
      barcode: p.barcode || '',
      name: p.name,
      gram: p.gram != null ? p.gram : 0,
      unit_price_no_vat: eurToInvoiceCurrency(effectivePrice),
      vat_rate: p.vat_rate != null ? p.vat_rate : 0,
      on_promotion: onPromo ? 1 : 0,
      promo_discount_pct: onPromo ? n(p.promo_discount_pct) : 0,
      // Kursi i Shitjes — vendoset manualisht nga user-i (jo auto). Kur user-i
      // e vendos, unit_price rillogaritet (proporcionalisht ose me formulë flori
      // nëse has_gram+multiplier janë>0).
      sell_rate: 0,
      has_gram: sellHas > 0 ? sellHas : 0,
      multiplier: sellHas > 0 ? 1 : 0,
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
        // Kur ndryshohet monedha, rifresko kursin nga tabela e ditës.
        if (patch.currency && patch.currency !== s.currency) {
          const r = allRates[patch.currency]
          next.exchange_rate = r != null ? String(r) : '1'
        }
        return next
      })
      // Auto-sync monedhën e faturës: nëse të gjitha splits ndajnë të njëjtën
      // monedhë dhe ajo ndryshon nga fatura, kalo faturën në atë monedhë
      // (rikonverton çmimet e artikujve me kursin e ri).
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
  // monedhën e faturës" mbetet e njëjtë (p.sh. 5000 EUR mbetet 5000 EUR).
  const changeExchangeRate = (newRate) => {
    setExchangeRate(newRate)
    const r = String(newRate)
    setPaymentSplits(prev => prev.map(s => s.currency === currency ? { ...s, exchange_rate: r } : s))
  }

  // Kursi i Shitjes per rresht — kur ndryshohet, rillogarit `unit_price_no_vat`:
  //   • FLORI (has_gram + multiplier > 0): formula direkte
  //       unit_price = has_gram × multiplier × sell_rate
  //   • PA FORMULE: shkallëzim proporcional (unit_price × new/old)
  const changeItemSellRate = (idx, newRate) => {
    setItems(prev => prev.map((it, i) => {
      if (i !== idx) return it
      const newR = parseFloat(newRate) || 0
      const hg = n(it.has_gram)
      const mul = n(it.multiplier)
      if (hg > 0 && mul > 0 && newR > 0) {
        return { ...it, sell_rate: newRate, unit_price_no_vat: +(hg * mul * newR).toFixed(2) }
      }
      const oldR = n(it.sell_rate)
      if (oldR > 0 && newR > 0 && Math.abs(newR - oldR) > 1e-9) {
        const factor = newR / oldR
        return { ...it, sell_rate: newRate, unit_price_no_vat: +(n(it.unit_price_no_vat) * factor).toFixed(2) }
      }
      return { ...it, sell_rate: newRate }
    }))
  }

  // Kur user-i ndryshon has_gram ose multiplier për një rresht, rillogarit
  // unit_price_no_vat me formulën flori (nëse të gjitha 3 fushat > 0).
  const changeItemFloriField = (idx, field, value) => {
    setItems(prev => prev.map((it, i) => {
      if (i !== idx) return it
      const next = { ...it, [field]: value }
      const hg = n(next.has_gram)
      const mul = n(next.multiplier)
      const sr = n(next.sell_rate)
      if (hg > 0 && mul > 0 && sr > 0) {
        next.unit_price_no_vat = +(hg * mul * sr).toFixed(2)
      }
      return next
    }))
  }

  // Deduho metodën e pagesës nga splits për ruajtjen dhe për badge-t në listë:
  // 0 splits → borxh; 1 split në monedhën e faturës → cash/bank; ndryshe → mikse.
  const inferPaymentMethod = (splits, invoiceCurrency) => {
    if (splits.length === 0) return 'debt'
    if (splits.length === 1 && splits[0].currency === invoiceCurrency) {
      return splits[0].method === 'bank' ? 'bank' : 'cash'
    }
    return 'mikse'
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
    return +(lek / invR).toFixed(2)
  })()

  // Totals
  const lineTotals = items.map(computeLine)
  const totals = lineTotals.reduce((acc, l) => ({
    sub: acc.sub + l.subtotal_no_vat,
    vat: acc.vat + l.vat_amount,
    tot: acc.tot + l.total_with_vat,
  }), { sub: 0, vat: 0, tot: 0 })

  const save = async () => {
    if (saving) return
    const validItems = items
      .filter(it => (it.name && it.name.trim()) || n(it.qty) > 0 || n(it.unit_price_no_vat) > 0)
      .map(it => ({
        ...it,
        gram: n(it.gram),
        on_promotion: it.on_promotion ? 1 : 0,
        promo_discount_pct: n(it.promo_discount_pct),
      }))
    if (validItems.length === 0) { alert('Shtoni të paktën një artikull.'); return }
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
        date: invoiceDate,
        invoice_no: invoiceNo,
        customer_name: customer.customer_name,
        customer_nipt: customer.customer_nipt,
        currency,
        exchange_rate: parseFloat(exchangeRate) || 1,
        payment_method: inferredPm,
        // amount_paid përdoret vetëm si fallback nga backend-i kur splits janë bosh.
        amount_paid: splitsPayload.length > 0 ? null : (amountPaid === '' ? null : parseFloat(amountPaid)),
        paid_cash: 0,
        paid_bank: 0,
        payment_splits: splitsPayload,
        notes,
        items: validItems,
        ...(online ? {
          is_online: 1,
          channel,
          shipping_address: shippingAddress,
          tracking_no: trackingNo,
          order_status: orderStatus,
        } : {}),
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
      <div className="card p-8 text-center text-slate-400 dark:text-slate-500">Duke ngarkuar faturën...</div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="btn-secondary">← Mbrapa</button>
          <div>
            <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">
              {online
                ? (invoiceId ? '🛒 Edito Porosinë Online' : '🛒 Porosi e Re Online')
                : (invoiceId ? 'Edito Faturën' : 'Faturë e Re Shitje')}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">Nr. {invoiceNo}</p>
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
          <label className="form-label">Nr. Fature <span className="text-[10px] text-slate-400 dark:text-slate-500">(auto)</span></label>
          <input
            type="text" value={invoiceNo} readOnly
            className="input-field font-mono bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-200 cursor-not-allowed"
          />
        </div>
        <div>
          <label className="form-label">Datë</label>
          <input
            type="date" value={invoiceDate}
            onChange={e => setInvoiceDate(e.target.value)}
            max={isAdmin ? undefined : today}
            min={isAdmin ? undefined : today}
            readOnly={!isAdmin}
            className={`input-field ${!isAdmin ? 'bg-slate-50 dark:bg-slate-900 cursor-not-allowed' : ''}`}
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
            <span className="ml-1 text-[10px] text-slate-400 dark:text-slate-500">(1 {currency} = ? LEK)</span>
          </label>
          <div className="flex gap-1">
            <input
              type="number" step="0.0001" min="0"
              value={exchangeRate}
              onChange={e => changeExchangeRate(e.target.value)}
              disabled={currency === 'LEK'}
              className="input-field flex-1 disabled:bg-slate-50"
            />
            <button onClick={refreshRates} title="Rifresko kursin"
              className="px-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs">↻</button>
          </div>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
            Burimi: <span className="font-medium">{rateSource || '—'}</span>
          </p>
        </div>
        <div className="col-span-2 md:col-span-4">
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <label className="form-label !mb-0">Pagesa</label>
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
                            ⚠️ Asnjë pagesë — fatura do të mbetet <span className="font-semibold">borxh i plotë</span>. Përdor butonat më poshtë për të shtuar pagesë.
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
                    <label className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-semibold">Pa Paguar / Borxh ({currency})</label>
                    <div className={`input-field tabular-nums font-bold ${due > 0.005 ? 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-200' : due < -0.005 ? 'bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border-purple-200' : 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-200'}`}>
                      {due > 0.005 ? fmt(due) : due < -0.005 ? `+${fmt(-due)} tepër` : '✓ Paguar plotësisht'}
                    </div>
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

      {/* Fushat për porosi online — kanali, adresa, tracking, statusi */}
      {online && (
        <div className="card border-purple-200 bg-purple-50/30">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xl">🛒</span>
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Detajet e Porosisë Online</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="form-label">Kanali</label>
              <select value={channel} onChange={e => setChannel(e.target.value)} className="input-field">
                <option value="Instagram">📸 Instagram</option>
                <option value="WhatsApp">💬 WhatsApp</option>
                <option value="Facebook">📘 Facebook</option>
                <option value="Telefon">📞 Telefon</option>
                <option value="Website">🌐 Website</option>
                <option value="Tjeter">Tjetër</option>
              </select>
            </div>
            <div>
              <label className="form-label">Statusi i Porosisë</label>
              <select value={orderStatus} onChange={e => setOrderStatus(e.target.value)} className="input-field">
                <option value="e_re">🆕 E re</option>
                <option value="ne_pergatitje">📦 Në përgatitje</option>
                <option value="derguar">🚚 Dërguar</option>
                <option value="dorezuar">✓ Dorëzuar</option>
                <option value="anuluar">❌ Anuluar</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="form-label">Nr. i Ndjekjes (tracking)</label>
              <input type="text" value={trackingNo} onChange={e => setTrackingNo(e.target.value)}
                className="input-field font-mono" placeholder="opsional — kodi i dërgesës" />
            </div>
            <div className="md:col-span-4">
              <label className="form-label">Adresa e Dërgimit</label>
              <textarea value={shippingAddress} onChange={e => setShippingAddress(e.target.value)}
                className="input-field resize-none" rows={2}
                placeholder="Emri i marrësit, adresa, qyteti, telefoni për transportuesin..." />
            </div>
          </div>
        </div>
      )}

      {/* Items table */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[1300px]">
            <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
              <tr className="text-slate-500 dark:text-slate-400">
                <th className="px-2 py-2 text-left font-semibold w-8">#</th>
                <th className="px-2 py-2 text-left font-semibold w-32">Barkodi</th>
                <th className="px-2 py-2 text-left font-semibold w-64">Përshkrimi</th>
                <th className="px-2 py-2 text-right font-semibold w-16">Sasia</th>
                <th className="px-2 py-2 text-right font-semibold w-20">Gramatura</th>
                <th className="px-2 py-2 text-right font-semibold w-20 bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200" title="Pesha e florit të pastër (gram HAS) — mbushet auto nga produkti">Has ne shitje</th>
                <th className="px-2 py-2 text-right font-semibold w-20 bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200" title="Kursi i Shitjes për këtë rresht — vendoset manualisht nga user-i (jo auto). Kur ndryshohet, çmimi rillogaritet (formula flori nëse Has+Shumëzues>0, ndryshe proporcionalisht)">Kursi Shitje</th>
                <th className="px-2 py-2 text-right font-semibold w-24">Zbritje €</th>
                <th className="px-2 py-2 text-right font-semibold w-16">Zbritje %</th>
                <th className="px-2 py-2 text-right font-semibold w-14">TVSH %</th>
                <th className="px-2 py-2 text-right font-semibold w-24">Çmimi final</th>
                <th className="px-2 py-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => {
                const lt = lineTotals[idx]
                const base = n(it.qty) * n(it.unit_price_no_vat)
                const discEur = discountEurFor(it)
                const isGiftRow = !!it.is_gift
                return (
                  <tr key={idx} className={`border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 ${isGiftRow ? 'bg-rose-50/40 dark:bg-rose-900/10' : ''}`}>
                    <td className="px-2 py-1 text-center text-slate-400 dark:text-slate-500">
                      {isGiftRow ? <span title="Dhuratë">🎁</span> : idx + 1}
                    </td>
                    <td className="px-1 py-1">
                      <BarcodeSearchInput
                        value={it.barcode}
                        onTypedChange={v => setItem(idx, { barcode: v })}
                        onPick={p => pickProduct(idx, p)}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <ProductPickerCell value={it} onPick={p => pickProduct(idx, p)} />
                      {isGiftRow && <div className="text-[10px] font-semibold text-rose-600 dark:text-rose-300 mt-0.5">🎁 Dhuratë (nuk hyn në total)</div>}
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
                        type="number" step="0.001" min="0" value={it.gram}
                        onChange={e => setItem(idx, { gram: e.target.value })}
                        className="input-field-sm text-right"
                      />
                    </td>
                    <td className="px-1 py-1 bg-amber-50/40 dark:bg-amber-900/10">
                      <MoneyInput
                        value={it.has_gram}
                        onChange={v => changeItemFloriField(idx, 'has_gram', v)}
                        className="input-field-sm text-right font-semibold text-amber-800 dark:text-amber-200"
                        placeholder="0.000"
                      />
                    </td>
                    <td className="px-1 py-1 bg-emerald-50/40 dark:bg-emerald-900/10">
                      <MoneyInput
                        value={it.sell_rate}
                        onChange={v => changeItemSellRate(idx, v)}
                        className="input-field-sm text-right font-semibold text-emerald-800 dark:text-emerald-200"
                        placeholder="0.00"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <MoneyInput
                        value={discEur}
                        onChange={eur => {
                          if (base <= 0) { setItem(idx, { discount_percent: 0 }); return }
                          // Zbritja € interpretohet si "eur off nga finali me TVSH".
                          // discount_percent aplikohet mbi bazen pa-TVSH (te computeLine),
                          // ndaj konvertojme: pct = eur / (base × (1 + vat/100)) × 100.
                          const vatFactor = 1 + (parseFloat(it.vat_rate) || 0) / 100
                          const pct = Math.max(0, Math.min(100, (eur / (base * vatFactor)) * 100))
                          setItem(idx, { discount_percent: +pct.toFixed(2) })
                        }}
                        className="input-field-sm text-right"
                        placeholder="0.00"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="number" step="0.01" min="0" max="100" value={it.discount_percent}
                        onChange={e => setItem(idx, { discount_percent: e.target.value })}
                        className="input-field-sm text-right"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="number" step="0.01" min="0" max="100" value={it.vat_rate}
                        onChange={e => setItem(idx, { vat_rate: e.target.value })}
                        className="input-field-sm text-right"
                      />
                    </td>
                    <td className="px-1 py-1 text-right tabular-nums font-semibold text-slate-900 dark:text-white">
                      {!!it.on_promotion && (
                        <div className="flex justify-end mb-0.5">
                          <span className="badge bg-rose-100 text-rose-700 text-[9px] font-bold whitespace-nowrap">
                            🏷️ PROMO {n(it.promo_discount_pct) > 0 ? `-${n(it.promo_discount_pct)}%` : ''}
                          </span>
                        </div>
                      )}
                      {isAdmin && !isGiftRow ? (
                        <MoneyInput
                          value={lt.total_with_vat}
                          onChange={finalVal => {
                            const q      = n(it.qty)
                            const discF  = 1 - (n(it.discount_percent) / 100)
                            const vatF   = 1 + (n(it.vat_rate) / 100)
                            const denom  = q * discF * vatF
                            if (!(denom > 0)) return
                            setItem(idx, { unit_price_no_vat: +(finalVal / denom).toFixed(4) })
                          }}
                          className="input-field-sm text-right font-semibold"
                          placeholder="0.00"
                        />
                      ) : (
                        fmt(lt.total_with_vat)
                      )}
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
                <td colSpan={10} className="px-2 py-2 text-right text-slate-600 dark:text-slate-300">TOTALI ({currency}):</td>
                <td className="px-2 py-2 text-right tabular-nums text-blue-700 dark:text-blue-300 text-sm">{fmt(totals.tot)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="p-3 border-t border-slate-100 dark:border-slate-800 flex items-center gap-2 flex-wrap">
          <button onClick={addItem} className="btn-secondary text-xs">+ Shto Artikull</button>
          <button onClick={openGiftPicker} className="btn-secondary text-xs bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-900/30 dark:hover:bg-rose-900/50 dark:text-rose-300 dark:border-rose-800">
            🎁 Shto Dhuratë
          </button>
        </div>
      </div>

      {showGiftPicker && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
             onClick={() => setShowGiftPicker(false)}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-lg w-full p-5 border border-slate-200 dark:border-slate-700"
               onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">🎁 Zgjidh një Dhuratë</h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Produkte të markuara si dhurata te Blerje Artikuj të Tjerë. Shtimi zbret stokun; shuma nuk hyn në totalin e faturës.</p>
              </div>
              <button onClick={() => setShowGiftPicker(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            {giftLoading ? (
              <div className="text-center py-6 text-xs text-slate-400">Duke ngarkuar...</div>
            ) : giftOptions.length === 0 ? (
              <div className="text-center py-6 text-xs text-slate-400 dark:text-slate-500">
                Nuk ka produkte dhurata në stok. Kaloji te Blerje Artikuj të Tjerë dhe shëno "🎁 Kjo faturë përmban dhurata".
              </div>
            ) : (
              <div className="max-h-80 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">
                {giftOptions.map(p => (
                  <button key={p.id} onClick={() => addGift(p)}
                    className="w-full text-left px-3 py-2 border-b border-slate-100 dark:border-slate-800 last:border-0 hover:bg-rose-50 dark:hover:bg-rose-900/20">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{p.name}</div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono truncate">{p.barcode || p.sku || '—'}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">Stok</div>
                        <div className="text-sm font-bold text-emerald-700 dark:text-emerald-300">{p.stock}</div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main entry ───────────────────────────────────────────────────────────────
// `online` prop: kur true, komponenti bëhet moduli "Shitje Online" — filtron
// listën për fatura online (`is_online=1`), shfaq statuse porosie, dhe në
// editor kërkon fushat shtesë (kanali, adresa, tracking, statusi).
export default function FaturaShitje({ date, openInvoiceId, onConsumeOpen, openNew, onConsumeNew, online = false }) {
  const [mode, setMode]               = useState('list')   // list | edit
  const [editingId, setEditingId]     = useState(null)
  const [refreshKey, setRefreshKey]   = useState(0)
  // Stornimi krijohet menjëherë në DB për të hapur redaktuesin; nëse përdoruesi
  // del me Anulo/Mbrapa pa e ruajtur, e fshijmë në vend që ta lëmë në bazë.
  const [pendingStornoId, setPendingStornoId] = useState(null)
  // Modal për kthim të pjesshëm — mban faturën origjinale që u zgjodh.
  const [returnFor, setReturnFor] = useState(null)

  // When a parent route asks us to open a specific invoice, switch into edit mode
  useEffect(() => {
    if (openInvoiceId) {
      setEditingId(openInvoiceId)
      setMode('edit')
      onConsumeOpen?.()
    }
  }, [openInvoiceId, onConsumeOpen])

  // Nga një link "Shitje e Re" — hap direkt editorin bosh
  useEffect(() => {
    if (openNew) {
      setEditingId(null)
      setMode('edit')
      onConsumeNew?.()
    }
  }, [openNew, onConsumeNew])

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
    if (!(await showConfirm(`Fshi faturën ${no}? Stoku do të kthehet në inventar.`, {
      title: 'Fshi faturën', confirmLabel: 'Fshi', danger: true,
    }))) return
    await fetch(`/api/invoices/${id}`, { method: 'DELETE' })
    setRefreshKey(k => k + 1)
  }

  // Hap modalin e kthimit — user zgjedh vetëm artikujt që kthehen dhe sasinë.
  // Modali thërret API me items=[{item_id, qty}] dhe pastaj hap kreditoren në
  // editor për verifikim / rregullim final.
  const stornoInvoice = async (id, no) => {
    // Ngarko një snapshot minimal të faturës që modali të ketë kontekst.
    try {
      const inv = await fetch(`/api/invoices/${id}`).then(r => r.json())
      setReturnFor(inv)
    } catch (_) { alert('Nuk u ngarkua fatura') }
  }

  const onReturnCreated = (r) => {
    setReturnFor(null)
    setRefreshKey(k => k + 1)
    // Kreditorja krijohet me shumat e sakta (artikujt e zgjedhur + refund
    // proporcional i pagesave). Nuk hapim editorin automatikisht — kjo do të
    // shkaktonte 403 për shitësit që s'kanë PUT. Admini mund të klikojë "Hap"
    // te rreshti i kreditores nëse duhet ta rregullojë manualisht.
  }

  if (mode === 'edit') {
    return (
      <>
        <InvoiceEditor date={date} invoiceId={editingId} onClose={closeEditor} onSaved={onSaved} online={online} />
        {returnFor && <PartialReturnModal invoice={returnFor} onClose={() => setReturnFor(null)} onCreated={onReturnCreated} />}
      </>
    )
  }
  return (
    <>
      <InvoiceList
        date={date}
        onOpen={openInvoice}
        onCreate={createNew}
        onDelete={deleteInvoice}
        onStornim={stornoInvoice}
        refreshKey={refreshKey}
        online={online}
      />
      {returnFor && <PartialReturnModal invoice={returnFor} onClose={() => setReturnFor(null)} onCreated={onReturnCreated} />}
    </>
  )
}
