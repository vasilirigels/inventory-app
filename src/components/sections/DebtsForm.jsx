import { useEffect, useState, useCallback } from 'react'

const CUR = ['lek', 'eur', 'usd', 'gbp', 'chf']
function n(v) { return parseFloat(v) || 0 }
function fmt(v) {
  const val = n(v)
  if (val === 0) return '-'
  return val.toLocaleString('sq-AL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

// mode: 'debt' = Borxhe Klienti, 'repayment' = Kthim Borxhi
export default function DebtsForm({ date, mode }) {
  const [debts, setDebts] = useState([])
  const [form, setForm] = useState({ name: '', lek: '', eur: '', usd: '', gbp: '', chf: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [savedMsg, setSavedMsg] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/debts/${date}`)
      const arr = await res.json()
      setDebts(arr.filter(d => d.type === mode))
    } catch (e) { console.error(e) }
  }, [date, mode])

  useEffect(() => { load() }, [load])

  const add = async e => {
    e.preventDefault()
    setError('')
    if (!form.name.trim()) { setError('Vendos emrin e klientit.'); return }
    const hasAmount = CUR.some(c => n(form[c]) !== 0)
    if (!hasAmount) { setError('Vendos të paktën një vlerë monetare.'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/debts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date, name: form.name.trim(), type: mode,
          lek: n(form.lek), eur: n(form.eur), usd: n(form.usd), gbp: n(form.gbp), chf: n(form.chf),
        }),
      })
      if (!res.ok) throw new Error('Gabim në ruajtje')
      setForm({ name: '', lek: '', eur: '', usd: '', gbp: '', chf: '' })
      await load()
      setSavedMsg('Shtuar ✓'); setTimeout(() => setSavedMsg(''), 1500)
    } catch (e) { setError(e.message || 'Gabim në rrjet') }
    finally { setBusy(false) }
  }

  const remove = async id => {
    if (!confirm('Fshi këtë regjistrim?')) return
    await fetch(`/api/debts/${id}`, { method: 'DELETE' })
    await load()
  }

  const totals = {}
  CUR.forEach(c => { totals[c] = debts.reduce((s, d) => s + n(d[c]), 0) })

  const title = mode === 'debt' ? 'Borxhe Klienti' : 'Kthim Borxhi'
  const description = mode === 'debt'
    ? 'Klientë që kanë marrë mall apo para pa paguar.'
    : 'Klientë që po kthejnë borxhin e marrë më parë.'

  return (
    <div className="max-w-5xl mx-auto">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-800">{title}</h3>
            <p className="text-xs text-slate-500 mt-1 mb-4">{description}</p>
          </div>
          {savedMsg && <span className="text-xs px-2 py-1 rounded-md bg-emerald-100 text-emerald-700">{savedMsg}</span>}
        </div>

        {error && (
          <div className="mb-3 px-3 py-2 bg-rose-50 border border-rose-200 text-rose-700 rounded-md text-sm">
            ⚠ {error}
          </div>
        )}

        <form onSubmit={add} className="grid grid-cols-1 md:grid-cols-7 gap-2 mb-4 p-3 bg-slate-50 rounded-lg">
          <input
            type="text" placeholder="Emri *" required
            value={form.name} onChange={e => { setForm(f => ({ ...f, name: e.target.value })); setError('') }}
            className="md:col-span-2 px-3 py-2 border border-slate-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {CUR.map(c => (
            <input
              key={c} type="number" step="any" placeholder={c.toUpperCase()}
              value={form[c]} onChange={e => setForm(f => ({ ...f, [c]: e.target.value }))}
              className="px-2 py-2 border border-slate-200 rounded-md text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          ))}
          <button
            type="submit" disabled={busy}
            className="md:col-span-7 mt-1 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50"
          >
            {busy ? 'Duke ruajtur…' : 'Shto regjistrim'}
          </button>
        </form>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="text-left px-3 py-2 text-xs font-semibold text-slate-600">Emri</th>
              {CUR.map(c => <th key={c} className="text-right px-3 py-2 text-xs font-semibold text-slate-600">{c.toUpperCase()}</th>)}
              <th className="w-12" />
            </tr>
          </thead>
          <tbody>
            {debts.length === 0 && (
              <tr><td colSpan={CUR.length + 2} className="text-center text-slate-400 py-6 text-sm">Asnjë regjistrim për këtë datë.</td></tr>
            )}
            {debts.map(d => (
              <tr key={d.id} className="border-b border-slate-100">
                <td className="px-3 py-2 text-slate-700">{d.name}</td>
                {CUR.map(c => <td key={c} className="px-3 py-2 text-right tabular-nums">{fmt(d[c])}</td>)}
                <td className="px-2 py-2 text-right">
                  <button onClick={() => remove(d.id)} className="text-rose-500 hover:text-rose-700 text-xs">✕</button>
                </td>
              </tr>
            ))}
            {debts.length > 0 && (
              <tr className="bg-slate-50 font-semibold">
                <td className="px-3 py-2 text-slate-700">Total</td>
                {CUR.map(c => <td key={c} className="px-3 py-2 text-right tabular-nums text-slate-800">{fmt(totals[c])}</td>)}
                <td />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
