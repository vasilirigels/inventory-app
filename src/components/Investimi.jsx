import { useEffect, useState } from 'react'
import { showConfirm } from './ConfirmDialog.jsx'

function n(v) { return parseFloat(v) || 0 }
function fmt(v) {
  return n(v).toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function today() { return new Date().toISOString().slice(0, 10) }

export default function Investimi() {
  const [data, setData]       = useState({ investments: [], debts: [], partners: {} })
  const [loading, setLoading] = useState(true)
  const [msg, setMsg]         = useState('')

  // Formular pagese borxhi
  const [payDebtId, setPayDebtId] = useState(null)
  const [payAmount, setPayAmount] = useState('')
  const [payDate, setPayDate]     = useState(today())
  const [payNote, setPayNote]     = useState('')
  const [paying, setPaying]       = useState(false)

  // Formular investim i ri
  const [showAddInv, setShowAddInv] = useState(false)
  const [invPartner, setInvPartner] = useState('Biba')
  const [invAmount, setInvAmount]   = useState('')
  const [invDate, setInvDate]       = useState(today())
  const [invNote, setInvNote]       = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const d = await fetch('/api/investimi').then(r => r.json())
      setData(d && typeof d === 'object' ? d : { investments: [], debts: [], partners: {} })
    } catch (e) { console.error(e) }
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const flash = (text) => { setMsg(text); setTimeout(() => setMsg(''), 2500) }

  const submitPayment = async (e) => {
    e.preventDefault()
    const amt = n(payAmount)
    if (amt <= 0) { flash('⚠ Vendos një shumë > 0'); return }
    if (!payDate)  { flash('⚠ Vendos datën'); return }
    setPaying(true)
    try {
      const r = await fetch('/api/investimi/debt-payments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ debt_id: payDebtId, amount_eur: amt, date: payDate, note: payNote }),
      })
      if (!r.ok) throw new Error((await r.json()).error || 'Gabim')
      setPayAmount(''); setPayNote(''); setPayDate(today()); setPayDebtId(null)
      flash('✓ Pagesa u regjistrua')
      await load()
    } catch (e) { flash('✗ ' + e.message) }
    setPaying(false)
  }

  const deletePayment = async (id) => {
    const ok = await showConfirm('Të fshihet kjo pagesë?', { confirmLabel: 'Fshi', danger: true })
    if (!ok) return
    try {
      const r = await fetch(`/api/investimi/debt-payments/${id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error((await r.json()).error || 'Gabim')
      flash('✓ Pagesa u fshi')
      await load()
    } catch (e) { flash('✗ ' + e.message) }
  }

  const submitInvestment = async (e) => {
    e.preventDefault()
    if (!invPartner.trim()) { flash('⚠ Vendos emrin e ortakut'); return }
    if (!invDate)           { flash('⚠ Vendos datën'); return }
    try {
      const r = await fetch('/api/investimi/investments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partner_name: invPartner.trim(), amount_eur: n(invAmount), date: invDate, note: invNote }),
      })
      if (!r.ok) throw new Error((await r.json()).error || 'Gabim')
      setInvAmount(''); setInvNote(''); setInvPartner('Biba'); setInvDate(today())
      setShowAddInv(false)
      flash('✓ Investimi u shtua')
      await load()
    } catch (e) { flash('✗ ' + e.message) }
  }

  const deleteInvestment = async (id) => {
    const ok = await showConfirm('Të fshihet ky zë investimi?', { confirmLabel: 'Fshi', danger: true })
    if (!ok) return
    try {
      const r = await fetch(`/api/investimi/investments/${id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error((await r.json()).error || 'Gabim')
      flash('✓ U fshi')
      await load()
    } catch (e) { flash('✗ ' + e.message) }
  }

  if (loading) {
    return <div className="p-8 text-center text-slate-400">Duke ngarkuar…</div>
  }

  const totalCapital = Object.values(data.partners).reduce((a, b) => a + (b || 0), 0)
  // Ortakëria llogaritet nga kontributi + borxhi (çfarë duhej të ishte paguar).
  // Diana ka kontribut 0 por detyrim 30k → kuota e saj llogaritet mbi 30k, jo mbi 0.
  const partnersWithShares = {}
  for (const p of Object.keys(data.partners)) partnersWithShares[p] = data.partners[p] || 0
  for (const d of data.debts) {
    partnersWithShares[d.debtor] = (partnersWithShares[d.debtor] || 0) + (d.initial_amount_eur || 0)
    partnersWithShares[d.creditor] = (partnersWithShares[d.creditor] || 0) - (d.initial_amount_eur || 0)
  }
  const totalEquity = Object.values(partnersWithShares).reduce((a, b) => a + (b || 0), 0)

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      {msg && (
        <div className="card bg-blue-50 dark:bg-blue-900/30 border-blue-200 text-sm text-slate-700 dark:text-slate-200">
          {msg}
        </div>
      )}

      {/* ── Blloku 1: Ortakëria ── */}
      <div className="card">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Ortakëria</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Kuota e secilit ortak = (kontribut i paguar në kapital) + (pjesë e financuar me borxh nga tjetri).
            </p>
          </div>
          <button
            onClick={() => setShowAddInv(v => !v)}
            className="btn-secondary text-xs"
          >{showAddInv ? '✕ Mbyll' : '+ Investim i Ri'}</button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {Object.entries(partnersWithShares).map(([name, equity]) => {
            const paid = data.partners[name] || 0
            const share = totalEquity > 0 ? (equity / totalEquity) * 100 : 0
            return (
              <div key={name} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{name}</span>
                  <span className="badge bg-indigo-100 text-indigo-700 dark:text-indigo-300">{share.toFixed(1)}%</span>
                </div>
                <div className="mt-2 text-2xl font-extrabold tabular-nums text-slate-800 dark:text-slate-100">
                  {fmt(equity)} <span className="text-sm font-medium text-slate-500">EUR</span>
                </div>
                <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  Kontribut i paguar: <span className="font-semibold">{fmt(paid)} EUR</span>
                </div>
              </div>
            )
          })}
        </div>

        <div className="mt-3 text-xs text-slate-500 dark:text-slate-400 border-t border-slate-100 dark:border-slate-800 pt-3 flex justify-between">
          <span>Kapital total i paguar në arkë:</span>
          <span className="font-bold tabular-nums text-slate-700 dark:text-slate-200">{fmt(totalCapital)} EUR</span>
        </div>

        {showAddInv && (
          <form onSubmit={submitInvestment} className="mt-4 border-t border-slate-100 dark:border-slate-800 pt-4 grid gap-2 sm:grid-cols-2">
            <label className="text-xs">
              <span className="block text-slate-500 mb-1">Ortaku</span>
              <input value={invPartner} onChange={e => setInvPartner(e.target.value)} className="input-field w-full" />
            </label>
            <label className="text-xs">
              <span className="block text-slate-500 mb-1">Shuma (EUR)</span>
              <input type="number" step="0.01" value={invAmount} onChange={e => setInvAmount(e.target.value)} className="input-field w-full tabular-nums text-right" />
            </label>
            <label className="text-xs">
              <span className="block text-slate-500 mb-1">Data</span>
              <input type="date" value={invDate} onChange={e => setInvDate(e.target.value)} className="input-field w-full" />
            </label>
            <label className="text-xs">
              <span className="block text-slate-500 mb-1">Shënim</span>
              <input value={invNote} onChange={e => setInvNote(e.target.value)} className="input-field w-full" />
            </label>
            <div className="sm:col-span-2 flex justify-end gap-2">
              <button type="button" onClick={() => setShowAddInv(false)} className="btn-secondary text-xs">Anulo</button>
              <button type="submit" className="btn-primary text-xs">💾 Ruaj</button>
            </div>
          </form>
        )}
      </div>

      {/* ── Blloku 2: Borxhet mes ortakëve ── */}
      {data.debts.map(debt => (
        <div key={debt.id} className="card">
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">
                Borxh: {debt.debtor} → {debt.creditor}
              </h3>
              {debt.reason && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{debt.reason}</p>}
            </div>
            {debt.remaining_eur > 0.005 && (
              <button
                onClick={() => { setPayDebtId(debt.id); setPayDate(today()) }}
                className="btn-primary text-xs"
              >+ Pagesë nga {debt.debtor}</button>
            )}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg bg-slate-50 dark:bg-slate-900/40 p-3">
              <div className="text-[11px] uppercase font-semibold text-slate-500 dark:text-slate-400">Fillestar</div>
              <div className="mt-1 text-xl font-bold tabular-nums text-slate-700 dark:text-slate-200">
                {fmt(debt.initial_amount_eur)} <span className="text-xs text-slate-500">EUR</span>
              </div>
            </div>
            <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/30 p-3">
              <div className="text-[11px] uppercase font-semibold text-emerald-700 dark:text-emerald-300">E shlyer</div>
              <div className="mt-1 text-xl font-bold tabular-nums text-emerald-700 dark:text-emerald-300">
                {fmt(debt.paid_eur)} <span className="text-xs">EUR</span>
              </div>
            </div>
            <div className={`rounded-lg p-3 ${debt.remaining_eur > 0.005 ? 'bg-rose-50 dark:bg-rose-900/30' : 'bg-emerald-50 dark:bg-emerald-900/30'}`}>
              <div className={`text-[11px] uppercase font-semibold ${debt.remaining_eur > 0.005 ? 'text-rose-700 dark:text-rose-300' : 'text-emerald-700 dark:text-emerald-300'}`}>Mbetet</div>
              <div className={`mt-1 text-xl font-bold tabular-nums ${debt.remaining_eur > 0.005 ? 'text-rose-700 dark:text-rose-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
                {debt.remaining_eur > 0.005 ? fmt(debt.remaining_eur) : '✓ Shlyer'} <span className="text-xs">{debt.remaining_eur > 0.005 ? 'EUR' : ''}</span>
              </div>
            </div>
          </div>

          {/* Formulari i pagesës për këtë borxh */}
          {payDebtId === debt.id && (
            <form onSubmit={submitPayment} className="mt-4 border-t border-slate-100 dark:border-slate-800 pt-4 grid gap-2 sm:grid-cols-2">
              <label className="text-xs">
                <span className="block text-slate-500 mb-1">Shuma (EUR)</span>
                <input type="number" step="0.01" min="0" value={payAmount} onChange={e => setPayAmount(e.target.value)} className="input-field w-full tabular-nums text-right" autoFocus />
              </label>
              <label className="text-xs">
                <span className="block text-slate-500 mb-1">Data</span>
                <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} className="input-field w-full" />
              </label>
              <label className="text-xs sm:col-span-2">
                <span className="block text-slate-500 mb-1">Shënim (opsional)</span>
                <input value={payNote} onChange={e => setPayNote(e.target.value)} className="input-field w-full" placeholder="p.sh. pjesë nga fitimi i tetorit" />
              </label>
              <div className="sm:col-span-2 flex justify-end gap-2">
                <button type="button" onClick={() => setPayDebtId(null)} className="btn-secondary text-xs">Anulo</button>
                <button type="submit" disabled={paying} className="btn-primary text-xs">
                  {paying ? 'Duke ruajtur…' : '💾 Ruaj Pagesën'}
                </button>
              </div>
            </form>
          )}

          {/* Historiku i pagesave */}
          {debt.payments.length > 0 && (
            <div className="mt-4">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
                Historik pagesash ({debt.payments.length})
              </h4>
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">Data</th>
                    <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-500">Shuma (EUR)</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">Shënim</th>
                    <th className="px-3 py-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {debt.payments.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).map(p => (
                    <tr key={p.id} className="border-b border-slate-100 dark:border-slate-800">
                      <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{p.date}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-emerald-700 dark:text-emerald-300">{fmt(p.amount_eur)}</td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-400 text-xs">{p.note || ''}</td>
                      <td className="px-3 py-2 text-right">
                        <button onClick={() => deletePayment(p.id)} className="text-rose-600 hover:text-rose-800 text-xs" title="Fshi">🗑</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}

      {/* ── Blloku 3: Historik i investimeve ── */}
      {data.investments.length > 0 && (
        <div className="card">
          <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Historik Investimesh</h3>
          <table className="w-full text-sm mt-3">
            <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">Data</th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">Ortaku</th>
                <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-500">Shuma (EUR)</th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">Shënim</th>
                <th className="px-3 py-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {data.investments.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).map(inv => (
                <tr key={inv.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{inv.date}</td>
                  <td className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">{inv.partner_name}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-800 dark:text-slate-100">{fmt(inv.amount_eur)}</td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-400 text-xs">{inv.note || ''}</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => deleteInvestment(inv.id)} className="text-rose-600 hover:text-rose-800 text-xs" title="Fshi">🗑</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
