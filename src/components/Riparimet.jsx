import { useCallback, useEffect, useMemo, useState } from 'react'
import { getUser } from '../lib/auth.js'
import { useRealtimeSync } from '../hooks/useRealtimeSync.js'
import MoneyInput from './MoneyInput.jsx'

const STATUS_META = {
  pranuar:  { label: 'Pranuar',     cls: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200',    dot: 'bg-slate-400' },
  ne_pune:  { label: 'Në punë',     cls: 'bg-amber-100 text-amber-700 dark:text-amber-300',    dot: 'bg-amber-500' },
  gati:     { label: 'Gati',        cls: 'bg-emerald-100 text-emerald-700 dark:text-emerald-300', dot: 'bg-emerald-500' },
  dorezuar: { label: 'Dorëzuar',    cls: 'bg-blue-100 text-blue-700 dark:text-blue-300',      dot: 'bg-blue-500' },
}
const STATUS_ORDER = ['pranuar', 'ne_pune', 'gati', 'dorezuar']

const CURRENCIES = ['LEK', 'EUR', 'USD', 'GBP', 'CHF']

function today() {
  return new Date().toISOString().split('T')[0]
}

function EMPTY() {
  return {
    date_received: today(),
    customer_name: '',
    customer_phone: '',
    item_description: '',
    issue_description: '',
    notes: '',
    price: '',
    currency: 'EUR',
    status: 'pranuar',
    date_delivered: '',
    paid: 0,
  }
}

function fmtNum(v) {
  const n = parseFloat(v) || 0
  return n.toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function RepairModal({ repair, onClose, onSave }) {
  const [form, setForm] = useState(() => repair ? { ...EMPTY(), ...repair } : EMPTY())
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const submit = (e) => {
    e.preventDefault()
    if (!form.customer_name.trim() || !form.item_description.trim() || !form.date_received) {
      alert('Plotësoni Datën, Emrin e klientit dhe Përshkrimin e sendit.')
      return
    }
    onSave(form)
  }
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box max-w-2xl">
        <div className="modal-header">
          <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">
            {repair?.id ? `Edito Riparimin #${repair.id}` : 'Riparim i Ri'}
          </h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 dark:text-slate-500 text-xl">×</button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="form-label">Data e Marrjes *</label>
                <input type="date" value={form.date_received}
                  onChange={e => set('date_received', e.target.value)}
                  className="input-field" required />
              </div>
              <div>
                <label className="form-label">Statusi</label>
                <select value={form.status} onChange={e => set('status', e.target.value)} className="input-field">
                  {STATUS_ORDER.map(s => (
                    <option key={s} value={s}>{STATUS_META[s].label}</option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="form-label">Emri i Klientit *</label>
                <input type="text" value={form.customer_name}
                  onChange={e => set('customer_name', e.target.value)}
                  className="input-field" placeholder="p.sh. Anila Doda" autoFocus required />
              </div>
              <div className="md:col-span-2">
                <label className="form-label">Telefoni</label>
                <input type="text" value={form.customer_phone}
                  onChange={e => set('customer_phone', e.target.value)}
                  className="input-field" placeholder="opsional" />
              </div>

              <div className="md:col-span-2">
                <label className="form-label">Sendi për Riparim *</label>
                <input type="text" value={form.item_description}
                  onChange={e => set('item_description', e.target.value)}
                  className="input-field" placeholder="p.sh. Unazë ari 18k me diamant" required />
              </div>

              <div className="md:col-span-2">
                <label className="form-label">Problemi / Ndërhyrja</label>
                <textarea value={form.issue_description}
                  onChange={e => set('issue_description', e.target.value)}
                  className="input-field resize-none" rows={2}
                  placeholder="p.sh. Zvogëlim mase, ndreqje kapëse, pastrim..." />
              </div>

              <div>
                <label className="form-label">Çmimi</label>
                <MoneyInput value={form.price}
                  onChange={v => set('price', String(v))}
                  className="input-field text-right tabular-nums" placeholder="0.00" />
              </div>
              <div>
                <label className="form-label">Monedha</label>
                <select value={form.currency} onChange={e => set('currency', e.target.value)} className="input-field">
                  {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div>
                <label className="form-label">Data e Dorëzimit</label>
                <input type="date" value={form.date_delivered || ''}
                  onChange={e => set('date_delivered', e.target.value)}
                  className="input-field" />
              </div>
              <div className="flex items-end pb-2">
                <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
                  <input type="checkbox" checked={!!form.paid}
                    onChange={e => set('paid', e.target.checked ? 1 : 0)}
                    className="w-4 h-4" />
                  <span>I paguar</span>
                </label>
              </div>

              <div className="md:col-span-2">
                <label className="form-label">Shënime</label>
                <textarea value={form.notes}
                  onChange={e => set('notes', e.target.value)}
                  className="input-field resize-none" rows={2}
                  placeholder="opsional" />
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn-secondary">Anulo</button>
            <button type="submit" className="btn-primary">
              {repair?.id ? '💾 Ruaj Ndryshimet' : '+ Shto Riparimin'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function Riparimet() {
  const me = getUser()
  const isAdmin = me?.role === 'admin'
  const [items, setItems]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [modal, setModal]       = useState(null)
  const [confirmDel, setConfirmDel] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/repairs')
      const data = await res.json()
      setItems(Array.isArray(data) ? data : [])
    } catch (_) {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  useRealtimeSync('repairs', load)

  const save = async (data) => {
    const isEdit = !!data.id
    const url = isEdit ? `/api/repairs/${data.id}` : '/api/repairs'
    const method = isEdit ? 'PUT' : 'POST'
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e.error || 'Gabim'); return }
    setModal(null)
    load()
  }

  const remove = async (id) => {
    const res = await fetch(`/api/repairs/${id}`, { method: 'DELETE' })
    if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e.error || 'Gabim'); return }
    setConfirmDel(null)
    load()
  }

  const quickStatus = async (row, status) => {
    const payload = { ...row, status }
    if (status === 'dorezuar' && !row.date_delivered) {
      payload.date_delivered = today()
    }
    await save(payload)
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return items
      .filter(r => statusFilter === 'all' ? true : r.status === statusFilter)
      .filter(r => !q ? true : (
        (r.customer_name || '').toLowerCase().includes(q) ||
        (r.customer_phone || '').toLowerCase().includes(q) ||
        (r.item_description || '').toLowerCase().includes(q) ||
        (r.issue_description || '').toLowerCase().includes(q)
      ))
  }, [items, search, statusFilter])

  const counts = useMemo(() => {
    const c = { all: items.length, pranuar: 0, ne_pune: 0, gati: 0, dorezuar: 0 }
    for (const r of items) if (c[r.status] !== undefined) c[r.status]++
    return c
  }, [items])

  // Përmbledhje mbi setin e filtruar — reflekton pamjen aktuale (statusi + kërkimi).
  // Grupim sipas monedhës sepse çmimet mund të jenë në disa monedha njëkohësisht.
  const summary = useMemo(() => {
    const byCur = {} // { LEK: { total, paid, unpaid, paidCount, unpaidCount }, ... }
    const statusCount = { pranuar: 0, ne_pune: 0, gati: 0, dorezuar: 0 }
    let withPrice = 0
    for (const r of filtered) {
      if (statusCount[r.status] !== undefined) statusCount[r.status]++
      const price = parseFloat(r.price) || 0
      if (price <= 0) continue
      withPrice++
      const cur = r.currency || 'LEK'
      if (!byCur[cur]) byCur[cur] = { total: 0, paid: 0, unpaid: 0, paidCount: 0, unpaidCount: 0 }
      byCur[cur].total += price
      if (r.paid) { byCur[cur].paid += price; byCur[cur].paidCount++ }
      else        { byCur[cur].unpaid += price; byCur[cur].unpaidCount++ }
    }
    return { count: filtered.length, withPrice, statusCount, byCur }
  }, [filtered])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">Riparimet</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Regjistri i sendeve që klientët sjellin për riparim</p>
        </div>
        <button onClick={() => setModal('add')} className="btn-primary">+ Riparim i Ri</button>
      </div>

      {/* Filtra: status */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {[
          { id: 'all',       label: 'Të gjitha', cls: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200' },
          { id: 'pranuar',   label: STATUS_META.pranuar.label,   cls: STATUS_META.pranuar.cls },
          { id: 'ne_pune',   label: STATUS_META.ne_pune.label,   cls: STATUS_META.ne_pune.cls },
          { id: 'gati',      label: STATUS_META.gati.label,      cls: STATUS_META.gati.cls },
          { id: 'dorezuar',  label: STATUS_META.dorezuar.label,  cls: STATUS_META.dorezuar.cls },
        ].map(t => {
          const active = statusFilter === t.id
          return (
            <button key={t.id} onClick={() => setStatusFilter(t.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                active ? 'ring-2 ring-blue-400 border-transparent ' + t.cls
                       : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50'
              }`}>
              {t.label}
              <span className="ml-1.5 text-[10px] opacity-70">{counts[t.id] ?? 0}</span>
            </button>
          )
        })}
      </div>

      <div className="card">
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          className="input-field" placeholder="Kërko klient, telefon, ose përshkrim..." />
      </div>

      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-400 dark:text-slate-500 text-sm">Duke ngarkuar…</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center">
            <div className="text-5xl mb-3">🛠️</div>
            <p className="text-slate-500 dark:text-slate-400 mb-4">
              {items.length === 0 ? 'Nuk ka riparime të regjistruara.' : 'Asnjë riparim s\'përputhet me filtrin.'}
            </p>
            {items.length === 0 && (
              <button onClick={() => setModal('add')} className="btn-primary mx-auto">+ Riparimi i Parë</button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Data</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Klienti</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Sendi</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Problemi</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Çmimi</th>
                  <th className="px-3 py-3 text-center text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Status</th>
                  <th className="px-3 py-3 text-center text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Pagesa</th>
                  <th className="px-3 py-3 text-center text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Veprime</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => {
                  const meta = STATUS_META[r.status] || STATUS_META.pranuar
                  return (
                    <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="px-3 py-3 text-slate-600 dark:text-slate-300 text-xs whitespace-nowrap">{r.date_received}</td>
                      <td className="px-3 py-3">
                        <div className="font-semibold text-slate-800 dark:text-slate-100">{r.customer_name}</div>
                        {r.customer_phone && <div className="text-[11px] text-slate-500 dark:text-slate-400">{r.customer_phone}</div>}
                      </td>
                      <td className="px-3 py-3 text-slate-700 dark:text-slate-200">{r.item_description}</td>
                      <td className="px-3 py-3 text-slate-600 dark:text-slate-300 text-xs max-w-xs">
                        {r.issue_description || <span className="italic text-slate-400 dark:text-slate-500">—</span>}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums font-semibold text-slate-800 dark:text-slate-100 whitespace-nowrap">
                        {r.price > 0 ? `${fmtNum(r.price)} ${r.currency}` : <span className="text-slate-400 dark:text-slate-500">—</span>}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span className={`badge inline-flex items-center gap-1.5 ${meta.cls}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-center">
                        {r.paid
                          ? <span className="badge bg-emerald-100 text-emerald-700 dark:text-emerald-300">✓ Paguar</span>
                          : <span className="badge bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">— </span>}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-center gap-1 flex-wrap">
                          {r.status !== 'ne_pune' && r.status !== 'dorezuar' && (
                            <button onClick={() => quickStatus(r, 'ne_pune')}
                              className="px-2 py-1 rounded-lg bg-amber-50 dark:bg-amber-900/30 hover:bg-amber-100 text-amber-700 dark:text-amber-300 text-[10px] font-semibold whitespace-nowrap"
                              title="Shëno në punë">▶ Në punë</button>
                          )}
                          {r.status !== 'gati' && r.status !== 'dorezuar' && (
                            <button onClick={() => quickStatus(r, 'gati')}
                              className="px-2 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 hover:bg-emerald-100 text-emerald-700 dark:text-emerald-300 text-[10px] font-semibold whitespace-nowrap"
                              title="Shëno gati">✓ Gati</button>
                          )}
                          {r.status !== 'dorezuar' && (
                            <button onClick={() => quickStatus(r, 'dorezuar')}
                              className="px-2 py-1 rounded-lg bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 text-blue-700 dark:text-blue-300 text-[10px] font-semibold whitespace-nowrap"
                              title="Dorëzoje">📤 Dorëzo</button>
                          )}
                          <button onClick={() => setModal(r)}
                            className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-[10px] font-semibold">Edito</button>
                          {isAdmin && (
                            <button onClick={() => setConfirmDel(r)}
                              className="px-2 py-1 rounded-lg bg-red-50 dark:bg-red-900/30 hover:bg-red-100 text-red-600 text-[10px] font-semibold">Fshi</button>
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

      {!loading && filtered.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div>
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">📊 Përmbledhje</h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {statusFilter === 'all' && !search.trim()
                  ? 'Për të gjitha riparimet'
                  : `Për ${filtered.length} riparimet e filtruara`}
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-slate-600 dark:text-slate-300">Total riparime:</span>
              <span className="text-2xl font-extrabold text-blue-700 dark:text-blue-300 tabular-nums">{summary.count}</span>
            </div>
          </div>

          {/* Ndarje sipas statusit */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
            {STATUS_ORDER.map(s => {
              const meta = STATUS_META[s]
              const n = summary.statusCount[s] || 0
              return (
                <div key={s} className={`rounded-lg p-2.5 border border-slate-200 dark:border-slate-700 flex items-center justify-between`}>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${meta.dot}`} />
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">{meta.label}</span>
                  </div>
                  <span className="text-lg font-bold text-slate-800 dark:text-slate-100 tabular-nums">{n}</span>
                </div>
              )
            })}
          </div>

          {/* Totalet sipas monedhës */}
          {Object.keys(summary.byCur).length === 0 ? (
            <p className="text-xs text-slate-400 dark:text-slate-500 italic">Asnjë çmim i vendosur për këto riparime.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 dark:bg-slate-900">
                  <tr className="text-slate-500 dark:text-slate-400 uppercase text-[10px]">
                    <th className="px-3 py-2 text-left font-semibold">Monedha</th>
                    <th className="px-3 py-2 text-right font-semibold">Total</th>
                    <th className="px-3 py-2 text-right font-semibold">✓ Paguar</th>
                    <th className="px-3 py-2 text-right font-semibold">Pa Paguar</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(summary.byCur).sort(([a],[b]) => a.localeCompare(b)).map(([cur, s]) => (
                    <tr key={cur} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="px-3 py-2">
                        <span className="badge bg-blue-100 text-blue-700 dark:text-blue-300">{cur}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-bold text-slate-800 dark:text-slate-100">{fmtNum(s.total)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-700 dark:text-emerald-300">
                        {fmtNum(s.paid)}
                        <span className="ml-1 text-[10px] text-slate-400 dark:text-slate-500">({s.paidCount})</span>
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums ${s.unpaid > 0.005 ? 'text-red-700 dark:text-red-300 font-semibold' : 'text-slate-400 dark:text-slate-500'}`}>
                        {s.unpaid > 0.005 ? fmtNum(s.unpaid) : '—'}
                        {s.unpaidCount > 0 && <span className="ml-1 text-[10px] text-slate-400 dark:text-slate-500">({s.unpaidCount})</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {modal && (
        <RepairModal
          repair={modal === 'add' ? null : modal}
          onClose={() => setModal(null)}
          onSave={save}
        />
      )}

      {confirmDel && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setConfirmDel(null)}>
          <div className="modal-box max-w-md">
            <div className="modal-header"><h3 className="font-bold text-slate-800 dark:text-slate-100">Konfirmo fshirjen</h3></div>
            <div className="modal-body">
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Fshi riparimin e <span className="font-semibold">{confirmDel.customer_name}</span>
                {' '}— {confirmDel.item_description}?
              </p>
            </div>
            <div className="modal-footer">
              <button onClick={() => setConfirmDel(null)} className="btn-secondary">Anulo</button>
              <button onClick={() => remove(confirmDel.id)} className="btn-danger">Fshi</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
