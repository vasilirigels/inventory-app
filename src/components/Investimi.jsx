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

  // Filter periudhe për historikun & përmbledhjen cash/bank
  const [periodFrom, setPeriodFrom] = useState('')
  const [periodTo, setPeriodTo]     = useState('')

  // Formular pagese konsoliduese: identifikohet nga çifti debtor→creditor,
  // jo nga një debt_id i vetëm — pagesa shpërndahet FIFO në borxhet aktive.
  const [payKey, setPayKey]       = useState(null) // "debtor||creditor"
  const [payAmount, setPayAmount] = useState('')
  const [payDate, setPayDate]     = useState(today())
  const [payNote, setPayNote]     = useState('')
  const [payMethod, setPayMethod] = useState('cash')
  const [paying, setPaying]       = useState(false)
  // Zgjeroni/palosni listën e borxheve individuale brenda një karte konsoliduese
  const [expandedPair, setExpandedPair] = useState(null)

  // Formular investim i ri
  const [showAddInv, setShowAddInv] = useState(false)
  const [invPartner, setInvPartner] = useState('Biba')
  const [invAmount, setInvAmount]   = useState('')
  const [invDate, setInvDate]       = useState(today())
  const [invNote, setInvNote]       = useState('')
  const [invMethod, setInvMethod]   = useState('cash')

  // Formular borxh i ri (p.sh. kur Diana merr shtese nga kapitali i Bibes)
  const [showAddDebt, setShowAddDebt] = useState(false)
  const [debtDebtor, setDebtDebtor]     = useState('Diana')
  const [debtCreditor, setDebtCreditor] = useState('Biba')
  const [debtAmount, setDebtAmount]     = useState('')
  const [debtReason, setDebtReason]     = useState('')
  const [debtDate, setDebtDate]         = useState(today())

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
    if (!payKey)   { flash('⚠ Zgjidh borxhin'); return }
    const [debtor, creditor] = payKey.split('||')
    setPaying(true)
    try {
      const r = await fetch('/api/investimi/debt-payments/consolidated', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ debtor, creditor, amount_eur: amt, date: payDate, note: payNote, payment_method: payMethod }),
      })
      if (!r.ok) throw new Error((await r.json()).error || 'Gabim')
      const resp = await r.json().catch(() => ({}))
      setPayAmount(''); setPayNote(''); setPayDate(today()); setPayKey(null); setPayMethod('cash')
      const nPays = resp?.payments?.length || 0
      flash(`✓ Pagesa u regjistrua${nPays > 1 ? ` (u shpërnda në ${nPays} borxhe)` : ''}`)
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
        body: JSON.stringify({ partner_name: invPartner.trim(), amount_eur: n(invAmount), date: invDate, note: invNote, payment_method: invMethod }),
      })
      if (!r.ok) throw new Error((await r.json()).error || 'Gabim')
      const resp = await r.json().catch(() => ({}))
      setInvAmount(''); setInvNote(''); setInvPartner('Biba'); setInvDate(today()); setInvMethod('cash')
      setShowAddInv(false)
      if (resp?.debt_auto_created) {
        flash(`✓ Investimi u shtua · Borxhi i Dianës u rrit automatikisht me ${fmt(resp.debt_auto_created.amount_eur)} EUR (30%)`)
      } else {
        flash('✓ Investimi u shtua')
      }
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

  const submitDebt = async (e) => {
    e.preventDefault()
    if (!debtDebtor.trim() || !debtCreditor.trim()) { flash('⚠ Vendos emrat (debtor + creditor)'); return }
    if (debtDebtor.trim() === debtCreditor.trim())  { flash('⚠ Debtor dhe creditor duhen te ndryshem'); return }
    if (n(debtAmount) <= 0) { flash('⚠ Vendos shume > 0'); return }
    if (!debtDate)          { flash('⚠ Vendos datën'); return }
    try {
      const r = await fetch('/api/investimi/debts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          debtor: debtDebtor.trim(),
          creditor: debtCreditor.trim(),
          initial_amount_eur: n(debtAmount),
          reason: debtReason,
          date: debtDate,
        }),
      })
      if (!r.ok) throw new Error((await r.json()).error || 'Gabim')
      setDebtAmount(''); setDebtReason(''); setDebtDate(today())
      setDebtDebtor('Diana'); setDebtCreditor('Biba')
      setShowAddDebt(false)
      flash('✓ Borxhi u shtua')
      await load()
    } catch (e) { flash('✗ ' + e.message) }
  }

  const deleteDebt = async (debt) => {
    const paid = (debt.paid_eur || 0) > 0.005
    const warn = paid
      ? `Ky borxh ka ${fmt(debt.paid_eur)} EUR pagesa të regjistruara. Fshirja do heqë edhe pagesat. Vazhdon?`
      : 'Të fshihet ky borxh?'
    const ok = await showConfirm(warn, { confirmLabel: 'Fshi', danger: true })
    if (!ok) return
    try {
      const r = await fetch(`/api/investimi/debts/${debt.id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error((await r.json()).error || 'Gabim')
      flash('✓ Borxhi u fshi')
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
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => { setShowAddInv(v => !v); setShowAddDebt(false) }}
              className="btn-secondary text-xs"
            >{showAddInv ? '✕ Mbyll' : '+ Investim i Ri'}</button>
            <button
              onClick={() => { setShowAddDebt(v => !v); setShowAddInv(false) }}
              className="btn-secondary text-xs"
            >{showAddDebt ? '✕ Mbyll' : '+ Borxh i Ri'}</button>
          </div>
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
            {invPartner.trim().toLowerCase() === 'biba' && n(invAmount) > 0 && (
              <div className="sm:col-span-2 text-xs text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-800 rounded-md px-2 py-1.5">
                ℹ️ Automatikisht do krijohet borxh Diana→Biba me <strong>{fmt(n(invAmount) * 0.30)} EUR</strong> (30% e investimit).
              </div>
            )}
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
              <span className="block text-slate-500 mb-1">Mënyra</span>
              <select value={invMethod} onChange={e => setInvMethod(e.target.value)} className="input-field w-full">
                <option value="cash">💵 Cash</option>
                <option value="bank">🏦 Bankë</option>
              </select>
            </label>
            <label className="text-xs sm:col-span-2">
              <span className="block text-slate-500 mb-1">Shënim</span>
              <input value={invNote} onChange={e => setInvNote(e.target.value)} className="input-field w-full" />
            </label>
            <div className="sm:col-span-2 flex justify-end gap-2">
              <button type="button" onClick={() => setShowAddInv(false)} className="btn-secondary text-xs">Anulo</button>
              <button type="submit" className="btn-primary text-xs">💾 Ruaj</button>
            </div>
          </form>
        )}

        {showAddDebt && (
          <form onSubmit={submitDebt} className="mt-4 border-t border-slate-100 dark:border-slate-800 pt-4 grid gap-2 sm:grid-cols-2">
            <label className="text-xs">
              <span className="block text-slate-500 mb-1">Debtor (merr borxh)</span>
              <input value={debtDebtor} onChange={e => setDebtDebtor(e.target.value)} className="input-field w-full" />
            </label>
            <label className="text-xs">
              <span className="block text-slate-500 mb-1">Creditor (jep borxh)</span>
              <input value={debtCreditor} onChange={e => setDebtCreditor(e.target.value)} className="input-field w-full" />
            </label>
            <label className="text-xs">
              <span className="block text-slate-500 mb-1">Shuma (EUR)</span>
              <input type="number" step="0.01" value={debtAmount} onChange={e => setDebtAmount(e.target.value)} className="input-field w-full tabular-nums text-right" autoFocus />
            </label>
            <label className="text-xs">
              <span className="block text-slate-500 mb-1">Data</span>
              <input type="date" value={debtDate} onChange={e => setDebtDate(e.target.value)} className="input-field w-full" />
            </label>
            <label className="text-xs sm:col-span-2">
              <span className="block text-slate-500 mb-1">Arsye (opsional)</span>
              <input value={debtReason} onChange={e => setDebtReason(e.target.value)} className="input-field w-full" placeholder="p.sh. financim i pjesës së Dianës nga Biba" />
            </label>
            <div className="sm:col-span-2 flex justify-end gap-2">
              <button type="button" onClick={() => setShowAddDebt(false)} className="btn-secondary text-xs">Anulo</button>
              <button type="submit" className="btn-primary text-xs">💾 Ruaj Borxhin</button>
            </div>
          </form>
        )}
      </div>

      {/* ── Blloku 2: Borxhet mes ortakëve — GRUPUAR në karta konsoliduese ──
          Të gjitha borxhet mes të njëjtit çift (debtor→creditor) shfaqen si
          një bllok i vetëm me totale. Një pagesë e vetme shpërndahet FIFO. */}
      {(() => {
        // Grupo sipas çiftit
        const groups = {}
        for (const d of data.debts) {
          const key = `${d.debtor}||${d.creditor}`
          if (!groups[key]) groups[key] = { debtor: d.debtor, creditor: d.creditor, debts: [], initial: 0, paid: 0, remaining: 0 }
          const g = groups[key]
          g.debts.push(d)
          g.initial   += n(d.initial_amount_eur)
          g.paid      += n(d.paid_eur)
          g.remaining += n(d.remaining_eur)
        }
        return Object.entries(groups).map(([key, g]) => {
          const isOpen = expandedPair === key
          const allAuto = g.debts.length > 0 && g.debts.every(d => d.source_investment_id > 0)
          const autoCount = g.debts.filter(d => d.source_investment_id > 0).length
          return (
            <div key={key} className="card">
              <div className="flex items-start justify-between flex-wrap gap-3">
                <div>
                  <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">
                    Borxh: {g.debtor} → {g.creditor}
                    {autoCount > 0 && (
                      <span className="ml-2 badge bg-indigo-100 text-indigo-700 dark:text-indigo-300 text-[10px]" title={`${autoCount} nga ${g.debts.length} borxhe janë krijuar automatikisht nga investimet`}>
                        ⚙️ {autoCount}/{g.debts.length} auto
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    {g.debts.length} zë{g.debts.length === 1 ? '' : 'ra'} borxhi · pagesa shpërndahet automatikisht nga më i vjetri (FIFO)
                  </p>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {g.remaining > 0.005 && (
                    <button
                      onClick={() => { setPayKey(key); setPayDate(today()); setPayAmount('') }}
                      className="btn-primary text-xs"
                    >+ Pagesë nga {g.debtor}</button>
                  )}
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg bg-slate-50 dark:bg-slate-900/40 p-3">
                  <div className="text-[11px] uppercase font-semibold text-slate-500 dark:text-slate-400">Borxhi Total</div>
                  <div className="mt-1 text-2xl font-bold tabular-nums text-slate-700 dark:text-slate-200">
                    {fmt(g.initial)} <span className="text-xs text-slate-500">EUR</span>
                  </div>
                </div>
                <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/30 p-3">
                  <div className="text-[11px] uppercase font-semibold text-emerald-700 dark:text-emerald-300">E Shlyer</div>
                  <div className="mt-1 text-2xl font-bold tabular-nums text-emerald-700 dark:text-emerald-300">
                    {fmt(g.paid)} <span className="text-xs">EUR</span>
                  </div>
                </div>
                <div className={`rounded-lg p-3 ${g.remaining > 0.005 ? 'bg-rose-50 dark:bg-rose-900/30' : 'bg-emerald-50 dark:bg-emerald-900/30'}`}>
                  <div className={`text-[11px] uppercase font-semibold ${g.remaining > 0.005 ? 'text-rose-700 dark:text-rose-300' : 'text-emerald-700 dark:text-emerald-300'}`}>Mbetet</div>
                  <div className={`mt-1 text-2xl font-bold tabular-nums ${g.remaining > 0.005 ? 'text-rose-700 dark:text-rose-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
                    {g.remaining > 0.005 ? fmt(g.remaining) : '✓ Shlyer'} <span className="text-xs">{g.remaining > 0.005 ? 'EUR' : ''}</span>
                  </div>
                </div>
              </div>

              {/* Formulari i pagesës konsoliduese */}
              {payKey === key && (
                <form onSubmit={submitPayment} className="mt-4 border-t border-slate-100 dark:border-slate-800 pt-4 grid gap-2 sm:grid-cols-2">
                  <label className="text-xs">
                    <span className="block text-slate-500 mb-1">Shuma (EUR) — max {fmt(g.remaining)}</span>
                    <input type="number" step="0.01" min="0" max={g.remaining} value={payAmount} onChange={e => setPayAmount(e.target.value)} className="input-field w-full tabular-nums text-right" autoFocus />
                  </label>
                  <label className="text-xs">
                    <span className="block text-slate-500 mb-1">Data</span>
                    <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} className="input-field w-full" />
                  </label>
                  <label className="text-xs">
                    <span className="block text-slate-500 mb-1">Mënyra</span>
                    <select value={payMethod} onChange={e => setPayMethod(e.target.value)} className="input-field w-full">
                      <option value="cash">💵 Cash</option>
                      <option value="bank">🏦 Bankë</option>
                    </select>
                  </label>
                  <label className="text-xs sm:col-span-2">
                    <span className="block text-slate-500 mb-1">Shënim (opsional)</span>
                    <input value={payNote} onChange={e => setPayNote(e.target.value)} className="input-field w-full" placeholder="p.sh. pjesë nga fitimi i tetorit" />
                  </label>
                  <div className="sm:col-span-2 text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/40 rounded px-2 py-1">
                    ℹ️ Shuma shpërndahet automatikisht në borxhet aktive, duke filluar nga më i vjetri. Nëse mbulon disa borxhe, mund të krijohen disa pagesa të lidhura.
                  </div>
                  <div className="sm:col-span-2 flex justify-end gap-2">
                    <button type="button" onClick={() => setPayKey(null)} className="btn-secondary text-xs">Anulo</button>
                    <button type="submit" disabled={paying} className="btn-primary text-xs">
                      {paying ? 'Duke ruajtur…' : '💾 Ruaj Pagesën'}
                    </button>
                  </div>
                </form>
              )}

              {/* Toggle detajet e zërat individualë */}
              <div className="mt-4 border-t border-slate-100 dark:border-slate-800 pt-3">
                <button
                  onClick={() => setExpandedPair(isOpen ? null : key)}
                  className="text-xs text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-100 font-semibold"
                >
                  {isOpen ? '▾' : '▸'} Detaje: {g.debts.length} zëra borxhi dhe historiku i pagesave
                </button>
                {isOpen && (
                  <div className="mt-3 space-y-3">
                    {g.debts.slice().sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.id - b.id).map(debt => (
                      <div key={debt.id} className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50/40 dark:bg-slate-900/20 p-3">
                        <div className="flex items-start justify-between gap-2 flex-wrap">
                          <div className="text-xs text-slate-600 dark:text-slate-300">
                            <div className="font-semibold text-slate-700 dark:text-slate-200">
                              #{debt.id} · {debt.date}
                              {debt.source_investment_id > 0 && <span className="ml-2 badge bg-indigo-100 text-indigo-700 dark:text-indigo-300 text-[9px]">⚙️ nga investim #{debt.source_investment_id}</span>}
                              {debt.source_withdrawal_id > 0 && <span className="ml-2 badge bg-amber-100 text-amber-700 dark:text-amber-300 text-[9px]">⚙️ nga kasafortë</span>}
                            </div>
                            {debt.reason && <div className="text-slate-500 dark:text-slate-400 mt-0.5">{debt.reason}</div>}
                          </div>
                          <div className="flex gap-3 items-baseline text-xs tabular-nums">
                            <span className="text-slate-500">{fmt(debt.initial_amount_eur)}</span>
                            <span className="text-emerald-700 dark:text-emerald-300">− {fmt(debt.paid_eur)}</span>
                            <span className={debt.remaining_eur > 0.005 ? 'text-rose-700 font-semibold' : 'text-emerald-700 font-semibold'}>
                              = {debt.remaining_eur > 0.005 ? fmt(debt.remaining_eur) : '✓'}
                            </span>
                            {debt.remaining_eur <= 0.005 && (
                              <button
                                onClick={() => deleteDebt(debt)}
                                className="text-rose-500 hover:text-rose-700"
                                title="Fshi këtë zë borxhi"
                              >🗑</button>
                            )}
                          </div>
                        </div>
                        {debt.payments.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                            <div className="text-[10px] uppercase font-semibold text-slate-400 mb-1">Pagesa ({debt.payments.length})</div>
                            {debt.payments.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).map(p => {
                              const pm = p.payment_method === 'bank' ? 'bank' : 'cash'
                              const badge = pm === 'bank' ? '🏦' : '💵'
                              return (
                                <div key={p.id} className="flex items-center justify-between text-xs py-0.5">
                                  <span className="text-slate-600 dark:text-slate-300">{p.date} · {badge} {p.note || ''}</span>
                                  <span className="flex items-center gap-2">
                                    <span className="tabular-nums text-emerald-700 dark:text-emerald-300 font-semibold">{fmt(p.amount_eur)}</span>
                                    <button onClick={() => deletePayment(p.id)} className="text-rose-500 hover:text-rose-700 text-xs">🗑</button>
                                  </span>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        })
      })()}

      {/* ── Blloku 3: Historik i investimeve me filter periudhe dhe ndarje cash/bankë ── */}
      {data.investments.length > 0 && (() => {
        // Filtrim sipas periudhës (nëse është vendosur)
        const inPeriod = (dateStr) => {
          if (!dateStr) return false
          if (periodFrom && dateStr < periodFrom) return false
          if (periodTo && dateStr > periodTo) return false
          return true
        }
        const filteredInv = data.investments.filter(inv => (!periodFrom && !periodTo) || inPeriod(inv.date))

        // Përmbledhje cash/bankë sipas ortakut (në periudhë)
        const summary = {}
        for (const inv of filteredInv) {
          const p = inv.partner_name || '(pa emër)'
          if (!summary[p]) summary[p] = { cash: 0, bank: 0, total: 0 }
          const pm = inv.payment_method === 'bank' ? 'bank' : 'cash'
          summary[p][pm] += n(inv.amount_eur)
          summary[p].total += n(inv.amount_eur)
        }
        const totalCash = Object.values(summary).reduce((s, p) => s + p.cash, 0)
        const totalBank = Object.values(summary).reduce((s, p) => s + p.bank, 0)
        const totalAll  = totalCash + totalBank

        return (
          <div className="card">
            <div className="flex items-start justify-between flex-wrap gap-3">
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Historik Investimesh</h3>
              <div className="flex gap-2 items-end flex-wrap">
                <label className="text-xs">
                  <span className="block text-slate-500 mb-1">Nga</span>
                  <input type="date" value={periodFrom} onChange={e => setPeriodFrom(e.target.value)} className="input-field text-xs" />
                </label>
                <label className="text-xs">
                  <span className="block text-slate-500 mb-1">Deri</span>
                  <input type="date" value={periodTo} onChange={e => setPeriodTo(e.target.value)} className="input-field text-xs" />
                </label>
                {(periodFrom || periodTo) && (
                  <button onClick={() => { setPeriodFrom(''); setPeriodTo('') }} className="btn-secondary text-xs">Pastro</button>
                )}
              </div>
            </div>

            {/* Përmbledhje cash/bankë e periudhës */}
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/30 p-3">
                <div className="text-[11px] uppercase font-semibold text-emerald-700 dark:text-emerald-300">💵 Cash</div>
                <div className="text-xl font-bold tabular-nums text-emerald-800 dark:text-emerald-200">{fmt(totalCash)} <span className="text-xs">EUR</span></div>
              </div>
              <div className="rounded-lg bg-blue-50 dark:bg-blue-900/30 p-3">
                <div className="text-[11px] uppercase font-semibold text-blue-700 dark:text-blue-300">🏦 Bankë</div>
                <div className="text-xl font-bold tabular-nums text-blue-800 dark:text-blue-200">{fmt(totalBank)} <span className="text-xs">EUR</span></div>
              </div>
              <div className="rounded-lg bg-slate-100 dark:bg-slate-900/60 p-3">
                <div className="text-[11px] uppercase font-semibold text-slate-600 dark:text-slate-400">Total {(periodFrom || periodTo) ? 'periudhë' : 'gjithsej'}</div>
                <div className="text-xl font-bold tabular-nums text-slate-800 dark:text-slate-100">{fmt(totalAll)} <span className="text-xs">EUR</span></div>
              </div>
            </div>

            {/* Ndarja sipas ortakut (nëse ka më shumë se 1) */}
            {Object.keys(summary).length > 1 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {Object.entries(summary).map(([p, v]) => (
                  <div key={p} className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/40 px-3 py-1.5 text-xs">
                    <span className="font-semibold text-slate-700 dark:text-slate-200">{p}:</span>{' '}
                    <span className="text-emerald-700 dark:text-emerald-300 tabular-nums">💵 {fmt(v.cash)}</span>{' + '}
                    <span className="text-blue-700 dark:text-blue-300 tabular-nums">🏦 {fmt(v.bank)}</span>{' = '}
                    <strong className="tabular-nums">{fmt(v.total)} EUR</strong>
                  </div>
                ))}
              </div>
            )}

            <table className="w-full text-sm mt-3">
              <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">Data</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">Ortaku</th>
                  <th className="px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-500">Mënyra</th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-500">Shuma (EUR)</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">Shënim</th>
                  <th className="px-3 py-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {filteredInv.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).map(inv => {
                  const pm = inv.payment_method === 'bank' ? 'bank' : 'cash'
                  const badge = pm === 'bank'
                    ? <span className="badge bg-blue-100 text-blue-700 dark:text-blue-300">🏦 Bankë</span>
                    : <span className="badge bg-emerald-100 text-emerald-700 dark:text-emerald-300">💵 Cash</span>
                  return (
                    <tr key={inv.id} className="border-b border-slate-100 dark:border-slate-800">
                      <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{inv.date}</td>
                      <td className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">{inv.partner_name}</td>
                      <td className="px-3 py-2 text-center">{badge}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-800 dark:text-slate-100">{fmt(inv.amount_eur)}</td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-400 text-xs">{inv.note || ''}</td>
                      <td className="px-3 py-2 text-right">
                        <button onClick={() => deleteInvestment(inv.id)} className="text-rose-600 hover:text-rose-800 text-xs" title="Fshi">🗑</button>
                      </td>
                    </tr>
                  )
                })}
                {filteredInv.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-slate-400 italic text-xs">
                      Asnjë investim në periudhën e zgjedhur.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )
      })()}
    </div>
  )
}
