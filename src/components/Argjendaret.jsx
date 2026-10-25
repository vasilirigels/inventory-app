import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRealtimeSync } from '../hooks/useRealtimeSync.js'

const STATUS_META = {
  pranuar:  { label: 'Pranuar',   cls: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200' },
  ne_pune:  { label: 'Në punë',   cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  gati:     { label: 'Gati',      cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  dorezuar: { label: 'Dorëzuar',  cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
}

function fmt(v) { return (parseFloat(v) || 0).toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }

export default function Argjendaret() {
  const [repairs, setRepairs] = useState([])
  const [argjendars, setArgjendars] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [rRes, aRes] = await Promise.all([
        fetch('/api/repairs').then(r => r.json()),
        fetch('/api/argjendars').then(r => r.json()).catch(() => []),
      ])
      setRepairs(Array.isArray(rRes) ? rRes : [])
      setArgjendars(Array.isArray(aRes) ? aRes : [])
    } catch {
      setRepairs([]); setArgjendars([])
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])
  useRealtimeSync('repairs', load)

  const grouped = useMemo(() => {
    // Grupon riparimet sipas argjendar_name. Përfshin edhe argjendarët nga tabela
    // argjendars edhe ata që shfaqen vetëm te repairs (për backwards compat).
    const map = new Map()
    for (const a of argjendars) map.set(a.name, { name: a.name, savedId: a.id, repairs: [] })
    for (const r of repairs) {
      const name = (r.argjendar_name || '').trim()
      if (!name) continue
      if (!map.has(name)) map.set(name, { name, savedId: null, repairs: [] })
      map.get(name).repairs.push(r)
    }
    const list = [...map.values()].map(g => {
      // Statistika për monedha
      const perCur = {}
      let countPaid = 0, countUnpaid = 0
      for (const r of g.repairs) {
        const cur = r.currency || 'LEK'
        if (!perCur[cur]) perCur[cur] = { paid: 0, unpaid: 0 }
        const price = parseFloat(r.price) || 0
        if (r.paid) { perCur[cur].paid += price; countPaid += 1 }
        else { perCur[cur].unpaid += price; countUnpaid += 1 }
      }
      return { ...g, perCur, countPaid, countUnpaid, countTotal: g.repairs.length }
    })
    return list.sort((a, b) => a.name.localeCompare(b.name, 'sq'))
  }, [repairs, argjendars])

  const visible = filter === 'all' ? grouped : grouped.filter(g => g.name === filter)

  const addArgjendar = async (e) => {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    setSaving(true); setErr('')
    try {
      const res = await fetch('/api/argjendars', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error === 'already_exists' ? 'Ky emër ekziston tashmë.' : (data.error || 'Gabim'))
      setNewName('')
      await load()
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  const removeArgjendar = async (name, id) => {
    if (!id) {
      alert('Ky emër ekziston vetëm si të dhëna historike te riparimet — nuk mund të fshihet nga lista zyrtare.')
      return
    }
    if (!confirm(`Fshi "${name}" nga lista e argjendarëve?\n\nRiparimet ekzistuese nuk ndryshohen.`)) return
    try {
      await fetch(`/api/argjendars/${id}`, { method: 'DELETE' })
      await load()
    } catch (e) { alert(e.message) }
  }

  return (
    <div className="space-y-4 max-w-6xl mx-auto">
      <div className="card">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">💍 Argjendarët</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">Secili argjendar me riparimet e tij, pagesat dhe borxhet.</p>
          </div>
          <div className="flex items-center gap-2">
            <select value={filter} onChange={e => setFilter(e.target.value)} className="input-field text-sm">
              <option value="all">Të gjithë argjendarët</option>
              {grouped.map(g => (
                <option key={g.name} value={g.name}>{g.name} ({g.countTotal})</option>
              ))}
            </select>
          </div>
        </div>

        <form onSubmit={addArgjendar} className="mt-4 flex gap-2 items-end border-t border-slate-200 dark:border-slate-700 pt-4">
          <div className="flex-1">
            <label className="form-label">Shto Argjendar të Ri</label>
            <input type="text" value={newName} onChange={e => setNewName(e.target.value)}
              placeholder="p.sh. Bujar, Fatos..." className="input-field" />
          </div>
          <button type="submit" disabled={saving || !newName.trim()}
            className="btn-primary disabled:opacity-50">
            {saving ? '…' : '+ Shto'}
          </button>
        </form>
        {err && <p className="text-xs text-rose-600 mt-2">{err}</p>}
      </div>

      {loading ? (
        <div className="card text-center py-12 text-slate-400">Duke ngarkuar…</div>
      ) : visible.length === 0 ? (
        <div className="card text-center py-12 text-slate-400">
          {filter === 'all' ? 'Asnjë argjendar ende. Shto të parin më sipër.' : 'Asnjë rezultat për këtë filtër.'}
        </div>
      ) : (
        <div className="space-y-4">
          {visible.map(g => (
            <ArgjendarCard key={g.name} group={g}
              onRemove={() => removeArgjendar(g.name, g.savedId)}
              onChanged={load} />
          ))}
        </div>
      )}
    </div>
  )
}

function ArgjendarCard({ group, onRemove, onChanged }) {
  const [expanded, setExpanded] = useState(false)
  const [paying, setPaying] = useState(null) // repair.id që po paguhet
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkDate, setBulkDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [bulkBusy, setBulkBusy] = useState(false)
  const curs = Object.keys(group.perCur)

  const payOne = async (r, dateStr) => {
    if (!dateStr) return
    setPaying(r.id)
    try {
      const res = await fetch(`/api/repairs/${r.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...r, paid: 1, argjendar_paid_date: dateStr }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Gabim')
      }
      onChanged?.()
    } catch (e) { alert(e.message) }
    finally { setPaying(null) }
  }

  const unpayOne = async (r) => {
    if (!confirm('Të anulohet pagesa për këtë riparim?')) return
    setPaying(r.id)
    try {
      const res = await fetch(`/api/repairs/${r.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...r, paid: 0, argjendar_paid_date: '' }),
      })
      if (!res.ok) throw new Error('Gabim')
      onChanged?.()
    } catch (e) { alert(e.message) }
    finally { setPaying(null) }
  }

  const openBulkPay = () => {
    const unpaid = group.repairs.filter(r => !r.paid && (parseFloat(r.price) || 0) > 0)
    if (unpaid.length === 0) { alert('Nuk ka riparime të papaguara.'); return }
    setBulkDate(new Date().toISOString().slice(0, 10))
    setBulkOpen(true)
  }

  const confirmBulkPay = async () => {
    const unpaid = group.repairs.filter(r => !r.paid && (parseFloat(r.price) || 0) > 0)
    if (!bulkDate || !/^\d{4}-\d{2}-\d{2}$/.test(bulkDate)) { alert('Vendos një datë të vlefshme.'); return }
    setBulkBusy(true)
    try {
      await Promise.all(unpaid.map(r =>
        fetch(`/api/repairs/${r.id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...r, paid: 1, argjendar_paid_date: bulkDate }),
        })
      ))
      setBulkOpen(false)
      onChanged?.()
    } catch (e) { alert(e.message) }
    finally { setBulkBusy(false) }
  }

  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-4 py-3 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <span className="text-2xl">💍</span>
          <div className="min-w-0">
            <h3 className="font-bold text-slate-800 dark:text-slate-100 truncate">{group.name}</h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {group.countTotal} riparime · {group.countPaid} paguar · {group.countUnpaid} pa paguar
              {!group.savedId && <span className="ml-2 text-amber-600" title="Vetëm nga historiku i riparimeve">⚠ pa listë</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {group.countUnpaid > 0 && (
            <button onClick={openBulkPay}
              className="text-xs px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
              title={`Paguaj ${group.countUnpaid} riparime të papaguara`}>
              💵 Paguaj të gjitha ({group.countUnpaid})
            </button>
          )}
          <button onClick={() => setExpanded(e => !e)} className="btn-secondary text-xs">
            {expanded ? '▲ Mbyll' : `▼ Shih ${group.countTotal} riparime`}
          </button>
          {group.savedId && (
            <button onClick={onRemove} className="text-xs px-2 py-1 rounded-md bg-rose-50 hover:bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300" title="Fshi nga lista">🗑</button>
          )}
        </div>
      </div>

      {curs.length > 0 && (
        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex flex-wrap gap-3">
          {curs.map(c => (
            <div key={c} className="flex-1 min-w-[160px] bg-slate-50 dark:bg-slate-900 rounded-lg px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">{c}</div>
              <div className="flex gap-3 mt-1 text-sm">
                <div>
                  <div className="text-[10px] text-emerald-700 dark:text-emerald-400">Paguar</div>
                  <div className="font-bold text-emerald-700 dark:text-emerald-300 tabular-nums">{fmt(group.perCur[c].paid)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-rose-700 dark:text-rose-400">Borxh</div>
                  <div className="font-bold text-rose-700 dark:text-rose-300 tabular-nums">{fmt(group.perCur[c].unpaid)}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {bulkOpen && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setBulkOpen(false)}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md">
            <div className="modal-header">
              <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">💵 Paguaj të gjitha</h3>
              <button onClick={() => setBulkOpen(false)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 text-xl">×</button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-sm text-slate-700 dark:text-slate-200">
                Do të markosh si të paguara <strong>{group.countUnpaid}</strong> riparime të papaguara të "<strong>{group.name}</strong>".
              </p>
              <div>
                <label className="form-label">Data e Pagesës *</label>
                <input type="date" value={bulkDate}
                  onChange={e => setBulkDate(e.target.value)}
                  className="input-field" />
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  Mund të zgjedhësh çdo datë — pagesa do të dalë nga arka e asaj dite.
                </p>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setBulkOpen(false)} className="btn-secondary" disabled={bulkBusy}>Anulo</button>
              <button onClick={confirmBulkPay} className="btn-primary disabled:opacity-50" disabled={bulkBusy || !bulkDate}>
                {bulkBusy ? 'Duke ruajtur…' : '💵 Konfirmo pagesën'}
              </button>
            </div>
          </div>
        </div>
      )}

      {expanded && (
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {group.repairs.map(r => (
            <div key={r.id} className="px-4 py-2.5 flex items-center gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/40">
              <span className={`text-[10px] px-2 py-0.5 rounded font-semibold ${STATUS_META[r.status]?.cls || 'bg-slate-100 text-slate-700'}`}>
                {STATUS_META[r.status]?.label || r.status}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
                  {r.item_description || <span className="italic text-slate-400">— pa përshkrim —</span>}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  {r.date_received} · {r.customer_name || '—'}
                  {r.date_delivered && ` · Dorëzuar: ${r.date_delivered}`}
                </div>
              </div>
              <div className="text-right whitespace-nowrap">
                <div className="font-bold text-slate-800 dark:text-slate-100 tabular-nums">{fmt(r.price)} <span className="text-[10px] font-normal text-slate-500">{r.currency}</span></div>
                <div className={`text-[10px] font-semibold ${r.paid ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>
                  {r.paid ? `✓ Paguar${r.argjendar_paid_date ? ` · ${r.argjendar_paid_date}` : ''}` : '⚠ Pa paguar'}
                </div>
              </div>
              {(parseFloat(r.price) || 0) > 0 && (
                <div className="shrink-0">
                  {r.paid ? (
                    <button onClick={() => unpayOne(r)} disabled={paying === r.id}
                      className="text-[10px] px-2 py-1 rounded-md bg-slate-100 hover:bg-rose-100 text-slate-600 hover:text-rose-700 dark:bg-slate-800 dark:hover:bg-rose-900/30 dark:text-slate-300 dark:hover:text-rose-300 disabled:opacity-50"
                      title="Anulo pagesën">
                      ↩ Anulo
                    </button>
                  ) : (
                    <PayButton repair={r} onPay={payOne} busy={paying === r.id} />
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function PayButton({ repair, onPay, busy }) {
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} disabled={busy}
        className="text-[10px] px-2 py-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-50">
        💵 Paguaj
      </button>
    )
  }
  return (
    <div className="flex items-center gap-1 bg-emerald-50 dark:bg-emerald-900/20 rounded-md p-1 border border-emerald-200 dark:border-emerald-800">
      <input type="date" value={date} onChange={e => setDate(e.target.value)}
        className="text-[10px] px-1 py-0.5 rounded border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-slate-900" />
      <button onClick={() => { onPay(repair, date); setOpen(false) }} disabled={busy || !date}
        className="text-[10px] px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-50">
        ✓
      </button>
      <button onClick={() => setOpen(false)} disabled={busy}
        className="text-[10px] px-1 py-0.5 text-slate-500 hover:text-slate-700">
        ×
      </button>
    </div>
  )
}
