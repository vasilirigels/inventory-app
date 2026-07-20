import { useEffect, useState } from 'react'
import { useRealtimeSync } from '../hooks/useRealtimeSync.js'
import DateRangeFilter from './DateRangeFilter.jsx'

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

export default function LevizjeBanke({ date }) {
  const [direction, setDirection] = useState('to_bank')  // 'to_bank' | 'to_safe'
  const [amounts, setAmounts] = useState(emptyAmounts())
  const [person, setPerson]   = useState('')
  const [note, setNote]       = useState('')
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [msg, setMsg]         = useState('')
  const [dateRange, setDateRange] = useState({ from: '', to: '' })
  const [confirmDel, setConfirmDel] = useState(null)

  const load = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (dateRange.from) params.set('from', dateRange.from)
      if (dateRange.to)   params.set('to', dateRange.to)
      const qs = params.toString()
      const rows = await fetch(`/api/bank-movements${qs ? '?' + qs : ''}`).then(r => r.json())
      setHistory(Array.isArray(rows) ? rows : [])
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { load() /* eslint-disable-next-line */ }, [dateRange.from, dateRange.to])
  useRealtimeSync('bank-movements', () => { load() })

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
    setSaving(true)
    try {
      const payload = { date, direction, person: person.trim(), note: note.trim() }
      for (const c of CURS) payload[`amount_${c.toLowerCase()}`] = parsed[c]
      const res = await fetch('/api/bank-movements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'gabim')
      setAmounts(emptyAmounts()); setPerson(''); setNote('')
      setMsg(direction === 'to_bank' ? '✓ Depozitimi u regjistrua' : '✓ Transferi në kasafortë u regjistrua')
      setTimeout(() => setMsg(''), 2500)
      load()
    } catch (err) {
      setMsg('⚠ ' + err.message)
      setTimeout(() => setMsg(''), 4000)
    } finally { setSaving(false) }
  }

  const doDelete = async id => {
    try {
      await fetch(`/api/bank-movements/${id}`, { method: 'DELETE' })
      setConfirmDel(null)
      load()
    } catch (e) { console.error(e) }
  }

  const totals = { to_bank: {}, to_safe: {} }
  for (const c of CURS) {
    totals.to_bank[c] = history.filter(r => r.direction === 'to_bank').reduce((s, r) => s + (r[`amount_${c.toLowerCase()}`] || 0), 0)
    totals.to_safe[c] = history.filter(r => r.direction === 'to_safe').reduce((s, r) => s + (r[`amount_${c.toLowerCase()}`] || 0), 0)
  }

  const isToSafe = direction === 'to_safe'

  return (
    <div className="max-w-6xl mx-auto space-y-4">

      {/* Forma e re */}
      <div className="card">
        <h3 className="text-lg font-bold text-slate-800">Lëvizje e Re Banke</h3>
        <p className="text-xs text-slate-500 mt-1">
          Regjistro depozitim kesh në bankë, ose tërheqje nga banka për kasafortë.
        </p>

        <form onSubmit={submit} className="mt-4 space-y-3">
          {/* Drejtimi */}
          <div>
            <label className="form-label">Drejtimi</label>
            <div className="flex gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setDirection('to_bank')}
                className={`px-4 py-2 rounded-xl border font-semibold text-sm flex items-center gap-2 transition
                  ${direction === 'to_bank' ? 'bg-emerald-100 border-emerald-400 text-emerald-800 ring-2 ring-emerald-200' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
              >
                💵 <span>Arka → Bankë</span>
                <span className="text-[10px] font-normal text-slate-500">(depozito)</span>
              </button>
              <button
                type="button"
                onClick={() => setDirection('to_safe')}
                className={`px-4 py-2 rounded-xl border font-semibold text-sm flex items-center gap-2 transition
                  ${direction === 'to_safe' ? 'bg-amber-100 border-amber-400 text-amber-800 ring-2 ring-amber-200' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
              >
                🏦 <span>Bankë → Kasafortë</span>
                <span className="text-[10px] font-normal text-slate-500">(tërheqje)</span>
              </button>
            </div>
          </div>

          {/* Shumat */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {CURS.map(c => (
              <div key={c}>
                <label className="form-label">Shuma {c}</label>
                <input
                  type="number" step="0.01" min="0"
                  value={amounts[c]}
                  onChange={e => setAmounts(a => ({ ...a, [c]: e.target.value }))}
                  className="input-field text-right font-semibold"
                  placeholder="0.00"
                />
              </div>
            ))}
          </div>

          {/* Personi + Shënim */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="form-label">Personi (kush e bëri)</label>
              <input
                type="text" value={person} onChange={e => setPerson(e.target.value)}
                className="input-field" placeholder="p.sh. BIBA, DIANA"
              />
            </div>
            <div>
              <label className="form-label">Shënim (opsional)</label>
              <input
                type="text" value={note} onChange={e => setNote(e.target.value)}
                className="input-field"
                placeholder={isToSafe ? 'arsyeja / destinacioni' : 'numri i faturës bankare, arsyeja...'}
              />
            </div>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button type="submit" disabled={saving}
              className={`${isToSafe ? 'bg-amber-600 hover:bg-amber-700' : 'bg-emerald-600 hover:bg-emerald-700'} text-white font-semibold px-5 py-2 rounded-xl transition disabled:opacity-50 flex items-center gap-2`}>
              {saving ? '⏳ Duke ruajtur...' : (isToSafe ? '🏦 Regjistro Transferin në Kasafortë' : '💵 Regjistro Depozitën')}
            </button>
            {msg && (
              <span className={`text-sm font-medium ${msg.startsWith('⚠') ? 'text-rose-600' : 'text-emerald-700'}`}>
                {msg}
              </span>
            )}
            <span className="ml-auto text-xs text-slate-500">
              Data: <strong className="text-slate-700">{date}</strong>
            </span>
          </div>
        </form>
      </div>

      {/* Filtër Periudhe */}
      <DateRangeFilter
        from={dateRange.from}
        to={dateRange.to}
        onChange={setDateRange}
        loading={loading}
        emptyForAll
        compact
        hint="Filtron historikun e lëvizjeve"
      />

      {/* Historik */}
      <div className="card p-0 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h4 className="text-sm font-bold text-slate-800">Historik i Lëvizjeve</h4>
          <p className="text-xs text-slate-500 mt-0.5">
            {history.length} regjistrime
            {CURS.some(c => totals.to_bank[c] > 0 || totals.to_safe[c] > 0) && (
              <span>
                {' · '}
                {CURS.filter(c => totals.to_bank[c] > 0).map(c => (
                  <span key={'b'+c} className="mr-2">
                    <span className="text-emerald-600 font-semibold">→Bankë</span>{' '}
                    <strong className="text-slate-700">{fmt(totals.to_bank[c])} {c}</strong>
                  </span>
                ))}
                {CURS.filter(c => totals.to_safe[c] > 0).map(c => (
                  <span key={'s'+c} className="mr-2">
                    <span className="text-amber-600 font-semibold">→Kasafortë</span>{' '}
                    <strong className="text-slate-700">{fmt(totals.to_safe[c])} {c}</strong>
                  </span>
                ))}
              </span>
            )}
          </p>
        </div>

        {loading ? (
          <div className="p-8 text-center text-slate-400 text-sm">Duke ngarkuar...</div>
        ) : history.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">Ende pa lëvizje të regjistruara.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase">Data</th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase">Drejtimi</th>
                  {CURS.map(c => (
                    <th key={c} className="text-right px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase">{c}</th>
                  ))}
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase">Personi</th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase">Shënim</th>
                  <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase">Kohë</th>
                  <th className="text-right px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase"></th>
                </tr>
              </thead>
              <tbody>
                {history.map(r => (
                  <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2.5 text-slate-700 font-medium">{r.date}</td>
                    <td className="px-3 py-2.5">
                      {r.direction === 'to_bank'
                        ? <span className="badge bg-emerald-100 text-emerald-800 text-[10px]">💵 → Bankë</span>
                        : <span className="badge bg-amber-100 text-amber-800 text-[10px]">🏦 → Kasafortë</span>}
                    </td>
                    {CURS.map(c => {
                      const v = r[`amount_${c.toLowerCase()}`] || 0
                      const cls = v > 0
                        ? (r.direction === 'to_bank' ? 'text-emerald-700' : 'text-amber-700')
                        : 'text-slate-400'
                      return (
                        <td key={c} className={`px-3 py-2.5 text-right tabular-nums font-semibold ${cls}`}>
                          {fmt(v)}
                        </td>
                      )
                    })}
                    <td className="px-3 py-2.5 text-slate-700">{r.person || <span className="text-slate-400 italic">—</span>}</td>
                    <td className="px-3 py-2.5 text-slate-600">{r.note || <span className="text-slate-400 italic">—</span>}</td>
                    <td className="px-3 py-2.5 text-slate-500 text-xs text-center">{fmtDateTime(r.created_at)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <button onClick={() => setConfirmDel(r)}
                        className="text-xs text-rose-600 hover:bg-rose-50 rounded-lg px-2 py-1 font-medium">
                        Fshi
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Konfirm Fshirje */}
      {confirmDel && (
        <div className="modal-overlay">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
            <div className="text-center">
              <div className="w-16 h-16 bg-rose-100 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-4">🗑️</div>
              <h3 className="font-bold text-slate-800 text-lg mb-1">Fshi Lëvizjen?</h3>
              <p className="text-slate-500 text-sm mb-6">
                Kjo lëvizje bankë ({confirmDel.date} · {confirmDel.direction === 'to_bank' ? 'Arka → Bankë' : 'Bankë → Kasafortë'}) do të hiqet përgjithmonë.
              </p>
              <div className="flex gap-3">
                <button onClick={() => setConfirmDel(null)} className="btn-secondary flex-1 justify-center">Anulo</button>
                <button onClick={() => doDelete(confirmDel.id)}
                  className="flex-1 py-2 bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium rounded-lg transition-colors">
                  Fshi
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
