import { useEffect, useState } from 'react'

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

export default function TerheqjaKasaforta({ date }) {
  const [lek, setLek] = useState('')
  const [eur, setEur] = useState('')
  const [person, setPerson] = useState('')
  const [note, setNote] = useState('')
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [confirmDel, setConfirmDel] = useState(null)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  const loadHistory = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (fromDate) params.set('from', fromDate)
      if (toDate)   params.set('to', toDate)
      const qs = params.toString()
      const rows = await fetch(`/api/safe-withdrawals${qs ? '?' + qs : ''}`).then(r => r.json())
      setHistory(Array.isArray(rows) ? rows : [])
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { loadHistory() /* eslint-disable-next-line */ }, [fromDate, toDate])

  const submit = async e => {
    e.preventDefault()
    const nLek = parseFloat(lek) || 0
    const nEur = parseFloat(eur) || 0
    if (nLek <= 0 && nEur <= 0) {
      setMsg('⚠ Vendos një shumë > 0 (LEK ose EUR)')
      setTimeout(() => setMsg(''), 3000)
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/safe-withdrawals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          amount_lek: nLek,
          amount_eur: nEur,
          person: person.trim(),
          note: note.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'gabim')
      setLek(''); setEur(''); setPerson(''); setNote('')
      setMsg('✓ Tërheqja u regjistrua')
      setTimeout(() => setMsg(''), 2500)
      loadHistory()
    } catch (err) {
      setMsg('⚠ ' + err.message)
      setTimeout(() => setMsg(''), 3500)
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async id => {
    try {
      await fetch(`/api/safe-withdrawals/${id}`, { method: 'DELETE' })
      setConfirmDel(null)
      loadHistory()
    } catch (e) { console.error(e) }
  }

  const totalLek = history.reduce((s, r) => s + (r.amount_lek || 0), 0)
  const totalEur = history.reduce((s, r) => s + (r.amount_eur || 0), 0)

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <h3 className="text-lg font-bold text-slate-800">Tërheqje nga Kasaforta</h3>
        <p className="text-xs text-slate-500 mt-1">
          Regjistro çdo tërheqje me shumën, personin që e mori, dhe një shënim opsional.
          Klik butonin "Regjistro Tërheqjen" për ta ruajtur.
        </p>

        <form onSubmit={submit} className="mt-5 grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
          <div>
            <label className="form-label">Shuma LEK</label>
            <input
              type="number" step="0.01" min="0"
              value={lek} onChange={e => setLek(e.target.value)}
              className="input-field text-right font-semibold"
              placeholder="0.00"
            />
          </div>
          <div>
            <label className="form-label">Shuma EUR</label>
            <input
              type="number" step="0.01" min="0"
              value={eur} onChange={e => setEur(e.target.value)}
              className="input-field text-right font-semibold"
              placeholder="0.00"
            />
          </div>
          <div className="md:col-span-2">
            <label className="form-label">Personi (kush e mori)</label>
            <input
              type="text"
              value={person} onChange={e => setPerson(e.target.value)}
              className="input-field"
              placeholder="p.sh. BIBA, DIANA"
            />
          </div>
          <div className="md:col-span-2">
            <label className="form-label">Shënim (opsional)</label>
            <input
              type="text"
              value={note} onChange={e => setNote(e.target.value)}
              className="input-field"
              placeholder="arsyeja / destinacioni"
            />
          </div>
          <div className="md:col-span-6 flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="btn-primary disabled:opacity-50"
            >
              {saving ? '⏳ Duke ruajtur...' : '💾 Regjistro Tërheqjen'}
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

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-0 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h4 className="text-sm font-bold text-slate-800">Historik i Tërheqjeve</h4>
            <p className="text-xs text-slate-500 mt-0.5">
              {history.length} regjistrime · Total: <strong className="text-slate-700">{fmt(totalLek)} LEK</strong>
              {totalEur > 0 && <> · <strong className="text-slate-700">{fmt(totalEur)} EUR</strong></>}
            </p>
          </div>
          <div className="flex items-end gap-2 flex-wrap">
            <div>
              <label className="form-label text-[10px]">Nga data</label>
              <input
                type="date"
                value={fromDate}
                max={toDate || undefined}
                onChange={e => setFromDate(e.target.value)}
                className="input-field text-xs py-1.5"
              />
            </div>
            <div>
              <label className="form-label text-[10px]">Deri më datë</label>
              <input
                type="date"
                value={toDate}
                min={fromDate || undefined}
                onChange={e => setToDate(e.target.value)}
                className="input-field text-xs py-1.5"
              />
            </div>
            {(fromDate || toDate) && (
              <button
                type="button"
                onClick={() => { setFromDate(''); setToDate('') }}
                className="btn-secondary text-xs py-1.5"
              >
                Pastro
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center text-slate-400 text-sm">Duke ngarkuar...</div>
        ) : history.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">
            Ende pa tërheqje të regjistruara.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Data</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Ora</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">LEK</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">EUR</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Personi</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Shënim</th>
                <th className="text-center px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Veprim</th>
              </tr>
            </thead>
            <tbody>
              {history.map(r => (
                <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2.5 text-slate-700 font-medium">{r.date}</td>
                  <td className="px-4 py-2.5 text-slate-500 text-xs">{fmtDateTime(r.created_at)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-slate-800">{fmt(r.amount_lek)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-slate-800">{fmt(r.amount_eur)}</td>
                  <td className="px-4 py-2.5 text-slate-700">{r.person || <span className="text-slate-400 italic">—</span>}</td>
                  <td className="px-4 py-2.5 text-slate-600">{r.note || <span className="text-slate-400 italic">—</span>}</td>
                  <td className="px-4 py-2.5 text-center">
                    <button
                      onClick={() => setConfirmDel(r)}
                      className="px-2.5 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 text-xs font-medium"
                    >
                      Fshi
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {confirmDel && (
        <div className="modal-overlay">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
            <div className="text-center">
              <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-4">🗑️</div>
              <h3 className="font-bold text-slate-800 text-lg mb-2">Fshi tërheqjen?</h3>
              <p className="text-slate-500 text-sm mb-6">
                {confirmDel.date} — {fmt(confirmDel.amount_lek)} LEK
                {confirmDel.amount_eur > 0 && ` / ${fmt(confirmDel.amount_eur)} EUR`}
                {confirmDel.person && ` (${confirmDel.person})`}
              </p>
              <div className="flex gap-3">
                <button onClick={() => setConfirmDel(null)} className="btn-secondary flex-1 justify-center">Anulo</button>
                <button
                  onClick={() => doDelete(confirmDel.id)}
                  className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors"
                >
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
