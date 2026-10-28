import { useEffect, useMemo, useState } from 'react'
import { showConfirm } from './ConfirmDialog.jsx'

const CURRENCIES = ['EUR', 'USD', 'LEK', 'GBP', 'CHF']

function n(v) { return parseFloat(v) || 0 }
function fmt(v) {
  const x = n(v)
  if (x === 0) return '-'
  return x.toLocaleString('sq-AL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}
function fmtSigned(v, sign) {
  const x = n(v)
  if (x === 0) return '-'
  return sign + ' ' + x.toLocaleString('sq-AL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}
function today() { return new Date().toISOString().slice(0, 10) }

export default function Investimi() {
  const [data, setData]       = useState({ investments: [], debts: [], partners: {}, totals_by_currency: {} })
  const [withdrawals, setWithdrawals] = useState([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg]         = useState('')

  const flash = (text) => { setMsg(text); setTimeout(() => setMsg(''), 3000) }

  const load = async () => {
    setLoading(true)
    try {
      const [d, sw] = await Promise.all([
        fetch('/api/investimi').then(r => r.json()),
        fetch('/api/safe-withdrawals?limit=500').then(r => r.ok ? r.json() : []),
      ])
      setData(d && typeof d === 'object' ? d : { investments: [], debts: [], partners: {}, totals_by_currency: {} })
      setWithdrawals(Array.isArray(sw) ? sw.filter(w => ['biba_investment', 'diana_debt'].includes(w.destination)) : [])
    } catch (e) { console.error(e) }
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  // Monedhat aktive — vetëm ato që kanë ndonjë aktivitet (investim, borxh, tërheqje).
  const activeCurs = useMemo(() => {
    const set = new Set()
    for (const inv of (data.investments || [])) if (n(inv.amount) > 0) set.add(inv.currency)
    for (const d of (data.debts || [])) if (n(d.amount) > 0) set.add(d.currency)
    for (const w of withdrawals) {
      for (const c of CURRENCIES) if (n(w[`amount_${c.toLowerCase()}`]) > 0) set.add(c)
    }
    const ordered = CURRENCIES.filter(c => set.has(c))
    return ordered.length ? ordered : ['EUR']
  }, [data, withdrawals])

  if (loading) {
    return <div className="p-8 text-center text-slate-400">Duke ngarkuar…</div>
  }

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      {/* Header kryesor */}
      <div className="card flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Investimi</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Kapitali i ortakëve, borxhet mes tyre, tërheqjet nga kasaforta dhe shlyerjet. Çdo monedhë mbahet veç — pa konvertim automatik.
          </p>
        </div>
        <button type="button" onClick={load}
          className="btn-secondary text-xs whitespace-nowrap"
          title="Ringarko të dhënat">🔄 Rifresko</button>
      </div>

      {msg && (
        <div className="card bg-blue-50 dark:bg-blue-900/30 border-blue-200 text-sm text-slate-700 dark:text-slate-200">
          {msg}
        </div>
      )}

      <SeksionInvestitoret data={data} activeCurs={activeCurs} flash={flash} reload={load} />
      <SeksionBorxhet data={data} flash={flash} reload={load} />
      <SeksionTerheqjet data={data} withdrawals={withdrawals} activeCurs={activeCurs} flash={flash} reload={load} />
      <SeksionShlyerje data={data} activeCurs={activeCurs} flash={flash} reload={load} />
    </div>
  )
}

// ─── Komponent i përbashkët: Section card në stilin e Arka Ditore ───
function Seksion({ title, children, action }) {
  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex items-center justify-between gap-2 flex-wrap">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</h4>
        {action}
      </div>
      {children}
    </div>
  )
}

// ─── Seksion 1: Investitorët (kapitali sipas monedhës) ───
function SeksionInvestitoret({ data, activeCurs, flash, reload }) {
  const [showForm, setShowForm] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [partner, setPartner]   = useState('')
  const [amount, setAmount]     = useState('')
  const [currency, setCurrency] = useState('EUR')
  const [date, setDate]         = useState(today())
  const [note, setNote]         = useState('')
  const [method, setMethod]     = useState('cash')

  const resetForm = () => {
    setEditingId(null)
    setPartner(''); setAmount(''); setNote(''); setDate(today()); setMethod('cash'); setCurrency('EUR')
  }
  const startEdit = (inv) => {
    setEditingId(inv.id)
    setPartner(inv.partner_name || '')
    setAmount(String(inv.amount || ''))
    setCurrency(inv.currency || 'EUR')
    setDate(inv.date || today())
    setNote(inv.note || '')
    setMethod(inv.payment_method === 'bank' ? 'bank' : 'cash')
    setShowForm(true)
    setShowHistory(true)
  }

  const partnerOptions = useMemo(() => {
    const set = new Set()
    for (const inv of (data.investments || [])) if (inv.partner_name) set.add(inv.partner_name)
    for (const d of (data.debts || [])) {
      if (d.debtor) set.add(d.debtor)
      if (d.creditor) set.add(d.creditor)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'sq'))
  }, [data])

  // Rreshtat e tabelës: një për çdo ortak me totale për çdo monedhë aktive.
  const partners = data.partners || {}
  const partnerRows = Object.keys(partners).sort((a, b) => a.localeCompare(b, 'sq'))
  const totals = data.totals_by_currency || {}

  const submit = async (e) => {
    e.preventDefault()
    if (!partner.trim()) { flash('⚠ Vendos emrin e ortakut'); return }
    if (n(amount) <= 0)  { flash('⚠ Vendos shumë > 0'); return }
    const body = {
      partner_name: partner.trim(), amount: n(amount), currency, date, note,
      payment_method: method,
    }
    const url = editingId ? `/api/investimi/investments/${editingId}` : '/api/investimi/investments'
    const httpMethod = editingId ? 'PUT' : 'POST'
    try {
      const r = await fetch(url, {
        method: httpMethod, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) throw new Error((await r.json()).error || 'Gabim')
      const resp = await r.json().catch(() => ({}))
      const wasEdit = !!editingId
      resetForm(); setShowForm(false)
      if (resp?.debt_auto_created) {
        flash(`✓ Investimi u ${wasEdit ? 'përditësua' : 'shtua'} · Borxh auto Diana→Biba ${fmt(resp.debt_auto_created.amount)} ${resp.debt_auto_created.currency} (30%)`)
      } else flash(wasEdit ? '✓ Investimi u përditësua' : '✓ Investimi u shtua')
      await reload()
    } catch (e) { flash('✗ ' + e.message) }
  }

  return (
    <Seksion
      title="Investitorët — Kapitali"
      action={<button onClick={() => {
        if (showForm) { resetForm(); setShowForm(false) } else setShowForm(true)
      }} className="btn-primary text-xs">
        {showForm ? '✕ Mbyll' : '+ Investim i Ri'}
      </button>}
    >
      {showForm && (
        <form onSubmit={submit} className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-indigo-50/40 dark:bg-indigo-900/10 grid gap-2 sm:grid-cols-6">
          {editingId && (
            <div className="sm:col-span-6 text-xs text-amber-700 dark:text-amber-300">
              ✎ Edit: ndryshimet e shumës/monedhës/ortakut rikrijojnë borxhin auto. Nëse borxhi auto ka pagesa, fshi pagesat e para.
            </div>
          )}
          {partner.trim().toLowerCase() === 'biba' && n(amount) > 0 && (
            <div className="sm:col-span-6 text-xs text-indigo-700 dark:text-indigo-300">
              ℹ️ {editingId ? 'Borxhi auto Diana→Biba rikrijohet' : 'Automatikisht do krijohet borxh Diana→Biba'} me <strong>{fmt(n(amount) * 0.30)} {currency}</strong> (30%).
            </div>
          )}
          <datalist id="inv-partners">
            {partnerOptions.map(name => <option key={name} value={name} />)}
          </datalist>
          <label className="text-xs sm:col-span-2">
            <span className="block text-slate-500 mb-1">Ortaku</span>
            <input value={partner} onChange={e => setPartner(e.target.value)} list="inv-partners"
              placeholder="p.sh. Biba, Diana…" className="input-field w-full" />
          </label>
          <label className="text-xs">
            <span className="block text-slate-500 mb-1">Shuma</span>
            <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)}
              className="input-field w-full tabular-nums text-right" />
          </label>
          <label className="text-xs">
            <span className="block text-slate-500 mb-1">Monedha</span>
            <select value={currency} onChange={e => setCurrency(e.target.value)} className="input-field w-full">
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="text-xs">
            <span className="block text-slate-500 mb-1">Mënyra</span>
            <select value={method} onChange={e => setMethod(e.target.value)} className="input-field w-full">
              <option value="cash">💵 Cash</option>
              <option value="bank">🏦 Bankë</option>
            </select>
          </label>
          <label className="text-xs">
            <span className="block text-slate-500 mb-1">Data</span>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className="input-field w-full" />
          </label>
          <label className="text-xs sm:col-span-5">
            <span className="block text-slate-500 mb-1">Koment / sqarim</span>
            <input value={note} onChange={e => setNote(e.target.value)} className="input-field w-full" placeholder="opsional" />
          </label>
          <div className="sm:col-span-1 flex items-end gap-1">
            {editingId && (
              <button type="button" onClick={() => { resetForm(); setShowForm(false) }}
                className="btn-secondary text-xs flex-1" title="Anulo editimin">✕</button>
            )}
            <button type="submit" className="btn-primary text-xs flex-1">
              {editingId ? '💾 Ruaj' : '💾 Ruaj'}
            </button>
          </div>
        </form>
      )}

      <table className="w-full text-sm">
        <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800">
          <tr>
            <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Zëri</th>
            {activeCurs.map(c => (
              <th key={c} className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {partnerRows.map(name => {
            const row = partners[name] || {}
            return (
              <tr key={name} className="border-b border-slate-100 dark:border-slate-800 bg-emerald-50/40 dark:bg-emerald-900/10">
                <td className="px-4 py-2.5 text-slate-700 dark:text-slate-200">
                  <span className="font-semibold">{name}</span>
                  <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">kontribut i paguar në kapital</span>
                </td>
                {activeCurs.map(c => (
                  <td key={c} className="px-3 py-2.5 text-right tabular-nums font-semibold text-emerald-700 dark:text-emerald-300">
                    {fmtSigned(row[c], '+')}
                  </td>
                ))}
              </tr>
            )
          })}
          {partnerRows.length === 0 && (
            <tr><td colSpan={activeCurs.length + 1} className="px-4 py-6 text-center text-slate-400 italic text-xs">
              Asnjë investim.
            </td></tr>
          )}
          <tr className="border-t-2 border-slate-300 dark:border-slate-700 bg-emerald-100 dark:bg-emerald-900/30">
            <td className="px-4 py-3 font-bold text-slate-800 dark:text-slate-100">
              = Kapital Total
              <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">shuma e investimeve të paguara</span>
            </td>
            {activeCurs.map(c => (
              <td key={c} className="px-3 py-3 text-right tabular-nums font-bold text-emerald-800 dark:text-emerald-200 text-base">
                {fmt(totals[c])}
              </td>
            ))}
          </tr>
        </tbody>
      </table>

      {/* Historik investimesh — collapsed default, toggle për të zgjeruar */}
      {(data.investments || []).length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setShowHistory(v => !v)}
            className="w-full px-4 py-2 border-t border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/30 text-left hover:bg-slate-100 dark:hover:bg-slate-800/50 transition flex items-center justify-between"
          >
            <h5 className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {showHistory ? '▾' : '▸'} Historik investimesh ({(data.investments || []).length})
            </h5>
            <span className="text-[10px] text-slate-400">{showHistory ? 'kliko për të fshehur' : 'kliko për të shfaqur'}</span>
          </button>
          {showHistory && (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800">
              <tr>
                <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">Data</th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">Ortaku</th>
                <th className="px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-500">Mënyra</th>
                <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-500">Shuma</th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">Koment</th>
                <th className="px-3 py-2 w-16"></th>
              </tr>
            </thead>
            <tbody>
              {(data.investments || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).map(inv => (
                <RreshtInvestimi key={inv.id} inv={inv} flash={flash} reload={reload} onEdit={startEdit} />
              ))}
            </tbody>
          </table>
          )}
        </>
      )}
    </Seksion>
  )
}

function RreshtInvestimi({ inv, flash, reload, onEdit }) {
  const pm = inv.payment_method === 'bank' ? 'bank' : 'cash'
  const badge = pm === 'bank'
    ? <span className="badge bg-blue-100 text-blue-700 dark:text-blue-300">🏦 Bankë</span>
    : <span className="badge bg-emerald-100 text-emerald-700 dark:text-emerald-300">💵 Cash</span>
  const del = async () => {
    const ok = await showConfirm('Të fshihet ky investim? (Borxhi auto i lidhur fshihet gjithashtu.)', { confirmLabel: 'Fshi', danger: true })
    if (!ok) return
    try {
      const r = await fetch(`/api/investimi/investments/${inv.id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error((await r.json()).error || 'Gabim')
      flash('✓ U fshi'); await reload()
    } catch (e) { flash('✗ ' + e.message) }
  }
  return (
    <tr className="border-b border-slate-100 dark:border-slate-800">
      <td className="px-4 py-2 text-slate-700 dark:text-slate-200">{inv.date}</td>
      <td className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">{inv.partner_name}</td>
      <td className="px-3 py-2 text-center">{badge}</td>
      <td className="px-3 py-2 text-right tabular-nums font-bold text-slate-800 dark:text-slate-100">
        {fmt(inv.amount)} {inv.currency}
      </td>
      <td className="px-3 py-2 text-slate-600 dark:text-slate-400 text-xs">{inv.note || ''}</td>
      <td className="px-3 py-2 text-right whitespace-nowrap">
        <button onClick={() => onEdit(inv)} className="text-indigo-600 hover:text-indigo-800 text-xs mr-2" title="Edito">✎</button>
        <button onClick={del} className="text-rose-600 hover:text-rose-800 text-xs" title="Fshi">🗑</button>
      </td>
    </tr>
  )
}

// ─── Seksion 2: Borxhet aktive mes ortakëve ───
function SeksionBorxhet({ data, flash, reload }) {
  const [showForm, setShowForm] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [debtor, setDebtor]       = useState('')
  const [creditor, setCreditor]   = useState('')
  const [amount, setAmount]       = useState('')
  const [currency, setCurrency]   = useState('EUR')
  const [reason, setReason]       = useState('')
  const [date, setDate]           = useState(today())

  const resetForm = () => {
    setEditingId(null)
    setDebtor(''); setCreditor(''); setAmount(''); setCurrency('EUR'); setReason(''); setDate(today())
  }
  const startEdit = (d) => {
    if ((d.source_investment_id || 0) > 0 || (d.source_withdrawal_id || 0) > 0) {
      flash('✗ Borxh auto — edito investimin ose tërheqjen burim')
      return
    }
    setEditingId(d.id)
    setDebtor(d.debtor || '')
    setCreditor(d.creditor || '')
    setAmount(String(d.amount || ''))
    setCurrency(d.currency || 'EUR')
    setReason(d.reason || '')
    setDate(d.date || today())
    setShowForm(true)
    setShowHistory(true)
  }

  const partnerOptions = useMemo(() => {
    const set = new Set()
    for (const inv of (data.investments || [])) if (inv.partner_name) set.add(inv.partner_name)
    for (const d of (data.debts || [])) {
      if (d.debtor) set.add(d.debtor)
      if (d.creditor) set.add(d.creditor)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'sq'))
  }, [data])

  // Grupo borxhet sipas (debtor, creditor); monedhat ruhen si nën-grupe brenda
  // rreshtit. Kështu Diana→Biba shfaqet si një rresht i vetëm me shumat
  // vertikalisht për EUR, USD, etj. (pa konvertim).
  const groups = useMemo(() => {
    const g = {}
    for (const d of (data.debts || [])) {
      const key = `${d.debtor}||${d.creditor}`
      if (!g[key]) g[key] = {
        key, debtor: d.debtor, creditor: d.creditor,
        byCurrency: {}, debts: [],
      }
      const cur = d.currency
      if (!g[key].byCurrency[cur]) {
        g[key].byCurrency[cur] = { total: 0, paid: 0, remaining: 0, debts: [] }
      }
      g[key].byCurrency[cur].total     += n(d.amount)
      g[key].byCurrency[cur].paid      += n(d.paid)
      g[key].byCurrency[cur].remaining += n(d.remaining)
      g[key].byCurrency[cur].debts.push(d)
      g[key].debts.push(d)
    }
    return Object.values(g).sort((a, b) =>
      a.debtor.localeCompare(b.debtor, 'sq') ||
      a.creditor.localeCompare(b.creditor, 'sq'))
  }, [data])

  // Totale per monedhë (shumatorja përmbi të gjitha çiftet).
  const totalsByCur = useMemo(() => {
    const t = {}
    for (const g of groups) {
      for (const [cur, sub] of Object.entries(g.byCurrency)) {
        t[cur] = t[cur] || { total: 0, paid: 0, remaining: 0 }
        t[cur].total     += sub.total
        t[cur].paid      += sub.paid
        t[cur].remaining += sub.remaining
      }
    }
    return t
  }, [groups])

  const submit = async (e) => {
    e.preventDefault()
    if (!debtor.trim() || !creditor.trim()) { flash('⚠ Vendos emrat'); return }
    if (debtor.trim() === creditor.trim())  { flash('⚠ Debtor ≠ Creditor'); return }
    if (n(amount) <= 0) { flash('⚠ Shumë > 0'); return }
    const body = { debtor: debtor.trim(), creditor: creditor.trim(),
      amount: n(amount), currency, reason, date }
    const url = editingId ? `/api/investimi/debts/${editingId}` : '/api/investimi/debts'
    const httpMethod = editingId ? 'PUT' : 'POST'
    try {
      const r = await fetch(url, {
        method: httpMethod, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) throw new Error((await r.json()).error || 'Gabim')
      const wasEdit = !!editingId
      resetForm(); setShowForm(false)
      flash(wasEdit ? '✓ Borxhi u përditësua' : '✓ Borxhi u shtua'); await reload()
    } catch (e) { flash('✗ ' + e.message) }
  }

  const delDebt = async (d) => {
    const auto = (d.source_investment_id || 0) > 0 || (d.source_withdrawal_id || 0) > 0
    const msg = auto
      ? 'Ky borxh u krijua automatikisht nga një investim/tërheqje. Fshi burimin për cascade. Të fshihet manualisht gjithsesi?'
      : 'Të fshihet ky borxh? (Pagesat e lidhura fshihen gjithashtu.)'
    const ok = await showConfirm(msg, { confirmLabel: 'Fshi', danger: true })
    if (!ok) return
    try {
      const r = await fetch(`/api/investimi/debts/${d.id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error((await r.json()).error || 'Gabim')
      flash('✓ Borxhi u fshi'); await reload()
    } catch (e) { flash('✗ ' + e.message) }
  }

  // Flat list i të gjitha borxheve (për historik), i renditur nga më i riu te më i vjetri.
  const debtsList = useMemo(() => {
    return (data.debts || []).slice().sort((a, b) =>
      (b.date || '').localeCompare(a.date || '') || b.id - a.id
    )
  }, [data])

  return (
    <Seksion
      title="Borxhe Mes Ortakëve"
      action={<button onClick={() => {
        if (showForm) { resetForm(); setShowForm(false) } else setShowForm(true)
      }} className="btn-secondary text-xs">
        {showForm ? '✕ Mbyll' : '+ Borxh i Ri'}
      </button>}
    >
      {showForm && (
        <form onSubmit={submit} className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-rose-50/40 dark:bg-rose-900/10 grid gap-2 sm:grid-cols-6">
          {editingId && (
            <div className="sm:col-span-6 text-xs text-amber-700 dark:text-amber-300">
              ✎ Edit borxhi — nëse monedha ndryshon dhe ka pagesa, fshi pagesat e para.
            </div>
          )}
          <datalist id="debt-partners">
            {partnerOptions.map(name => <option key={name} value={name} />)}
          </datalist>
          <label className="text-xs sm:col-span-2">
            <span className="block text-slate-500 mb-1">Debtor (merr borxh)</span>
            <input value={debtor} onChange={e => setDebtor(e.target.value)} list="debt-partners"
              className="input-field w-full" />
          </label>
          <label className="text-xs sm:col-span-2">
            <span className="block text-slate-500 mb-1">Creditor (jep borxh)</span>
            <input value={creditor} onChange={e => setCreditor(e.target.value)} list="debt-partners"
              className="input-field w-full" />
          </label>
          <label className="text-xs">
            <span className="block text-slate-500 mb-1">Shuma</span>
            <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)}
              className="input-field w-full tabular-nums text-right" />
          </label>
          <label className="text-xs">
            <span className="block text-slate-500 mb-1">Monedha</span>
            <select value={currency} onChange={e => setCurrency(e.target.value)} className="input-field w-full">
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="text-xs">
            <span className="block text-slate-500 mb-1">Data</span>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className="input-field w-full" />
          </label>
          <label className="text-xs sm:col-span-4">
            <span className="block text-slate-500 mb-1">Koment / sqarim</span>
            <input value={reason} onChange={e => setReason(e.target.value)} className="input-field w-full" placeholder="opsional" />
          </label>
          <div className="sm:col-span-1 flex items-end gap-1">
            {editingId && (
              <button type="button" onClick={() => { resetForm(); setShowForm(false) }}
                className="btn-secondary text-xs flex-1" title="Anulo editimin">✕</button>
            )}
            <button type="submit" className="btn-primary text-xs flex-1">💾 Ruaj</button>
          </div>
        </form>
      )}

      <table className="w-full text-sm">
        <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800">
          <tr>
            <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">Zëri</th>
            <th className="px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-500">Monedha</th>
            <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-500">Shuma</th>
            <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-500">Paguar</th>
            <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-500">Mbetet</th>
          </tr>
        </thead>
        <tbody>
          {groups.map(g => {
            const currencies = Object.keys(g.byCurrency).sort()
            const anyActive = currencies.some(c => g.byCurrency[c].remaining > 0.005)
            const bg = anyActive ? 'bg-rose-50/40 dark:bg-rose-900/10' : 'bg-emerald-50/40 dark:bg-emerald-900/10'
            const nAuto = g.debts.filter(d => d.source_investment_id > 0 || d.source_withdrawal_id > 0).length
            return (
              <tr key={g.key} className={`border-b border-slate-100 dark:border-slate-800 ${bg}`}>
                <td className="px-4 py-2.5 text-slate-700 dark:text-slate-200 align-top">
                  <span className="font-semibold">{g.debtor} → {g.creditor}</span>
                  <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">
                    {g.debts.length} zë{g.debts.length === 1 ? '' : 'ra'}{nAuto > 0 ? ` · ${nAuto} auto` : ''}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-center text-xs font-semibold text-slate-600 dark:text-slate-300 align-top">
                  {currencies.map(c => <div key={c} className="leading-6">{c}</div>)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-700 dark:text-slate-200 align-top">
                  {currencies.map(c => <div key={c} className="leading-6">{fmt(g.byCurrency[c].total)}</div>)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700 dark:text-emerald-300 align-top">
                  {currencies.map(c => <div key={c} className="leading-6">{fmt(g.byCurrency[c].paid)}</div>)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums font-bold align-top">
                  {currencies.map(c => {
                    const sub = g.byCurrency[c]
                    const act = sub.remaining > 0.005
                    return (
                      <div key={c} className={`leading-6 ${act ? 'text-rose-700 dark:text-rose-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
                        {act ? fmt(sub.remaining) : '✓'}
                      </div>
                    )
                  })}
                </td>
              </tr>
            )
          })}
          {groups.length === 0 && (
            <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400 italic text-xs">
              Asnjë borxh i regjistruar.
            </td></tr>
          )}
          {Object.entries(totalsByCur).map(([cur, t]) => (
            <tr key={cur} className="border-t border-slate-200 dark:border-slate-700 bg-slate-100/60 dark:bg-slate-800/40">
              <td className="px-4 py-2 font-bold text-slate-700 dark:text-slate-200">
                = Totale {cur}
                <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">shumatorja për monedhën</span>
              </td>
              <td className="px-3 py-2 text-center text-xs font-bold">{cur}</td>
              <td className="px-3 py-2 text-right tabular-nums font-bold">{fmt(t.total)}</td>
              <td className="px-3 py-2 text-right tabular-nums font-bold text-emerald-700 dark:text-emerald-300">{fmt(t.paid)}</td>
              <td className={`px-3 py-2 text-right tabular-nums font-bold ${t.remaining > 0.005 ? 'text-rose-700' : 'text-emerald-700'}`}>{fmt(t.remaining)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {debtsList.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setShowHistory(v => !v)}
            className="w-full px-4 py-2 border-t border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/30 text-left hover:bg-slate-100 dark:hover:bg-slate-800/50 transition flex items-center justify-between"
          >
            <h5 className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {showHistory ? '▾' : '▸'} Historik borxhesh ({debtsList.length})
            </h5>
            <span className="text-[10px] text-slate-400">{showHistory ? 'kliko për të fshehur' : 'kliko për të shfaqur'}</span>
          </button>
          {showHistory && (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">Data</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">Nga → Tek</th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-500">Shuma</th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-500">Paguar</th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-500">Mbetet</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">Burimi / Koment</th>
                  <th className="px-3 py-2 w-16"></th>
                </tr>
              </thead>
              <tbody>
                {debtsList.map(d => {
                  const auto = (d.source_investment_id || 0) > 0 || (d.source_withdrawal_id || 0) > 0
                  const srcLabel = (d.source_investment_id || 0) > 0 ? '🤖 auto nga investim'
                    : (d.source_withdrawal_id || 0) > 0 ? '🤖 auto nga tërheqje'
                    : ''
                  const active = n(d.remaining) > 0.005
                  return (
                    <tr key={d.id} className={`border-b border-slate-100 dark:border-slate-800 ${active ? 'bg-rose-50/30 dark:bg-rose-900/10' : 'bg-emerald-50/30 dark:bg-emerald-900/10'}`}>
                      <td className="px-4 py-2 text-slate-700 dark:text-slate-200">{d.date}</td>
                      <td className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">
                        {d.debtor} → {d.creditor}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-800 dark:text-slate-100">
                        {fmt(d.amount)} {d.currency}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-700 dark:text-emerald-300">
                        {fmt(d.paid)}
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums font-bold ${active ? 'text-rose-700 dark:text-rose-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
                        {active ? fmt(d.remaining) : '✓'}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                        {[srcLabel, d.reason].filter(Boolean).join(' · ')}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {auto ? (
                          <span className="text-slate-300 dark:text-slate-600 text-xs mr-2" title="Borxh auto — edito investimin/tërheqjen burim">✎</span>
                        ) : (
                          <button onClick={() => startEdit(d)} className="text-indigo-600 hover:text-indigo-800 text-xs mr-2" title="Edito">✎</button>
                        )}
                        <button onClick={() => delDebt(d)} className="text-rose-600 hover:text-rose-800 text-xs" title="Fshi">🗑</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </>
      )}
    </Seksion>
  )
}

// ─── Seksion 3: Tërheqje investimi (safe_withdrawals me destination) ───
function SeksionTerheqjet({ data, withdrawals, activeCurs, flash, reload }) {
  const [showForm, setShowForm] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [dest, setDest]         = useState('biba_investment')
  const [amount, setAmount]     = useState('')
  const [currency, setCurrency] = useState('EUR')
  const [date, setDate]         = useState(today())
  const [person, setPerson]     = useState('')
  const [note, setNote]         = useState('')

  const resetForm = () => {
    setEditingId(null)
    setDest('biba_investment'); setAmount(''); setCurrency('EUR'); setDate(today()); setPerson(''); setNote('')
  }
  const startEdit = (w) => {
    setEditingId(w.id)
    setDest(w.destination || 'biba_investment')
    // Gjej monedhën e vetme me shumë > 0 (çdo tërheqje ruan një monedhë).
    const cur = CURRENCIES.find(c => n(w[`amount_${c.toLowerCase()}`]) > 0) || 'EUR'
    setCurrency(cur)
    setAmount(String(n(w[`amount_${cur.toLowerCase()}`]) || ''))
    setDate(w.date || today())
    setPerson(w.person || '')
    setNote(w.note || '')
    setShowForm(true)
    setShowHistory(true)
  }

  // Për destinacionin 'biba_investment', tregon vetëm monedhat që kanë borxh aktiv.
  const curWithActiveDebt = useMemo(() => {
    const curs = new Set()
    for (const d of (data.debts || [])) {
      if (d.debtor === 'Diana' && d.creditor === 'Biba' && n(d.remaining) > 0.005) curs.add(d.currency)
    }
    return Array.from(curs)
  }, [data])

  const availableCurs = dest === 'biba_investment'
    ? (curWithActiveDebt.length > 0 ? curWithActiveDebt : CURRENCIES)
    : CURRENCIES

  const submit = async (e) => {
    e.preventDefault()
    if (n(amount) <= 0) { flash('⚠ Shumë > 0'); return }
    const body = {
      date, destination: dest, person: person.trim(), note: note.trim(),
      amount_lek: 0, amount_eur: 0, amount_usd: 0, amount_gbp: 0, amount_chf: 0,
    }
    body[`amount_${currency.toLowerCase()}`] = n(amount)
    const url = editingId ? `/api/safe-withdrawals/${editingId}` : '/api/safe-withdrawals'
    const httpMethod = editingId ? 'PUT' : 'POST'
    try {
      const r = await fetch(url, {
        method: httpMethod, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) throw new Error((await r.json()).error || 'Gabim')
      const wasEdit = !!editingId
      resetForm(); setShowForm(false)
      if (wasEdit) {
        flash('✓ Tërheqja u përditësua')
      } else {
        flash(dest === 'biba_investment'
          ? `✓ Tërheqje Biba — 30% zbriti borxhin e Dianës në ${currency}`
          : `✓ Tërheqje ${person.trim() || 'Diana'} — iu rrit borxhi me ${fmt(n(amount))} ${currency}`)
      }
      await reload()
    } catch (e) { flash('✗ ' + e.message) }
  }

  const del = async (id) => {
    const ok = await showConfirm('Të fshihet kjo tërheqje? Efektet te borxhet kthehen mbrapsht.', { confirmLabel: 'Fshi', danger: true })
    if (!ok) return
    try {
      const r = await fetch(`/api/safe-withdrawals/${id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error((await r.json()).error || 'Gabim')
      flash('✓ U fshi'); await reload()
    } catch (e) { flash('✗ ' + e.message) }
  }

  // Totale per monedhë per lloj tërheqje.
  // Për diana_debt, totalet grupohen për çdo emër borxhliu (person; default 'Diana').
  const totals = useMemo(() => {
    const bibaTotals = {}
    const debtTotals = {}
    for (const w of withdrawals) {
      if (w.destination === 'biba_investment') {
        for (const c of CURRENCIES) {
          const v = n(w[`amount_${c.toLowerCase()}`])
          if (v > 0) bibaTotals[c] = (bibaTotals[c] || 0) + v
        }
      } else if (w.destination === 'diana_debt') {
        const name = (w.person || '').trim() || 'Diana'
        if (!debtTotals[name]) debtTotals[name] = {}
        for (const c of CURRENCIES) {
          const v = n(w[`amount_${c.toLowerCase()}`])
          if (v > 0) debtTotals[name][c] = (debtTotals[name][c] || 0) + v
        }
      }
    }
    return { biba_investment: bibaTotals, diana_debt_by_name: debtTotals }
  }, [withdrawals])

  return (
    <Seksion
      title="Tërheqje nga Kasaforta (Investimi)"
      action={<button onClick={() => {
        if (showForm) { resetForm(); setShowForm(false) } else setShowForm(true)
      }} className="btn-primary text-xs">
        {showForm ? '✕ Mbyll' : '+ Tërheqje e Re'}
      </button>}
    >
      {showForm && (
        <form onSubmit={submit} className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-amber-50/40 dark:bg-amber-900/10 grid gap-2 sm:grid-cols-6">
          {editingId && (
            <div className="sm:col-span-6 text-xs text-amber-700 dark:text-amber-300">
              ✎ Edit: efektet te borxhet rikrijohen automatikisht sipas vlerave të reja.
            </div>
          )}
          <div className="sm:col-span-6 text-xs text-slate-500 dark:text-slate-400">
            <strong>Biba (nga investimi):</strong> 30% e tërheqjes zbret borxhin e Dianës NË TË NJËJTËN MONEDHË.{' '}
            <strong>Borxh i Ri:</strong> krijon borxh të ri (Person)→Biba në atë monedhë. Nëse <em>Person</em> është bosh, default-i është Diana.
          </div>
          <label className="text-xs sm:col-span-3">
            <span className="block text-slate-500 mb-1">Lloji</span>
            <div className="flex gap-1">
              <button type="button" onClick={() => setDest('biba_investment')}
                className={`flex-1 px-2 py-2 rounded-md text-xs font-semibold border ${
                  dest === 'biba_investment'
                    ? 'bg-indigo-100 border-indigo-300 text-indigo-800 dark:bg-indigo-900/40'
                    : 'bg-white border-slate-200 text-slate-600 dark:bg-slate-800 dark:border-slate-700'
                }`}>Biba — Investim</button>
              <button type="button" onClick={() => setDest('diana_debt')}
                className={`flex-1 px-2 py-2 rounded-md text-xs font-semibold border ${
                  dest === 'diana_debt'
                    ? 'bg-rose-100 border-rose-300 text-rose-800 dark:bg-rose-900/40'
                    : 'bg-white border-slate-200 text-slate-600 dark:bg-slate-800 dark:border-slate-700'
                }`}>Borxh i Ri (Diana / Tjetër)</button>
            </div>
          </label>
          <label className="text-xs">
            <span className="block text-slate-500 mb-1">Shuma</span>
            <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)}
              className="input-field w-full tabular-nums text-right" />
          </label>
          <label className="text-xs">
            <span className="block text-slate-500 mb-1">Monedha</span>
            <select value={currency} onChange={e => setCurrency(e.target.value)} className="input-field w-full">
              {availableCurs.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="text-xs">
            <span className="block text-slate-500 mb-1">Data</span>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className="input-field w-full" />
          </label>
          <label className="text-xs sm:col-span-2">
            <span className="block text-slate-500 mb-1">
              {dest === 'diana_debt' ? 'Emri i borxhliut (opsional)' : 'Person (opsional)'}
            </span>
            <input value={person} onChange={e => setPerson(e.target.value)} className="input-field w-full"
              placeholder={dest === 'diana_debt' ? 'default: Diana' : ''} />
          </label>
          <label className="text-xs sm:col-span-3">
            <span className="block text-slate-500 mb-1">Koment / sqarim</span>
            <input value={note} onChange={e => setNote(e.target.value)} className="input-field w-full" placeholder="opsional" />
          </label>
          <div className="sm:col-span-1 flex items-end gap-1">
            {editingId && (
              <button type="button" onClick={() => { resetForm(); setShowForm(false) }}
                className="btn-secondary text-xs flex-1" title="Anulo editimin">✕</button>
            )}
            <button type="submit" className="btn-primary text-xs flex-1">💾 Ruaj</button>
          </div>
        </form>
      )}

      <table className="w-full text-sm">
        <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800">
          <tr>
            <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">Zëri</th>
            {activeCurs.map(c => (
              <th key={c} className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-500">{c}</th>
            ))}
            <th className="px-3 py-2 w-16"></th>
          </tr>
        </thead>
        <tbody>
          {withdrawals.length > 0 && (
            <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/30">
              <td colSpan={activeCurs.length + 2}>
                <button type="button" onClick={() => setShowHistory(v => !v)}
                  className="w-full px-4 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800/50 transition flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {showHistory ? '▾' : '▸'} Historik tërheqjesh ({withdrawals.length})
                  </span>
                  <span className="text-[10px] text-slate-400">{showHistory ? 'kliko për të fshehur' : 'kliko për të shfaqur'}</span>
                </button>
              </td>
            </tr>
          )}
          {showHistory && withdrawals.map(w => {
            const isBiba = w.destination === 'biba_investment'
            const bg = isBiba ? 'bg-indigo-50/40 dark:bg-indigo-900/10' : 'bg-rose-50/40 dark:bg-rose-900/10'
            const color = isBiba ? 'text-indigo-700 dark:text-indigo-300' : 'text-rose-700 dark:text-rose-300'
            const debtorName = (w.person || '').trim() || 'Diana'
            return (
              <tr key={w.id} className={`border-b border-slate-100 dark:border-slate-800 ${bg}`}>
                <td className="px-4 py-2.5 text-slate-700 dark:text-slate-200">
                  <span className="font-semibold">{w.date} — {isBiba ? 'Biba (Investim)' : `${debtorName} (Borxh)`}</span>
                  <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">
                    {(isBiba ? [w.person, w.note] : [w.note]).filter(Boolean).join(' · ') || (isBiba ? '30% zbret borxhin' : `rrit borxhin ${debtorName}→Biba`)}
                  </span>
                </td>
                {activeCurs.map(c => (
                  <td key={c} className={`px-3 py-2.5 text-right tabular-nums font-semibold ${color}`}>
                    {fmtSigned(n(w[`amount_${c.toLowerCase()}`]), '−')}
                  </td>
                ))}
                <td className="px-3 py-2.5 text-right whitespace-nowrap">
                  <button onClick={() => startEdit(w)} className="text-indigo-600 hover:text-indigo-800 text-xs mr-2" title="Edito">✎</button>
                  <button onClick={() => del(w.id)} className="text-rose-600 hover:text-rose-800 text-xs" title="Fshi">🗑</button>
                </td>
              </tr>
            )
          })}
          {withdrawals.length === 0 && (
            <tr><td colSpan={activeCurs.length + 2} className="px-4 py-6 text-center text-slate-400 italic text-xs">
              Asnjë tërheqje investimi.
            </td></tr>
          )}
          {/* Totale per lloj */}
          {Object.keys(totals.biba_investment).length > 0 && (
            <tr className="border-t border-slate-200 dark:border-slate-700 bg-indigo-100/60 dark:bg-indigo-900/30">
              <td className="px-4 py-2 font-bold text-slate-700 dark:text-slate-200">
                = Total Biba (Investim)
                <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">tërheqje që zbritën borxhin e Dianës (30%)</span>
              </td>
              {activeCurs.map(c => (
                <td key={c} className="px-3 py-2 text-right tabular-nums font-bold text-indigo-800 dark:text-indigo-200">
                  {fmt(totals.biba_investment[c])}
                </td>
              ))}
              <td></td>
            </tr>
          )}
          {Object.keys(totals.diana_debt_by_name).sort().map(name => (
            <tr key={`debt-${name}`} className="border-t border-slate-200 dark:border-slate-700 bg-rose-100/60 dark:bg-rose-900/30">
              <td className="px-4 py-2 font-bold text-slate-700 dark:text-slate-200">
                = Total {name} (Borxh)
                <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">tërheqje që rritën borxhin {name}→Biba</span>
              </td>
              {activeCurs.map(c => (
                <td key={c} className="px-3 py-2 text-right tabular-nums font-bold text-rose-800 dark:text-rose-200">
                  {fmt(totals.diana_debt_by_name[name][c])}
                </td>
              ))}
              <td></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Seksion>
  )
}

// ─── Seksion 4: Shlyerje borxhi (historiku i pagesave) ───
function SeksionShlyerje({ data, activeCurs, flash, reload }) {
  const [showHistory, setShowHistory] = useState(false)
  const [payKey, setPayKey]       = useState(null) // "debtor||creditor||CUR"
  const [payAmount, setPayAmount] = useState('')
  const [payDate, setPayDate]     = useState(today())
  const [payNote, setPayNote]     = useState('')
  const [payMethod, setPayMethod] = useState('cash')
  const [paying, setPaying]       = useState(false)
  const [editingPay, setEditingPay] = useState(null) // {id, debtor, creditor, currency}

  const startEditPay = (p) => {
    const cur = p.currency || p.debt_currency
    setEditingPay({ id: p.id, debtor: p.debtor, creditor: p.creditor, currency: cur })
    setPayAmount(String(n(p.amount) || ''))
    setPayDate(p.date || today())
    setPayNote(p.note || '')
    setPayMethod(p.payment_method === 'bank' ? 'bank' : 'cash')
    setPayKey(null)
    setShowHistory(true)
  }
  const cancelEditPay = () => {
    setEditingPay(null)
    setPayAmount(''); setPayDate(today()); setPayNote(''); setPayMethod('cash')
  }

  // Grupo borxhet aktive sipas çiftit+monedhës për formën e pagesës FIFO.
  const activeGroups = useMemo(() => {
    const g = {}
    for (const d of (data.debts || [])) {
      if (n(d.remaining) <= 0.005) continue
      const key = `${d.debtor}||${d.creditor}||${d.currency}`
      if (!g[key]) g[key] = {
        key, debtor: d.debtor, creditor: d.creditor, currency: d.currency, remaining: 0,
      }
      g[key].remaining += n(d.remaining)
    }
    return Object.values(g)
  }, [data])

  // Të gjitha pagesat (nga historiku i borxheve).
  const payments = useMemo(() => {
    const list = []
    for (const d of (data.debts || [])) {
      for (const p of (d.payments || [])) {
        list.push({ ...p, debtor: d.debtor, creditor: d.creditor, debt_currency: d.currency })
      }
    }
    return list.sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id - a.id)
  }, [data])

  // Totale per monedhë.
  const totalsByCur = useMemo(() => {
    const t = {}
    for (const p of payments) {
      const c = p.currency || p.debt_currency
      t[c] = (t[c] || 0) + n(p.amount)
    }
    return t
  }, [payments])

  const activeGroup = activeGroups.find(g => g.key === payKey)

  const submitPay = async (e) => {
    e.preventDefault()
    if (!activeGroup)       { flash('⚠ Zgjidh borxhin'); return }
    if (n(payAmount) <= 0)  { flash('⚠ Shumë > 0'); return }
    setPaying(true)
    try {
      const r = await fetch('/api/investimi/debt-payments/consolidated', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          debtor: activeGroup.debtor, creditor: activeGroup.creditor,
          amount: n(payAmount), currency: activeGroup.currency,
          date: payDate, note: payNote, payment_method: payMethod,
        }),
      })
      if (!r.ok) throw new Error((await r.json()).error || 'Gabim')
      const resp = await r.json().catch(() => ({}))
      setPayAmount(''); setPayNote(''); setPayDate(today()); setPayKey(null); setPayMethod('cash')
      const nPays = resp?.payments?.length || 0
      flash(`✓ Pagesa u regjistrua${nPays > 1 ? ` (${nPays} borxhe)` : ''}`)
      await reload()
    } catch (e) { flash('✗ ' + e.message) }
    setPaying(false)
  }

  const delPay = async (id) => {
    const ok = await showConfirm('Të fshihet kjo pagesë?', { confirmLabel: 'Fshi', danger: true })
    if (!ok) return
    try {
      const r = await fetch(`/api/investimi/debt-payments/${id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error((await r.json()).error || 'Gabim')
      flash('✓ Pagesa u fshi'); await reload()
    } catch (e) { flash('✗ ' + e.message) }
  }

  const submitEditPay = async (e) => {
    e.preventDefault()
    if (!editingPay)         { return }
    if (n(payAmount) <= 0)   { flash('⚠ Shumë > 0'); return }
    setPaying(true)
    try {
      const r = await fetch(`/api/investimi/debt-payments/${editingPay.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: n(payAmount), date: payDate, note: payNote, payment_method: payMethod,
        }),
      })
      if (!r.ok) throw new Error((await r.json()).error || 'Gabim')
      cancelEditPay()
      flash('✓ Pagesa u përditësua')
      await reload()
    } catch (e) { flash('✗ ' + e.message) }
    setPaying(false)
  }

  return (
    <Seksion
      title="Shlyerje Borxhi (Historik)"
      action={activeGroups.length > 0 && (
        <select value={payKey || ''} onChange={e => { setPayKey(e.target.value || null); setPayDate(today()); setPayAmount('') }}
          className="input-field text-xs">
          <option value="">+ Pagesë e Re — zgjidh borxhin…</option>
          {activeGroups.map(g => (
            <option key={g.key} value={g.key}>{g.debtor}→{g.creditor} ({g.currency}) · mbetet {fmt(g.remaining)}</option>
          ))}
        </select>
      )}
    >
      {editingPay && (
        <form onSubmit={submitEditPay} className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-amber-50/40 dark:bg-amber-900/10 grid gap-2 sm:grid-cols-6">
          <div className="sm:col-span-6 text-xs text-amber-700 dark:text-amber-300">
            ✎ Edito pagesën për <strong>{editingPay.debtor} → {editingPay.creditor} ({editingPay.currency})</strong> — monedha mbetet fiks.
          </div>
          <label className="text-xs sm:col-span-2">
            <span className="block text-slate-500 mb-1">Shuma ({editingPay.currency})</span>
            <input type="number" step="0.01" min="0" value={payAmount} onChange={e => setPayAmount(e.target.value)}
              className="input-field w-full tabular-nums text-right" autoFocus />
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
            <span className="block text-slate-500 mb-1">Koment / sqarim</span>
            <input value={payNote} onChange={e => setPayNote(e.target.value)} className="input-field w-full" />
          </label>
          <div className="sm:col-span-5 flex gap-2 justify-end">
            <button type="button" onClick={cancelEditPay} className="btn-secondary text-xs">Anulo</button>
          </div>
          <div className="sm:col-span-1 flex items-end">
            <button type="submit" disabled={paying} className="btn-primary text-xs w-full">
              {paying ? '…' : '💾 Ruaj'}
            </button>
          </div>
        </form>
      )}
      {payKey && activeGroup && !editingPay && (
        <form onSubmit={submitPay} className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-emerald-50/40 dark:bg-emerald-900/10 grid gap-2 sm:grid-cols-6">
          <div className="sm:col-span-6 text-xs text-slate-600 dark:text-slate-300">
            Pagesë për <strong>{activeGroup.debtor} → {activeGroup.creditor} ({activeGroup.currency})</strong> — shpërndahet FIFO (më i vjetri i pari).
          </div>
          <label className="text-xs sm:col-span-2">
            <span className="block text-slate-500 mb-1">Shuma ({activeGroup.currency}) — max {fmt(activeGroup.remaining)}</span>
            <input type="number" step="0.01" min="0" value={payAmount} onChange={e => setPayAmount(e.target.value)}
              className="input-field w-full tabular-nums text-right" autoFocus />
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
            <span className="block text-slate-500 mb-1">Koment / sqarim</span>
            <input value={payNote} onChange={e => setPayNote(e.target.value)} className="input-field w-full" placeholder="p.sh. pjesë nga paga" />
          </label>
          <div className="sm:col-span-5 flex gap-2 justify-end">
            <button type="button" onClick={() => setPayKey(null)} className="btn-secondary text-xs">Anulo</button>
          </div>
          <div className="sm:col-span-1 flex items-end">
            <button type="submit" disabled={paying} className="btn-primary text-xs w-full">
              {paying ? '…' : '💾 Ruaj'}
            </button>
          </div>
        </form>
      )}

      <table className="w-full text-sm">
        <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800">
          <tr>
            <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">Zëri</th>
            {activeCurs.map(c => (
              <th key={c} className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-500">{c}</th>
            ))}
            <th className="px-3 py-2 w-16"></th>
          </tr>
        </thead>
        <tbody>
          {payments.length > 0 && (
            <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/30">
              <td colSpan={activeCurs.length + 2}>
                <button type="button" onClick={() => setShowHistory(v => !v)}
                  className="w-full px-4 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800/50 transition flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {showHistory ? '▾' : '▸'} Historik pagesash ({payments.length})
                  </span>
                  <span className="text-[10px] text-slate-400">{showHistory ? 'kliko për të fshehur' : 'kliko për të shfaqur'}</span>
                </button>
              </td>
            </tr>
          )}
          {showHistory && payments.map(p => {
            const cur = p.currency || p.debt_currency
            const pm = p.payment_method === 'bank' ? '🏦' : '💵'
            const srcLabel = p.source_withdrawal_id > 0 ? ' · nga tërheqje' : ''
            return (
              <tr key={p.id} className="border-b border-slate-100 dark:border-slate-800 bg-emerald-50/30 dark:bg-emerald-900/10">
                <td className="px-4 py-2.5 text-slate-700 dark:text-slate-200">
                  <span className="font-semibold">{p.date} — {p.debtor} → {p.creditor}</span>
                  <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">
                    {pm} {p.note || ''}{srcLabel}
                  </span>
                </td>
                {activeCurs.map(c => (
                  <td key={c} className="px-3 py-2.5 text-right tabular-nums font-semibold text-emerald-700 dark:text-emerald-300">
                    {c === cur ? fmtSigned(n(p.amount), '+') : '-'}
                  </td>
                ))}
                <td className="px-3 py-2.5 text-right whitespace-nowrap">
                  {p.source_withdrawal_id > 0 ? (
                    <span className="text-slate-300 dark:text-slate-600 text-xs mr-2" title="Pagesë nga tërheqje — edito tërheqjen">✎</span>
                  ) : (
                    <button onClick={() => startEditPay(p)} className="text-indigo-600 hover:text-indigo-800 text-xs mr-2" title="Edito">✎</button>
                  )}
                  <button onClick={() => delPay(p.id)} className="text-rose-600 hover:text-rose-800 text-xs" title="Fshi">🗑</button>
                </td>
              </tr>
            )
          })}
          {payments.length === 0 && (
            <tr><td colSpan={activeCurs.length + 2} className="px-4 py-6 text-center text-slate-400 italic text-xs">
              Asnjë pagesë.
            </td></tr>
          )}
          <tr className="border-t-2 border-slate-300 dark:border-slate-700 bg-emerald-100 dark:bg-emerald-900/30">
            <td className="px-4 py-3 font-bold text-slate-800 dark:text-slate-100">
              = Total Pagesa
              <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">shuma e paguar deri sot</span>
            </td>
            {activeCurs.map(c => (
              <td key={c} className="px-3 py-3 text-right tabular-nums font-bold text-emerald-800 dark:text-emerald-200">
                {fmt(totalsByCur[c])}
              </td>
            ))}
            <td></td>
          </tr>
        </tbody>
      </table>
    </Seksion>
  )
}
