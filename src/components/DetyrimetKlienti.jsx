import { useState, useEffect, useRef, useCallback, Fragment } from 'react'
import { exportToExcel, exportToPdf, formatNum } from '../utils/export.js'
import DateRangeFilter from './DateRangeFilter.jsx'
import MoneyInput from './MoneyInput.jsx'

function n(v) { return parseFloat(v) || 0 }
function fmt(v) {
  return n(v).toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function clientFullName(c) {
  return [c?.first_name, c?.last_name].filter(Boolean).join(' ').trim()
}

function pmLabel(pm) {
  return pm === 'debt' ? 'Borxh' : pm === 'bank' ? 'Bankë' : pm === 'pos' ? 'POS' : 'Cash'
}

function exportDebtsExcel(invoices, groupArr, totals, client) {
  const rows = []
  for (const g of groupArr) {
    for (const inv of g.list) {
      rows.push({
        'Klienti': g.name || '(pa klient)',
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
    'Klienti': 'TOTALI',
    'NIPT': '', 'Data Fature': '', 'Nr. Fature': '', 'Monedha': '',
    'Lloji Pagesës': '',
    'Totali': totals.tot,
    'Shuma e Paguar': totals.paid,
    'Data Pagesës së Fundit': '',
    'Shuma Pa Paguar': totals.due,
  })
  const suffix = client?.name ? `_${client.name.replace(/\s+/g, '_')}` : ''
  exportToExcel(`Detyrime_Klienti${suffix}_${new Date().toISOString().slice(0, 10)}`, rows, {
    sheetName: 'Detyrime',
    columnWidths: [22, 14, 12, 14, 10, 12, 14, 14, 18, 14],
  })
}

function exportDebtsPdf(invoices, groupArr, totals, client) {
  const sections = []
  for (const g of groupArr) {
    sections.push({
      title: `👤 ${g.name || '(pa klient)'}${g.nipt ? ` — NIPT: ${g.nipt}` : ''}`,
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
  // Summary section
  sections.push({
    title: 'PËRMBLEDHJE TOTAL',
    headers: ['Total i Faturuar', 'I Paguar', 'Borxh i Mbetur'],
    rows: [[
      { v: formatNum(totals.tot),  cls: 'num' },
      { v: formatNum(totals.paid), cls: 'num green' },
      { v: formatNum(totals.due),  cls: 'num red' },
    ]],
  })
  const titleSuffix = client?.name ? ` — ${client.name}` : ''
  exportToPdf(`Detyrime Klienti${titleSuffix}`, sections)
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

const PAY_CURRENCIES = ['LEK', 'EUR', 'USD', 'GBP', 'CHF']

// ── Payment modal: history + add new payment ────────────────────────────────
function PaymentModal({ invoiceId, onClose, onSaved }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [amount, setAmount]   = useState('')
  const [date, setDate]       = useState(today())
  const [method, setMethod]   = useState('cash')
  const [payCurrency, setPayCurrency] = useState('EUR')
  const [rates, setRates]     = useState({ LEK: 1 })
  const [notes, setNotes]     = useState('')
  const [saving, setSaving]   = useState(false)
  const [err, setErr]         = useState('')

  const [loadErr, setLoadErr] = useState('')

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

  const load = useCallback(() => {
    setLoading(true)
    setLoadErr('')
    fetch(`/api/invoices/${invoiceId}/payments`)
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status} — endpoint i pagesave nuk u gjet. Rinis serverin (npm run dev).`)
        return r.json()
      })
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { setLoadErr(e.message || 'Gabim'); setLoading(false) })
  }, [invoiceId])

  useEffect(() => { load() }, [load])

  if (loading) {
    return (
      <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-8 text-center text-slate-400 dark:text-slate-500">Duke ngarkuar...</div>
      </div>
    )
  }

  if (loadErr || !data) {
    return (
      <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-8 max-w-md">
          <div className="text-center">
            <div className="text-5xl mb-3">⚠️</div>
            <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg mb-2">Pagesat s'mund të ngarkohen</h3>
            <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">{loadErr || 'Gabim i panjohur'}</p>
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
  // Convert a given amount-in-payCurrency to invoice currency (what gets stored)
  const toInvoiceCcy = (amtInPay) => {
    if (payCurrency === inv.currency) return n(amtInPay)
    if (!payRate) return 0
    return +(n(amtInPay) * payRate / invoiceRate).toFixed(2)
  }
  // The remaining debt expressed in the user-selected pay currency
  const dueInPayCcy = (() => {
    if (payCurrency === inv.currency) return due
    if (!payRate) return null
    return +(due * invoiceRate / payRate).toFixed(2)
  })()

  const sendPayment = async (payload) => {
    setErr('')
    setSaving(true)
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/payments`, {
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
    // To perfectly close the debt we always send the exact due in invoice currency.
    const amtToCharge = payCurrency === inv.currency
      ? `${fmt(due)} ${inv.currency}`
      : `${fmt(dueInPayCcy)} ${payCurrency} (= ${fmt(due)} ${inv.currency})`
    const methodLabel = method === 'pos' ? 'POS' : 'Cash'
    if (!confirm(`Të mbyllet borxhi plotësisht me ${amtToCharge} (${methodLabel}, datë ${date})?`)) return
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
    await fetch(`/api/invoice-payments/${id}`, { method: 'DELETE' })
    await load()
    onSaved?.()
  }

  const methodBadge = (pm) => pm === 'debt'
    ? <span className="badge bg-amber-100 text-amber-700 dark:text-amber-300">⚠️ Borxh</span>
    : pm === 'bank'
    ? <span className="badge bg-blue-100 text-blue-700 dark:text-blue-300">🏦 Bankë</span>
    : pm === 'pos'
    ? <span className="badge bg-purple-100 text-purple-700 dark:text-purple-300">💳 POS</span>
    : <span className="badge bg-emerald-100 text-emerald-700 dark:text-emerald-300">💵 Cash</span>

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="modal-header">
          <div>
            <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">💰 Pagesa — {inv.invoice_no}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {inv.customer_name || 'pa klient'}{inv.customer_nipt ? ` · ${inv.customer_nipt}` : ''} · datë fature: {inv.date}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 dark:text-slate-500 text-xl">×</button>
        </div>

        <div className="p-6 space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-3 gap-3">
            <div className="card py-3 text-center">
              <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-semibold">Totali</p>
              <p className="text-xl font-bold text-slate-800 dark:text-slate-100 tabular-nums">{fmt(inv.total_with_vat)}</p>
            </div>
            <div className="card py-3 text-center bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200">
              <p className="text-[10px] text-emerald-700 dark:text-emerald-300 uppercase font-semibold">Paguar deri tani</p>
              <p className="text-xl font-bold text-emerald-700 dark:text-emerald-300 tabular-nums">{fmt(inv.amount_paid)}</p>
            </div>
            <div className={`card py-3 text-center ${isPaid ? 'bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200' : 'bg-red-50 dark:bg-red-900/30 border-red-200'}`}>
              <p className={`text-[10px] uppercase font-semibold ${isPaid ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600'}`}>Borxh i mbetur</p>
              <p className={`text-xl font-bold tabular-nums ${isPaid ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600'}`}>
                {isPaid ? '✓ Mbyllur' : fmt(due)}
              </p>
            </div>
          </div>

          {/* Payment history — date + amount, prominent */}
          <div>
            <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">Pagesat e Bëra</h4>
            <div className="space-y-2">
              {data.initial_paid > 0.005 && (
                <div className="card flex items-center justify-between bg-slate-50 dark:bg-slate-900">
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 font-semibold uppercase">Data Pagesës</div>
                    <div className="text-lg font-bold text-slate-800 dark:text-slate-100">{data.initial_date}</div>
                    <div className="text-[10px] italic text-slate-500 dark:text-slate-400 mt-0.5">Pagesë në regjistrim</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-slate-500 dark:text-slate-400 font-semibold uppercase">Vlera</div>
                    <div className="text-2xl font-extrabold text-emerald-700 dark:text-emerald-300 tabular-nums">{fmt(data.initial_paid)}</div>
                    <div className="mt-1">{methodBadge(inv.payment_method)}</div>
                  </div>
                </div>
              )}
              {data.payments.map(p => (
                <div key={p.id} className="card flex items-center justify-between">
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 font-semibold uppercase">Data Pagesës</div>
                    <div className="text-lg font-bold text-slate-800 dark:text-slate-100">{p.date}</div>
                    {p.notes && <div className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5">{p.notes}</div>}
                  </div>
                  <div className="text-right flex items-center gap-3">
                    <div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 font-semibold uppercase">Vlera</div>
                      <div className="text-2xl font-extrabold text-emerald-700 dark:text-emerald-300 tabular-nums">{fmt(p.amount)}</div>
                      <div className="mt-1">{methodBadge(p.payment_method)}</div>
                    </div>
                    <button onClick={() => removePayment(p.id)}
                      className="w-8 h-8 flex items-center justify-center rounded-lg bg-red-50 dark:bg-red-900/30 hover:bg-red-100 text-red-500 text-sm" title="Fshi pagesën">✕</button>
                  </div>
                </div>
              ))}
              {data.payments.length === 0 && data.initial_paid <= 0.005 && (
                <div className="card py-6 text-center text-slate-400 dark:text-slate-500 text-sm">
                  Asnjë pagesë e regjistruar akoma.
                </div>
              )}
            </div>
          </div>

          {/* Close-debt-in-one-click action */}
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

          {/* Partial payment form */}
          {!isPaid && (
            <form onSubmit={submit} className="card bg-blue-50 dark:bg-blue-900/30 border-blue-200">
              <h4 className="text-sm font-semibold text-blue-800 dark:text-blue-200 mb-3">
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
                  <MoneyInput
                    value={amount} onChange={v => setAmount(String(v))}
                    className="input-field tabular-nums"
                    placeholder={dueInPayCcy != null ? fmt(dueInPayCcy) : '—'} />
                  {payCurrency !== inv.currency && amount && payRate && (
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 italic mt-0.5">
                      = {fmt(toInvoiceCcy(amount))} {inv.currency}
                    </p>
                  )}
                </div>
                <div>
                  <label className="form-label">Mënyra</label>
                  <select value={method} onChange={e => setMethod(e.target.value)} className="input-field">
                    <option value="cash">💵 Cash</option>
                    <option value="pos">💳 POS</option>
                  </select>
                </div>
                <div className="col-span-4">
                  <label className="form-label">Shënime (opsional)</label>
                  <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
                    className="input-field" placeholder="p.sh. pagesë e pjesshme" />
                </div>
              </div>
              {payCurrency !== inv.currency && !payRate && (
                <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 rounded px-2 py-1 mt-3">
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
            <div className="card bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200 text-center py-6">
              <div className="text-4xl mb-2">✅</div>
              <p className="font-bold text-emerald-700 dark:text-emerald-300 text-lg">Borxhi është mbyllur plotësisht!</p>
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

// ── Sidebar: all clients alphabetically with their debts ────────────────────
function DebtSummaryList({ selected, onPick, refreshKey, dateRange }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [onlyDebt, setOnlyDebt] = useState(false)

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (onlyDebt) params.set('onlyDebt', '1')
    if (dateRange?.from) params.set('from', dateRange.from)
    if (dateRange?.to)   params.set('to', dateRange.to)
    const qs = params.toString()
    fetch(`/api/client-debts/summary${qs ? '?' + qs : ''}`)
      .then(r => r.json())
      .then(d => { setRows(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => { setRows([]); setLoading(false) })
  }, [refreshKey, onlyDebt, dateRange?.from, dateRange?.to])

  if (loading) {
    return <div className="card p-6 text-center text-slate-400 dark:text-slate-500 text-sm">Duke ngarkuar...</div>
  }

  const withDebt = rows.filter(r => n(r.due) > 0.005).length
  const totalOwed = rows.reduce((s, r) => s + n(r.due), 0)

  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Klientët (A → Z)</h3>
          <label className="text-[11px] text-slate-600 dark:text-slate-300 flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={onlyDebt}
              onChange={e => setOnlyDebt(e.target.checked)}
              className="rounded"
            />
            Vetëm me borxh
          </label>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-slate-500 dark:text-slate-400">
          <span>{rows.length} klientë</span>
          <span>·</span>
          <span className="text-red-600 font-semibold">{withDebt} me borxh</span>
          <span>·</span>
          <span className="text-red-600 font-bold tabular-nums">{fmt(totalOwed)}</span>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="p-8 text-center text-slate-400 dark:text-slate-500 text-sm">
          <div className="text-3xl mb-2">📭</div>
          Asnjë klient i regjistruar në fatura
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[65vh] overflow-y-auto">
          {rows.map((r, i) => {
            const isSel = selected && (
              (selected.nipt && r.customer_nipt && selected.nipt === r.customer_nipt) ||
              (!selected.nipt && selected.name === r.customer_name)
            )
            const due = n(r.due)
            const hasDebt = due > 0.005
            return (
              <li key={i}>
                <button
                  onClick={() => onPick({ name: r.customer_name, nipt: r.customer_nipt })}
                  className={`w-full text-left px-4 py-3 hover:bg-blue-50 transition-colors ${isSel ? 'bg-blue-50 dark:bg-blue-900/30 border-l-4 border-blue-500' : ''}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
                        {r.customer_name || <span className="italic text-slate-400 dark:text-slate-500">— pa emër —</span>}
                      </p>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono truncate">{r.customer_nipt || '—'}</p>
                    </div>
                    <div className="text-right">
                      {hasDebt ? (
                        <p className="text-sm font-bold text-red-600 tabular-nums">{fmt(due)}</p>
                      ) : (
                        <p className="text-sm font-bold text-emerald-600">✓</p>
                      )}
                      <p className="text-[10px] text-slate-500 dark:text-slate-400">{r.currency} · {r.invoice_count}f.</p>
                    </div>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ── Client search box (autocomplete on clients table) ────────────────────────
function ClientSearchBox({ value, onPick, onClear }) {
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
        const data = await fetch(`/api/clients/search?q=${encodeURIComponent(q)}`).then(r => r.json())
        setResults(Array.isArray(data) ? data : [])
      } catch { setResults([]) }
      setLoading(false)
    }, 200)
  }

  return (
    <div ref={boxRef} className="relative">
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 text-sm pointer-events-none">🔍</span>
          <input
            type="text" value={query}
            placeholder="Kërko klient — emër, NIPT, telefon..."
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
        <div className="absolute z-20 left-0 right-0 mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg max-h-72 overflow-y-auto">
          {loading && <div className="p-2 text-xs text-slate-400 dark:text-slate-500">Duke kërkuar...</div>}
          {results.map(c => (
            <button
              key={c.id}
              onClick={() => { onPick({ name: clientFullName(c) || c.nipt, nipt: c.nipt }); setOpen(false) }}
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
        </div>
      )}
    </div>
  )
}

// ── All-clients summary table (default view) ────────────────────────────────
function AllClientsSummary({ onPick, dateRange, refreshKey }) {
  const [rawRows, setRawRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [onlyDebt, setOnlyDebt] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (onlyDebt) params.set('onlyDebt', '1')
    if (dateRange?.from) params.set('from', dateRange.from)
    if (dateRange?.to)   params.set('to', dateRange.to)
    const qs = params.toString()
    fetch(`/api/client-debts/summary${qs ? '?' + qs : ''}`)
      .then(r => r.json())
      .then(d => { setRawRows(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => { setRawRows([]); setLoading(false) })
  }, [onlyDebt, dateRange?.from, dateRange?.to, refreshKey])

  const q = search.toLowerCase().trim()
  const rows = !q ? rawRows : rawRows.filter(r =>
    (r.customer_name || '').toLowerCase().includes(q) ||
    (r.customer_nipt || '').toLowerCase().includes(q)
  )

  const totals = rows.reduce((acc, r) => {
    acc.invCount += n(r.invoice_count)
    acc.total    += n(r.total)
    acc.paid     += n(r.paid)
    acc.due      += n(r.due)
    return acc
  }, { invCount: 0, total: 0, paid: 0, due: 0 })

  if (loading) {
    return <div className="card text-center py-12 text-slate-400 dark:text-slate-500">Duke ngarkuar...</div>
  }

  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 flex items-center justify-between flex-wrap gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Të Gjithë Klientët — Përmbledhje Detyrimesh</h3>
          <p className="text-[10px] text-slate-500 dark:text-slate-400">
            {rows.length} klientë{search && rawRows.length !== rows.length ? ` (nga ${rawRows.length})` : ''} · sipas alfabetit
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 text-sm pointer-events-none">🔍</span>
            <input
              type="text" value={search} onChange={e => setSearch(e.target.value)}
              className="input-field pl-7 w-56 py-1.5 text-sm"
              placeholder="Kërko klient / NIPT..."
            />
          </div>
          <label className="text-xs text-slate-600 dark:text-slate-300 flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={onlyDebt} onChange={e => setOnlyDebt(e.target.checked)} className="rounded" />
            Vetëm me borxh
          </label>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="p-10 text-center">
          <div className="text-5xl mb-3">✓</div>
          <p className="text-slate-500 dark:text-slate-400">Asnjë klient me detyrime për këtë periudhë.</p>
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Klienti</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">NIPT</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Monedha</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Nr. Faturave</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Totali</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Paguar</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Borxh</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const due = n(r.due)
              return (
                <tr key={i} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-100">
                    {r.customer_name || <span className="italic text-slate-400 dark:text-slate-500">— pa emër —</span>}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500 dark:text-slate-400">{r.customer_nipt || '—'}</td>
                  <td className="px-4 py-3 text-center"><span className="badge bg-blue-100 text-blue-700 dark:text-blue-300">{r.currency}</span></td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700 dark:text-slate-200">{r.invoice_count}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold text-slate-800 dark:text-slate-100">{fmt(r.total)}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold text-emerald-700 dark:text-emerald-300">{fmt(r.paid)}</td>
                  <td className={`px-4 py-3 text-right tabular-nums font-bold ${due > 0.005 ? 'text-red-600' : 'text-emerald-600'}`}>
                    {due > 0.005 ? fmt(due) : '✓'}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="bg-slate-50 dark:bg-slate-900 border-t-2 border-slate-200 dark:border-slate-700">
            <tr>
              <td colSpan={3} className="px-4 py-3 text-xs font-bold text-slate-700 dark:text-slate-200 uppercase">GJITHSEJ</td>
              <td className="px-4 py-3 text-right tabular-nums font-bold text-slate-800 dark:text-slate-100">{totals.invCount}</td>
              <td className="px-4 py-3 text-right tabular-nums font-bold text-slate-800 dark:text-slate-100">{fmt(totals.total)}</td>
              <td className="px-4 py-3 text-right tabular-nums font-bold text-emerald-700 dark:text-emerald-300">{fmt(totals.paid)}</td>
              <td className={`px-4 py-3 text-right tabular-nums font-extrabold ${totals.due > 0.005 ? 'text-red-600' : 'text-emerald-600'}`}>
                {fmt(totals.due)}
              </td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  )
}

// ── Invoices panel: all unpaid (when no client selected) OR for one client ──
function ClientInvoicesPanel({ client, onNavigate, refreshKey, onOpenPayment, dateRange }) {
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  // date-asc: më e vjetra e para · date-desc: më e reja e para · name: alfabet
  const [sortBy, setSortBy]     = useState('date-asc')

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (client?.nipt) params.set('nipt', client.nipt)
    else if (client?.name) params.set('q', client.name)
    if (dateRange?.from) params.set('from', dateRange.from)
    if (dateRange?.to)   params.set('to', dateRange.to)
    const qs = params.toString()
    fetch(`/api/client-debts${qs ? '?' + qs : ''}`)
      .then(r => r.json())
      .then(d => { setInvoices(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => { setInvoices([]); setLoading(false) })
  }, [client?.nipt, client?.name, refreshKey, dateRange?.from, dateRange?.to])

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

  // Totalet e grupuara sipas monedhës origjinale — pa konvertim në LEK.
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

  // Group invoices by client (key = NIPT or name) — also track LEK aggregates
  const groups = {}
  for (const inv of invoices) {
    const key = (inv.customer_nipt && inv.customer_nipt.trim()) || inv.customer_name || '(pa klient)'
    if (!groups[key]) {
      groups[key] = {
        hasForeign: false,
        totalLek: 0, paidLek: 0, dueLek: 0,
        name: inv.customer_name || '',
        nipt: inv.customer_nipt || '',
        list: [],
        total: 0, paid: 0, due: 0,
        oldestDate: inv.date,
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
    if (inv.date && (!g.oldestDate || inv.date < g.oldestDate)) g.oldestDate = inv.date
  }
  // Renditje sipas zgjedhjes së përdoruesit.
  const invoiceCmp = sortBy === 'date-desc'
    ? (a, b) => (b.date || '').localeCompare(a.date || '')
    : (a, b) => (a.date || '').localeCompare(b.date || '')
  for (const g of Object.values(groups)) {
    g.list.sort(invoiceCmp)
  }
  let groupArr
  if (sortBy === 'name') {
    groupArr = Object.values(groups).sort((a, b) =>
      (a.name || '~~').localeCompare(b.name || '~~', 'sq', { sensitivity: 'base' })
    )
  } else if (sortBy === 'date-desc') {
    // Grupi që ka faturën më të re del i pari.
    const newestOf = (g) => g.list.reduce((mx, inv) => inv.date > mx ? inv.date : mx, '')
    groupArr = Object.values(groups).sort((a, b) => newestOf(b).localeCompare(newestOf(a)))
  } else {
    // date-asc: grupi që ka faturën më të vjetër del i pari.
    groupArr = Object.values(groups).sort((a, b) =>
      (a.oldestDate || '9999-12-31').localeCompare(b.oldestDate || '9999-12-31')
    )
  }

  return (
    <div className="space-y-4">
      {/* Summary header */}
      <div className="card">
        <div className="min-w-0">
          <p className="text-xs text-slate-500 dark:text-slate-400 uppercase font-semibold tracking-wide">
            {client ? 'Klienti i Zgjedhur' : 'Të Gjithë Klientët'}
          </p>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 truncate">
            {client
              ? (client.name || <span className="italic text-slate-400 dark:text-slate-500">— pa emër —</span>)
              : `${groupArr.length} klientë me borxh`}
          </h2>
          {client?.nipt && <p className="text-sm font-mono text-slate-500 dark:text-slate-400">NIPT: {client.nipt}</p>}
        </div>
      </div>

      {/* Invoices grouped by client */}
      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 flex items-center justify-between flex-wrap gap-3">
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
            Faturat e Papaguara ({invoices.length})
          </h3>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-600 dark:text-slate-300 font-medium">Rendit:</label>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value)}
              className="input-field text-xs py-1.5 pr-7"
            >
              <option value="date-asc">📅 Data — më e vjetra e para</option>
              <option value="date-desc">📅 Data — më e reja e para</option>
              <option value="name">🔤 Emri i klientit (A → Z)</option>
            </select>
            <button
              onClick={() => exportDebtsExcel(invoices, groupArr, totals, client)}
              disabled={invoices.length === 0}
              className="btn-secondary text-xs disabled:opacity-40"
              title="Eksporto në Excel"
            >📊 Excel</button>
            <button
              onClick={() => exportDebtsPdf(invoices, groupArr, totals, client)}
              disabled={invoices.length === 0}
              className="btn-secondary text-xs disabled:opacity-40"
              title="Eksporto në PDF"
            >📄 PDF</button>
          </div>
        </div>
        {loading ? (
          <div className="p-8 text-center text-slate-400 dark:text-slate-500">Duke ngarkuar...</div>
        ) : invoices.length === 0 ? (
          <div className="p-10 text-center">
            <div className="text-5xl mb-3">✓</div>
            <p className="text-slate-500 dark:text-slate-400">
              {client ? 'Asnjë borxh i hapur për këtë klient.' : 'Asnjë borxh i hapur në sistem.'}
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Data Fature</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Nr. Fature</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Monedha</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Pagesa</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Totali</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Paguar (Data)</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Borxh</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Vepro</th>
              </tr>
            </thead>
            <tbody>
              {groupArr.map((g, gi) => (
                <Fragment key={gi}>
                  <tr className="bg-blue-50 dark:bg-blue-900/30 border-t-2 border-blue-200">
                    <td colSpan={8} className="px-4 py-2 font-bold text-blue-900">
                      👤 {g.name || <span className="italic text-slate-500 dark:text-slate-400">— pa klient —</span>}
                      {g.nipt && <span className="ml-2 text-xs font-mono text-slate-600 dark:text-slate-300">({g.nipt})</span>}
                      <span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">· {g.list.length} fatura</span>
                    </td>
                  </tr>
                  {g.list.map(inv => {
                    const pm  = inv.payment_method
                    const pmBadge = pm === 'debt'
                      ? <span className="badge bg-amber-100 text-amber-700 dark:text-amber-300">⚠️ Borxh</span>
                      : pm === 'bank'
                      ? <span className="badge bg-blue-100 text-blue-700 dark:text-blue-300">🏦 Bankë</span>
                      : pm === 'pos'
                      ? <span className="badge bg-purple-100 text-purple-700 dark:text-purple-300">💳 POS</span>
                      : <span className="badge bg-emerald-100 text-emerald-700 dark:text-emerald-300">💵 Cash</span>
                    const isCredit  = !!inv.is_credit_note
                    const rate      = n(inv.exchange_rate) || 1
                    const isForeign = (inv.currency || 'LEK') !== 'LEK'
                    return (
                      <tr key={inv.id} className={`border-b border-slate-100 dark:border-slate-800 ${isCredit ? 'bg-red-50/40 hover:bg-red-50' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}>
                        <td className="px-4 py-2 text-slate-700 dark:text-slate-200">{inv.date}</td>
                        <td className="px-4 py-2 font-mono text-xs">
                          <button
                            onClick={() => onNavigate?.('fatura-shitje', { date: inv.date, invoiceId: inv.id })}
                            className="text-blue-600 hover:text-blue-800 hover:underline font-semibold"
                            title="Hap faturën te FATURA SHITJE"
                          >{inv.invoice_no}</button>
                          {isCredit && <span className="ml-1.5 badge bg-red-100 text-red-700 dark:text-red-300 text-[9px]">KREDITORE</span>}
                        </td>
                        <td className="px-4 py-2 text-center"><span className="badge bg-blue-100 text-blue-700 dark:text-blue-300">{inv.currency}</span></td>
                        <td className="px-4 py-2 text-center">{pmBadge}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-slate-800 dark:text-slate-100">
                          {fmt(inv.total_with_vat)}
                          {isForeign && (
                            <div className="text-[10px] font-normal text-slate-500 dark:text-slate-400 italic">
                              = {fmt(n(inv.total_with_vat) * rate)} LEK
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <div className="tabular-nums text-emerald-700 dark:text-emerald-300 font-semibold">{fmt(inv.amount_paid)}</div>
                          {isForeign && n(inv.amount_paid) > 0.005 && (
                            <div className="text-[10px] font-normal text-emerald-600/70 italic">
                              = {fmt(n(inv.amount_paid) * rate)} LEK
                            </div>
                          )}
                          {n(inv.amount_paid) > 0 && (
                            <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                              {inv.last_payment_date || inv.date}
                              {inv.payment_count > 0 && <span className="ml-1 text-emerald-600">· {inv.payment_count}p.</span>}
                            </div>
                          )}
                        </td>
                        <td className={`px-4 py-2 text-right tabular-nums font-bold ${inv._due > 0.005 ? 'text-red-600' : 'text-emerald-600'}`}>
                          {inv._due > 0.005 ? fmt(inv._due) : '✓'}
                          {isForeign && n(inv._due) > 0.005 && (
                            <div className="text-[10px] font-normal text-red-500/80 italic">
                              = {fmt(n(inv._due) * rate)} LEK
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2 text-center">
                          <button
                            onClick={() => onOpenPayment?.(inv.id)}
                            className="px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 hover:bg-emerald-100 text-emerald-700 dark:text-emerald-300 text-xs font-medium"
                            title="Regjistro pagesë / shih historikun"
                          >💰 Pagesë</button>
                        </td>
                      </tr>
                    )
                  })}
                </Fragment>
              ))}
            </tbody>
            <tfoot className="bg-slate-50 dark:bg-slate-900 border-t-2 border-slate-200 dark:border-slate-700">
              {currenciesInList.map((cur, idx) => {
                const t = totalsByCur[cur]
                return (
                  <tr key={cur} className={`bg-blue-50 dark:bg-blue-900/30 ${idx > 0 ? 'border-t border-blue-200' : ''}`}>
                    <td colSpan={4} className="px-4 py-3 text-xs font-bold text-blue-700 dark:text-blue-300 uppercase tracking-wide">
                      💱 TOTAL ({cur})
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-extrabold text-slate-800 dark:text-slate-100">{fmt(t.tot)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-extrabold text-emerald-700 dark:text-emerald-300">{fmt(t.paid)}</td>
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


export default function DetyrimetKlienti({ onNavigate }) {
  const [selected, setSelected] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [paymentInvoiceId, setPaymentInvoiceId] = useState(null)
  const [dateRange, setDateRange] = useState({ from: '', to: '' })

  const onPaymentSaved = () => setRefreshKey(k => k + 1)

  return (
    <div className="space-y-4">
      <DateRangeFilter from={dateRange.from} to={dateRange.to} onChange={setDateRange} emptyForAll hint="Boshi = i gjithë historiku" />
      <ClientSearchBox
        value={selected}
        onPick={setSelected}
        onClear={() => setSelected(null)}
      />
      <ClientInvoicesPanel
        client={selected}
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
