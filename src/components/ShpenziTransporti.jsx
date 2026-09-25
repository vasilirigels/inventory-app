import { useState, useEffect, useCallback, useMemo } from 'react'
import MoneyInput from './MoneyInput.jsx'
import { showConfirm } from './ConfirmDialog.jsx'
import { useRealtimeSync } from '../hooks/useRealtimeSync.js'

const CURRENCIES = ['LEK', 'EUR', 'USD', 'GBP', 'CHF']

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

// Picker për faturat e blerjes — kërkim me query dhe listë e filtruar.
// Faturat që kanë tashmë një pagesë transporti shfaqen si të bllokuara.
function PurchaseInvoicePicker({ value, onChange, invoices, disabled, excludeId }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const selected = value ? invoices.find(i => String(i.id) === String(value)) : null

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return invoices
    return invoices.filter(i =>
      String(i.invoice_no || '').toLowerCase().includes(s) ||
      String(i.supplier_name || '').toLowerCase().includes(s)
    )
  }, [invoices, q])

  return (
    <div className="relative">
      <div className="flex gap-1">
        <input
          type="text"
          value={open ? q : (selected ? `${selected.invoice_no || '(pa nr)'} — ${selected.supplier_name || '—'}` : q)}
          onFocus={() => setOpen(true)}
          onChange={e => { setQ(e.target.value); setOpen(true) }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Kërko nr faturë ose furnitor..."
          className="input-field flex-1"
          disabled={disabled}
        />
        {selected && (
          <button type="button" onClick={() => { onChange(''); setQ('') }}
            className="px-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-600 dark:text-slate-300 text-sm"
            title="Pastro">✕</button>
        )}
      </div>
      {open && (
        <div className="absolute z-20 mt-1 w-full max-h-72 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg">
          {filtered.length === 0 ? (
            <div className="p-3 text-xs text-slate-400 italic">Asnjë faturë blerje.</div>
          ) : filtered.map(i => {
            const taken = i.has_transport_payment && String(i.id) !== String(excludeId)
            return (
              <button
                key={i.id}
                type="button"
                disabled={taken}
                onMouseDown={(e) => {
                  if (taken) { e.preventDefault(); return }
                  onChange(String(i.id))
                  setQ('')
                  setOpen(false)
                }}
                className={`block w-full text-left px-3 py-2 text-sm border-b border-slate-100 dark:border-slate-700 last:border-b-0 ${taken ? 'opacity-40 cursor-not-allowed' : 'hover:bg-blue-50 dark:hover:bg-blue-900/20'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-800 dark:text-slate-100">
                    {i.invoice_no || '(pa nr)'}
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                    {fmtDate(i.date)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 mt-0.5">
                  <span className="text-xs text-slate-600 dark:text-slate-300 truncate">
                    {i.supplier_name || <span className="italic text-slate-400">— pa furnitor —</span>}
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                    {fmt(i.total_with_vat)} {i.currency || 'LEK'}
                  </span>
                </div>
                {taken && (
                  <div className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">
                    ⚠ Ka tashmë një pagesë transporti
                  </div>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function emptyDraft(defaultDate = '') {
  return { date: defaultDate, mode: 'invoice', purchase_invoice_id: '', description: '', currency: 'EUR', amount: '', exchange_rate: '1' }
}

export default function ShpenziTransporti({ date }) {
  const [invoices, setInvoices] = useState([])
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState(() => emptyDraft(date))
  const [rates, setRates] = useState({ LEK: 1 })
  const [rateSource, setRateSource] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState(null)
  const [fromDate, setFromDate] = useState(() => date)
  const [toDate, setToDate] = useState(() => date)

  const rangeActive = fromDate !== date || toDate !== date
  const showDateCol = fromDate !== toDate

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const entriesUrl = fromDate === toDate
        ? `/api/expense-entries/${fromDate}?type=transport`
        : `/api/reports/expenses?from=${fromDate}&to=${toDate}&type=transport`
      const [invs, entries, ratesRes] = await Promise.all([
        fetch('/api/purchase-invoices/list-simple').then(r => r.json()),
        fetch(entriesUrl).then(r => r.json()),
        fetch(`/api/exchange-rates/${date}`).then(r => r.json()).catch(() => ({})),
      ])
      setInvoices(Array.isArray(invs) ? invs : [])
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
      setInvoices([]); setRows([])
    } finally {
      setLoading(false)
    }
  }, [date, fromDate, toDate])

  useEffect(() => {
    const t = setTimeout(() => { load() }, 300)
    return () => clearTimeout(t)
  }, [load])

  useEffect(() => { setDraft(d => ({ ...d, date })) }, [date])

  useRealtimeSync(['expense_entries', 'purchase_invoices'], load)

  const addEntry = async () => {
    const withInvoice = draft.mode !== 'no-invoice'
    if (withInvoice && !draft.purchase_invoice_id) { alert('Zgjidh një faturë blerje ose kalo te "Pa faturë".'); return }
    if (!withInvoice && !draft.description.trim()) { alert('Vendos një përshkrim për transportin pa faturë.'); return }
    if (!n(draft.amount)) { alert('Vendos vlerën.'); return }
    if (!draft.date) { alert('Vendos datën.'); return }
    const cur = draft.currency || 'LEK'
    const rate = cur === 'LEK' ? 1 : n(draft.exchange_rate)
    if (cur !== 'LEK' && rate <= 0) { alert(`Vendos kursin për 1 ${cur} (në LEK).`); return }
    setSaving(true)
    try {
      const res = await fetch('/api/expense-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: draft.date,
          kind: 'transport',
          purchase_invoice_id: withInvoice ? parseInt(draft.purchase_invoice_id) : null,
          description: draft.description,
          currency: cur,
          amount: n(draft.amount),
          exchange_rate: rate,
        }),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e.error || 'Gabim'); return }
      setDraft({ ...emptyDraft(draft.date), mode: draft.mode, currency: cur, exchange_rate: String(rate) })
      load()
    } finally { setSaving(false) }
  }

  const startEdit = (row) => {
    setEditingId(row.id)
    setEditDraft({
      date: row.date || date,
      mode: row.purchase_invoice_id ? 'invoice' : 'no-invoice',
      purchase_invoice_id: row.purchase_invoice_id ? String(row.purchase_invoice_id) : '',
      description: row.description || '',
      currency: row.currency || 'LEK',
      amount: row.amount != null ? String(row.amount) : '',
      exchange_rate: row.exchange_rate != null ? String(row.exchange_rate) : '1',
    })
  }
  const cancelEdit = () => { setEditingId(null); setEditDraft(null) }

  const saveEdit = async () => {
    if (!editDraft || editingId == null) return
    const withInvoice = editDraft.mode !== 'no-invoice'
    if (withInvoice && !editDraft.purchase_invoice_id) { alert('Zgjidh një faturë blerje ose kalo te "Pa faturë".'); return }
    if (!withInvoice && !editDraft.description.trim()) { alert('Vendos një përshkrim për transportin pa faturë.'); return }
    const cur = editDraft.currency || 'LEK'
    const rate = cur === 'LEK' ? 1 : n(editDraft.exchange_rate)
    if (cur !== 'LEK' && rate <= 0) { alert(`Vendos kursin për 1 ${cur} (në LEK).`); return }
    if (!n(editDraft.amount)) { alert('Vendos vlerën.'); return }
    const res = await fetch(`/api/expense-entries/${editingId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: editDraft.date || date,
        kind: 'transport',
        purchase_invoice_id: withInvoice ? parseInt(editDraft.purchase_invoice_id) : null,
        description: editDraft.description || '',
        currency: cur,
        amount: n(editDraft.amount),
        exchange_rate: rate,
      }),
    })
    if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e.error || 'Gabim'); return }
    cancelEdit()
    load()
  }

  const removeEntry = async (id) => {
    if (!(await showConfirm('Fshi këtë pagesë transporti?', {
      title: 'Fshi pagesën', confirmLabel: 'Fshi', danger: true,
    }))) return
    await fetch(`/api/expense-entries/${id}`, { method: 'DELETE' })
    if (editingId === id) cancelEdit()
    load()
  }

  const eurRate = n(rates.EUR) > 0 ? n(rates.EUR) : 0
  const lekToEur = (lek) => (eurRate > 0 ? lek / eurRate : 0)
  const rowTotalEur = (row) => {
    const cur = row.currency || 'LEK'
    if (cur === 'EUR') return n(row.amount)
    return lekToEur(n(row.amount) * n(row.exchange_rate || 1))
  }

  const totals = rows.reduce((a, r) => {
    const cur = r.currency || 'LEK'
    a.by_currency[cur] = (a.by_currency[cur] || 0) + n(r.amount)
    a.total_lek += n(r.amount) * n(r.exchange_rate || 1)
    a.total_eur += rowTotalEur(r)
    return a
  }, { by_currency: {}, total_lek: 0, total_eur: 0 })
  const totalsList = Object.entries(totals.by_currency).filter(([, v]) => Math.abs(v) > 0.005)

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">Shpenzime Transporti</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Regjistro shpenzimet e transportit — <strong>me faturë blerje</strong> (lidhet me një faturë specifike) ose <strong>pa faturë</strong> (kosto transporti të tjera me përshkrim). Të dyja llojet reflektohen te Arka Ditore.
          {rateSource && <span className="ml-1 text-slate-400 dark:text-slate-500">(kursi: <span className="font-medium">{rateSource}</span>)</span>}
        </p>
      </div>

      {/* New entry */}
      <div className="card">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">+ Shto Pagesë Transporti</h3>
          <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden text-xs">
            <button
              type="button"
              onClick={() => setDraft(d => ({ ...d, mode: 'invoice' }))}
              className={`px-3 py-1.5 font-semibold transition ${draft.mode !== 'no-invoice' ? 'bg-blue-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'}`}
            >📄 Me faturë</button>
            <button
              type="button"
              onClick={() => setDraft(d => ({ ...d, mode: 'no-invoice', purchase_invoice_id: '' }))}
              className={`px-3 py-1.5 font-semibold transition ${draft.mode === 'no-invoice' ? 'bg-blue-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'}`}
            >📝 Pa faturë</button>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-7 gap-2 items-end">
          <div>
            <label className="form-label">Data</label>
            <input
              type="date"
              value={draft.date || ''}
              onChange={e => setDraft(d => ({ ...d, date: e.target.value }))}
              className="input-field"
            />
          </div>
          {draft.mode !== 'no-invoice' ? (
            <div className="md:col-span-2">
              <label className="form-label">Faturë Blerje</label>
              <PurchaseInvoicePicker
                value={draft.purchase_invoice_id}
                onChange={v => setDraft(d => ({ ...d, purchase_invoice_id: v }))}
                invoices={invoices}
              />
            </div>
          ) : (
            <div className="md:col-span-2">
              <label className="form-label text-slate-400">Faturë Blerje</label>
              <div className="input-field bg-slate-50 dark:bg-slate-900 text-slate-400 dark:text-slate-500 italic text-xs cursor-not-allowed flex items-center">
                — pa faturë —
              </div>
            </div>
          )}
          <div className="md:col-span-2">
            <label className="form-label">
              Përshkrimi {draft.mode === 'no-invoice' && <span className="text-rose-500">*</span>}
            </label>
            <input
              type="text" value={draft.description}
              onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
              className="input-field"
              placeholder={draft.mode === 'no-invoice' ? 'p.sh. Transport nga Tirana për Rrogozhinë' : 'opsional'}
            />
          </div>
          <div>
            <label className="form-label">Monedha</label>
            <select
              value={draft.currency}
              onChange={e => {
                const newCur = e.target.value
                setDraft(d => {
                  if (newCur === 'LEK') return { ...d, currency: newCur, exchange_rate: '1' }
                  const autoRate = rates[newCur]
                  return { ...d, currency: newCur, exchange_rate: autoRate ? String(autoRate) : '' }
                })
              }}
              className="input-field"
            >
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label">Vlera ({draft.currency})</label>
            <MoneyInput
              value={draft.amount}
              onChange={v => setDraft(d => ({ ...d, amount: String(v) }))}
              className="input-field text-right tabular-nums"
            />
          </div>
          <div className="md:col-span-7 flex items-center justify-end">
            <button
              onClick={addEntry}
              disabled={saving}
              className="btn-primary disabled:opacity-50"
            >
              {saving ? '⏳ Duke ruajtur...' : '+ Shto'}
            </button>
          </div>
        </div>
      </div>

      {/* Period filter */}
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
          <button
            onClick={() => { setFromDate(date); setToDate(date) }}
            className="btn-secondary text-xs"
          >Pastro filtrin</button>
        )}
        {loading && (
          <span className="text-[11px] text-blue-600 bg-blue-50 dark:bg-blue-900/30 px-2 py-1 rounded-lg border border-blue-200">
            ⏳ Duke ngarkuar...
          </span>
        )}
      </div>

      {/* Entries table */}
      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
            Pagesat e Transportit
            {rangeActive && (
              <span className="ml-2 text-xs font-normal text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 rounded">
                {fmtDate(fromDate)} → {fmtDate(toDate)}
              </span>
            )}
          </h3>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {rows.length} {rows.length === 1 ? 'rresht' : 'rreshta'}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
              <tr>
                {showDateCol && (
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase w-24">Data</th>
                )}
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase w-56">Faturë Blerje</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Përshkrimi</th>
                <th className="px-3 py-2 text-center text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase w-24">Monedha</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase w-32">Vlera</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase w-28">Kursi (LEK)</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase w-32 bg-blue-50/60">Total EUR</th>
                <th className="px-3 py-2 text-center text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase w-12"></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={showDateCol ? 8 : 7} className="p-6 text-center text-slate-400 dark:text-slate-500 text-sm italic">
                    {rangeActive
                      ? `Asnjë pagesë transporti në periudhën ${fmtDate(fromDate)} → ${fmtDate(toDate)}.`
                      : 'Asnjë pagesë transporti për këtë datë.'}
                  </td>
                </tr>
              ) : rows.map(r => {
                const isEditing = editingId === r.id
                if (isEditing && editDraft) {
                  const eCur = editDraft.currency || 'LEK'
                  const eIsLek = eCur === 'LEK'
                  const eTotalLek = n(editDraft.amount) * (eIsLek ? 1 : n(editDraft.exchange_rate))
                  const eTotalEur = eCur === 'EUR' ? n(editDraft.amount) : lekToEur(eTotalLek)
                  return (
                    <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800 bg-amber-50/40">
                      {showDateCol && (
                        <td className="px-2 py-1">
                          <input type="date" value={editDraft.date || ''}
                            onChange={e => setEditDraft(d => ({ ...d, date: e.target.value }))}
                            className="input-field-sm" />
                        </td>
                      )}
                      <td className="px-2 py-1">
                        <div className="inline-flex rounded border border-slate-200 dark:border-slate-700 overflow-hidden text-[10px] mb-1">
                          <button
                            type="button"
                            onClick={() => setEditDraft(d => ({ ...d, mode: 'invoice' }))}
                            className={`px-2 py-0.5 font-semibold ${editDraft.mode !== 'no-invoice' ? 'bg-blue-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-500'}`}
                          >Me faturë</button>
                          <button
                            type="button"
                            onClick={() => setEditDraft(d => ({ ...d, mode: 'no-invoice', purchase_invoice_id: '' }))}
                            className={`px-2 py-0.5 font-semibold ${editDraft.mode === 'no-invoice' ? 'bg-blue-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-500'}`}
                          >Pa faturë</button>
                        </div>
                        {editDraft.mode !== 'no-invoice' ? (
                          <PurchaseInvoicePicker
                            value={editDraft.purchase_invoice_id}
                            onChange={v => setEditDraft(d => ({ ...d, purchase_invoice_id: v }))}
                            invoices={invoices}
                            excludeId={r.purchase_invoice_id}
                          />
                        ) : (
                          <div className="input-field-sm bg-slate-50 dark:bg-slate-900 text-slate-400 italic text-[11px] cursor-not-allowed">— pa faturë —</div>
                        )}
                      </td>
                      <td className="px-2 py-1">
                        <input type="text" value={editDraft.description}
                          onChange={e => setEditDraft(d => ({ ...d, description: e.target.value }))}
                          className="input-field-sm"
                          placeholder={editDraft.mode === 'no-invoice' ? 'përshkrim (i domosdoshëm)' : 'opsional'} />
                      </td>
                      <td className="px-2 py-1">
                        <select value={eCur}
                          onChange={e => {
                            const newCur = e.target.value
                            setEditDraft(d => {
                              if (newCur === 'LEK') return { ...d, currency: newCur, exchange_rate: '1' }
                              const autoRate = rates[newCur]
                              return { ...d, currency: newCur, exchange_rate: autoRate ? String(autoRate) : d.exchange_rate }
                            })
                          }}
                          className="input-field-sm">
                          {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-1">
                        <MoneyInput value={editDraft.amount}
                          onChange={v => setEditDraft(d => ({ ...d, amount: String(v) }))}
                          className="input-field-sm text-right tabular-nums" />
                      </td>
                      <td className="px-2 py-1">
                        <input type="number" step="0.0001" min="0"
                          value={eIsLek ? 1 : editDraft.exchange_rate}
                          disabled={eIsLek}
                          onChange={e => setEditDraft(d => ({ ...d, exchange_rate: e.target.value }))}
                          className="input-field-sm text-right tabular-nums disabled:bg-slate-100 disabled:text-slate-400" />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-blue-700 dark:text-blue-300 bg-blue-50/40">
                        {fmt(eTotalEur)}
                      </td>
                      <td className="px-2 py-1 text-center whitespace-nowrap">
                        <button onClick={saveEdit} className="px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-900/30 hover:bg-emerald-100 text-emerald-700 dark:text-emerald-300 text-xs font-medium mr-1" title="Ruaj">✓</button>
                        <button onClick={cancelEdit} className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-600 dark:text-slate-300 text-xs font-medium" title="Anulo">✕</button>
                      </td>
                    </tr>
                  )
                }
                const cur = r.currency || 'LEK'
                const isLek = cur === 'LEK'
                const totalEur = rowTotalEur(r)
                return (
                  <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    {showDateCol && (
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-300 text-xs font-mono">{fmtDate(r.date)}</td>
                    )}
                    <td className="px-3 py-2 text-slate-800 dark:text-slate-100">
                      {r.purchase_invoice_id ? (
                        <>
                          <div className="font-semibold">{r.purchase_invoice_no || <span className="italic text-slate-400">(pa nr)</span>}</div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {r.purchase_supplier_name || <span className="italic">— pa furnitor —</span>}
                            {r.purchase_invoice_date && <span className="ml-1">· {fmtDate(r.purchase_invoice_date)}</span>}
                          </div>
                        </>
                      ) : (
                        <span className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300">— pa faturë —</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                      {r.description || <span className="italic text-slate-400 dark:text-slate-500">—</span>}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className="badge bg-blue-100 text-blue-700 dark:text-blue-300">{cur}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-800 dark:text-slate-100 font-semibold">
                      {fmt(r.amount)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">
                      {isLek ? '1' : fmt(r.exchange_rate)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-blue-700 dark:text-blue-300 bg-blue-50/40">
                      {fmt(totalEur)}
                    </td>
                    <td className="px-2 py-1 text-center whitespace-nowrap">
                      <button onClick={() => startEdit(r)}
                        className="px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 text-blue-700 dark:text-blue-300 text-xs font-medium mr-1"
                        title="Edito">✏️</button>
                      <button onClick={() => removeEntry(r.id)}
                        className="px-2 py-0.5 rounded bg-red-50 dark:bg-red-900/30 hover:bg-red-100 text-red-600 text-xs font-medium"
                        title="Fshi">✕</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="bg-blue-50 dark:bg-blue-900/30 border-t-2 border-blue-200">
              <tr className="font-bold text-xs">
                <td colSpan={showDateCol ? 4 : 3} className="px-3 py-2 text-right text-slate-700 dark:text-slate-200 uppercase">TOTALI:</td>
                <td colSpan={2} className="px-3 py-2 text-right text-slate-600 dark:text-slate-300 text-[11px]">
                  {totalsList.length === 0
                    ? '—'
                    : totalsList.map(([c, v]) => `${fmt(v)} ${c}`).join(' · ')}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-blue-900 text-sm bg-blue-100/60">
                  {fmt(totals.total_eur)} EUR
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  )
}
