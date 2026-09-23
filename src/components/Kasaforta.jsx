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

function fmtDate(d) {
  return d.split('-').reverse().join('.')
}

function todayLocal() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}


export default function Kasaforta() {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [showConvert, setShowConvert] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [dateRange, setDateRange] = useState({ from: '', to: '' })
  const [manageDate, setManageDate] = useState(null) // 'YYYY-MM-DD' ose null
  const isAdmin = getUser()?.role === 'admin'

  useEffect(() => {
    let cancel = false
    setLoading(true)
    fetch('/api/kasaforta')
      .then(r => r.json())
      .then(d => { if (!cancel) { setData(d); setLoading(false) } })
      .catch(e => { if (!cancel) { setError(e.message || 'Gabim'); setLoading(false) } })
    return () => { cancel = true }
  }, [refreshKey])

  if (loading) return <div className="card p-8 text-center text-slate-400 dark:text-slate-500 text-sm">Duke ngarkuar...</div>
  if (error)   return <div className="card p-8 text-center text-red-500 text-sm">⚠ {error}</div>
  if (!data)   return null

  const { balance = {}, history: rawHistory = [] } = data

  const history = rawHistory.filter(r => {
    if (dateRange.from && r.date < dateRange.from) return false
    if (dateRange.to   && r.date > dateRange.to)   return false
    return true
  })

  const activeCurs = CURS.filter(c =>
    (balance[c] || 0) !== 0 ||
    history.some(h => (h[c]?.deposit || 0) || (h[c]?.withdraw || 0) || (h[c]?.closeout_in || 0) || (h[c]?.conv_in || 0) || (h[c]?.conv_out || 0))
  )
  const shownCurs = activeCurs.length ? activeCurs : ['LEK']

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div className="card bg-gradient-to-r from-slate-900 to-slate-800 text-white">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide font-semibold">Gjendja e Kasafortës</p>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
              Derdhje + Mbyllje Ditore − Tërheqje ± Konvertime (kumulative)
            </p>
          </div>
          <button
            onClick={() => setShowConvert(true)}
            className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-900 dark:text-white text-xs font-bold shadow-sm"
            title="Konverto valutë brenda kasafortës (p.sh. EUR → LEK)"
          >💱 Konverto Monedhë</button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-4">
          {CURS.map(c => {
            const v = balance[c] || 0
            return (
              <div key={c} className="bg-slate-800 dark:bg-slate-900 rounded-lg px-3 py-2.5">
                <div className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-semibold">{c}</div>
                <div className={`text-xl font-extrabold tabular-nums ${v < 0 ? 'text-rose-400' : v > 0 ? 'text-amber-300' : 'text-slate-500 dark:text-slate-400'}`}>
                  🔒 {fmt(v)}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {showConvert && (
        <ConvertModal
          balance={balance}
          onClose={() => setShowConvert(false)}
          onSaved={() => { setShowConvert(false); setRefreshKey(k => k + 1) }}
        />
      )}

      {manageDate && (
        <ManageEventsModal
          date={manageDate}
          onClose={() => setManageDate(null)}
          onChanged={() => { setRefreshKey(k => k + 1) }}
        />
      )}

      <DateRangeFilter
        from={dateRange.from}
        to={dateRange.to}
        onChange={setDateRange}
        emptyForAll
        compact
        hint="Filtron historikun e kasafortës"
      />

      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Historiku i Lëvizjeve</h4>
          <span className="text-xs text-slate-400 dark:text-slate-500">
            {history.length} ditë me lëvizje
            {(dateRange.from || dateRange.to) && rawHistory.length !== history.length && (
              <span className="ml-1 text-slate-500 dark:text-slate-400">(nga {rawHistory.length})</span>
            )}
          </span>
        </div>
        {history.length === 0 ? (
          <div className="p-10 text-center text-slate-400 dark:text-slate-500">
            <div className="text-4xl mb-2">🔒</div>
            <p className="text-sm">Asnjë lëvizje në kasafortë.</p>
            <p className="text-xs mt-1">Përdor "Mbyllje Dite" tek Arka Ditore për të derdhur kesh në kasafortë.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Data</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Monedha</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase" title="Gjendja e kasafortës në fillim të kësaj date">Bilanci Fillestar</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Derdhje</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Mbyllje Dite</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase" title="Konvertim monedhe brenda kasafortës (shtim / heqje)">Konvertim</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Tërheqje</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Neto</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase" title="Gjendja e kasafortës në fund të kësaj date (fillestar + neto)">Bilanci Final</th>
                  {isAdmin && <th className="px-3 py-2 text-center text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase" title="Menaxho / fshi veprime të kësaj date">Veprime</th>}
                </tr>
              </thead>
              <tbody>
                {history.map(r => (
                  shownCurs.filter(c => {
                    const cur = r[c] || {}
                    return cur.deposit || cur.withdraw || cur.closeout_in || cur.conv_in || cur.conv_out
                  }).map((c, idx, arr) => {
                    const cur = r[c] || {}
                    const convEvents = cur.conversions || []
                    const convTitle = convEvents
                      .map(ev => ev.direction === 'in'
                        ? `🔄 +${fmt(ev.amount)} ${c} ← ${fmt(ev.other_amount)} ${ev.other_cur} (1 ${ev.other_cur} = ${ev.rate} ${c})${ev.note ? ' · ' + ev.note : ''}`
                        : `🔄 −${fmt(ev.amount)} ${c} → ${fmt(ev.other_amount)} ${ev.other_cur} (1 ${c} = ${ev.rate} ${ev.other_cur})${ev.note ? ' · ' + ev.note : ''}`
                      ).join('\n')
                    return (
                      <tr key={`${r.date}-${c}`} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="px-3 py-2 text-slate-700 dark:text-slate-200 font-mono text-xs">
                          {idx === 0 ? fmtDate(r.date) : ''}
                        </td>
                        <td className="px-3 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300">{c}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-500 dark:text-slate-400" title="Gjendja në fillim të ditës">
                          {fmt(cur.balance_before)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-emerald-700 dark:text-emerald-300">
                          {cur.deposit > 0 ? `+${fmt(cur.deposit)}` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-amber-700 dark:text-amber-300">
                          {cur.closeout_in > 0 ? `+${fmt(cur.closeout_in)}` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums" title={convTitle}>
                          {cur.conv_in > 0 && (
                            <span className="text-sky-700 font-semibold">🔄 +{fmt(cur.conv_in)}</span>
                          )}
                          {cur.conv_in > 0 && cur.conv_out > 0 && <span className="text-slate-300 mx-1">·</span>}
                          {cur.conv_out > 0 && (
                            <span className="text-violet-700 font-semibold">🔄 −{fmt(cur.conv_out)}</span>
                          )}
                          {cur.conv_in === 0 && cur.conv_out === 0 && <span className="text-slate-300">—</span>}
                          {convEvents.length > 0 && (
                            <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 space-y-0.5">
                              {convEvents.map((ev, i) => (
                                <div key={i} className="truncate max-w-[240px]" title={convTitle}>
                                  {ev.direction === 'in'
                                    ? <>← {fmt(ev.other_amount)} {ev.other_cur}</>
                                    : <>→ {fmt(ev.other_amount)} {ev.other_cur}</>
                                  }
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-rose-700">
                          {cur.withdraw > 0 ? `−${fmt(cur.withdraw)}` : '—'}
                        </td>
                        <td className={`px-3 py-2 text-right tabular-nums font-semibold ${cur.net > 0 ? 'text-emerald-700 dark:text-emerald-300' : cur.net < 0 ? 'text-rose-700' : 'text-slate-400 dark:text-slate-500'}`}>
                          {cur.net > 0 ? '+' : ''}{fmt(cur.net)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-bold text-slate-900 dark:text-white" title={`${fmt(cur.balance_before)} + ${cur.net > 0 ? '+' : ''}${fmt(cur.net)} = ${fmt(cur.balance)}`}>
                          {fmt(cur.balance)}
                        </td>
                        {isAdmin && (
                          <td className="px-3 py-2 text-center">
                            {idx === 0 && (
                              <button
                                onClick={() => setManageDate(r.date)}
                                className="text-xs px-2 py-1 rounded-md bg-slate-100 dark:bg-slate-700 hover:bg-rose-100 dark:hover:bg-rose-900/30 text-slate-700 dark:text-slate-200 hover:text-rose-700 dark:hover:text-rose-300"
                                title="Menaxho veprime të kësaj date (admin)"
                              >
                                🔧
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    )
                  })
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  )
}

// ── Modal për konvertim monedhash brenda kasafortës ────────────────────────
function ConvertModal({ balance, onClose, onSaved }) {
  const [date, setDate]           = useState(todayLocal())
  const [fromCur, setFromCur]     = useState('LEK')
  const [toCur, setToCur]         = useState('EUR')
  const [fromAmt, setFromAmt]     = useState('')
  const [toAmt, setToAmt]         = useState('')
  const [rateManual, setRateManual] = useState('')
  const [note, setNote]           = useState('')
  const [saving, setSaving]       = useState(false)
  const [err, setErr]             = useState('')
  const [rates, setRates]         = useState({ LEK: 1 })
  const [lastEdited, setLastEdited] = useState('from')  // 'from' | 'to' | 'rate'

  // Merr kurset për datën e zgjedhur
  useEffect(() => {
    if (!date) return
    fetch(`/api/exchange-rates/${date}`)
      .then(r => r.json())
      .then(d => setRates(d?.rates || { LEK: 1 }))
      .catch(() => setRates({ LEK: 1 }))
  }, [date])

  // Kursi i sugjeruar: 1 fromCur = X toCur
  // Bazë: rates[cur] = LEK për 1 njësi të monedhës
  //   1 fromCur = rates[fromCur] LEK
  //   1 toCur   = rates[toCur]   LEK
  //   ⇒ 1 fromCur = rates[fromCur] / rates[toCur] toCur
  const suggestedRate = (() => {
    const rF = parseFloat(rates[fromCur]) || (fromCur === 'LEK' ? 1 : 0)
    const rT = parseFloat(rates[toCur])   || (toCur === 'LEK'   ? 1 : 0)
    if (!rF || !rT) return null
    return +(rF / rT).toFixed(6)
  })()
  const effectiveRate = rateManual !== '' ? (parseFloat(rateManual) || 0) : (suggestedRate || 0)

  // Auto-recalculate to_amount when from_amount or rate changes (except when
  // user manually edited to_amount)
  useEffect(() => {
    if (lastEdited === 'to') return
    if (fromAmt === '' || !effectiveRate) return
    const to = +(parseFloat(fromAmt) * effectiveRate).toFixed(2)
    setToAmt(String(to))
    // eslint-disable-next-line
  }, [fromAmt, effectiveRate, fromCur, toCur])

  // Nëse user ndryshon toAmt, rikthej rate-in
  useEffect(() => {
    if (lastEdited !== 'to') return
    if (fromAmt === '' || toAmt === '' || parseFloat(fromAmt) === 0) return
    const derived = +(parseFloat(toAmt) / parseFloat(fromAmt)).toFixed(6)
    setRateManual(String(derived))
    // eslint-disable-next-line
  }, [toAmt])

  const submit = async () => {
    setErr('')
    if (fromCur === toCur) { setErr('Zgjidh monedha të ndryshme.'); return }
    const fromN = parseFloat(fromAmt) || 0
    const toN   = parseFloat(toAmt)   || 0
    if (fromN <= 0 || toN <= 0) { setErr('Vendos shuma > 0.'); return }
    if (fromN > (balance[fromCur] || 0)) {
      if (!(await showConfirm(
        `Shuma ${fromN} ${fromCur} tejkalon gjendjen aktuale (${fmt(balance[fromCur] || 0)} ${fromCur}). Vazhdo gjithsesi?`,
        { title: 'Kujdes: gjendje e pamjaftueshme', confirmLabel: 'Vazhdo', danger: true }
      ))) return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/safe-conversions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          from_currency: fromCur,
          from_amount:   fromN,
          to_currency:   toCur,
          to_amount:     toN,
          exchange_rate: effectiveRate,
          note,
        }),
      })
      const r = await res.json()
      if (!res.ok) throw new Error(r.error || 'Gabim')
      onSaved?.()
    } catch (e) {
      setErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="modal-header">
          <div>
            <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">💱 Konverto Monedhë</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">Zbrit nga një monedhë, derdh në një tjetër (brenda kasafortës)</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 dark:text-slate-500 text-xl">×</button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="form-label">Data</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className="input-field" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Nga (monedha)</label>
              <select value={fromCur} onChange={e => setFromCur(e.target.value)} className="input-field">
                {CURS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">Gjendja: <span className="font-bold text-slate-700 dark:text-slate-200 tabular-nums">{fmt(balance[fromCur] || 0)}</span></p>
            </div>
            <div>
              <label className="form-label">Në (monedha)</label>
              <select value={toCur} onChange={e => setToCur(e.target.value)} className="input-field">
                {CURS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">Gjendja: <span className="font-bold text-slate-700 dark:text-slate-200 tabular-nums">{fmt(balance[toCur] || 0)}</span></p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Shuma për të nxjerrë ({fromCur})</label>
              <MoneyInput
                value={fromAmt}
                onChange={v => { setLastEdited('from'); setFromAmt(String(v)) }}
                className="input-field tabular-nums font-bold"
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="form-label">Shuma për të derdhur ({toCur})</label>
              <MoneyInput
                value={toAmt}
                onChange={v => { setLastEdited('to'); setToAmt(String(v)) }}
                className="input-field tabular-nums font-bold"
                placeholder="0.00"
              />
            </div>
          </div>

          <div>
            <label className="form-label">
              Kursi i Këmbimit <span className="text-[10px] text-slate-400 dark:text-slate-500">(1 {fromCur} = X {toCur})</span>
            </label>
            <div className="flex gap-2 items-center">
              <input
                type="number" step="0.000001" min="0"
                value={rateManual !== '' ? rateManual : (suggestedRate ?? '')}
                onChange={e => { setLastEdited('rate'); setRateManual(e.target.value) }}
                className="input-field tabular-nums flex-1"
                placeholder={suggestedRate ? String(suggestedRate) : '—'}
              />
              {suggestedRate != null && (
                <button
                  type="button"
                  onClick={() => { setRateManual(''); setLastEdited('from') }}
                  className="btn-secondary text-xs whitespace-nowrap"
                  title="Rikthe në kursin e sugjeruar"
                >↻ Sugjeruar</button>
              )}
            </div>
            {suggestedRate != null && (
              <p className="text-[10px] text-slate-500 dark:text-slate-400 italic mt-1">
                Kursi i sugjeruar për datën {date}: 1 {fromCur} = {suggestedRate} {toCur}
              </p>
            )}
          </div>

          <div>
            <label className="form-label">Shënime (opsional)</label>
            <input type="text" value={note} onChange={e => setNote(e.target.value)}
              className="input-field" placeholder="p.sh. konvertim për shpenzime muajore" />
          </div>

          {err && <p className="text-sm text-red-600">{err}</p>}

          <div className="card bg-amber-50 dark:bg-amber-900/30 border-amber-200 !p-3">
            <p className="text-xs font-semibold text-amber-800 dark:text-amber-200 mb-1">📋 Përmbledhje</p>
            <div className="text-[11px] text-amber-900 space-y-0.5">
              <div>🔻 Zbritet nga kasaforta: <span className="font-bold tabular-nums">{fmt(parseFloat(fromAmt) || 0)} {fromCur}</span></div>
              <div>🔺 Shtohet në kasafortë: <span className="font-bold tabular-nums">{fmt(parseFloat(toAmt) || 0)} {toCur}</span></div>
              <div className="text-slate-600 dark:text-slate-300">Kursi i regjistruar: 1 {fromCur} = {effectiveRate ? effectiveRate : '—'} {toCur}</div>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="btn-secondary">Anulo</button>
          <button
            onClick={submit}
            disabled={saving || fromCur === toCur || !fromAmt || !toAmt}
            className="btn-primary disabled:opacity-50"
          >
            {saving ? '⏳ Duke ruajtur...' : '💾 Ruaj Konvertimin'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Modal admin-only: liston veprimet individuale të një date dhe lejon fshirjen
// e ndonjë veprimi të gabuar (tërheqje, konvertim, derdhje bankë→kasafortë,
// mbyllje dite). Fshirja e mbylljes së ditës zeron kolonat closeout_to_safe_*
// të asaj date te daily_records.
function ManageEventsModal({ date, onClose, onChanged }) {
  const [events, setEvents] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [busyId, setBusyId] = useState('')

  const load = async () => {
    setLoading(true); setErr('')
    try {
      const r = await fetch(`/api/kasaforta/events/${date}`)
      if (!r.ok) throw new Error((await r.json()).error || 'Gabim')
      setEvents(await r.json())
    } catch (e) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [date])

  const doDelete = async (kind, id, label) => {
    const ok = await showConfirm(
      `${label}\n\nKy veprim është i pakthyeshëm. Bilanci i kasafortës do të rikllogaritet automatikisht.`,
      { title: 'Fshi këtë veprim?', confirmLabel: 'Po, fshi', danger: true },
    )
    if (!ok) return
    setBusyId(`${kind}-${id}`); setErr('')
    try {
      let url
      if (kind === 'withdrawal') url = `/api/safe-withdrawals/${id}`
      else if (kind === 'conversion') url = `/api/safe-conversions/${id}`
      else if (kind === 'bank_deposit') url = `/api/bank-movements/${id}`
      else if (kind === 'closeout') url = `/api/kasaforta/closeout/${date}`
      else throw new Error('Lloj i panjohur')
      const r = await fetch(url, { method: 'DELETE' })
      if (!r.ok) throw new Error((await r.json()).error || 'Gabim gjatë fshirjes')
      await load()
      onChanged?.()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusyId('')
    }
  }

  const amountsSummary = (obj) => {
    const parts = []
    for (const c of CURS) {
      const key = `amount_${c.toLowerCase()}`
      const v = parseFloat(obj[key]) || 0
      if (v > 0) parts.push(`${fmt(v)} ${c}`)
    }
    return parts.join(' · ') || '—'
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="modal-header">
          <div>
            <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">🔧 Menaxho Veprime — {fmtDate(date)}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">Fshi veprime të bëra gabimisht. Bilanci rifreskohet automatikisht.</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 dark:text-slate-500 text-xl">×</button>
        </div>

        <div className="p-4 space-y-4">
          {loading && <p className="text-sm text-slate-500">Duke ngarkuar…</p>}
          {err && <p className="text-sm text-red-600">{err}</p>}

          {events && (
            <>
              {/* Tërheqjet */}
              <Section title="Tërheqje nga Kasaforta" empty="Asnjë tërheqje">
                {events.withdrawals?.map(w => (
                  <EventRow
                    key={w.id}
                    label={amountsSummary(w)}
                    subtitle={[w.person, w.note].filter(Boolean).join(' · ')}
                    onDelete={() => doDelete('withdrawal', w.id, `Tërheqje: ${amountsSummary(w)}`)}
                    busy={busyId === `withdrawal-${w.id}`}
                  />
                ))}
              </Section>

              {/* Konvertimet */}
              <Section title="Konvertim Monedhe" empty="Asnjë konvertim">
                {events.conversions?.map(cv => (
                  <EventRow
                    key={cv.id}
                    label={`${fmt(cv.from_amount)} ${cv.from_currency} → ${fmt(cv.to_amount)} ${cv.to_currency}`}
                    subtitle={`Kursi: 1 ${cv.from_currency} = ${cv.exchange_rate} ${cv.to_currency}${cv.note ? ' · ' + cv.note : ''}`}
                    onDelete={() => doDelete('conversion', cv.id, `Konvertim: ${fmt(cv.from_amount)} ${cv.from_currency} → ${fmt(cv.to_amount)} ${cv.to_currency}`)}
                    busy={busyId === `conversion-${cv.id}`}
                  />
                ))}
              </Section>

              {/* Derdhjet nga banka */}
              <Section title="Derdhje Bankë → Kasafortë" empty="Asnjë derdhje">
                {events.bank_deposits?.map(bd => (
                  <EventRow
                    key={bd.id}
                    label={amountsSummary(bd)}
                    subtitle={bd.note || ''}
                    onDelete={() => doDelete('bank_deposit', bd.id, `Derdhje bankë: ${amountsSummary(bd)}`)}
                    busy={busyId === `bank_deposit-${bd.id}`}
                  />
                ))}
              </Section>

              {/* Mbyllja e Ditës */}
              <Section title="Mbyllje Dite (Arka → Kasafortë)" empty="Asnjë mbyllje ditore">
                {events.closeout && (
                  <EventRow
                    label={CURS.map(c => {
                      const v = events.closeout.amounts[c] || 0
                      return v > 0 ? `${fmt(v)} ${c}` : null
                    }).filter(Boolean).join(' · ') || '—'}
                    subtitle="Fshirja zeron mbylljen për këtë datë; do të duhet të ripërsërisësh mbylljen te Arka Ditore nëse ka pasur kesh të tepërt."
                    danger
                    onDelete={() => doDelete('closeout', date, `Mbyllje dite për ${fmtDate(date)}`)}
                    busy={busyId === `closeout-${date}`}
                  />
                )}
              </Section>
            </>
          )}
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="btn-secondary">Mbyll</button>
        </div>
      </div>
    </div>
  )
}

function Section({ title, empty, children }) {
  const hasChildren = Array.isArray(children)
    ? children.filter(Boolean).length > 0
    : !!children
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">{title}</h4>
      {hasChildren
        ? <div className="space-y-1">{children}</div>
        : <p className="text-xs text-slate-400 dark:text-slate-500 italic">{empty}</p>}
    </div>
  )
}

function EventRow({ label, subtitle, onDelete, busy, danger }) {
  return (
    <div className={`flex items-start justify-between gap-3 rounded-lg border ${danger ? 'border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/10' : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40'} p-2`}>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 tabular-nums">{label}</p>
        {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{subtitle}</p>}
      </div>
      <button
        onClick={onDelete}
        disabled={busy}
        className="shrink-0 text-xs px-2 py-1 rounded-md bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-semibold"
      >
        {busy ? '…' : '🗑️ Fshi'}
      </button>
    </div>
  )
}
