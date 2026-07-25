import { useState, useEffect, useRef } from 'react'
import { exportToExcel, exportToPdf, formatNum } from '../utils/export.js'
import DateRangeFilter from './DateRangeFilter.jsx'

function n(v) { return parseFloat(v) || 0 }
function fmt(v) {
  return n(v).toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function pmLabel(pm) {
  return pm === 'debt' ? 'Borxh' : pm === 'bank' ? 'Bankë' : pm === 'pos' ? 'POS' : 'Cash'
}

function exportActivityExcel(enriched, totals, supplier, dateRange, currencyByInvoiceId) {
  const rows = enriched.map(ev => {
    if (ev.kind === 'invoice') {
      const inv = ev.invoice
      return {
        'Data': ev.date,
        'Lloji': 'Faturë Blerje',
        'Burimi': 'FATURA BLERJE',
        'Nr. Fature': inv.invoice_no,
        'Monedha': inv.currency,
        'Pagesa': pmLabel(inv.payment_method),
        'Detaje': '',
        'Detyrim (+)': n(inv.total_with_vat),
        'Pagesë (-)': ev.initialPaid > 0.005 ? ev.initialPaid : '',
        'Balanca': ev.balance,
      }
    }
    const p = ev.payment
    return {
      'Data': ev.date,
      'Lloji': 'Pagesë',
      'Burimi': 'Detyrime Furnitor',
      'Nr. Fature': p.invoice_no,
      'Monedha': currencyByInvoiceId?.get(p.purchase_id) || '',
      'Pagesa': pmLabel(p.payment_method),
      'Detaje': p.notes || '',
      'Detyrim (+)': '',
      'Pagesë (-)': n(p.amount),
      'Balanca': ev.balance,
    }
  })
  rows.push({
    'Data': '', 'Lloji': 'TOTALI', 'Burimi': '', 'Nr. Fature': '',
    'Monedha': '', 'Pagesa': '', 'Detaje': '',
    'Detyrim (+)': totals.invoiced,
    'Pagesë (-)': totals.paid,
    'Balanca': totals.due,
  })
  const namePart = supplier?.name ? `_${supplier.name.replace(/\s+/g, '_')}` : ''
  const dateSuffix = dateRange?.from || dateRange?.to
    ? `_${dateRange.from || 'start'}_${dateRange.to || 'today'}`
    : ''
  exportToExcel(`Analize_Veprime_Furnitor${namePart}${dateSuffix}`, rows, {
    sheetName: 'Veprimet',
    columnWidths: [12, 14, 18, 14, 10, 10, 24, 14, 14, 14],
  })
}

function exportActivityPdf(enriched, totals, supplier, dateRange, currencyByInvoiceId) {
  const dateInfo = (dateRange?.from || dateRange?.to)
    ? `Periudha: ${dateRange.from || '...'} → ${dateRange.to || '...'} · `
    : ''
  const subtitle = `${dateInfo}Furnitori: ${supplier?.name || '(pa emër)'}${supplier?.nipt ? ` · NIPT: ${supplier.nipt}` : ''} · ${enriched.length} veprime`
  exportToPdf(`Analize Veprime Furnitor${supplier?.name ? ` — ${supplier.name}` : ''}`, [
    {
      subtitle,
      headers: ['Data', 'Lloji', 'Burimi', 'Detaje', 'Monedha', 'Pagesa', 'Detyrim (+)', 'Pagesë (−)', 'Balanca'],
      rows: enriched.map(ev => {
        if (ev.kind === 'invoice') {
          const inv = ev.invoice
          return [
            ev.date,
            'Faturë Blerje',
            'FATURA BLERJE',
            inv.invoice_no,
            inv.currency,
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
          'Detyrime Furnitor',
          `për ${p.invoice_no}${p.notes ? ` — ${p.notes}` : ''}`,
          currencyByInvoiceId?.get(p.purchase_id) || '',
          pmLabel(p.payment_method),
          '',
          { v: formatNum(p.amount), cls: 'num green' },
          { v: formatNum(ev.balance), cls: `num ${ev.balance > 0.005 ? 'red' : 'green'}` },
        ]
      }),
      footerRows: [[
        'TOTALE', '', '', '', '', '',
        { v: formatNum(totals.invoiced), cls: 'num' },
        { v: formatNum(totals.paid), cls: 'num green' },
        { v: formatNum(totals.due), cls: `num ${totals.due > 0.005 ? 'red' : 'green'}` },
      ]],
    }
  ])
}


function SupplierSearch({ value, onPick, onClear }) {
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
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 text-sm pointer-events-none">🔍</span>
          <input
            type="text" value={query}
            placeholder="Kërko furnitor — emër, NIPT, telefon..."
            onChange={e => { setQuery(e.target.value); search(e.target.value); setOpen(true) }}
            onFocus={() => query && setOpen(true)}
            className="input-field pl-9"
          />
        </div>
        {value && <button onClick={onClear} className="btn-secondary">Pastro</button>}
      </div>
      {open && (results.length > 0 || loading) && (
        <div className="absolute z-20 left-0 right-0 mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg max-h-72 overflow-y-auto">
          {loading && <div className="p-2 text-xs text-slate-400 dark:text-slate-500">Duke kërkuar...</div>}
          {results.map(s => (
            <button
              key={s.id}
              onClick={() => { onPick({ name: s.name || s.nipt, nipt: s.nipt }); setOpen(false) }}
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

function ActivityPanel({ supplier, onNavigate, dateRange }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!supplier) { setData(null); return }
    setLoading(true)
    const params = new URLSearchParams()
    if (supplier.nipt) params.set('nipt', supplier.nipt)
    else if (supplier.name) params.set('name', supplier.name)
    if (dateRange?.from) params.set('from', dateRange.from)
    if (dateRange?.to)   params.set('to', dateRange.to)
    fetch(`/api/supplier-activity?${params}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => { setData(null); setLoading(false) })
  }, [supplier?.nipt, supplier?.name, dateRange?.from, dateRange?.to])

  if (!supplier) {
    return (
      <div className="card text-center py-16">
        <div className="text-5xl mb-3">👈</div>
        <p className="text-slate-500 dark:text-slate-400">Zgjidh një furnitor nga kërkimi sipër.</p>
      </div>
    )
  }
  if (loading) return <div className="card text-center py-12 text-slate-400 dark:text-slate-500">Duke ngarkuar veprimet...</div>
  if (!data || data.invoices.length === 0) {
    return (
      <div className="card text-center py-12">
        <div className="text-4xl mb-3">📭</div>
        <p className="text-slate-500 dark:text-slate-400">Nuk ka asnjë faturë blerje për këtë furnitor.</p>
      </div>
    )
  }

  // Group purchase_payments (partial payments from the modal) per invoice
  const subsByInvoice = new Map()
  for (const p of data.payments) {
    if (!subsByInvoice.has(p.purchase_id)) subsByInvoice.set(p.purchase_id, [])
    subsByInvoice.get(p.purchase_id).push(p)
  }

  // Chronological timeline. Per-row Pagesë on the invoice row depends on payment method:
  //   Cash / POS → Pagesë = full invoice total          (closes instantly, balance = 0)
  //   Bankë      → Pagesë = 0                           (closes later via Detyrime Furnitor)
  //   Borxh      → Pagesë = value paid on the invoice   (initial paid at registration)
  // Each subsequent partial payment from the Detyrime Furnitor modal is its own row
  // (Pagesë only) and lowers the running balance further. For the rare case of a Bankë
  // invoice with an upfront amount typed in, that part is shown as a separate "pagesë në
  // regjistrim" row so totals stay consistent.
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
          purchase_id: inv.id,
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
  const rateByInvoiceId     = new Map(data.invoices.map(i => [i.id, n(i.exchange_rate) || 1]))
  const currencyByInvoiceId = new Map(data.invoices.map(i => [i.id, i.currency || 'LEK']))

  let runDebit = 0, runCredit = 0
  let runDebitLek = 0, runCreditLek = 0
  // Totalet e ndara sipas monedhës origjinale.
  const totalsByCur = {}
  const bump = (cur, invAmt, paidAmt) => {
    if (!totalsByCur[cur]) totalsByCur[cur] = { invoiced: 0, paid: 0 }
    totalsByCur[cur].invoiced += invAmt
    totalsByCur[cur].paid     += paidAmt
  }
  const enriched = events.map(ev => {
    if (ev.kind === 'invoice') {
      const rate = n(ev.invoice.exchange_rate) || 1
      const cur  = ev.invoice.currency || 'LEK'
      runDebit  += n(ev.invoice.total_with_vat)
      runCredit += ev.initialPaid
      runDebitLek  += n(ev.invoice.total_with_vat) * rate
      runCreditLek += ev.initialPaid * rate
      bump(cur, n(ev.invoice.total_with_vat), ev.initialPaid)
    } else {
      const rate = rateByInvoiceId.get(ev.payment.purchase_id) || 1
      const cur  = currencyByInvoiceId.get(ev.payment.purchase_id) || 'LEK'
      runCredit += n(ev.payment.amount)
      runCreditLek += n(ev.payment.amount) * rate
      bump(cur, 0, n(ev.payment.amount))
    }
    return { ...ev, balance: +(runDebit - runCredit).toFixed(2) }
  })
  for (const c of Object.keys(totalsByCur)) {
    const t = totalsByCur[c]
    t.invoiced = +t.invoiced.toFixed(2)
    t.paid     = +t.paid.toFixed(2)
    t.due      = +(t.invoiced - t.paid).toFixed(2)
  }
  const currenciesInList = Object.keys(totalsByCur).sort()

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
      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Veprimet sipas Datës (Kronologjike)</h3>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
              {enriched.length} veprime · Faturat dhe pagesat e mbyllura në regjistrim nga
              <span className="ml-1 mr-1 badge bg-blue-100 text-blue-700 dark:text-blue-300">📄 FATURA BLERJE</span>
              · Pagesat e mëvonshme nga
              <span className="ml-1 badge bg-emerald-100 text-emerald-700 dark:text-emerald-300">💰 Detyrime Furnitor</span>
            </p>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button
              onClick={() => exportActivityExcel(enriched, totals, supplier, dateRange, currencyByInvoiceId)}
              className="btn-secondary text-xs"
              title="Eksporto në Excel"
            >📊 Excel</button>
            <button
              onClick={() => exportActivityPdf(enriched, totals, supplier, dateRange, currencyByInvoiceId)}
              className="btn-secondary text-xs"
              title="Eksporto në PDF"
            >📄 PDF</button>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Data</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Lloji & Burimi</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Detaje</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Monedha</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Detyrim (+)</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Pagesë (−)</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Balanca</th>
            </tr>
          </thead>
          <tbody>
            {enriched.map((ev, i) => {
              if (ev.kind === 'invoice') {
                const inv = ev.invoice
                const pm = inv.payment_method
                const isInstantClose = pm === 'cash' || pm === 'pos'
                const rate = n(inv.exchange_rate) || 1
                const isForeign = (inv.currency || 'LEK') !== 'LEK'
                return (
                  <tr key={i} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="px-4 py-2 text-slate-700 dark:text-slate-200 font-semibold">{ev.date}</td>
                    <td className="px-4 py-2">
                      <span className="badge bg-blue-100 text-blue-700 dark:text-blue-300">📄 Faturë Blerje</span>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                        {isInstantClose
                          ? 'mbyllur në moment (Cash/POS)'
                          : 'do mbyllet nga Detyrime Furnitor'}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-600 dark:text-slate-300">
                      <button
                        onClick={() => onNavigate?.('fatura-blerje', { date: inv.date, invoiceId: inv.id })}
                        className="font-mono font-semibold text-blue-600 hover:text-blue-800 hover:underline"
                        title="Hap këtë faturë"
                      >{inv.invoice_no}</button>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">{pm === 'debt' ? '⚠️ Borxh' : pm === 'bank' ? '🏦 Bankë' : pm === 'pos' ? '💳 POS' : '💵 Cash'}</div>
                    </td>
                    <td className="px-4 py-2 text-center">
                      <span className="badge bg-blue-100 text-blue-700 dark:text-blue-300">{inv.currency}</span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold text-slate-800 dark:text-slate-100">
                      {fmt(inv.total_with_vat)}
                      {isForeign && (
                        <div className="text-[10px] font-normal text-slate-500 dark:text-slate-400 italic">
                          = {fmt(n(inv.total_with_vat) * rate)} LEK
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold text-emerald-700 dark:text-emerald-300">
                      {ev.initialPaid > 0.005 ? fmt(ev.initialPaid) : '—'}
                      {isForeign && ev.initialPaid > 0.005 && (
                        <div className="text-[10px] font-normal text-emerald-600/70 italic">
                          = {fmt(ev.initialPaid * rate)} LEK
                        </div>
                      )}
                    </td>
                    <td className={`px-4 py-2 text-right tabular-nums font-bold ${ev.balance > 0.005 ? 'text-red-600' : 'text-emerald-700 dark:text-emerald-300'}`}>
                      {fmt(ev.balance)}
                    </td>
                  </tr>
                )
              }
              const p = ev.payment
              const isInitBank = !!ev.isInitialBankPay
              const payRate = rateByInvoiceId.get(p.purchase_id) || 1
              const payCurrency = data.invoices.find(i => i.id === p.purchase_id)?.currency || 'LEK'
              const isForeign = payCurrency !== 'LEK'
              return (
                <tr key={i} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 bg-emerald-50/30">
                  <td className="px-4 py-2 text-slate-700 dark:text-slate-200 font-semibold">{ev.date}</td>
                  <td className="px-4 py-2">
                    <span className="badge bg-emerald-100 text-emerald-700 dark:text-emerald-300">💰 Pagesë</span>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                      {isInitBank ? 'pagesë në regjistrim (Bankë)' : 'nga Detyrime Furnitor'}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-600 dark:text-slate-300">
                    <div className="text-slate-700 dark:text-slate-200">
                      për fat.{' '}
                      <button
                        onClick={() => onNavigate?.('fatura-blerje', { date: p.invoice_date, invoiceId: p.purchase_id })}
                        className="font-mono font-semibold text-blue-600 hover:text-blue-800 hover:underline"
                        title="Hap këtë faturë"
                      >{p.invoice_no}</button>
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {p.payment_method === 'bank' ? '🏦 Bankë' : p.payment_method === 'pos' ? '💳 POS' : '💵 Cash'}{p.notes ? ` · ${p.notes}` : ''}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-center">
                    <span className="badge bg-blue-100 text-blue-700 dark:text-blue-300">{payCurrency}</span>
                  </td>
                  <td className="px-4 py-2"></td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold text-emerald-700 dark:text-emerald-300">
                    {fmt(p.amount)}
                    {isForeign && (
                      <div className="text-[10px] font-normal text-emerald-600/70 italic">
                        = {fmt(n(p.amount) * payRate)} LEK
                      </div>
                    )}
                  </td>
                  <td className={`px-4 py-2 text-right tabular-nums font-bold ${ev.balance > 0.005 ? 'text-red-600' : 'text-emerald-700 dark:text-emerald-300'}`}>
                    {fmt(ev.balance)}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="bg-slate-50 dark:bg-slate-900 border-t-2 border-slate-200 dark:border-slate-700">
            {currenciesInList.map((cur, idx) => {
              const t = totalsByCur[cur]
              return (
                <tr key={cur} className={`bg-blue-50 dark:bg-blue-900/30 ${idx > 0 ? 'border-t border-blue-200' : ''}`}>
                  <td colSpan={3} className="px-4 py-3 text-xs font-bold text-blue-700 dark:text-blue-300 uppercase tracking-wide">
                    💱 TOTAL ({cur})
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="badge bg-blue-200 text-blue-800 dark:text-blue-200">{cur}</span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-extrabold text-slate-800 dark:text-slate-100">{fmt(t.invoiced)}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-extrabold text-emerald-700 dark:text-emerald-300">{fmt(t.paid)}</td>
                  <td className={`px-4 py-3 text-right tabular-nums font-extrabold ${t.due > 0.005 ? 'text-red-600' : 'text-emerald-700 dark:text-emerald-300'}`}>
                    {fmt(t.due)}
                  </td>
                </tr>
              )
            })}
          </tfoot>
        </table>
      </div>
    </div>
  )
}

export default function AnalizeVeprimeFurnitor({ onNavigate }) {
  const [selected, setSelected] = useState(null)
  const [dateRange, setDateRange] = useState({ from: '', to: '' })

  return (
    <div className="space-y-4">
      <DateRangeFilter from={dateRange.from} to={dateRange.to} onChange={setDateRange} emptyForAll hint="Boshi = i gjithë historiku" />
      <SupplierSearch
        value={selected}
        onPick={setSelected}
        onClear={() => setSelected(null)}
      />
      <ActivityPanel supplier={selected} onNavigate={onNavigate} dateRange={dateRange} />
    </div>
  )
}
