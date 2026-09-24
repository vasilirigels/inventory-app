import { useState, useEffect, useRef } from 'react'
import { showConfirm } from './ConfirmDialog.jsx'
import { getUser } from '../lib/auth.js'

// Rregullat e zbritjes (tarifës) sipas ditëve nga shitja:
//   0 ditë (të njëjtën ditë) → 0%
//   1–10 ditë               → 10%
//   11–30 ditë              → 25%
//   > 30 ditë               → 40%
function computeReturnTier(days) {
  if (days <= 0)  return { pct: 0,  label: 'Brenda ditës' }
  if (days <= 10) return { pct: 10, label: '1–10 ditë' }
  if (days <= 30) return { pct: 25, label: '11–30 ditë' }
  return              { pct: 40, label: 'Mbi 30 ditë' }
}

function fmt(n) {
  const v = Number(n) || 0
  return v.toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function KthimShitje() {
  const isAdmin = getUser()?.role === 'admin'
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState(null) // item nga results
  const [qty, setQty] = useState(1)
  const [feePctOverride, setFeePctOverride] = useState(null) // null = tier default
  const [unitPriceOverride, setUnitPriceOverride] = useState(null) // null = çmimi i faturës
  const [refundMethod, setRefundMethod] = useState('cash')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(null)
  // Admin-only: në modin "shumë direkte" hiqet krejt tarifa % dhe admini vendos
  // shumën e rimbursimit drejtpërsëdrejti (default = totali i rreshtit).
  const [adminManualMode, setAdminManualMode] = useState(false)
  const [manualRefund, setManualRefund] = useState(null) // null = auto = lineTotal
  const timerRef = useRef()

  // Debounced search
  useEffect(() => {
    if (!q.trim()) { setResults([]); return }
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/sales/items/search?q=${encodeURIComponent(q.trim())}&limit=30`)
        if (res.ok) setResults(await res.json())
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(timerRef.current)
  }, [q])

  const selectItem = (it) => {
    setSelected(it)
    setQty(Math.min(1, it.qty_remaining))
    setFeePctOverride(null)
    setUnitPriceOverride(null)
    setManualRefund(null)
    setError('')
    setSuccess(null)
  }

  const clearSelection = () => {
    setSelected(null)
    setQty(1)
    setFeePctOverride(null)
    setUnitPriceOverride(null)
    setManualRefund(null)
    setError('')
  }

  // Llogaritjet e refund-it
  const tier = selected ? computeReturnTier(selected.days_since_sale) : null
  const useManual = isAdmin && adminManualMode
  const effectivePct = useManual ? 0 : (feePctOverride != null ? feePctOverride : (tier?.pct ?? 0))
  const effectiveUnitPrice = unitPriceOverride != null
    ? unitPriceOverride
    : (selected?.unit_total_with_vat || 0)
  const lineTotal = selected ? +(effectiveUnitPrice * qty).toFixed(2) : 0
  const feeKept   = useManual ? 0 : +(lineTotal * (effectivePct / 100)).toFixed(2)
  // Në modin admin manual, shuma e rimbursimit vendoset direkt (default = lineTotal).
  const rawRefund = useManual
    ? (manualRefund != null ? manualRefund : lineTotal)
    : +(lineTotal - feeKept).toFixed(2)
  // Serveri e klampon refund_amount te totali i rreshtit të faturës origjinale
  // (retTotal). Nëse user rrit çmimin mbi atë të faturës, rimbursimi mund të
  // tejkalojë atë kufi — e klampojmë edhe në UI që të mos ketë keqkuptim.
  const invoiceLineTotal = selected ? +((selected.unit_total_with_vat || 0) * qty).toFixed(2) : 0
  const refundClamped = rawRefund > invoiceLineTotal
  const refund = Math.min(rawRefund, invoiceLineTotal)

  const qtyValid = selected && qty > 0 && qty <= selected.qty_remaining + 1e-6
  const pctValid = useManual ? true : (effectivePct >= 0 && effectivePct <= 100)
  const manualValid = !useManual || (refund >= 0)

  const submit = async () => {
    if (!selected || !qtyValid || !pctValid || !manualValid) return
    const feeLine = useManual
      ? `Shumë manuale (admin) — pa tarifë`
      : `Zbritje ${effectivePct}% = ${fmt(feeKept)} (${tier?.label})`
    const ok = await showConfirm(
      `Fatura ${selected.invoice_no} — ${selected.name}\n` +
      `Sasi: ${qty} × ${fmt(effectiveUnitPrice)} = ${fmt(lineTotal)} ${selected.currency || 'LEK'}\n` +
      `${feeLine}\n` +
      `Rimbursim: ${fmt(refund)} ${selected.currency || 'LEK'} — ${refundMethod.toUpperCase()}`,
      { title: 'Konfirmo kthimin', confirmLabel: 'Po, kthej' },
    )
    if (!ok) return
    setSaving(true); setError('')
    try {
      const res = await fetch(`/api/invoices/${selected.invoice_id}/credit-note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{ item_id: selected.item_id, qty }],
          refund_amount: refund,
          refund_method: refundMethod,
          notes: notes.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Gabim gjatë kthimit')
      setSuccess({
        invoice_no: data.invoice_no,
        product: selected.name,
        qty,
        refund,
        feeKept,
      })
      // rifresko rezultatet për të reflektuar qty_remaining të re
      if (q.trim()) {
        const r = await fetch(`/api/sales/items/search?q=${encodeURIComponent(q.trim())}&limit=30`)
        if (r.ok) setResults(await r.json())
      }
      clearSelection()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow p-4">
        <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-1">
          🔄 Kthim Produkt (Shitje)
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Kërko produktin me <b>barkod</b> ose <b>emër</b>, zgjidh rreshtin nga fatura e shitjes, dhe kryeje kthimin.
        </p>
        <div className="mt-3 text-xs text-slate-500 dark:text-slate-400 grid grid-cols-2 md:grid-cols-4 gap-1">
          <div>📅 Brenda ditës → <b>0%</b></div>
          <div>📅 1–10 ditë → <b>10%</b></div>
          <div>📅 11–30 ditë → <b>25%</b></div>
          <div>📅 Mbi 30 ditë → <b>40%</b></div>
        </div>
      </div>

      {success && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
          <p className="text-green-800 dark:text-green-200 font-semibold">
            ✅ Kthimi u regjistrua — kreditore <span className="font-mono">{success.invoice_no}</span>
          </p>
          <p className="text-sm text-green-700 dark:text-green-300 mt-1">
            {success.product} × {success.qty} — u rimbursuan <b>{fmt(success.refund)}</b>
            {success.feeKept > 0 ? <> (tarifë e mbajtur: <b>{fmt(success.feeKept)}</b>)</> : null}
          </p>
        </div>
      )}

      {isAdmin && <ReturnsHistory />}

      {/* Kutia e kërkimit */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow p-4">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">🔍</span>
          <input
            type="text"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Skano barkodin ose shkruaj emrin e produktit..."
            className="input-field pl-9 w-full"
            autoFocus
          />
        </div>
        {searching && <p className="text-xs text-slate-500 mt-2">Duke kërkuar…</p>}
        {!searching && q.trim() && results.length === 0 && (
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-3">
            Asnjë rresht i vlefshëm nuk u gjet për <b>{q}</b>.
          </p>
        )}
      </div>

      {/* Lista e rezultateve */}
      {results.length > 0 && !selected && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow overflow-hidden">
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 dark:bg-slate-700 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold">Data</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold">Fatura</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold">Klienti</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold">Barkod</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold">Produkt</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold">Sasia (mbetur)</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold">Çmim/copë</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold">Ditë</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {results.map(it => {
                  const t = computeReturnTier(it.days_since_sale)
                  return (
                    <tr key={it.item_id} className="border-t border-slate-100 dark:border-slate-700 hover:bg-amber-50 dark:hover:bg-amber-900/10">
                      <td className="px-3 py-1.5">{it.invoice_date}</td>
                      <td className="px-3 py-1.5 font-mono text-xs">{it.invoice_no}</td>
                      <td className="px-3 py-1.5 truncate max-w-[10rem]">{it.customer_name || '—'}</td>
                      <td className="px-3 py-1.5 font-mono text-xs">{it.barcode || '—'}</td>
                      <td className="px-3 py-1.5 truncate max-w-[16rem]">{it.name}</td>
                      <td className="px-3 py-1.5 text-right">
                        <span className="font-semibold">{it.qty_remaining}</span>
                        <span className="text-slate-400 text-xs"> / {it.qty_original}</span>
                      </td>
                      <td className="px-3 py-1.5 text-right">{fmt(it.unit_total_with_vat)}</td>
                      <td className="px-3 py-1.5 text-right">
                        <span className="text-slate-700 dark:text-slate-200">{it.days_since_sale}</span>
                        <span className="ml-1 text-xs text-amber-700 dark:text-amber-400">({t.pct}%)</span>
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <button
                          onClick={() => selectItem(it)}
                          className="px-3 py-1 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold"
                        >
                          Zgjidh
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Forma e kthimit */}
      {selected && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow p-4 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-lg font-bold text-slate-800 dark:text-slate-100">{selected.name}</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Fatura <span className="font-mono">{selected.invoice_no}</span> · {selected.invoice_date}
                {selected.customer_name && <> · {selected.customer_name}</>}
                {selected.barcode && <> · Barkod: <span className="font-mono">{selected.barcode}</span></>}
              </p>
            </div>
            <button
              onClick={clearSelection}
              className="text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
            >
              ← Kthehu te lista
            </button>
          </div>

          {isAdmin && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2">
              <input
                id="admin-manual-mode"
                type="checkbox"
                checked={adminManualMode}
                onChange={e => { setAdminManualMode(e.target.checked); setManualRefund(null) }}
                className="accent-amber-600"
              />
              <label htmlFor="admin-manual-mode" className="text-sm text-amber-900 dark:text-amber-100 cursor-pointer select-none">
                🔓 <b>Admin:</b> hiq tarifën % dhe përcakto shumën e rimbursimit direkt
              </label>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                Sasi (max {selected.qty_remaining})
              </label>
              <input
                type="number"
                min={0}
                max={selected.qty_remaining}
                step="any"
                value={qty}
                onChange={e => setQty(parseFloat(e.target.value) || 0)}
                className="input-field w-full"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                Çmim/copë (i shitur)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={effectiveUnitPrice}
                  onChange={e => setUnitPriceOverride(parseFloat(e.target.value) || 0)}
                  className="input-field w-full"
                />
                {unitPriceOverride != null && unitPriceOverride !== selected.unit_total_with_vat && (
                  <button
                    onClick={() => setUnitPriceOverride(null)}
                    title="Kthehu te çmimi i faturës"
                    className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                  >
                    ↺
                  </button>
                )}
              </div>
              {unitPriceOverride != null && unitPriceOverride !== selected.unit_total_with_vat && (
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                  Fatura: {fmt(selected.unit_total_with_vat)}
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                Ditë nga shitja
              </label>
              <div className="input-field w-full bg-slate-50 dark:bg-slate-900/40 flex items-center">
                <span className="font-semibold">{selected.days_since_sale}</span>
                <span className="ml-2 text-xs text-slate-500">({tier?.label})</span>
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                {useManual ? 'Shuma e Rimbursimit (admin)' : 'Zbritje % (tarifa e dyqanit)'}
              </label>
              {useManual ? (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={manualRefund != null ? manualRefund : lineTotal}
                    onChange={e => setManualRefund(parseFloat(e.target.value) || 0)}
                    className="input-field w-full font-bold"
                  />
                  {manualRefund != null && manualRefund !== lineTotal && (
                    <button
                      onClick={() => setManualRefund(null)}
                      title="Kthehu te shuma totale (100%)"
                      className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                    >
                      ↺
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step="1"
                      value={effectivePct}
                      onChange={e => setFeePctOverride(parseFloat(e.target.value) || 0)}
                      className="input-field w-full"
                    />
                    {feePctOverride != null && feePctOverride !== tier.pct && (
                      <button
                        onClick={() => setFeePctOverride(null)}
                        title="Kthehu te tier-i default"
                        className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                      >
                        ↺
                      </button>
                    )}
                  </div>
                  {feePctOverride != null && feePctOverride !== tier.pct && (
                    <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                      Override manual (default: {tier.pct}%)
                    </p>
                  )}
                </>
              )}
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                Metoda e rimbursimit
              </label>
              <select
                value={refundMethod}
                onChange={e => setRefundMethod(e.target.value)}
                className="input-field w-full"
              >
                <option value="cash">💵 Cash</option>
                <option value="bank">🏦 Bankë</option>
                <option value="pos">💳 POS</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
              Shënime (opsionale)
            </label>
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="P.sh. Defekt fabrike, nuk i përshtatet, etj."
              className="input-field w-full"
            />
          </div>

          {/* Përmbledhje llogaritjeje */}
          <div className="bg-slate-50 dark:bg-slate-900/40 rounded-lg p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
            <SummaryLine label="Vlera e artikujve" value={`${fmt(lineTotal)} ${selected.currency || 'LEK'}`} />
            {useManual ? (
              <SummaryLine label="Tarifa" value="— (admin, pa %)" />
            ) : (
              <SummaryLine label={`Tarifa (${effectivePct}%)`} value={`− ${fmt(feeKept)} ${selected.currency || 'LEK'}`} tone="red" />
            )}
            <SummaryLine label="Rimbursim për klientin" value={`${fmt(refund)} ${selected.currency || 'LEK'}`} tone="green" big />
          </div>

          {refundClamped && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-sm text-amber-800 dark:text-amber-200">
              ⚠️ Rimbursimi u limitua në {fmt(invoiceLineTotal)} {selected.currency || 'LEK'} —
              totali i rreshtit të faturës origjinale. Për t'i kthyer një shumë më të madhe,
              duhet të ndryshohet fatura origjinale.
            </div>
          )}

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              onClick={clearSelection}
              disabled={saving}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              Anulo
            </button>
            <button
              onClick={submit}
              disabled={saving || !qtyValid || !pctValid || !manualValid || refund < 0}
              className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold"
            >
              {saving ? 'Duke ruajtur…' : `💾 Kryej Kthimin (${fmt(refund)})`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Admin: Historia e Kthimeve (kreditoreve) ──────────────────────────────
// Seksion i mbylleshëm që lejon admin-in të shohë kthimet e bëra, të ndryshojë
// datën e një kthimi (kur është regjistruar në datë të gabuar) ose ta fshijë
// që të ripërsëritet.
function ReturnsHistory() {
  const todayIso = () => new Date().toISOString().slice(0, 10)
  const monthAgoIso = () => {
    const d = new Date(); d.setMonth(d.getMonth() - 1)
    return d.toISOString().slice(0, 10)
  }

  const [open, setOpen]     = useState(false)
  const [from, setFrom]     = useState(monthAgoIso())
  const [to, setTo]         = useState(todayIso())
  const [q, setQ]           = useState('')
  const [rows, setRows]     = useState([])
  const [loading, setLoad]  = useState(false)
  const [busyId, setBusy]   = useState(null)
  const [editDate, setEditDate] = useState(null) // { id, currentDate, newDate }
  const [msg, setMsg]       = useState('')

  const load = async () => {
    setLoad(true)
    try {
      const p = new URLSearchParams()
      if (from) p.set('from', from)
      if (to)   p.set('to', to)
      if (q.trim()) p.set('q', q.trim())
      p.set('limit', '200')
      const res = await fetch(`/api/credit-notes?${p}`)
      const data = await res.json()
      setRows(Array.isArray(data) ? data : [])
    } catch (_) { setRows([]) }
    finally { setLoad(false) }
  }

  useEffect(() => { if (open) load() /* eslint-disable-next-line */ }, [open, from, to])

  const doChangeDate = async () => {
    if (!editDate) return
    if (!/^\d{4}-\d{2}-\d{2}$/.test(editDate.newDate)) {
      setMsg('Formati i datës: YYYY-MM-DD'); return
    }
    setBusy(editDate.id); setMsg('')
    try {
      const res = await fetch(`/api/invoices/${editDate.id}/date`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: editDate.newDate }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Gabim')
      setMsg(`✓ Data u ndryshua: ${data.old_date || '?'} → ${data.new_date || editDate.newDate}`)
      setEditDate(null)
      load()
    } catch (ex) {
      setMsg(`Gabim: ${ex.message}`)
    } finally { setBusy(null) }
  }

  const doDelete = async (r) => {
    const ok = await showConfirm(
      `Kreditore ${r.invoice_no} nga ${r.date}\n` +
      `Klient: ${r.customer_name || '—'}\n` +
      `Total i kthyer: ${fmt(Math.abs(r.total_with_vat))} ${r.currency || 'LEK'}\n\n` +
      `Fshirja e këtij kthimi do të:\n` +
      `• zbresë artikujt përsëri nga stoku\n` +
      `• rikthejë rimbursimin te bilancet (arka/bankë)\n` +
      `• fshijë kreditoren përgjithmonë\n\n` +
      `Pas kësaj mund të ripërsërisësh kthimin me datën e saktë.`,
      { title: 'Fshi këtë kthim?', confirmLabel: 'Po, fshi', danger: true },
    )
    if (!ok) return
    setBusy(r.id); setMsg('')
    try {
      const res = await fetch(`/api/invoices/${r.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Gabim')
      }
      setMsg(`✓ Kreditore ${r.invoice_no} u fshi`)
      load()
    } catch (ex) {
      setMsg(`Gabim: ${ex.message}`)
    } finally { setBusy(null) }
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/60 text-left"
      >
        <div>
          <div className="text-sm font-bold text-slate-800 dark:text-slate-100">
            📋 Historia e Kthimeve <span className="text-[10px] font-normal text-amber-700 dark:text-amber-300 uppercase ml-1">Admin</span>
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Shiko, ndrysho datën, ose fshi kthime të bëra më parë
          </div>
        </div>
        <span className="text-slate-400 text-lg">{open ? '▼' : '▶'}</span>
      </button>

      {open && (
        <div className="border-t border-slate-100 dark:border-slate-800 p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase mb-1">Nga</label>
              <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="input-field" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase mb-1">Deri</label>
              <input type="date" value={to} onChange={e => setTo(e.target.value)} className="input-field" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase mb-1">Kërko</label>
              <div className="flex gap-2">
                <input type="text" value={q} onChange={e => setQ(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') load() }}
                  placeholder="Nr. kreditore, klient, ose nr. fature origjinale"
                  className="input-field flex-1" />
                <button onClick={load} className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-sm font-semibold">Kërko</button>
              </div>
            </div>
          </div>

          {msg && (
            <div className={`text-xs px-3 py-2 rounded-lg ${msg.startsWith('✓') ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'}`}>
              {msg}
            </div>
          )}

          {loading ? (
            <p className="text-center text-slate-400 text-sm py-6">Duke ngarkuar…</p>
          ) : rows.length === 0 ? (
            <p className="text-center text-slate-400 text-sm py-6">Asnjë kthim s'u gjet për këtë filtër.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900">
                  <tr>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase">Data</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase">Kreditore</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase">Origjinali</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase">Klienti</th>
                    <th className="px-3 py-2 text-right text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase">Copë</th>
                    <th className="px-3 py-2 text-right text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase">Rimbursim</th>
                    <th className="px-3 py-2 text-center text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase">Metoda</th>
                    <th className="px-3 py-2 text-center text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase">Veprime</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => {
                    const isEditing = editDate?.id === r.id
                    const busy = busyId === r.id
                    const refundAbs = Math.abs(r.amount_paid || r.total_with_vat || 0)
                    return (
                      <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/30">
                        <td className="px-3 py-2 text-xs whitespace-nowrap">
                          {isEditing ? (
                            <input type="date" value={editDate.newDate}
                              onChange={e => setEditDate({ ...editDate, newDate: e.target.value })}
                              className="input-field !py-1 !text-xs" />
                          ) : (
                            <span className="text-slate-700 dark:text-slate-200">{r.date}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs whitespace-nowrap font-semibold text-slate-800 dark:text-slate-100">
                          {r.invoice_no}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs whitespace-nowrap text-slate-600 dark:text-slate-400">
                          {r.parent_invoice_no || '—'}
                          {r.parent_invoice_date && (
                            <div className="text-[10px] text-slate-400">{r.parent_invoice_date}</div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-700 dark:text-slate-200 max-w-[10rem] truncate">
                          {r.customer_name || <span className="italic text-slate-400">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-xs text-slate-700 dark:text-slate-200">
                          {r.qty_total}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-xs font-bold text-green-700 dark:text-green-400 whitespace-nowrap">
                          {fmt(refundAbs)} {r.currency || 'LEK'}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className="badge bg-slate-100 dark:bg-slate-800 text-[10px] uppercase">
                            {r.payment_method || '—'}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-center gap-1 flex-wrap">
                            {isEditing ? (
                              <>
                                <button
                                  onClick={doChangeDate}
                                  disabled={busy || editDate.newDate === r.date}
                                  className="px-2 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white text-[10px] font-semibold"
                                >{busy ? '…' : '✓ Ruaj'}</button>
                                <button
                                  onClick={() => setEditDate(null)}
                                  className="px-2 py-1 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-[10px] font-semibold"
                                >Anulo</button>
                              </>
                            ) : (
                              <>
                                <button
                                  onClick={() => setEditDate({ id: r.id, newDate: r.date })}
                                  disabled={busy}
                                  className="px-2 py-1 rounded-lg bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 text-blue-700 dark:text-blue-300 text-[10px] font-semibold"
                                  title="Ndrysho datën e këtij kthimi"
                                >📅 Datën</button>
                                <button
                                  onClick={() => doDelete(r)}
                                  disabled={busy}
                                  className="px-2 py-1 rounded-lg bg-red-50 dark:bg-red-900/30 hover:bg-red-100 text-red-600 text-[10px] font-semibold"
                                  title="Fshi kthimin (rikthen stokun + rimbursimin)"
                                >🗑️ Fshi</button>
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
        </div>
      )}
    </div>
  )
}

function SummaryLine({ label, value, tone = 'slate', big = false }) {
  const toneClass =
    tone === 'green' ? 'text-green-700 dark:text-green-400' :
    tone === 'red'   ? 'text-red-700 dark:text-red-400' :
                       'text-slate-700 dark:text-slate-200'
  return (
    <div>
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`${big ? 'text-2xl' : 'text-lg'} font-bold ${toneClass}`}>{value}</div>
    </div>
  )
}
