import { useEffect, useState } from 'react'
import DateRangeFilter from './DateRangeFilter.jsx'
import MoneyInput from './MoneyInput.jsx'
import { showConfirm } from './ConfirmDialog.jsx'
import { getUser } from '../lib/auth.js'

const CURS = ['LEK', 'EUR', 'USD', 'GBP', 'CHF']

function fmt(v) {
  const x = parseFloat(v) || 0
  if (x === 0) return '-'
  return x.toLocaleString('sq-AL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

function fmtDateTime(s) {
  if (!s) return ''
  const d = new Date(String(s).replace(' ', 'T') + 'Z')
  return d.toLocaleString('sq-AL', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

const emptyAmounts = () => ({ LEK: '', EUR: '', USD: '', GBP: '', CHF: '' })

const DEST_LABELS = {
  arka:   { label: 'Arkë',   desc: 'Paratë kalojnë në sirtarin e shitjes (hyjnë te Arka Ditore)' },
  bank:   { label: 'Bankë',  desc: 'Paratë kalojnë në llogari bankare (rrisin bilancin e bankës)' },
  jashte: { label: 'Jashtë', desc: 'Pagesë personi / arsye tjetër jashtë sistemit' },
}

export default function TerheqjaKasaforta({ date }) {
  const isAdmin = getUser()?.role === 'admin'
  const [entryDate, setEntryDate] = useState(date)
  const [amounts, setAmounts] = useState(emptyAmounts())
  const [destination, setDestination] = useState('jashte')
  const [person, setPerson] = useState('')
  const [note, setNote] = useState('')
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [dateRange, setDateRange] = useState({ from: '', to: '' })
  const [deletingId, setDeletingId] = useState(null)
  const [editingId, setEditingId] = useState(null)

  useEffect(() => { setEntryDate(date) }, [date])

  const loadHistory = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (dateRange.from) params.set('from', dateRange.from)
      if (dateRange.to)   params.set('to', dateRange.to)
      const qs = params.toString()
      const rows = await fetch(`/api/safe-withdrawals${qs ? '?' + qs : ''}`).then(r => r.json())
      setHistory(Array.isArray(rows) ? rows : [])
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { loadHistory() /* eslint-disable-next-line */ }, [dateRange.from, dateRange.to])

  const submit = async e => {
    e.preventDefault()
    const parsed = {}
    let anyPositive = false
    for (const c of CURS) {
      const v = parseFloat(amounts[c]) || 0
      parsed[c] = v
      if (v > 0) anyPositive = true
    }
    if (!anyPositive) {
      setMsg('⚠ Vendos një shumë > 0 në të paktën një monedhë')
      setTimeout(() => setMsg(''), 3000)
      return
    }
    if (!entryDate) {
      setMsg('⚠ Vendos datën e tërheqjes')
      setTimeout(() => setMsg(''), 3000)
      return
    }
    setSaving(true)
    try {
      const payload = { date: entryDate, destination, person: person.trim(), note: note.trim() }
      for (const c of CURS) payload[`amount_${c.toLowerCase()}`] = parsed[c]
      const url = editingId ? `/api/safe-withdrawals/${editingId}` : '/api/safe-withdrawals'
      const method = editingId ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'gabim')
      setAmounts(emptyAmounts()); setPerson(''); setNote(''); setDestination('jashte')
      setEntryDate(date)
      const wasEditing = !!editingId
      setEditingId(null)
      setMsg(wasEditing ? '✓ Tërheqja u përditësua' : '✓ Tërheqja u regjistrua')
      setTimeout(() => setMsg(''), 2500)
      loadHistory()
    } catch (err) {
      setMsg('⚠ ' + err.message)
      setTimeout(() => setMsg(''), 3500)
    } finally {
      setSaving(false)
    }
  }

  const startEdit = (row) => {
    setEditingId(row.id)
    setEntryDate(row.date)
    setDestination(row.destination || 'jashte')
    setPerson(row.person || '')
    setNote(row.note || '')
    const a = emptyAmounts()
    for (const c of CURS) {
      const v = row[`amount_${c.toLowerCase()}`] || 0
      a[c] = v ? String(v) : ''
    }
    setAmounts(a)
    setMsg('')
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const cancelEdit = () => {
    setEditingId(null)
    setAmounts(emptyAmounts()); setPerson(''); setNote(''); setDestination('jashte')
    setEntryDate(date)
    setMsg('')
  }

  const totals = {}
  for (const c of CURS) {
    totals[c] = history.reduce((s, r) => s + (r[`amount_${c.toLowerCase()}`] || 0), 0)
  }

  const doDelete = async (row) => {
    const parts = []
    for (const c of CURS) {
      const v = row[`amount_${c.toLowerCase()}`] || 0
      if (v > 0) parts.push(`${fmt(v)} ${c}`)
    }
    const amountStr = parts.join(' · ') || '—'
    const destLabel = DEST_LABELS[row.destination || 'jashte']?.label || 'Jashtë'
    const ok = await showConfirm(
      `Data: ${row.date}\nShuma: ${amountStr}\nDestinacioni: ${destLabel}${row.person ? `\nPersoni: ${row.person}` : ''}${row.note ? `\nShënim: ${row.note}` : ''}\n\nKy veprim është i pakthyeshëm. Bilanci i kasafortës dhe arka do të rikllogariten automatikisht.`,
      { title: 'Fshi këtë tërheqje?', confirmLabel: 'Po, fshi', danger: true },
    )
    if (!ok) return
    setDeletingId(row.id); setMsg('')
    try {
      const res = await fetch(`/api/safe-withdrawals/${row.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Gabim gjatë fshirjes')
      setMsg('✓ Tërheqja u fshi')
      setTimeout(() => setMsg(''), 2500)
      loadHistory()
    } catch (err) {
      setMsg('⚠ ' + err.message)
      setTimeout(() => setMsg(''), 3500)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div className={`bg-white dark:bg-slate-800 rounded-xl shadow-sm border p-6 ${editingId ? 'border-amber-400 dark:border-amber-500 ring-2 ring-amber-200 dark:ring-amber-900/40' : 'border-slate-200 dark:border-slate-700'}`}>
        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">
          {editingId ? `✏️ Edito Tërheqjen #${editingId}` : 'Tërheqje nga Kasaforta'}
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          {editingId
            ? 'Ndrysho të dhënat më poshtë dhe kliko "Përditëso" për të ruajtur. Bilanci i kasafortës dhe arka rikllogariten automatikisht.'
            : 'Regjistro çdo tërheqje me shumat për çdo monedhë, personin që i mori dhe një shënim opsional. Klik butonin "Regjistro Tërheqjen" për ta ruajtur.'}
        </p>

        <form onSubmit={submit} className="mt-5 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="form-label">
                Data e Tërheqjes
                {!isAdmin && <span className="ml-1 text-[10px] text-slate-400 dark:text-slate-500 normal-case">(vetëm admini mund ta ndryshojë)</span>}
                {isAdmin && <span className="ml-1 text-[10px] text-amber-600 dark:text-amber-400 normal-case">(admin — mund të zgjedhësh datë të mëparshme)</span>}
              </label>
              <input
                type="date"
                value={entryDate}
                onChange={e => setEntryDate(e.target.value)}
                readOnly={!isAdmin}
                className={`input-field ${!isAdmin ? 'bg-slate-50 dark:bg-slate-900 cursor-not-allowed' : ''}`}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {CURS.map(c => (
              <div key={c}>
                <label className="form-label">Shuma {c}</label>
                <MoneyInput
                  value={amounts[c]}
                  onChange={v => setAmounts(a => ({ ...a, [c]: String(v) }))}
                  className="input-field text-right font-semibold"
                  placeholder="0.00"
                />
              </div>
            ))}
          </div>
          <div>
            <label className="form-label">Destinacioni</label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {Object.entries(DEST_LABELS).map(([key, { label, desc }]) => (
                <label
                  key={key}
                  className={`cursor-pointer rounded-lg border-2 px-3 py-2 transition ${
                    destination === key
                      ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/30'
                      : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="destination"
                      value={key}
                      checked={destination === key}
                      onChange={() => setDestination(key)}
                      className="accent-amber-500"
                    />
                    <span className="font-semibold text-sm text-slate-800 dark:text-slate-100">{label}</span>
                  </div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 ml-6">{desc}</p>
                </label>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="form-label">
                Personi {destination === 'jashte' ? '(kush e mori)' : '(opsional)'}
              </label>
              <input
                type="text"
                value={person} onChange={e => setPerson(e.target.value)}
                className="input-field"
                placeholder="p.sh. BIBA, DIANA"
              />
            </div>
            <div>
              <label className="form-label">Shënim (opsional)</label>
              <input
                type="text"
                value={note} onChange={e => setNote(e.target.value)}
                className="input-field"
                placeholder="arsyeja / detajet"
              />
            </div>
          </div>
          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="btn-primary disabled:opacity-50"
            >
              {saving ? '⏳ Duke ruajtur...' : editingId ? '💾 Përditëso' : '💾 Regjistro Tërheqjen'}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={cancelEdit}
                disabled={saving}
                className="btn-secondary disabled:opacity-50"
              >
                Anulo
              </button>
            )}
            {msg && (
              <span className={`text-sm font-medium ${msg.startsWith('⚠') ? 'text-rose-600' : 'text-emerald-700 dark:text-emerald-300'}`}>
                {msg}
              </span>
            )}
          </div>
        </form>
      </div>

      <DateRangeFilter
        from={dateRange.from}
        to={dateRange.to}
        onChange={setDateRange}
        loading={loading}
        emptyForAll
        compact
        hint="Filtron historikun e tërheqjeve"
      />

      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-0 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800">
          <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">Historik i Tërheqjeve</h4>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {history.length} regjistrime · Totale:
            {CURS.filter(c => totals[c] > 0).map(c => (
              <span key={c}> · <strong className="text-slate-700 dark:text-slate-200">{fmt(totals[c])} {c}</strong></span>
            ))}
            {CURS.every(c => totals[c] === 0) && <span> —</span>}
          </p>
        </div>

        {loading ? (
          <div className="p-8 text-center text-slate-400 dark:text-slate-500 text-sm">Duke ngarkuar...</div>
        ) : history.length === 0 ? (
          <div className="p-8 text-center text-slate-400 dark:text-slate-500 text-sm">
            Ende pa tërheqje të regjistruara.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Data</th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Ora</th>
                  {CURS.map(c => (
                    <th key={c} className="text-right px-3 py-2.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">{c}</th>
                  ))}
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Destinacioni</th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Personi</th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Shënim</th>
                  {isAdmin && (
                    <th className="text-right px-3 py-2.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Veprim</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {history.map(r => (
                  <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="px-3 py-2.5 text-slate-700 dark:text-slate-200 font-medium">{r.date}</td>
                    <td className="px-3 py-2.5 text-slate-500 dark:text-slate-400 text-xs">{fmtDateTime(r.created_at)}</td>
                    {CURS.map(c => (
                      <td key={c} className="px-3 py-2.5 text-right tabular-nums font-semibold text-slate-800 dark:text-slate-100">
                        {fmt(r[`amount_${c.toLowerCase()}`])}
                      </td>
                    ))}
                    <td className="px-3 py-2.5">
                      {(() => {
                        const dest = r.destination || 'jashte'
                        const meta = DEST_LABELS[dest] || DEST_LABELS.jashte
                        const cls = dest === 'arka' ? 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200'
                                  : dest === 'bank' ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200'
                                  : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
                        return <span className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-semibold ${cls}`}>{meta.label}</span>
                      })()}
                    </td>
                    <td className="px-3 py-2.5 text-slate-700 dark:text-slate-200">{r.person || <span className="text-slate-400 dark:text-slate-500 italic">—</span>}</td>
                    <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">{r.note || <span className="text-slate-400 dark:text-slate-500 italic">—</span>}</td>
                    {isAdmin && (
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => startEdit(r)}
                          disabled={deletingId === r.id || editingId === r.id}
                          className="text-xs font-semibold text-amber-600 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-300 disabled:opacity-50 mr-3"
                          title="Edito këtë tërheqje"
                        >
                          {editingId === r.id ? '✏️ Duke edituar…' : '✏️ Edito'}
                        </button>
                        <button
                          type="button"
                          onClick={() => doDelete(r)}
                          disabled={deletingId === r.id || editingId === r.id}
                          className="text-xs font-semibold text-rose-600 hover:text-rose-800 dark:text-rose-400 dark:hover:text-rose-300 disabled:opacity-50"
                          title="Fshi këtë tërheqje"
                        >
                          {deletingId === r.id ? '⏳...' : '🗑 Fshi'}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  )
}
