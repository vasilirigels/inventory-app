import { useState, useEffect, useRef } from 'react'
import { exportToExcel, exportToPdf, formatNum } from '../utils/export.js'

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

function exportActivityExcel(enriched, totals, client, dateRange) {
  const rows = enriched.map(ev => {
    if (ev.kind === 'invoice') {
      const inv = ev.invoice
      return {
        'Data': ev.date,
        'Lloji': 'Faturë Shitje',
        'Burimi': 'FATURA SHITJE',
        'Nr. Fature': inv.invoice_no,
        'Monedha': inv.currency,
        'Pagesa': pmLabel(inv.payment_method),
        'Detaje': '',
        'Debitim (+)': n(inv.total_with_vat),
        'Kreditim (-)': ev.initialPaid > 0.005 ? ev.initialPaid : '',
        'Balanca': ev.balance,
      }
    }
    const p = ev.payment
    return {
      'Data': ev.date,
      'Lloji': 'Pagesë',
      'Burimi': 'Detyrime Klienti',
      'Nr. Fature': p.invoice_no,
      'Monedha': '',
      'Pagesa': pmLabel(p.payment_method),
      'Detaje': p.notes || '',
      'Debitim (+)': '',
      'Kreditim (-)': n(p.amount),
      'Balanca': ev.balance,
    }
  })
  rows.push({
    'Data': '', 'Lloji': 'TOTALI', 'Burimi': '', 'Nr. Fature': '',
    'Monedha': '', 'Pagesa': '', 'Detaje': '',
    'Debitim (+)': totals.invoiced,
    'Kreditim (-)': totals.paid,
    'Balanca': totals.due,
  })
  const namePart = client?.name ? `_${client.name.replace(/\s+/g, '_')}` : ''
  const dateSuffix = dateRange?.from || dateRange?.to
    ? `_${dateRange.from || 'start'}_${dateRange.to || 'today'}`
    : ''
  exportToExcel(`Analize_Veprime${namePart}${dateSuffix}`, rows, {
    sheetName: 'Veprimet',
    columnWidths: [12, 14, 18, 14, 10, 10, 24, 14, 14, 14],
  })
}

function exportActivityPdf(enriched, totals, client, dateRange) {
  const dateInfo = (dateRange?.from || dateRange?.to)
    ? `Periudha: ${dateRange.from || '...'} → ${dateRange.to || '...'} · `
    : ''
  const subtitle = `${dateInfo}Klienti: ${client?.name || '(pa emër)'}${client?.nipt ? ` · NIPT: ${client.nipt}` : ''} · ${enriched.length} veprime`
  exportToPdf(`Analize Veprime Klient${client?.name ? ` — ${client.name}` : ''}`, [
    {
      subtitle,
      headers: ['Data', 'Lloji', 'Burimi', 'Detaje', 'Pagesa', 'Debitim (+)', 'Kreditim (−)', 'Balanca'],
      rows: enriched.map(ev => {
        if (ev.kind === 'invoice') {
          const inv = ev.invoice
          return [
            ev.date,
            'Faturë Shitje',
            'FATURA SHITJE',
            `${inv.invoice_no} (${inv.currency})`,
            pmLabel(inv.payment_method),
            { v: formatNum(inv.total_with_vat), cls: 'num' },
            ev.initialPaid > 0.005 ? { v: formatNum(ev.initialPaid), cls: 'num green' } : '',
            { v: formatNum(ev.balance), cls: `num ${ev.balance > 0.005 ? 'red' : 'green'}` },
          ]
        }
        const p = ev.payment
        return [
          ev.date,
          'Pagesë',
          'Detyrime Klienti',
          `për ${p.invoice_no}${p.notes ? ` — ${p.notes}` : ''}`,
          pmLabel(p.payment_method),
          '',
          { v: formatNum(p.amount), cls: 'num green' },
          { v: formatNum(ev.balance), cls: `num ${ev.balance > 0.005 ? 'red' : 'green'}` },
        ]
      }),
      footerRows: [[
        'TOTALE', '', '', '', '',
        { v: formatNum(totals.invoiced), cls: 'num' },
        { v: formatNum(totals.paid), cls: 'num green' },
        { v: formatNum(totals.due), cls: `num ${totals.due > 0.005 ? 'red' : 'green'}` },
      ]],
    }
  ])
}

