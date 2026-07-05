import { useState, useEffect, useRef, useCallback, Fragment } from 'react'
import { exportToExcel, exportToPdf, formatNum } from '../utils/export.js'
import DateRangeFilter from './DateRangeFilter.jsx'

function n(v) { return parseFloat(v) || 0 }
function fmt(v) {
  return n(v).toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function pmLabel(pm) {
  return pm === 'debt' ? 'Borxh' : pm === 'bank' ? 'Bankë' : pm === 'pos' ? 'POS' : 'Cash'
}

function exportDebtsExcel(invoices, groupArr, totals, supplier) {
  const rows = []
  for (const g of groupArr) {
    for (const inv of g.list) {
      rows.push({
        'Furnitori': g.name || '(pa furnitor)',
        'NIPT': g.nipt || '',
        'Data Fature': inv.date,
        'Nr. Fature': inv.invoice_no,
        'Monedha': inv.currency,
        'Lloji Pagesës': pmLabel(inv.payment_method),
        'Totali': n(inv.total_with_vat),
        'Shuma e Paguar': n(inv.amount_paid),
        'Data Pagesës së Fundit': inv.last_payment_date || inv.date,
        'Shuma Pa Paguar': inv._due,
      })
    }
  }
  rows.push({
    'Furnitori': 'TOTALI',
    'NIPT': '', 'Data Fature': '', 'Nr. Fature': '', 'Monedha': '',
    'Lloji Pagesës': '',
    'Totali': totals.tot,
    'Shuma e Paguar': totals.paid,
    'Data Pagesës së Fundit': '',
    'Shuma Pa Paguar': totals.due,
  })
  const suffix = supplier?.name ? `_${supplier.name.replace(/\s+/g, '_')}` : ''
  exportToExcel(`Detyrime_Furnitor${suffix}_${new Date().toISOString().slice(0, 10)}`, rows, {
    sheetName: 'Detyrime',
    columnWidths: [22, 14, 12, 14, 10, 12, 14, 14, 18, 14],
  })
}

function exportDebtsPdf(invoices, groupArr, totals, supplier) {
  const sections = []
  for (const g of groupArr) {
    sections.push({
      title: `🏭 ${g.name || '(pa furnitor)'}${g.nipt ? ` — NIPT: ${g.nipt}` : ''}`,
      subtitle: `${g.list.length} fatura · Total: ${formatNum(g.total)} · Paguar: ${formatNum(g.paid)} · Borxh: ${formatNum(g.due)}`,
      headers: ['Data', 'Nr. Fature', 'Monedha', 'Pagesa', 'Totali', 'Paguar', 'Data Pagesës', 'Borxh'],
      rows: g.list.map(inv => [
        inv.date,
        inv.invoice_no,
        inv.currency,
        pmLabel(inv.payment_method),
        { v: formatNum(inv.total_with_vat), cls: 'num' },
        { v: formatNum(inv.amount_paid),    cls: 'num green' },
        inv.last_payment_date || inv.date,
        { v: formatNum(inv._due),           cls: 'num red' },
      ]),
    })
  }
  sections.push({
    title: 'PËRMBLEDHJE TOTAL',
    headers: ['Total i Faturuar', 'I Paguar', 'Borxh i Mbetur'],
    rows: [[
      { v: formatNum(totals.tot),  cls: 'num' },
      { v: formatNum(totals.paid), cls: 'num green' },
      { v: formatNum(totals.due),  cls: 'num red' },
    ]],
  })
  const titleSuffix = supplier?.name ? ` — ${supplier.name}` : ''
  exportToPdf(`Detyrime Furnitor${titleSuffix}`, sections)
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

const PAY_CURRENCIES = ['LEK', 'EUR', 'USD', 'GBP', 'CHF']

// ── Payment modal ───────────────────────────────────────────────────────────
function PaymentModal({ invoiceId, onClose, onSaved }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [amount, setAmount]   = useState('')
  const [date, setDate]       = useState(today())
  const [method, setMethod]   = useState('cash')
  const [payCurrency, setPayCurrency] = useState('LEK')
  const [rates, setRates]     = useState({ LEK: 1 })
  const [notes, setNotes]     = useState('')
  const [saving, setSaving]   = useState(false)
  const [err, setErr]         = useState('')
  const [loadErr, setLoadErr] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    setLoadErr('')
    fetch(`/api/purchase-invoices/${invoiceId}/payments`)
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status} — endpoint i pagesave nuk u gjet. Rinis serverin.`)
        return r.json()
      })
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { setLoadErr(e.message || 'Gabim'); setLoading(false) })
  }, [invoiceId])

  useEffect(() => { load() }, [load])

  // Refresh available exchange rates whenever the payment date changes
  useEffect(() => {
    if (!date) return
    fetch(`/api/exchange-rates/${date}`)
      .then(r => r.json())
      .then(d => { if (d && d.rates) setRates(d.rates) })
      .catch(() => {})
  }, [date])

  // Default the payment currency to the invoice's own currency once it loads.
  // MUST live before any early-return below so the hook order stays stable.
  useEffect(() => {
    const c = data?.invoice?.currency
    if (c) setPayCurrency(c)
  }, [data?.invoice?.currency])

  if (loading) {
    return (
      <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
        <div className="bg-white rounded-2xl shadow-2xl p-8 text-center text-slate-400">Duke ngarkuar...</div>
      </div>
    )
  }

  if (loadErr || !data) {
    return (
      <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
        <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md">
          <div className="text-center">
            <div className="text-5xl mb-3">⚠️</div>
            <h3 className="font-bold text-slate-800 text-lg mb-2">Pagesat s'mund të ngarkohen</h3>
            <p className="text-sm text-slate-600 mb-4">{loadErr || 'Gabim i panjohur'}</p>
            <button onClick={onClose} className="btn-secondary mx-auto">Mbyll</button>
          </div>
        </div>
      </div>
    )
  }

  const inv = data.invoice
  const due = Math.max(0, n(inv.total_with_vat) - n(inv.amount_paid))
  const isPaid = due <= 0.005

  const invoiceRate = n(inv.exchange_rate) || 1
  const payRate     = n(rates[payCurrency]) || (payCurrency === 'LEK' ? 1 : null)
  const toInvoiceCcy = (amtInPay) => {
    if (payCurrency === inv.currency) return n(amtInPay)
    if (!payRate) return 0
    return +(n(amtInPay) * payRate / invoiceRate).toFixed(2)
  }
  const dueInPayCcy = (() => {
    if (payCurrency === inv.currency) return due
    if (!payRate) return null
    return +(due * invoiceRate / payRate).toFixed(2)
  })()

  const sendPayment = async (payload) => {
    setErr('')
    setSaving(true)
    try {
      const res = await fetch(`/api/purchase-invoices/${invoiceId}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const r = await res.json()
      if (!res.ok) throw new Error(r.error || 'Gabim')
      setAmount(''); setNotes('')
      await load()
      onSaved?.()
    } catch (e) {
      setErr(e.message)
    }
    setSaving(false)
  }

  const submit = async (e) => {
    e.preventDefault()
    const amtPay = parseFloat(amount)
    if (!amtPay || amtPay <= 0) { setErr('Vendos shumë më të madhe se 0.'); return }
    if (payCurrency !== inv.currency && !payRate) {
      setErr(`Nuk ka kurs këmbimi për ${payCurrency} në datën ${date}.`); return
    }
    const amtInvoice = toInvoiceCcy(amtPay)
    if (amtInvoice > due + 0.005) {
      setErr(`Shuma maksimale: ${dueInPayCcy != null ? fmt(dueInPayCcy) : fmt(due)} ${payCurrency}`); return
    }
    const ccyNote = payCurrency !== inv.currency
      ? `Pagesë ${fmt(amtPay)} ${payCurrency} (= ${fmt(amtInvoice)} ${inv.currency})`
      : ''
    await sendPayment({
      amount: amtInvoice,
      date,
      payment_method: method,
      notes: notes ? (ccyNote ? `${notes} · ${ccyNote}` : notes) : ccyNote,
    })
  }

  const closeFullDebt = async () => {
    if (payCurrency !== inv.currency && !payRate) {
      setErr(`Nuk ka kurs këmbimi për ${payCurrency} në datën ${date}.`); return
    }
    const amtToCharge = payCurrency === inv.currency
      ? `${fmt(due)} ${inv.currency}`
      : `${fmt(dueInPayCcy)} ${payCurrency} (= ${fmt(due)} ${inv.currency})`
    if (!confirm(`Të mbyllet borxhi ndaj furnitorit plotësisht me ${amtToCharge} (${method === 'bank' ? 'Bankë' : 'Cash'}, datë ${date})?`)) return
    const ccyNote = payCurrency !== inv.currency
      ? `Mbyllje me ${fmt(dueInPayCcy)} ${payCurrency} (= ${fmt(due)} ${inv.currency})`
      : 'Mbyllje e plotë e borxhit'
    await sendPayment({
      amount: due,
      date,
      payment_method: method,
      notes: notes ? `${notes} · ${ccyNote}` : ccyNote,
    })
  }

  const removePayment = async (id) => {
    if (!confirm('Fshi këtë pagesë?')) return
    await fetch(`/api/purchase-payments/${id}`, { method: 'DELETE' })
    await load()
    onSaved?.()
  }

  const methodBadge = (pm) => pm === 'debt'
    ? <span className="badge bg-amber-100 text-amber-700">⚠️ Borxh</span>
    : pm === 'bank'
    ? <span className="badge bg-blue-100 text-blue-700">🏦 Bankë</span>
    : pm === 'pos'
    ? <span className="badge bg-purple-100 text-purple-700">💳 POS</span>
    : <span className="badge bg-emerald-100 text-emerald-700">💵 Cash</span>

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="modal-header">
          <div>
            <h3 className="font-bold text-slate-800 text-lg">💰 Pagesa — {inv.invoice_no}</h3>
            <p className="text-xs text-slate-500">
              {inv.supplier_name || 'pa furnitor'}{inv.supplier_nipt ? ` · ${inv.supplier_nipt}` : ''} · datë fature: {inv.date}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 text-xl">×</button>
        </div>

        <div className="p-6 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="card py-3 text-center">
              <p className="text-[10px] text-slate-500 uppercase font-semibold">Totali</p>
              <p className="text-xl font-bold text-slate-800 tabular-nums">{fmt(inv.total_with_vat)}</p>
            </div>
            <div className="card py-3 text-center bg-emerald-50 border-emerald-200">
              <p className="text-[10px] text-emerald-700 uppercase font-semibold">Paguar deri tani</p>
              <p className="text-xl font-bold text-emerald-700 tabular-nums">{fmt(inv.amount_paid)}</p>
            </div>
            <div className={`card py-3 text-center ${isPaid ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
              <p className={`text-[10px] uppercase font-semibold ${isPaid ? 'text-emerald-700' : 'text-red-600'}`}>Borxh i mbetur</p>
              <p className={`text-xl font-bold tabular-nums ${isPaid ? 'text-emerald-700' : 'text-red-600'}`}>
                {isPaid ? '✓ Mbyllur' : fmt(due)}
              </p>
            </div>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-slate-700 mb-2">Pagesat e Bëra</h4>
            <div className="space-y-2">
              {data.initial_paid > 0.005 && (
                <div className="card flex items-center justify-between bg-slate-50">
                  <div>
                    <div className="text-xs text-slate-500 font-semibold uppercase">Data Pagesës</div>
                    <div className="text-lg font-bold text-slate-800">{data.initial_date}</div>
                    <div className="text-[10px] italic text-slate-500 mt-0.5">Pagesë në regjistrim</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-slate-500 font-semibold uppercase">Vlera</div>
                    <div className="text-2xl font-extrabold text-emerald-700 tabular-nums">{fmt(data.initial_paid)}</div>
                    <div className="mt-1">{methodBadge(inv.payment_method)}</div>
                  </div>
                </div>
              )}
              {data.payments.map(p => (
                <div key={p.id} className="card flex items-center justify-between">
                  <div>
                    <div className="text-xs text-slate-500 font-semibold uppercase">Data Pagesës</div>
                    <div className="text-lg font-bold text-slate-800">{p.date}</div>
                    {p.notes && <div className="text-[11px] text-slate-600 mt-0.5">{p.notes}</div>}
                  </div>
                  <div className="text-right flex items-center gap-3">
                    <div>
                      <div className="text-xs text-slate-500 font-semibold uppercase">Vlera</div>
                      <div className="text-2xl font-extrabold text-emerald-700 tabular-nums">{fmt(p.amount)}</div>
                      <div className="mt-1">{methodBadge(p.payment_method)}</div>
                    </div>
                    <button onClick={() => removePayment(p.id)}
                      className="w-8 h-8 flex items-center justify-center rounded-lg bg-red-50 hover:bg-red-100 text-red-500 text-sm" title="Fshi pagesën">✕</button>
                  </div>
                </div>
              ))}
              {data.payments.length === 0 && data.initial_paid <= 0.005 && (
                <div className="card py-6 text-center text-slate-400 text-sm">
                  Asnjë pagesë e regjistruar akoma.
                </div>
              )}
            </div>
          </div>

          {!isPaid && (
            <button
              type="button"
              onClick={closeFullDebt}
              disabled={saving || (payCurrency !== inv.currency && !payRate)}
              className="w-full py-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white font-bold text-lg shadow-lg shadow-emerald-500/30 disabled:opacity-50 transition-all"
            >
              {saving
                ? '⏳ Duke ruajtur...'
                : payCurrency === inv.currency
                  ? `✓ MBYLL BORXHIN PLOTËSISHT — ${fmt(due)} ${inv.currency}`
                  : dueInPayCcy != null
                    ? `✓ MBYLL BORXHIN PLOTËSISHT — ${fmt(dueInPayCcy)} ${payCurrency} (= ${fmt(due)} ${inv.currency})`
                    : `✓ MBYLL BORXHIN PLOTËSISHT (mungon kurs ${payCurrency})`}
            </button>
          )}

          {!isPaid && (
            <form onSubmit={submit} className="card bg-blue-50 border-blue-200">
              <h4 className="text-sm font-semibold text-blue-800 mb-3">
                Ose regjistro pagesë të pjesshme
                {payCurrency !== inv.currency && (
                  <span className="ml-2 text-[11px] font-normal text-blue-600">
                    (në {payCurrency}; kursi i datës {date}: 1 {payCurrency} = {fmt(payRate)} LEK)
                  </span>
                )}
              </h4>
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label className="form-label">Data</label>
                  <input type="date" value={date} onChange={e => setDate(e.target.value)}
                    className="input-field" required />
                </div>
                <div>
                  <label className="form-label">Monedha e Pagesës</label>
                  <select value={payCurrency} onChange={e => setPayCurrency(e.target.value)} className="input-field">
                    {PAY_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">Shuma ({payCurrency})</label>
                  <input type="number" step="0.01" min="0.01"
                    value={amount} onChange={e => setAmount(e.target.value)}
                    className="input-field tabular-nums"
                    placeholder={dueInPayCcy != null ? fmt(dueInPayCcy) : '—'} />
                  {payCurrency !== inv.currency && amount && payRate && (
                    <p className="text-[10px] text-slate-500 italic mt-0.5">
                      = {fmt(toInvoiceCcy(amount))} {inv.currency}
                    </p>
                  )}
                </div>
                <div>
                  <label className="form-label">Mënyra</label>
                  <select value={method} onChange={e => setMethod(e.target.value)} className="input-field">
                    <option value="cash">💵 Cash</option>
                    <option value="bank">🏦 Bankë</option>
                  </select>
                </div>
                <div className="col-span-4">
                  <label className="form-label">Shënime (opsional)</label>
                  <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
                    className="input-field" placeholder="p.sh. pagesë e pjesshme" />
                </div>
              </div>
              {payCurrency !== inv.currency && !payRate && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-3">
                  ⚠️ Nuk u gjet kursi i {payCurrency} për datën {date}. Ndrysho datën ose zgjidh një monedhë tjetër.
                </p>
              )}
              {err && <p className="text-sm text-red-600 mt-3">{err}</p>}
              <div className="flex justify-end mt-3">
                <button type="submit" disabled={saving} className="btn-primary disabled:opacity-50">
                  {saving ? '⏳ Duke ruajtur...' : '💾 Regjistro Pagesën'}
                </button>
              </div>
            </form>
          )}

          {isPaid && (
            <div className="card bg-emerald-50 border-emerald-200 text-center py-6">
              <div className="text-4xl mb-2">✅</div>
              <p className="font-bold text-emerald-700 text-lg">Borxhi është mbyllur plotësisht!</p>
              <p className="text-xs text-emerald-600 mt-1">Kjo faturë nuk ka detyrime të mbetura.</p>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="btn-secondary">Mbyll</button>
        </div>
      </div>
    </div>
  )
}

// ── Supplier search box ─────────────────────────────────────────────────────
function SupplierSearchBox({ value, onPick, onClear }) {
  const [query, setQuery] = useState(value?.name || '')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const timerRef = useRef(null)
  const boxRef = useRef(null)

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
    }, 200)
  }

  return (
    <div ref={boxRef} className="relative">
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">🔍</span>
          <input
            type="text" value={query}
            placeholder="Kërko furnitor — emër, NIPT, telefon..."
            onChange={e => { setQuery(e.target.value); search(e.target.value); setOpen(true) }}
            onFocus={() => query && setOpen(true)}
            className="input-field pl-9"
          />
        </div>
        {value && (
          <button onClick={onClear} className="btn-secondary">Pastro</button>
        )}
      </div>
      {open && (results.length > 0 || loading) && (
        <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-72 overflow-y-auto">
          {loading && <div className="p-2 text-xs text-slate-400">Duke kërkuar...</div>}
          {results.map(s => (
            <button
              key={s.id}
              onClick={() => { onPick({ name: s.name || s.nipt, nipt: s.nipt }); setOpen(false) }}
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

// ── Invoices panel ──────────────────────────────────────────────────────────
function SupplierInvoicesPanel({ supplier, onNavigate, refreshKey, onOpenPayment, dateRange }) {
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (supplier?.nipt) params.set('nipt', supplier.nipt)
    else if (supplier?.name) params.set('name', supplier.name)
    if (dateRange?.from) params.set('from', dateRange.from)
    if (dateRange?.to)   params.set('to', dateRange.to)
    const qs = params.toString()
    fetch(`/api/supplier-debts${qs ? '?' + qs : ''}`)
      .then(r => r.json())
      .then(d => { setInvoices(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => { setInvoices([]); setLoading(false) })
  }, [supplier?.nipt, supplier?.name, refreshKey, dateRange?.from, dateRange?.to])

  const totals = invoices.reduce((acc, inv) => {
    const due  = n(inv.amount_due != null ? inv.amount_due : (inv.total_with_vat - inv.amount_paid))
    const rate = n(inv.exchange_rate) || 1
    acc.tot  += n(inv.total_with_vat)
    acc.paid += n(inv.amount_paid)
    acc.due  += due
    acc.totLek  += n(inv.total_with_vat) * rate
    acc.paidLek += n(inv.amount_paid) * rate
    acc.dueLek  += due * rate
    return acc
  }, { tot: 0, paid: 0, due: 0, totLek: 0, paidLek: 0, dueLek: 0 })

  // Totalet e grupuara sipas monedhës origjinale të faturës — pa konvertim në LEK.
  const totalsByCur = invoices.reduce((acc, inv) => {
    const cur = inv.currency || 'LEK'
    if (!acc[cur]) acc[cur] = { tot: 0, paid: 0, due: 0 }
    const due = n(inv.amount_due != null ? inv.amount_due : (inv.total_with_vat - inv.amount_paid))
    acc[cur].tot  += n(inv.total_with_vat)
    acc[cur].paid += n(inv.amount_paid)
    acc[cur].due  += due
    return acc
  }, {})
  const currenciesInList = Object.keys(totalsByCur).sort()

  const groups = {}
  for (const inv of invoices) {
    const key = (inv.supplier_nipt && inv.supplier_nipt.trim()) || inv.supplier_name || '(pa furnitor)'
    if (!groups[key]) {
      groups[key] = {
        hasForeign: false,
        totalLek: 0, paidLek: 0, dueLek: 0,
        name: inv.supplier_name || '',
        nipt: inv.supplier_nipt || '',
        list: [],
        total: 0, paid: 0, due: 0,
      }
    }
    const g = groups[key]
    const due  = n(inv.amount_due != null ? inv.amount_due : (inv.total_with_vat - inv.amount_paid))
    const rate = n(inv.exchange_rate) || 1
    g.list.push({ ...inv, _due: due })
    g.total += n(inv.total_with_vat)
    g.paid  += n(inv.amount_paid)
    g.due   += due
    g.totalLek += n(inv.total_with_vat) * rate
    g.paidLek  += n(inv.amount_paid) * rate
    g.dueLek   += due * rate
    if ((inv.currency || 'LEK') !== 'LEK') g.hasForeign = true
  }
  const groupArr = Object.values(groups).sort((a, b) =>
    (a.name || '~~').localeCompare(b.name || '~~', 'sq', { sensitivity: 'base' })
  )

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="min-w-0">
          <p className="text-xs text-slate-500 uppercase font-semibold tracking-wide">
            {supplier ? 'Furnitori i Zgjedhur' : 'Të Gjithë Furnitorët'}
          </p>
          <h2 className="text-xl font-bold text-slate-800 truncate">
            {supplier
              ? (supplier.name || <span className="italic text-slate-400">— pa emër —</span>)
              : `${groupArr.length} furnitorë me borxh`}
          </h2>
          {supplier?.nipt && <p className="text-sm font-mono text-slate-500">NIPT: {supplier.nipt}</p>}
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-800">
            Faturat e Papaguara ({invoices.length}) — sipas alfabetit
          </h3>
          <div className="flex gap-2">
            <button
              onClick={() => exportDebtsExcel(invoices, groupArr, totals, supplier)}
              disabled={invoices.length === 0}
              className="btn-secondary text-xs disabled:opacity-40"
              title="Eksporto në Excel"
            >📊 Excel</button>
            <button
              onClick={() => exportDebtsPdf(invoices, groupArr, totals, supplier)}
              disabled={invoices.length === 0}
              className="btn-secondary text-xs disabled:opacity-40"
              title="Eksporto në PDF"
            >📄 PDF</button>
          </div>
        </div>
        {loading ? (
          <div className="p-8 text-center text-slate-400">Duke ngarkuar...</div>
        ) : invoices.length === 0 ? (
          <div className="p-10 text-center">
            <div className="text-5xl mb-3">✓</div>
            <p className="text-slate-500">
              {supplier ? 'Asnjë borxh i hapur për këtë furnitor.' : 'Asnjë borxh i hapur ndaj furnitorëve.'}
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Data Fature</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Nr. Fature</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase">Monedha</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase">Pagesa</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase">Totali</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase">Paguar (Data)</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase">Borxh</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase">Vepro</th>
              </tr>
            </thead>
            <tbody>
              {groupArr.map((g, gi) => (
                <Fragment key={gi}>
                  <tr className="bg-blue-50 border-t-2 border-blue-200">
                    <td colSpan={8} className="px-4 py-2 font-bold text-blue-900">
                      🏭 {g.name || <span className="italic text-slate-500">— pa furnitor —</span>}
                      {g.nipt && <span className="ml-2 text-xs font-mono text-slate-600">({g.nipt})</span>}
                      <span className="ml-2 text-xs font-normal text-slate-500">· {g.list.length} fatura</span>
                    </td>
                  </tr>
                  {g.list.map(inv => {
                    const pm  = inv.payment_method
                    const pmBadge = pm === 'debt'
                      ? <span className="badge bg-amber-100 text-amber-700">⚠️ Borxh</span>
                      : pm === 'bank'
                      ? <span className="badge bg-blue-100 text-blue-700">🏦 Bankë</span>
                      : pm === 'pos'
                      ? <span className="badge bg-purple-100 text-purple-700">💳 POS</span>
                      : <span className="badge bg-emerald-100 text-emerald-700">💵 Cash</span>
                    const rate      = n(inv.exchange_rate) || 1
                    const isForeign = (inv.currency || 'LEK') !== 'LEK'
                    return (
                      <tr key={inv.id} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-4 py-2 text-slate-700">{inv.date}</td>
                        <td className="px-4 py-2 font-mono text-xs">
                          <button
                            onClick={() => onNavigate?.('fatura-blerje', { date: inv.date, invoiceId: inv.id })}
                            className="text-blue-600 hover:text-blue-800 hover:underline font-semibold"
                            title="Hap këtë faturë"
                          >{inv.invoice_no}</button>
                        </td>
                        <td className="px-4 py-2 text-center"><span className="badge bg-blue-100 text-blue-700">{inv.currency}</span></td>
                        <td className="px-4 py-2 text-center">{pmBadge}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-slate-800">
                          {fmt(inv.total_with_vat)}
                          {isForeign && (
                            <div className="text-[10px] font-normal text-slate-500 italic">
                              = {fmt(n(inv.total_with_vat) * rate)} LEK
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <div className="tabular-nums text-emerald-700 font-semibold">{fmt(inv.amount_paid)}</div>
                          {isForeign && n(inv.amount_paid) > 0.005 && (
                            <div className="text-[10px] font-normal text-emerald-600/70 italic">
                              = {fmt(n(inv.amount_paid) * rate)} LEK
                            </div>
                          )}
                          {n(inv.amount_paid) > 0 && (
                            <div className="text-[10px] text-slate-500 mt-0.5">
                              {inv.last_payment_date || inv.date}
                              {inv.payment_count > 0 && <span className="ml-1 text-emerald-600">· {inv.payment_count}p.</span>}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums font-bold text-red-600">
                          {fmt(inv._due)}
                          {isForeign && n(inv._due) > 0.005 && (
                            <div className="text-[10px] font-normal text-red-500/80 italic">
                              = {fmt(n(inv._due) * rate)} LEK
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2 text-center">
                          <button
                            onClick={() => onOpenPayment?.(inv.id)}
                            className="px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-medium"
                            title="Regjistro pagesë / shih historikun"
                          >💰 Pagesë</button>
                        </td>
                      </tr>
                    )
                  })}
                </Fragment>
              ))}
            </tbody>
            <tfoot className="bg-slate-50 border-t-2 border-slate-200">
              {currenciesInList.map((cur, idx) => {
                const t = totalsByCur[cur]
                return (
                  <tr key={cur} className={`bg-blue-50 ${idx > 0 ? 'border-t border-blue-200' : ''}`}>
                    <td colSpan={4} className="px-4 py-3 text-xs font-bold text-blue-700 uppercase tracking-wide">
                      💱 TOTAL ({cur})
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-extrabold text-slate-800">{fmt(t.tot)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-extrabold text-emerald-700">{fmt(t.paid)}</td>
                    <td className={`px-4 py-3 text-right tabular-nums font-extrabold ${t.due > 0.005 ? 'text-red-600' : 'text-emerald-600'}`}>
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


export default function DetyrimetFurnitor({ onNavigate }) {
  const [selected, setSelected] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [paymentInvoiceId, setPaymentInvoiceId] = useState(null)
  const [dateRange, setDateRange] = useState({ from: '', to: '' })

  const onPaymentSaved = () => setRefreshKey(k => k + 1)

  return (
    <div className="space-y-4">
      <DateRangeFilter from={dateRange.from} to={dateRange.to} onChange={setDateRange} emptyForAll hint="Boshi = i gjithë historiku" />
      <SupplierSearchBox
        value={selected}
        onPick={setSelected}
        onClear={() => setSelected(null)}
      />
      <SupplierInvoicesPanel
        supplier={selected}
        onNavigate={onNavigate}
        refreshKey={refreshKey}
        onOpenPayment={setPaymentInvoiceId}
        dateRange={dateRange}
      />
      {paymentInvoiceId && (
        <PaymentModal
          invoiceId={paymentInvoiceId}
          onClose={() => setPaymentInvoiceId(null)}
          onSaved={onPaymentSaved}
        />
      )}
    </div>
  )
}
