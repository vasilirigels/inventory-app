import { useEffect, useMemo, useState, useCallback } from 'react'

const CUR = ['lek', 'eur', 'usd', 'gbp', 'chf']
const CUR_LABEL = { lek: 'LEK', eur: 'EUR', usd: 'USD', gbp: 'GBP', chf: 'CHF' }

function n(v) { return parseFloat(v) || 0 }
function fmt(v, dec = 2) {
  const num = n(v)
  if (num === 0) return '—'
  return num.toLocaleString('sq-AL', { minimumFractionDigits: dec === 0 ? 0 : 2, maximumFractionDigits: dec })
}
function today() { return new Date().toISOString().split('T')[0] }
function fmtDate(s) {
  if (!s) return '—'
  const [y, m, d] = s.split('-')
  return `${parseInt(d)}/${parseInt(m)}/${y}`
}

// Compute balance per currency: debt − paid. Positive means customer owes.
function balances(c) {
  const b = {}
  CUR.forEach(cur => { b[cur] = n(c[`debt_${cur}`]) - n(c[`paid_${cur}`]) })
  return b
}
function hasDebt(b) { return CUR.some(c => b[c] > 0.005) }

export default function CustomersLedger({ initialFilter, onNavigate }) {
  const [customers, setCustomers] = useState([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [filter, setFilter]       = useState(initialFilter || 'all') // all | indebted | clear
  const [sortBy, setSortBy]       = useState('balance_eur')           // name | balance_<cur> | last_date | entries
  const [sortDir, setSortDir]     = useState('desc')
  const [active, setActive]       = useState(null) // active customer (drawer open)

  const [quickForm, setQuickForm] = useState({
    open: false, name: '', type: 'debt', date: today(),
    lek: '', eur: '', usd: '', gbp: '', chf: '',
  })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/customers/summary')
      const data = await res.json()
      setCustomers(Array.isArray(data) ? data : [])
    } catch (e) { console.error(e) }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const enriched = customers.map(c => ({ ...c, balances: balances(c) }))

  const filtered = useMemo(() => {
    return enriched
      .filter(c => !search || c.name.toLowerCase().includes(search.toLowerCase()))
      .filter(c => {
        if (filter === 'indebted') return hasDebt(c.balances)
        if (filter === 'clear')    return !hasDebt(c.balances)
        return true
      })
      .sort((a, b) => {
        let av, bv
        if (sortBy === 'name')       { av = a.name; bv = b.name; }
        else if (sortBy === 'entries')   { av = a.entries; bv = b.entries; }
        else if (sortBy === 'last_date') { av = a.last_date || ''; bv = b.last_date || ''; }
        else if (sortBy.startsWith('balance_')) {
          const cur = sortBy.split('_')[1]
          av = a.balances[cur]; bv = b.balances[cur];
        }
        if (av < bv) return sortDir === 'asc' ? -1 : 1
        if (av > bv) return sortDir === 'asc' ? 1 : -1
        return 0
      })
  }, [enriched, search, filter, sortBy, sortDir])

  // Totals (outstanding only, positive balances)
  const totals = {}
  CUR.forEach(cur => { totals[cur] = enriched.reduce((s, c) => s + Math.max(0, c.balances[cur]), 0) })

  const indebted = enriched.filter(c => hasDebt(c.balances)).length
  const cleared  = enriched.length - indebted

  const sort = (col) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(col); setSortDir('desc') }
  }
  const sortIcon = col => sortBy === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''

  // Quick-add
  const submitQuick = async (e) => {
    e.preventDefault()
    if (!quickForm.name.trim()) return
    setBusy(true)
    try {
      await fetch('/api/debts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: quickForm.date, name: quickForm.name.trim(), type: quickForm.type,
          lek: n(quickForm.lek), eur: n(quickForm.eur), usd: n(quickForm.usd), gbp: n(quickForm.gbp), chf: n(quickForm.chf),
        }),
      })
      setQuickForm({ open: false, name: '', type: 'debt', date: today(), lek: '', eur: '', usd: '', gbp: '', chf: '' })
      await load()
      if (active && active.name === quickForm.name.trim()) {
        // reload active customer too
        openDrawer(quickForm.name.trim())
      }
    } catch (e) { console.error(e) }
    setBusy(false)
  }

  const openDrawer = async (name) => {
    const c = enriched.find(x => x.name === name)
    setActive({ name, summary: c, transactions: null, loading: true })
    try {
      const res = await fetch(`/api/customers/${encodeURIComponent(name)}/transactions`)
      const tx = await res.json()
      setActive(a => a && a.name === name ? { ...a, transactions: tx, loading: false } : a)
    } catch (e) { setActive(a => a ? { ...a, loading: false } : a) }
  }

  const deleteTx = async id => {
    if (!confirm('Fshi këtë transaksion?')) return
    await fetch(`/api/debts/${id}`, { method: 'DELETE' })
    await load()
    if (active) await openDrawer(active.name)
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-slate-400">
      <div className="text-center"><div className="text-4xl mb-3 animate-pulse">👥</div><p className="text-sm">Duke ngarkuar klientët...</p></div>
    </div>
  )

  return (
    <div className="space-y-5">
      {/* ── Top stats ── */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Stat label="Klientë" value={enriched.length} color="slate" />
        <Stat label="Me Borxh" value={indebted}        color="rose" />
        <Stat label="Shlyer"    value={cleared}        color="emerald" />
        <Stat label="Borxh EUR" value={fmt(totals.eur)} color="amber" />
        <Stat label="Borxh LEK" value={fmt(totals.lek, 0)} color="amber" />
        <Stat label="Borxh USD" value={fmt(totals.usd)} color="amber" />
      </div>

      {/* ── Toolbar ── */}
      <div className="bg-white rounded-xl border border-slate-200 p-3 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px] relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">🔍</span>
          <input type="text" placeholder="Kërko klient..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="flex bg-slate-100 rounded-lg p-0.5">
          {[
            { id: 'all',      label: 'Të gjithë' },
            { id: 'indebted', label: '⚠️ Me borxh' },
            { id: 'clear',    label: '✅ Shlyer' },
          ].map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${filter === f.id ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
              {f.label}
            </button>
          ))}
        </div>
        <button onClick={() => setQuickForm(f => ({ ...f, open: !f.open }))}
          className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-md">
          + Shto regjistrim
        </button>
      </div>

      {/* ── Quick add form ── */}
      {quickForm.open && (
        <form onSubmit={submitQuick} className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-[10px] text-slate-500 mb-0.5 uppercase font-semibold">Lloji</label>
              <div className="flex bg-slate-100 rounded-md p-0.5">
                {['debt','repayment'].map(t => (
                  <button key={t} type="button" onClick={() => setQuickForm(f => ({ ...f, type: t }))}
                    className={`px-3 py-1.5 text-xs font-medium rounded ${quickForm.type === t ? (t === 'debt' ? 'bg-rose-600 text-white' : 'bg-emerald-600 text-white') : 'text-slate-500'}`}>
                    {t === 'debt' ? 'Borxh i ri' : 'Kthim borxhi'}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 mb-0.5 uppercase font-semibold">Data</label>
              <input type="date" value={quickForm.date} onChange={e => setQuickForm(f => ({ ...f, date: e.target.value }))}
                className="px-2 py-2 border border-slate-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="flex-1 min-w-[180px]">
              <label className="block text-[10px] text-slate-500 mb-0.5 uppercase font-semibold">Emri</label>
              <input type="text" value={quickForm.name} onChange={e => setQuickForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Emri i klientit" required
                className="w-full px-2 py-2 border border-slate-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {CUR.map(cur => (
              <div key={cur}>
                <label className="block text-[10px] text-slate-500 mb-0.5 uppercase font-semibold">{CUR_LABEL[cur]}</label>
                <input type="number" step="any" value={quickForm[cur]} onChange={e => setQuickForm(f => ({ ...f, [cur]: e.target.value }))}
                  placeholder="0"
                  className="w-full px-2 py-2 border border-slate-200 rounded-md text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setQuickForm({ open: false, name: '', type: 'debt', date: today(), lek: '', eur: '', usd: '', gbp: '', chf: '' })}
              className="px-3 py-2 text-sm text-slate-600 hover:text-slate-800">Anulo</button>
            <button type="submit" disabled={busy}
              className={`px-4 py-2 text-sm font-medium text-white rounded-md disabled:opacity-50 ${quickForm.type === 'debt' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
              {busy ? 'Duke ruajtur…' : 'Ruaj'}
            </button>
          </div>
        </form>
      )}

      {/* ── Table ── */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <p className="text-xs text-slate-500 px-4 py-2 border-b border-slate-100">{filtered.length} klientë{search || filter !== 'all' ? ' (filtruar)' : ''}</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <ThSort label="Klienti" col="name" sortBy={sortBy} sortIcon={sortIcon} onClick={sort} align="left" />
                {CUR.map(cur => (
                  <ThSort key={cur} label={`Bilanc ${CUR_LABEL[cur]}`} col={`balance_${cur}`} sortBy={sortBy} sortIcon={sortIcon} onClick={sort} align="right" />
                ))}
                <ThSort label="Tx" col="entries" sortBy={sortBy} sortIcon={sortIcon} onClick={sort} align="center" />
                <ThSort label="Data e fundit" col="last_date" sortBy={sortBy} sortIcon={sortIcon} onClick={sort} align="left" />
                <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase text-center">Statusi</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const ind = hasDebt(c.balances)
                return (
                  <tr key={c.name}
                    onClick={() => openDrawer(c.name)}
                    className="border-b border-slate-100 hover:bg-blue-50 cursor-pointer transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold ${ind ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>
                          {c.name.charAt(0).toUpperCase()}
                        </div>
                        <span className="font-semibold text-slate-800">{c.name}</span>
                      </div>
                    </td>
                    {CUR.map(cur => {
                      const b = c.balances[cur]
                      return (
                        <td key={cur} className="px-3 py-3 text-right tabular-nums">
                          {b > 0.005 ? <span className="text-rose-600 font-semibold">{fmt(b, cur === 'lek' ? 0 : 2)}</span>
                          : b < -0.005 ? <span className="text-emerald-600">+{fmt(-b, cur === 'lek' ? 0 : 2)}</span>
                          : <span className="text-slate-400">—</span>}
                        </td>
                      )
                    })}
                    <td className="px-3 py-3 text-center text-xs text-slate-500">{c.entries}</td>
                    <td className="px-3 py-3 text-xs text-slate-500">{fmtDate(c.last_date)}</td>
                    <td className="px-3 py-3 text-center">
                      {ind
                        ? <span className="inline-block px-2 py-0.5 text-[10px] font-semibold rounded bg-rose-100 text-rose-700">Me borxh</span>
                        : <span className="inline-block px-2 py-0.5 text-[10px] font-semibold rounded bg-emerald-100 text-emerald-700">Shlyer</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            {filtered.length > 0 && (
              <tfoot>
                <tr className="bg-slate-50 font-bold border-t-2 border-slate-200">
                  <td className="px-4 py-2 text-slate-700">Total (vetëm borxhe)</td>
                  {CUR.map(cur => (
                    <td key={cur} className="px-3 py-2 text-right tabular-nums text-rose-700">{fmt(totals[cur], cur === 'lek' ? 0 : 2)}</td>
                  ))}
                  <td colSpan={3}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        {filtered.length === 0 && (
          <div className="text-center py-10 text-slate-400 text-sm">Nuk u gjet asnjë klient</div>
        )}
      </div>

      {/* ── Customer drawer ── */}
      {active && <CustomerDrawer customer={active} onClose={() => setActive(null)} onDelete={deleteTx} onNavigate={onNavigate} />}
    </div>
  )
}

function Stat({ label, value, color }) {
  const map = {
    slate: 'bg-slate-50 text-slate-700',
    rose: 'bg-rose-50 text-rose-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
  }
  return (
    <div className={`rounded-xl border border-slate-200 p-4 ${map[color]}`}>
      <p className="text-[10px] uppercase font-semibold opacity-80">{label}</p>
      <p className="text-2xl font-extrabold mt-1 tabular-nums">{value}</p>
    </div>
  )
}

function ThSort({ label, col, sortBy, sortIcon, onClick, align = 'left' }) {
  const alignClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
  return (
    <th onClick={() => onClick(col)}
      className={`px-3 py-2 text-xs font-semibold text-slate-500 uppercase cursor-pointer hover:text-slate-700 select-none ${alignClass}`}>
      {label}{sortIcon(col)}
    </th>
  )
}

function CustomerDrawer({ customer, onClose, onDelete, onNavigate }) {
  const { name, summary, transactions, loading } = customer
  const balance = summary ? summary.balances : null

  // Running balance computation per currency
  const txWithBalance = useMemo(() => {
    if (!transactions) return []
    const run = { lek: 0, eur: 0, usd: 0, gbp: 0, chf: 0 }
    return transactions.map(t => {
      const sign = t.type === 'debt' ? 1 : -1
      CUR.forEach(c => { run[c] += sign * n(t[c]) })
      return { ...t, running: { ...run } }
    })
  }, [transactions])

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-3xl bg-white shadow-2xl overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-slate-200 px-5 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center text-base font-bold">
              {name.charAt(0).toUpperCase()}
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-800">{name}</h3>
              {summary && <p className="text-xs text-slate-500">{summary.entries} transaksione · {fmtDate(summary.first_date)} → {fmtDate(summary.last_date)}</p>}
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-md hover:bg-slate-100 text-slate-500 text-xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-4">
          {balance && (
            <div>
              <p className="text-[10px] text-slate-500 uppercase font-semibold mb-2">Bilanci aktual</p>
              <div className="grid grid-cols-5 gap-2">
                {CUR.map(cur => {
                  const v = balance[cur]
                  return (
                    <div key={cur} className={`rounded-lg border p-3 ${v > 0.005 ? 'bg-rose-50 border-rose-200' : v < -0.005 ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200'}`}>
                      <p className="text-[10px] font-semibold text-slate-500 uppercase">{CUR_LABEL[cur]}</p>
                      <p className={`text-base font-bold tabular-nums mt-1 ${v > 0.005 ? 'text-rose-700' : v < -0.005 ? 'text-emerald-700' : 'text-slate-400'}`}>
                        {v === 0 ? '—' : (v > 0 ? '' : '+') + fmt(Math.abs(v), cur === 'lek' ? 0 : 2)}
                      </p>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div>
            <p className="text-[10px] text-slate-500 uppercase font-semibold mb-2">Historiku i transaksioneve</p>
            {loading && <p className="text-sm text-slate-400">Duke ngarkuar…</p>}
            {!loading && txWithBalance.length === 0 && <p className="text-sm text-slate-400">Asnjë transaksion.</p>}
            {!loading && txWithBalance.length > 0 && (
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-2 py-2 text-left">Data</th>
                      <th className="px-2 py-2 text-left">Lloji</th>
                      {CUR.map(cur => <th key={cur} className="px-2 py-2 text-right">{CUR_LABEL[cur]}</th>)}
                      <th className="px-2 py-2 text-right">Bilanci EUR</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {txWithBalance.map(t => (
                      <tr key={t.id} className={`border-t border-slate-100 ${t.type === 'debt' ? '' : 'bg-emerald-50/30'}`}>
                        <td className="px-2 py-2 text-slate-700 whitespace-nowrap">
                          {fmtDate(t.date)}
                        </td>
                        <td className="px-2 py-2">
                          {t.type === 'debt'
                            ? <span className="px-2 py-0.5 text-[10px] font-semibold rounded bg-rose-100 text-rose-700">Borxh</span>
                            : <span className="px-2 py-0.5 text-[10px] font-semibold rounded bg-emerald-100 text-emerald-700">Kthim</span>}
                        </td>
                        {CUR.map(cur => {
                          const v = n(t[cur])
                          return <td key={cur} className={`px-2 py-2 text-right tabular-nums ${v === 0 ? 'text-slate-300' : t.type === 'debt' ? 'text-rose-600' : 'text-emerald-700'}`}>{v === 0 ? '—' : (t.type === 'debt' ? '' : '−') + fmt(v, cur === 'lek' ? 0 : 2)}</td>
                        })}
                        <td className={`px-2 py-2 text-right tabular-nums font-semibold ${t.running.eur > 0.005 ? 'text-rose-700' : t.running.eur < -0.005 ? 'text-emerald-700' : 'text-slate-400'}`}>{t.running.eur === 0 ? '—' : fmt(t.running.eur)}</td>
                        <td className="px-2 py-2 text-center">
                          <button onClick={() => onDelete(t.id)} className="text-rose-400 hover:text-rose-600 text-xs">✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