function pmBadge(pm) {
  if (pm === 'debt') return <span className="badge bg-amber-100 text-amber-700">⚠️ Borxh</span>
  if (pm === 'bank') return <span className="badge bg-blue-100 text-blue-700">🏦 Bankë</span>
  if (pm === 'pos')  return <span className="badge bg-purple-100 text-purple-700">💳 POS</span>
  return <span className="badge bg-emerald-100 text-emerald-700">💵 Cash</span>
}

function DateRangeFilter({ from, to, onChange }) {
  const setRange = (preset) => {
    const t = new Date()
    const iso = (d) => d.toISOString().slice(0, 10)
    if (preset === 'today')      onChange({ from: iso(t), to: iso(t) })
    else if (preset === 'month') {
      const first = new Date(t.getFullYear(), t.getMonth(), 1)
      onChange({ from: iso(first), to: iso(t) })
    }
    else if (preset === 'year')  {
      const first = new Date(t.getFullYear(), 0, 1)
      onChange({ from: iso(first), to: iso(t) })
    }
    else if (preset === 'all')   onChange({ from: '', to: '' })
  }
  return (
    <div className="card flex flex-wrap items-end gap-3">
      <div className="flex items-center gap-2">
        <span className="text-2xl">📅</span>
        <span className="text-sm font-semibold text-slate-700">Filtër Date</span>
      </div>
      <div>
        <label className="form-label">Nga</label>
        <input type="date" value={from} onChange={e => onChange({ from: e.target.value, to })}
          className="input-field" />
      </div>
      <div>
        <label className="form-label">Deri</label>
        <input type="date" value={to} onChange={e => onChange({ from, to: e.target.value })}
          className="input-field" />
      </div>
      <div className="flex gap-1.5">
        <button type="button" onClick={() => setRange('today')} className="btn-secondary text-xs">Sot</button>
        <button type="button" onClick={() => setRange('month')} className="btn-secondary text-xs">Ky muaj</button>
        <button type="button" onClick={() => setRange('year')} className="btn-secondary text-xs">Ky vit</button>
        <button type="button" onClick={() => setRange('all')} className="btn-secondary text-xs">Të gjitha</button>
      </div>
      {(from || to) && (
        <div className="text-[11px] text-blue-700 bg-blue-50 px-2 py-1 rounded-lg border border-blue-200">
          Filtruar: {from || '...'} → {to || '...'}
        </div>
      )}
    </div>
  )
}

