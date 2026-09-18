import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRealtimeSync } from '../hooks/useRealtimeSync.js'
import MoneyInput from './MoneyInput.jsx'

const STATUS_META = {
  ne_progres: { label: 'Në progres', cls: 'bg-amber-100 text-amber-700 dark:text-amber-300',    icon: '⏳' },
  gati:       { label: 'Gati',       cls: 'bg-emerald-100 text-emerald-700 dark:text-emerald-300', icon: '✅' },
  dorezuar:   { label: 'Dorëzuar',   cls: 'bg-blue-100 text-blue-700 dark:text-blue-300',       icon: '📦' },
}
const STATUS_ORDER = ['ne_progres', 'gati', 'dorezuar']
const CURRENCIES = ['EUR', 'USD', 'LEK', 'GBP', 'CHF']
const KARATS = ['9K', '10K', '14K', '18K', '21K', '21.6K', '22K', '24K']
const CATEGORIES = ['Unazë', 'Byzylyk', 'Gjerdan', 'Vathë', 'Varëse', 'Kafaz', 'Kurorë', 'Sterlinë', 'Tjetër']

function today() { return new Date().toISOString().split('T')[0] }
function fmt(v) { const n = parseFloat(v) || 0; return n.toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function fmt3(v) { const n = parseFloat(v) || 0; return n.toLocaleString('sq-AL', { minimumFractionDigits: 0, maximumFractionDigits: 3 }) }

function EMPTY() {
  return {
    date: today(),
    expected_delivery_date: '',
    customer_name: '',
    customer_phone: '',
    reference_product_id: null,
    reference_product_name: '',
    reference_product_barcode: '',
    reference_note: '',
    category: '',
    karat: '',
    gram: '',
    stones: '',
    initials: '',
    size: '',
    notes: '',
    image_path: '',
    currency: 'EUR',
    sell_price: '',
  }
}

// ── Reference product picker ───────────────────────────────────────────────
function ReferenceProductPicker({ value, name, barcode, onPick, onClear }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const timerRef = useRef(null)
  const boxRef = useRef(null)

  useEffect(() => {
    function onDoc(e) { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
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

  if (value) {
    return (
      <div className="flex items-center gap-2 p-2 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg">
        <span className="text-lg">💎</span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm text-slate-800 dark:text-slate-100 truncate">{name}</div>
          <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">{barcode || '—'}</div>
        </div>
        <button type="button" onClick={onClear} className="text-xs text-red-600 hover:underline">Hiq</button>
      </div>
    )
  }

  return (
    <div className="relative" ref={boxRef}>
      <input
        type="text" value={query}
        onChange={e => { setQuery(e.target.value); search(e.target.value); setOpen(true) }}
        onFocus={() => query && setOpen(true)}
        placeholder="Kërko produkt referencë (emër ose barkod)..."
        className="input-field text-sm"
      />
      {open && (results.length > 0 || loading) && (
        <div className="absolute z-50 mt-1 w-full max-h-64 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg">
          {loading && <div className="p-2 text-xs text-slate-400">Duke kërkuar...</div>}
          {results.map(p => (
            <button type="button" key={p.id}
              onClick={() => { onPick(p); setOpen(false); setQuery(''); setResults([]) }}
              className="w-full text-left px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-700 border-b border-slate-100 dark:border-slate-700 last:border-0">
              <div className="text-sm text-slate-800 dark:text-slate-100">{p.name}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">{p.barcode || '—'} · stok: {p.stock || 0}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Editor Modal ────────────────────────────────────────────────────────────
function PorosiEditor({ porosi, onClose, onSave }) {
  const [form, setForm] = useState(() => porosi ? { ...EMPTY(), ...porosi } : EMPTY())
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const submit = async (e) => {
    e.preventDefault()
    if (!form.customer_name.trim()) { alert('Vendos emrin e klientit.'); return }
    if (!form.date) { alert('Vendos datën.'); return }
    if (!(parseFloat(form.sell_price) > 0)) { alert('Vendos vlerën e shitjes.'); return }
    setSaving(true)
    try {
      await onSave(form)
    } finally { setSaving(false) }
  }

  const pickReference = (p) => setForm(f => ({
    ...f,
    reference_product_id: p.id,
    reference_product_name: p.name,
    reference_product_barcode: p.barcode || '',
    // Auto-populate karat/gram from reference if empty
    karat: f.karat || (p.name?.match(/\b(\d{1,2}(?:\.\d+)?K)\b/i)?.[1] || ''),
    gram: f.gram || (p.gram ? String(p.gram) : ''),
    currency: f.currency || 'EUR',
    sell_price: f.sell_price || (p.sell_price ? String(p.sell_price) : ''),
  }))

  const clearReference = () => setForm(f => ({ ...f, reference_product_id: null, reference_product_name: '', reference_product_barcode: '' }))

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="modal-header">
          <div>
            <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">
              {porosi?.id ? `Edito Porosinë ${porosi.porosi_no}` : '🛠️ Porosi e Re'}
            </h3>
            {porosi?.porosi_no && <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">{porosi.porosi_no}</p>}
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 dark:text-slate-500 text-xl">×</button>
        </div>
        <form onSubmit={submit}>
          <div className="p-6 space-y-4">
            {/* Data + statusi */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="form-label">Data *</label>
                <input type="date" value={form.date} onChange={e => set('date', e.target.value)} className="input-field" required />
              </div>
              <div>
                <label className="form-label">Data e Pritur e Dorëzimit</label>
                <input type="date" value={form.expected_delivery_date || ''}
                  onChange={e => set('expected_delivery_date', e.target.value)} className="input-field" />
              </div>
              <div>
                <label className="form-label">Statusi</label>
                <select value={form.status || 'ne_progres'} onChange={e => set('status', e.target.value)} className="input-field">
                  {STATUS_ORDER.filter(s => s !== 'dorezuar').map(s => (
                    <option key={s} value={s}>{STATUS_META[s].icon} {STATUS_META[s].label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Klienti */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="form-label">Emri i Klientit *</label>
                <input type="text" value={form.customer_name}
                  onChange={e => set('customer_name', e.target.value)}
                  className="input-field" required />
              </div>
              <div>
                <label className="form-label">Telefoni</label>
                <input type="text" value={form.customer_phone || ''}
                  onChange={e => set('customer_phone', e.target.value)}
                  className="input-field" />
              </div>
            </div>

            {/* Produkt referencë */}
            <div>
              <label className="form-label">Produkt Referencë (nga inventari)</label>
              <ReferenceProductPicker
                value={form.reference_product_id}
                name={form.reference_product_name}
                barcode={form.reference_product_barcode}
                onPick={pickReference}
                onClear={clearReference}
              />
              <input type="text" value={form.reference_note || ''}
                onChange={e => set('reference_note', e.target.value)}
                placeholder="Modifikimet — p.sh. 'si kjo por me smerald në vend të diamantit'"
                className="input-field text-sm mt-2" />
            </div>

            {/* Fusha teknike */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="form-label">Kategoria</label>
                <select value={form.category || ''} onChange={e => set('category', e.target.value)} className="input-field">
                  <option value="">—</option>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Karat</label>
                <select value={form.karat || ''} onChange={e => set('karat', e.target.value)} className="input-field">
                  <option value="">—</option>
                  {KARATS.map(k => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Pesha (gr)</label>
                <input type="number" step="0.001" min="0" value={form.gram || ''}
                  onChange={e => set('gram', e.target.value)} className="input-field text-right" />
              </div>
              <div>
                <label className="form-label">Përmasa</label>
                <input type="text" value={form.size || ''}
                  onChange={e => set('size', e.target.value)}
                  placeholder="p.sh. 17, 45cm"
                  className="input-field" />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="form-label">Gurë (lloji, sasia, karat)</label>
                <input type="text" value={form.stones || ''}
                  onChange={e => set('stones', e.target.value)}
                  placeholder="p.sh. 1x smerald 0.5ct + 2x diamant 0.1ct"
                  className="input-field" />
              </div>
              <div>
                <label className="form-label">Iniciale / Gdhendje</label>
                <input type="text" value={form.initials || ''}
                  onChange={e => set('initials', e.target.value)}
                  placeholder="p.sh. A&B, 12.06.2026"
                  className="input-field" />
              </div>
            </div>

            <div>
              <label className="form-label">Shënime</label>
              <textarea value={form.notes || ''} onChange={e => set('notes', e.target.value)}
                rows={2} className="input-field text-sm" placeholder="Detaje shtesë, kërkesa speciale..." />
            </div>

            {porosi?.id && (
              <div>
                <label className="form-label">Foto / Skicë</label>
                <div className="flex items-center gap-3">
                  {form.image_path ? (
                    <>
                      <img src={`/uploads/products/${form.image_path}`} alt="skicë"
                        className="w-20 h-20 object-cover rounded-lg border border-slate-200" />
                      <button type="button" className="btn-secondary text-xs"
                        onClick={async () => {
                          if (!confirm('Fshi imazhin?')) return
                          await fetch(`/api/porosi/${porosi.id}/image`, { method: 'DELETE' })
                          set('image_path', '')
                        }}>Fshi Imazhin</button>
                    </>
                  ) : (
                    <label className="btn-secondary text-xs cursor-pointer">
                      📷 Ngarko Foto
                      <input type="file" accept="image/*" className="hidden"
                        onChange={async (e) => {
                          const f = e.target.files?.[0]; if (!f) return
                          const fd = new FormData(); fd.append('image', f)
                          const res = await fetch(`/api/porosi/${porosi.id}/image`, { method: 'POST', body: fd })
                          const d = await res.json()
                          if (d.success) set('image_path', d.image_path)
                        }} />
                    </label>
                  )}
                </div>
              </div>
            )}

            {/* Financiare */}
            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-200 dark:border-slate-700">
              <div>
                <label className="form-label">Monedha</label>
                <select value={form.currency || 'EUR'} onChange={e => set('currency', e.target.value)} className="input-field">
                  {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Vlera e Shitjes *</label>
                <MoneyInput value={form.sell_price} onChange={v => set('sell_price', v)} />
              </div>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn-secondary">Anulo</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Duke ruajtur...' : (porosi?.id ? '💾 Ruaj Ndryshimet' : '➕ Krijo Porosinë')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Deposits Modal ──────────────────────────────────────────────────────────
function DepositsModal({ porosi, onClose, onChanged }) {
  const [deposits, setDeposits] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({
    date: today(), amount: '', currency: porosi.currency || 'EUR',
    method: 'cash', exchange_rate: 1, notes: '',
  })
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetch(`/api/porosi/${porosi.id}`).then(r => r.json())
      setDeposits(data.deposits || [])
    } catch { setDeposits([]) }
    setLoading(false)
  }, [porosi.id])

  useEffect(() => { load() }, [load])

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const totalInCurrency = useMemo(() => {
    // Konverto çdo depozitë në monedhën e porosisë duke përdorur exchange_rate
    // e depozitës. Nëse monedha përputhet, s'ka konvertim.
    return deposits.reduce((s, d) => {
      const amt = parseFloat(d.amount) || 0
      if (d.currency === porosi.currency) return s + amt
      return s + amt * (parseFloat(d.exchange_rate) || 1)
    }, 0)
  }, [deposits, porosi.currency])

  const remaining = Math.max(0, (parseFloat(porosi.sell_price) || 0) - totalInCurrency)

  const submit = async (e) => {
    e.preventDefault()
    const amt = parseFloat(form.amount) || 0
    if (amt <= 0) { alert('Vendos shumën e depozitës.'); return }
    if (!form.date) { alert('Vendos datën.'); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/porosi/${porosi.id}/deposits`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Gabim në ruajtje')
      }
      setForm({ date: today(), amount: '', currency: porosi.currency || 'EUR', method: 'cash', exchange_rate: 1, notes: '' })
      await load()
      onChanged?.()
    } catch (e) { alert(e.message) }
    finally { setSaving(false) }
  }

  const removeDep = async (id) => {
    if (!confirm('Fshi këtë depozitë?')) return
    const res = await fetch(`/api/porosi-deposits/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      alert(err.error || 'Gabim në fshirje')
      return
    }
    await load()
    onChanged?.()
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="modal-header">
          <div>
            <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">💰 Depozitat — {porosi.porosi_no}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">{porosi.customer_name}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 dark:text-slate-500 text-xl">×</button>
        </div>

        <div className="p-6 space-y-4">
          {/* Përmbledhëse */}
          <div className="grid grid-cols-3 gap-3">
            <div className="card py-3 text-center">
              <p className="text-[10px] text-slate-500 uppercase font-semibold">Vlera Totale</p>
              <p className="text-xl font-bold tabular-nums">{fmt(porosi.sell_price)} {porosi.currency}</p>
            </div>
            <div className="card py-3 text-center bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200">
              <p className="text-[10px] text-emerald-700 uppercase font-semibold">Paguar Deri Tani</p>
              <p className="text-xl font-bold text-emerald-700 dark:text-emerald-300 tabular-nums">{fmt(totalInCurrency)} {porosi.currency}</p>
            </div>
            <div className={`card py-3 text-center ${remaining <= 0.005 ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
              <p className={`text-[10px] uppercase font-semibold ${remaining <= 0.005 ? 'text-emerald-700' : 'text-amber-700'}`}>Të Mbetura</p>
              <p className={`text-xl font-bold tabular-nums ${remaining <= 0.005 ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>
                {remaining <= 0.005 ? '✓ Mbyllur' : `${fmt(remaining)} ${porosi.currency}`}
              </p>
            </div>
          </div>

          {/* Lista e depozitave */}
          <div>
            <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">Depozitat e Regjistruara</h4>
            {loading ? (
              <div className="text-center text-sm text-slate-400 py-4">Duke ngarkuar...</div>
            ) : deposits.length === 0 ? (
              <div className="text-center text-sm text-slate-400 py-4">Nuk ka depozita ende.</div>
            ) : (
              <div className="space-y-1">
                {deposits.map(d => (
                  <div key={d.id} className="flex items-center gap-3 p-2 bg-slate-50 dark:bg-slate-900 rounded-lg">
                    <div className="text-xs w-20 text-slate-500">{d.date}</div>
                    <div className="text-xs w-14">
                      {d.method === 'bank' ? '🏦 Bankë' : d.method === 'pos' ? '💳 POS' : '💵 Cash'}
                    </div>
                    <div className="flex-1 font-bold text-emerald-700 dark:text-emerald-300 tabular-nums">
                      {fmt(d.amount)} {d.currency}
                      {d.currency !== porosi.currency && (
                        <span className="text-[10px] font-normal text-slate-500 ml-2">
                          (kurs {d.exchange_rate} → {fmt(d.amount * (d.exchange_rate || 1))} {porosi.currency})
                        </span>
                      )}
                    </div>
                    {d.notes && <div className="text-[10px] italic text-slate-500 flex-1 truncate">{d.notes}</div>}
                    {porosi.status !== 'dorezuar' && (
                      <button onClick={() => removeDep(d.id)} className="text-xs text-red-600 hover:underline">Fshi</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Formë e re depozite */}
          {porosi.status !== 'dorezuar' && (
            <form onSubmit={submit} className="border-t border-slate-200 dark:border-slate-700 pt-4 space-y-3">
              <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">➕ Regjistro Depozitë të Re</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div>
                  <label className="form-label text-xs">Data</label>
                  <input type="date" value={form.date} onChange={e => set('date', e.target.value)} className="input-field text-sm" required />
                </div>
                <div>
                  <label className="form-label text-xs">Shuma</label>
                  <MoneyInput value={form.amount} onChange={v => set('amount', v)} />
                </div>
                <div>
                  <label className="form-label text-xs">Monedha</label>
                  <select value={form.currency} onChange={e => set('currency', e.target.value)} className="input-field text-sm">
                    {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label text-xs">Metoda</label>
                  <select value={form.method} onChange={e => set('method', e.target.value)} className="input-field text-sm">
                    <option value="cash">💵 Cash</option>
                    <option value="bank">🏦 Bankë</option>
                    <option value="pos">💳 POS</option>
                  </select>
                </div>
              </div>
              {form.currency !== porosi.currency && (
                <div>
                  <label className="form-label text-xs">Kursi ({form.currency} → {porosi.currency})</label>
                  <input type="number" step="0.0001" min="0" value={form.exchange_rate}
                    onChange={e => set('exchange_rate', e.target.value)} className="input-field text-sm" />
                </div>
              )}
              <div>
                <label className="form-label text-xs">Shënime (opsionale)</label>
                <input type="text" value={form.notes} onChange={e => set('notes', e.target.value)}
                  className="input-field text-sm" placeholder="p.sh. Depozita e parë 30%" />
              </div>
              <button type="submit" className="btn-primary w-full" disabled={saving}>
                {saving ? 'Duke regjistruar...' : '💰 Regjistro Depozitën'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Deliver Modal ───────────────────────────────────────────────────────────
function DeliverModal({ porosi, onClose, onDelivered }) {
  const [full, setFull] = useState(null)
  const [loading, setLoading] = useState(true)
  const [date, setDate] = useState(today())
  const [newPayment, setNewPayment] = useState('')
  const [newMethod, setNewMethod] = useState('cash')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    (async () => {
      try {
        const data = await fetch(`/api/porosi/${porosi.id}`).then(r => r.json())
        setFull(data)
      } catch { setFull(porosi) }
      setLoading(false)
    })()
  }, [porosi.id])

  if (loading || !full) return null

  const totalDeposits = (full.deposits || []).reduce((s, d) => {
    const amt = parseFloat(d.amount) || 0
    if (d.currency === full.currency) return s + amt
    return s + amt * (parseFloat(d.exchange_rate) || 1)
  }, 0)
  const total = parseFloat(full.sell_price) || 0
  const remainingBeforePay = Math.max(0, total - totalDeposits)
  const newPay = Math.min(remainingBeforePay, parseFloat(newPayment) || 0)
  const remainingAfterPay = Math.max(0, remainingBeforePay - newPay)

  const submit = async () => {
    if (!full.sell_price || parseFloat(full.sell_price) <= 0) {
      alert('Vendos vlerën e shitjes te porosia para dorëzimit.'); return
    }
    if (!confirm(`Të krijohet fatura e shitjes për ${full.customer_name}?\n\nTotal: ${fmt(total)} ${full.currency}\nDepozitat: ${fmt(totalDeposits)} ${full.currency}\nPagesa e re: ${fmt(newPay)} ${full.currency}\nMbetet borxh: ${fmt(remainingAfterPay)} ${full.currency}`)) return
    setSaving(true)
    try {
      const res = await fetch(`/api/porosi/${porosi.id}/deliver`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          new_payment_amount: newPay,
          new_payment_method: newMethod,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Gabim në dorëzim')
      }
      const data = await res.json()
      alert(`✅ Fatura ${data.invoice_no} u krijua me sukses!`)
      onDelivered?.()
    } catch (e) { alert(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="modal-header">
          <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">📦 Dorëzo Porosinë — {full.porosi_no}</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 dark:text-slate-500 text-xl">×</button>
        </div>

        <div className="p-6 space-y-4">
          <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg text-sm">
            <div><span className="text-slate-500">Klienti:</span> <strong>{full.customer_name}</strong></div>
            {full.category && <div><span className="text-slate-500">Artikulli:</span> {full.category} {full.karat} {full.gram ? `· ${full.gram}g` : ''}</div>}
            {full.initials && <div><span className="text-slate-500">Iniciale:</span> {full.initials}</div>}
          </div>

          <div>
            <label className="form-label">Data e Faturës</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className="input-field" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 bg-slate-50 rounded-lg text-center">
              <div className="text-[10px] text-slate-500 uppercase">Total Fature</div>
              <div className="text-lg font-bold tabular-nums">{fmt(total)} {full.currency}</div>
            </div>
            <div className="p-3 bg-emerald-50 dark:bg-emerald-900/30 rounded-lg text-center">
              <div className="text-[10px] text-emerald-700 uppercase">Depozita e Aplikuar</div>
              <div className="text-lg font-bold text-emerald-700 dark:text-emerald-300 tabular-nums">{fmt(totalDeposits)} {full.currency}</div>
            </div>
          </div>

          <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
            <div className="text-sm font-semibold text-slate-700 mb-2">Pagesa në Dorëzim (opsionale)</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label text-xs">Shuma ({full.currency})</label>
                <MoneyInput value={newPayment} onChange={setNewPayment} />
              </div>
              <div>
                <label className="form-label text-xs">Metoda</label>
                <select value={newMethod} onChange={e => setNewMethod(e.target.value)} className="input-field text-sm">
                  <option value="cash">💵 Cash</option>
                  <option value="bank">🏦 Bankë</option>
                  <option value="pos">💳 POS</option>
                </select>
              </div>
            </div>
            <div className="mt-2 text-xs text-slate-500">Max: {fmt(remainingBeforePay)} {full.currency}</div>
          </div>

          <div className={`p-3 rounded-lg text-center ${remainingAfterPay <= 0.005 ? 'bg-emerald-50 border border-emerald-200' : 'bg-amber-50 border border-amber-200'}`}>
            <div className="text-[10px] uppercase font-semibold">Do të mbetet borxh</div>
            <div className={`text-2xl font-bold tabular-nums ${remainingAfterPay <= 0.005 ? 'text-emerald-700' : 'text-amber-700'}`}>
              {remainingAfterPay <= 0.005 ? '✓ 0' : fmt(remainingAfterPay)} {full.currency}
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="btn-secondary">Anulo</button>
          <button onClick={submit} className="btn-primary" disabled={saving}>
            {saving ? 'Duke krijuar...' : '📦 Dorëzo dhe Krijo Faturën'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Porosi Component ───────────────────────────────────────────────────
export default function Porosi() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [search, setSearch] = useState('')

  const [editorPorosi, setEditorPorosi] = useState(null)
  const [showEditor, setShowEditor] = useState(false)
  const [depositsFor, setDepositsFor] = useState(null)
  const [deliverFor, setDeliverFor] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (fromDate) params.set('from', fromDate)
      if (toDate)   params.set('to', toDate)
      if (statusFilter !== 'all') params.set('status', statusFilter)
      const data = await fetch(`/api/porosi?${params}`).then(r => r.json())
      setItems(Array.isArray(data) ? data : [])
    } catch { setItems([]) }
    setLoading(false)
  }, [fromDate, toDate, statusFilter])

  useEffect(() => { load() }, [load])
  useRealtimeSync('porosi', load)
  useRealtimeSync('porosi_deposits', load)

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return items
    return items.filter(p =>
      (p.porosi_no || '').toLowerCase().includes(s) ||
      (p.customer_name || '').toLowerCase().includes(s) ||
      (p.customer_phone || '').toLowerCase().includes(s) ||
      (p.reference_product_barcode || '').toLowerCase().includes(s)
    )
  }, [items, search])

  const stats = useMemo(() => {
    const s = { total: items.length, ne_progres: 0, gati: 0, dorezuar: 0 }
    for (const p of items) if (s[p.status] != null) s[p.status]++
    return s
  }, [items])

  const openNew = () => { setEditorPorosi(null); setShowEditor(true) }
  const openEdit = (p) => { setEditorPorosi(p); setShowEditor(true) }

  const savePorosi = async (form) => {
    const method = form.id ? 'PUT' : 'POST'
    const url = form.id ? `/api/porosi/${form.id}` : '/api/porosi'
    const res = await fetch(url, {
      method, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      alert(err.error || 'Gabim në ruajtje')
      return
    }
    setShowEditor(false)
    await load()
  }

  const deletePorosi = async (p) => {
    if (!confirm(`Fshi porosinë ${p.porosi_no}?`)) return
    const res = await fetch(`/api/porosi/${p.id}`, { method: 'DELETE' })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      alert(err.error || 'Gabim në fshirje')
      return
    }
    await load()
  }

  const markGati = async (p) => {
    const res = await fetch(`/api/porosi/${p.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...p, status: 'gati' }),
    })
    if (!res.ok) { alert('Gabim'); return }
    await load()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">🛠️ Porosi (Custom Orders)</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Menaxho porositë me modifikime — depozitë paraprake dhe dorëzim si faturë shitje.</p>
        </div>
        <button onClick={openNew} className="btn-primary">➕ Porosi e Re</button>
      </div>

      {/* Statistika */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <button onClick={() => setStatusFilter('all')} className={`card py-3 text-center transition ${statusFilter === 'all' ? 'ring-2 ring-blue-500' : ''}`}>
          <p className="text-[10px] text-slate-500 uppercase font-semibold">Të Gjitha</p>
          <p className="text-2xl font-bold text-slate-800 dark:text-slate-100">{stats.total}</p>
        </button>
        {STATUS_ORDER.map(s => (
          <button key={s} onClick={() => setStatusFilter(s)} className={`card py-3 text-center transition ${statusFilter === s ? 'ring-2 ring-blue-500' : ''}`}>
            <p className="text-[10px] uppercase font-semibold text-slate-500">{STATUS_META[s].icon} {STATUS_META[s].label}</p>
            <p className="text-2xl font-bold text-slate-800 dark:text-slate-100">{stats[s]}</p>
          </button>
        ))}
      </div>

      {/* Filtra */}
      <div className="card flex flex-wrap items-end gap-3">
        <div>
          <label className="form-label text-xs">Nga data</label>
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="input-field text-sm" />
        </div>
        <div>
          <label className="form-label text-xs">Deri</label>
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="input-field text-sm" />
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="form-label text-xs">Kërko (klient, nr, barkod)</label>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="P2026-00001, emri i klientit..." className="input-field text-sm" />
        </div>
        {(fromDate || toDate || statusFilter !== 'all' || search) && (
          <button onClick={() => { setFromDate(''); setToDate(''); setStatusFilter('all'); setSearch('') }}
            className="btn-secondary text-xs">Pastro Filtrat</button>
        )}
      </div>

      {/* Lista */}
      {loading ? (
        <div className="card p-8 text-center text-slate-400">Duke ngarkuar...</div>
      ) : filtered.length === 0 ? (
        <div className="card p-8 text-center text-slate-400">
          {items.length === 0 ? 'Nuk ka asnjë porosi ende. Kliko "Porosi e Re" për të filluar.' : 'Asnjë rezultat për filtrin aktual.'}
        </div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase">Nr / Data</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase">Klienti</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase">Përshkrimi</th>
                <th className="px-3 py-2 text-center text-xs font-semibold text-slate-500 uppercase">Statusi</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase">Vlera</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase">Paguar</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase">Borxh</th>
                <th className="px-3 py-2 text-center text-xs font-semibold text-slate-500 uppercase">Dorëzim</th>
                <th className="px-3 py-2 text-center text-xs font-semibold text-slate-500 uppercase">Veprime</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => {
                const paid = parseFloat(p.total_deposits_in_currency) || 0
                const total = parseFloat(p.sell_price) || 0
                const due = Math.max(0, total - paid)
                const meta = STATUS_META[p.status] || STATUS_META.ne_progres
                const parts = [p.category, p.karat, p.gram ? `${fmt3(p.gram)}g` : '', p.stones, p.initials ? `("${p.initials}")` : ''].filter(Boolean)
                return (
                  <tr key={p.id} className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900/50">
                    <td className="px-3 py-2">
                      <div className="font-mono text-xs text-slate-700 dark:text-slate-200">{p.porosi_no}</div>
                      <div className="text-[10px] text-slate-500">{p.date}</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-semibold text-slate-800 dark:text-slate-100">{p.customer_name}</div>
                      {p.customer_phone && <div className="text-[10px] text-slate-500">{p.customer_phone}</div>}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-300 max-w-xs">
                      {parts.length > 0 && <div>{parts.join(' · ')}</div>}
                      {p.reference_product_name && <div className="text-[10px] text-blue-600 dark:text-blue-400">Ref: {p.reference_product_name}</div>}
                      {p.reference_note && <div className="text-[10px] italic text-slate-500 line-clamp-2">"{p.reference_note}"</div>}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold ${meta.cls}`}>
                        {meta.icon} {meta.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmt(total)} {p.currency}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-700 dark:text-emerald-300">
                      {fmt(paid)}
                      {p.deposits_count > 0 && <div className="text-[10px] text-slate-500">{p.deposits_count} dep.</div>}
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums font-bold ${due > 0.005 ? 'text-amber-600' : 'text-emerald-600'}`}>
                      {due <= 0.005 ? '✓' : fmt(due)}
                    </td>
                    <td className="px-3 py-2 text-center text-xs text-slate-500">
                      {p.expected_delivery_date || '—'}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => setDepositsFor(p)} className="btn-secondary text-xs" title="Depozitat">💰</button>
                        {p.status !== 'dorezuar' && (
                          <>
                            <button onClick={() => openEdit(p)} className="btn-secondary text-xs" title="Edito">✏️</button>
                            {p.status === 'ne_progres' && (
                              <button onClick={() => markGati(p)} className="btn-secondary text-xs" title="Marko si Gati">✅</button>
                            )}
                            <button onClick={() => setDeliverFor(p)} className="btn-primary text-xs" title="Dorëzo">📦</button>
                            <button onClick={() => deletePorosi(p)} className="text-xs text-red-600 hover:underline px-1" title="Fshi">🗑️</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {showEditor && (
        <PorosiEditor
          porosi={editorPorosi}
          onClose={() => setShowEditor(false)}
          onSave={savePorosi}
        />
      )}
      {depositsFor && (
        <DepositsModal
          porosi={depositsFor}
          onClose={() => setDepositsFor(null)}
          onChanged={load}
        />
      )}
      {deliverFor && (
        <DeliverModal
          porosi={deliverFor}
          onClose={() => setDeliverFor(null)}
          onDelivered={() => { setDeliverFor(null); load() }}
        />
      )}
    </div>
  )
}