// ── Sidebar: alphabetical list of all clients who appear in invoices ────────
function ClientsList({ selected, onPick, dateRange }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (dateRange?.from) params.set('from', dateRange.from)
    if (dateRange?.to)   params.set('to', dateRange.to)
    const qs = params.toString()
    fetch(`/api/client-debts/summary${qs ? '?' + qs : ''}`)
      .then(r => r.json())
      .then(d => { setRows(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => { setRows([]); setLoading(false) })
  }, [dateRange?.from, dateRange?.to])

  if (loading) {
    return <div className="card p-6 text-center text-slate-400 text-sm">Duke ngarkuar...</div>
  }

  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
        <h3 className="text-sm font-bold text-slate-800">Klientët (A → Z)</h3>
        <p className="text-[10px] text-slate-500">{rows.length} klientë me fatura</p>
      </div>
      {rows.length === 0 ? (
        <div className="p-8 text-center text-slate-400 text-sm">
          Asnjë klient i regjistruar në fatura
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 max-h-[65vh] overflow-y-auto">
          {rows.map((r, i) => {
            const isSel = selected && (
              (selected.nipt && r.customer_nipt && selected.nipt === r.customer_nipt) ||
              (!selected.nipt && selected.name === r.customer_name)
            )
            const due = n(r.due)
            return (
              <li key={i}>
                <button
                  onClick={() => onPick({ name: r.customer_name, nipt: r.customer_nipt })}
                  className={`w-full text-left px-4 py-3 hover:bg-blue-50 transition-colors ${isSel ? 'bg-blue-50 border-l-4 border-blue-500' : ''}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-800 truncate">
                        {r.customer_name || <span className="italic text-slate-400">— pa emër —</span>}
                      </p>
                      <p className="text-[10px] text-slate-500 font-mono truncate">{r.customer_nipt || '—'}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-slate-500">{r.invoice_count}f.</p>
                      {due > 0.005 && <p className="text-xs font-bold text-red-600 tabular-nums">{fmt(due)}</p>}
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

// ── Search box (autocomplete on clients table) ───────────────────────────────
function ClientSearch({ value, onPick, onClear }) {
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
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">🔍</span>
          <input
            type="text" value={query}
            placeholder="Kërko klient — emër, NIPT, telefon..."
            onChange={e => { setQuery(e.target.value); search(e.target.value); setOpen(true) }}
            onFocus={() => query && setOpen(true)}
            className="input-field pl-9"
          />
        </div>
        {value && <button onClick={onClear} className="btn-secondary">Pastro</button>}
      </div>
      {open && (results.length > 0 || loading) && (
        <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-72 overflow-y-auto">
          {loading && <div className="p-2 text-xs text-slate-400">Duke kërkuar...</div>}
          {results.map(c => (
            <button
              key={c.id}
              onClick={() => { onPick({ name: clientFullName(c) || c.nipt, nipt: c.nipt }); setOpen(false) }}
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
        </div>
      )}
    </div>
  )
}

function ActivityPanel({ client, onNavigate, dateRange }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!client) { setData(null); return }
    setLoading(true)
    const params = new URLSearchParams()
    if (client.nipt) params.set('nipt', client.nipt)
    else if (client.name) params.set('name', client.name)
    if (dateRange?.from) params.set('from', dateRange.from)
    if (dateRange?.to)   params.set('to', dateRange.to)
    fetch(`/api/client-activity?${params}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => { setData(null); setLoading(false) })
  }, [client?.nipt, client?.name, dateRange?.from, dateRange?.to])

  if (!client) {
    return (
      <div className="card text-center py-16">
        <div className="text-5xl mb-3">👈</div>
        <p className="text-slate-500">Zgjidh një klient nga lista majtas, ose kërko sipër.</p>
      </div>
    )
  }
  if (loading) return <div className="card text-center py-12 text-slate-400">Duke ngarkuar veprimet...</div>
  if (!data || data.invoices.length === 0) {
    return (
      <div className="card text-center py-12">
        <div className="text-4xl mb-3">📭</div>
        <p className="text-slate-500">Nuk ka asnjë faturë për këtë klient.</p>
      </div>
    )
  }

  // Group invoice_payments (partial payments from Detyrime Klienti modal) per invoice
  const subsByInvoice = new Map()
  for (const p of data.payments) {
    if (!subsByInvoice.has(p.invoice_id)) subsByInvoice.set(p.invoice_id, [])
    subsByInvoice.get(p.invoice_id).push(p)
  }

  // Chronological timeline. Per-row Pagesë on the invoice row depends on payment method:
  //   Cash / POS → Pagesë = full invoice total          (closes instantly, balance = 0)
  //   Bankë      → Pagesë = 0                           (closes later via Detyrime Klienti)
  //   Borxh      → Pagesë = value paid on the invoice   (initial paid at registration)
  // Each subsequent partial payment from the Detyrime Klienti modal is its own row
  // (Pagesë only) and lowers the running balance further. For the rare case of a Bankë
  // invoice with an upfront amount typed in, that part is shown as a separate
  // "pagesë në regjistrim" row so totals stay consistent.
  const events = []
  for (const inv of data.invoices) {
    const subs = subsByInvoice.get(inv.id) || []
    const sumSubs = subs.reduce((s, p) => s + n(p.amount), 0)
    const pm = inv.payment_method
    const total = n(inv.total_with_vat)
    const initStored = +Math.max(0, n(inv.amount_paid) - sumSubs).toFixed(2)
    let invoicePaid = 0
    let leftoverInit = 0
    if (pm === 'cash' || pm === 'pos') {
      invoicePaid = total
    } else if (pm === 'bank') {
      invoicePaid = 0
      leftoverInit = initStored
    } else { // 'debt' (or anything else)
      invoicePaid = initStored
    }
    events.push({
      kind: 'invoice',
      date: inv.date,
      orderKey: `${inv.date}-1-i-${String(inv.id).padStart(10, '0')}`,
      invoice: inv,
      initialPaid: invoicePaid,
    })
    if (leftoverInit > 0.005) {
      events.push({
        kind: 'payment',
        date: inv.date,
        orderKey: `${inv.date}-2-pinit-${String(inv.id).padStart(10, '0')}`,
        isInitialBankPay: true,
        payment: {
          id: `init-${inv.id}`,
          invoice_id: inv.id,
          date: inv.date,
          amount: leftoverInit,
          payment_method: 'bank',
          notes: 'pagesë në regjistrim',
          invoice_no: inv.invoice_no,
          invoice_date: inv.date,
        },
      })
    }
  }
  for (const p of data.payments) {
    events.push({
      kind: 'payment',
      date: p.date,
      orderKey: `${p.date}-3-p-${String(p.id).padStart(10, '0')}`,
      payment: p,
    })
  }
  events.sort((a, b) => a.orderKey.localeCompare(b.orderKey))

  // Per-invoice exchange rate so payment events can be converted to LEK too
  // (payment.amount is in the invoice's currency).
  const rateByInvoiceId = new Map(data.invoices.map(i => [i.id, n(i.exchange_rate) || 1]))

  let runDebit = 0, runCredit = 0
  let runDebitLek = 0, runCreditLek = 0
  const enriched = events.map(ev => {
    if (ev.kind === 'invoice') {
      const rate = n(ev.invoice.exchange_rate) || 1
      runDebit  += n(ev.invoice.total_with_vat)
      runCredit += ev.initialPaid
      runDebitLek  += n(ev.invoice.total_with_vat) * rate
      runCreditLek += ev.initialPaid * rate
    } else {
      const rate = rateByInvoiceId.get(ev.payment.invoice_id) || 1
      runCredit += n(ev.payment.amount)
      runCreditLek += n(ev.payment.amount) * rate
    }
    return { ...ev, balance: +(runDebit - runCredit).toFixed(2) }
  })

  const totals = {
    invoiced: +runDebit.toFixed(2),
    paid:     +runCredit.toFixed(2),
    due:      +(runDebit - runCredit).toFixed(2),
    invoicedLek: +runDebitLek.toFixed(2),
    paidLek:     +runCreditLek.toFixed(2),
    dueLek:      +(runDebitLek - runCreditLek).toFixed(2),
  }

  return (
    <div className="space-y-4">
      {/* Chronological timeline */}
      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-800">Veprimet sipas Datës (Kronologjike)</h3>
            <p className="text-[10px] text-slate-500 mt-0.5">
              {enriched.length} veprime · Faturat dhe pagesat e mbyllura në regjistrim nga
              <span className="ml-1 mr-1 badge bg-blue-100 text-blue-700">📄 FATURA SHITJE</span>
              · Pagesat e mëvonshme nga
              <span className="ml-1 badge bg-emerald-100 text-emerald-700">💰 Detyrime Klienti</span>
            </p>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button
              onClick={() => exportActivityExcel(enriched, totals, client, dateRange)}
              className="btn-secondary text-xs"
              title="Eksporto në Excel"
            >📊 Excel</button>
            <button
              onClick={() => exportActivityPdf(enriched, totals, client, dateRange)}
              className="btn-secondary text-xs"
              title="Eksporto në PDF"
            >📄 PDF</button>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Data</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Lloji & Burimi</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Detaje</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase">Debitim (+)</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase">Kreditim (−)</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase">Balanca</th>
            </tr>
          </thead>
          <tbody>
            {enriched.map((ev, i) => {
              if (ev.kind === 'invoice') {
                const inv = ev.invoice
                const isCredit = !!inv.is_credit_note
                const pm = inv.payment_method
                const isInstantClose = pm === 'cash' || pm === 'pos'
                const rate = n(inv.exchange_rate) || 1
                const isForeign = (inv.currency || 'LEK') !== 'LEK'
                return (
                  <tr key={i} className={`border-b border-slate-100 ${isCredit ? 'bg-red-50/40 hover:bg-red-50' : 'hover:bg-slate-50'}`}>
                    <td className="px-4 py-2 text-slate-700 font-semibold">{ev.date}</td>
                    <td className="px-4 py-2">
                      {isCredit
                        ? <span className="badge bg-red-100 text-red-700">↩️ Kreditore</span>
                        : <span className="badge bg-blue-100 text-blue-700">📄 Faturë Shitje</span>}
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        {isInstantClose
                          ? 'mbyllur në moment (Cash/POS)'
                          : 'do mbyllet nga Detyrime Klienti'}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-600">
                      <button
                        onClick={() => onNavigate?.('fatura-shitje', { date: inv.date, invoiceId: inv.id })}
                        className="font-mono font-semibold text-blue-600 hover:text-blue-800 hover:underline"
                        title="Hap këtë faturë"
                      >{inv.invoice_no}</button>
                      <div className="text-[11px] text-slate-500">{inv.currency} · {pm === 'debt' ? '⚠️ Borxh' : pm === 'bank' ? '🏦 Bankë' : pm === 'pos' ? '💳 POS' : '💵 Cash'}</div>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold text-slate-800">
                      {fmt(inv.total_with_vat)}
                      {isForeign && (
                        <div className="text-[10px] font-normal text-slate-500 italic">
                          = {fmt(n(inv.total_with_vat) * rate)} LEK
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold text-emerald-700">
                      {ev.initialPaid > 0.005 ? fmt(ev.initialPaid) : '—'}
                      {isForeign && ev.initialPaid > 0.005 && (
                        <div className="text-[10px] font-normal text-emerald-600/70 italic">
                          = {fmt(ev.initialPaid * rate)} LEK
                        </div>
                      )}
                    </td>
                    <td className={`px-4 py-2 text-right tabular-nums font-bold ${ev.balance > 0.005 ? 'text-red-600' : 'text-emerald-700'}`}>
                      {fmt(ev.balance)}
                    </td>
                  </tr>
                )
              }
              const p = ev.payment
              const isInitBank = !!ev.isInitialBankPay
              const payRate = rateByInvoiceId.get(p.invoice_id) || 1
              const payCurrency = data.invoices.find(i => i.id === p.invoice_id)?.currency || 'LEK'
              const isForeign = payCurrency !== 'LEK'
              return (
                <tr key={i} className="border-b border-slate-100 hover:bg-slate-50 bg-emerald-50/30">
                  <td className="px-4 py-2 text-slate-700 font-semibold">{ev.date}</td>
                  <td className="px-4 py-2">
                    <span className="badge bg-emerald-100 text-emerald-700">💰 Pagesë</span>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      {isInitBank ? 'pagesë në regjistrim (Bankë)' : 'nga Detyrime Klienti'}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-600">
                    <div className="text-slate-700">
                      për fat.{' '}
                      <button
                        onClick={() => onNavigate?.('fatura-shitje', { date: p.invoice_date, invoiceId: p.invoice_id })}
                        className="font-mono font-semibold text-blue-600 hover:text-blue-800 hover:underline"
                        title="Hap këtë faturë"
                      >{p.invoice_no}</button>
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {p.payment_method === 'bank' ? '🏦 Bankë' : p.payment_method === 'pos' ? '💳 POS' : '💵 Cash'}{p.notes ? ` · ${p.notes}` : ''}
                    </div>
                  </td>
                  <td className="px-4 py-2"></td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold text-emerald-700">
                    {fmt(p.amount)}
                    {isForeign && (
                      <div className="text-[10px] font-normal text-emerald-600/70 italic">
                        = {fmt(n(p.amount) * payRate)} LEK
                      </div>
                    )}
                  </td>
                  <td className={`px-4 py-2 text-right tabular-nums font-bold ${ev.balance > 0.005 ? 'text-red-600' : 'text-emerald-700'}`}>
                    {fmt(ev.balance)}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="bg-slate-50 border-t-2 border-slate-200">
            <tr className="bg-blue-50">
              <td colSpan={3} className="px-4 py-3 text-xs font-bold text-blue-700 uppercase tracking-wide">
                💱 TOTALE NË LEK <span className="text-[10px] font-normal text-blue-600">(të konvertuara me kursin e çdo fature)</span>
              </td>
              <td className="px-4 py-3 text-right tabular-nums font-extrabold text-slate-800">{fmt(totals.invoicedLek)}</td>
              <td className="px-4 py-3 text-right tabular-nums font-extrabold text-emerald-700">{fmt(totals.paidLek)}</td>
              <td className={`px-4 py-3 text-right tabular-nums font-extrabold ${totals.dueLek > 0.005 ? 'text-red-600' : 'text-emerald-700'}`}>
                {fmt(totals.dueLek)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

export default function AnalizeVeprime({ onNavigate }) {
  const [selected, setSelected] = useState(null)
  const [dateRange, setDateRange] = useState({ from: '', to: '' })

  return (
    <div className="space-y-4">
      <DateRangeFilter from={dateRange.from} to={dateRange.to} onChange={setDateRange} />
      <ClientSearch
        value={selected}
        onPick={setSelected}
        onClear={() => setSelected(null)}
      />
      <ActivityPanel client={selected} onNavigate={onNavigate} dateRange={dateRange} />
    </div>
  )
}
