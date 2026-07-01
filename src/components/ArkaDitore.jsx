import { useEffect, useRef, useState } from 'react'

function fmt(v) {
  const x = parseFloat(v) || 0
  return x.toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function ArkaDitore({ date, onNavigate }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [physInput, setPhysInput] = useState('')
  const [toSafeInput, setToSafeInput] = useState('')
  const [closingOut, setClosingOut]   = useState(false)
  const [closeoutMsg, setCloseoutMsg] = useState('')
  const [savedMsg, setSavedMsg]   = useState('')
  const saveTimer = useRef(null)

  const load = async () => {
    setLoading(true); setError('')
    try {
      const d = await fetch(`/api/arka-ditore/${date}`).then(r => r.json())
      setData(d)
      setPhysInput(d.physical_cash ? String(d.physical_cash) : '')
      setToSafeInput(d.closeout_to_safe ? String(d.closeout_to_safe) : '')
    } catch (e) { setError(e.message || 'Gabim') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() /* eslint-disable-next-line */ }, [date])

  const doCloseout = async () => {
    if (closingOut) return
    const toSafe = parseFloat(toSafeInput) || 0
    const phys   = data?.physical_cash || 0
    if (toSafe > phys) {
      setCloseoutMsg('⚠ Shuma për kasafortë nuk mund të jetë më e madhe se gjendja fizike.')
      setTimeout(() => setCloseoutMsg(''), 3500)
      return
    }
    setClosingOut(true)
    try {
      const r = await fetch(`/api/arka-ditore/${date}/closeout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to_safe_lek: toSafe }),
      }).then(r => r.json())
      setData(prev => prev ? {
        ...prev,
        closeout_to_safe: r.to_safe_lek,
        carryover_next_day: r.carry_lek,
      } : prev)
      setCloseoutMsg(`✓ Mbyllur: ${r.to_safe_lek.toLocaleString('sq-AL')} në kasafortë, ${r.carry_lek.toLocaleString('sq-AL')} mbart për ${r.next_date}`)
      setTimeout(() => setCloseoutMsg(''), 4000)
    } catch (e) {
      setCloseoutMsg('⚠ Gabim në mbyllje')
      setTimeout(() => setCloseoutMsg(''), 3000)
    } finally { setClosingOut(false) }
  }

  const savePhysical = async (raw) => {
    const value = parseFloat(raw) || 0
    try {
      await fetch(`/api/arka-ditore/${date}/physical`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ physical_cash_lek: value }),
      })
      setData(prev => prev ? {
        ...prev,
        physical_cash: value,
        difference: +(value - prev.cash_balance).toFixed(2),
      } : prev)
      setSavedMsg('Ruajtur ✓'); setTimeout(() => setSavedMsg(''), 1200)
    } catch (e) {
      setSavedMsg('⚠ Gabim'); setTimeout(() => setSavedMsg(''), 2000)
    }
  }

  const handlePhysChange = (v) => {
    setPhysInput(v)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => savePhysical(v), 600)
  }

  if (loading) {
    return <div className="card p-8 text-center text-slate-400 text-sm">Duke ngarkuar...</div>
  }
  if (error) {
    return <div className="card p-8 text-center text-red-500 text-sm">⚠ {error}</div>
  }
  if (!data) return null

  const rows = [
    { label: 'Gjendje Fillestare (mbartje)',   value: data.opening_cash,  sign: '+', color: 'text-slate-700',   bg: 'bg-slate-50',    detail: 'nga dita e mëparshme' },
    { label: 'Xhiro Totale (Fatura Shitje)',  value: data.xhiro_total,   sign: '+', color: 'text-emerald-700', bg: 'bg-emerald-50',  detail: `${data.counts.invoices} fatura` },
    { label: 'Pagesa me Bankë',                value: data.paid_bank,     sign: '−', color: 'text-blue-700',    bg: 'bg-blue-50',     detail: 'paid_bank' },
    { label: 'Pagesa me POS',                  value: data.paid_pos,      sign: '−', color: 'text-indigo-700',  bg: 'bg-indigo-50',   detail: 'paid_pos' },
    { label: 'Borxh i Papaguar (amount_due)',  value: data.amount_due,    sign: '−', color: 'text-rose-700',    bg: 'bg-rose-50',     detail: 'borxhi nga ditja' },
  ]
  const outRows = [
    { label: 'Shpenzime (Arkë)',               value: data.expenses,      sign: '−', color: 'text-orange-700',  bg: 'bg-orange-50',   detail: `${data.counts.expenses} regjistrime` },
    { label: 'Fatura Blerje Kesh',             value: data.purchase_cash, sign: '−', color: 'text-amber-700',   bg: 'bg-amber-50',    detail: `${data.counts.purchases_cash} fatura` },
  ]

  const diff = data.difference || 0
  const diffColor = Math.abs(diff) < 0.005 ? 'text-emerald-600' : diff > 0 ? 'text-rose-600' : 'text-amber-600'
  const diffLabel = Math.abs(diff) < 0.005 ? 'Përputhje e plotë' : diff > 0 ? 'Tepricë në arkë (më shumë kesh)' : 'Mungesë në arkë (mungon kesh)'

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="card">
        <h3 className="text-lg font-bold text-slate-800">Arka Ditore</h3>
        <p className="text-xs text-slate-500 mt-1">
          Bilanc i ditës bazuar tek Fatura Shitje, Fatura Blerje (kesh) dhe Shpenzimet. Vlerat në LEK.
        </p>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Të Ardhura nga Shitja</h4>
        </div>
        <table className="w-full text-sm">
          <tbody>
            {rows.map(r => (
              <tr key={r.label} className={`border-b border-slate-100 ${r.bg}`}>
                <td className="px-4 py-2.5 text-slate-700">{r.label}</td>
                <td className="px-4 py-2.5 text-xs text-slate-400">{r.detail}</td>
                <td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${r.color}`}>
                  {r.sign} {fmt(r.value)} LEK
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-slate-300 bg-emerald-100">
              <td className="px-4 py-3 font-bold text-slate-800">= Kesh në Dispozicion</td>
              <td className="px-4 py-3 text-xs text-slate-500">Mbartje + Xhiro − Bankë − POS − Borxh</td>
              <td className="px-4 py-3 text-right tabular-nums font-bold text-emerald-800 text-base">
                {fmt((data.opening_cash || 0) + data.cash_from_sales)} LEK
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Dalje nga Arka</h4>
        </div>
        <table className="w-full text-sm">
          <tbody>
            {outRows.map(r => (
              <tr key={r.label} className={`border-b border-slate-100 ${r.bg}`}>
                <td className="px-4 py-2.5 text-slate-700">{r.label}</td>
                <td className="px-4 py-2.5 text-xs text-slate-400">{r.detail}</td>
                <td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${r.color}`}>
                  {r.sign} {fmt(r.value)} LEK
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card bg-slate-900 text-white">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-400 uppercase tracking-wide font-semibold">Gjendja e Arkës në Fund të Ditës (Teorike)</p>
            <p className="text-[10px] text-slate-500 mt-0.5">
              Mbartje + Kesh nga shitjet − Shpenzime − Blerje kesh
            </p>
          </div>
          <div className={`text-3xl font-extrabold tabular-nums ${data.cash_balance < 0 ? 'text-rose-400' : 'text-emerald-300'}`}>
            {fmt(data.cash_balance)} <span className="text-sm font-medium text-slate-400">LEK</span>
          </div>
        </div>
      </div>

      <div className="card border-2 border-amber-200 bg-amber-50">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-semibold uppercase tracking-wide text-amber-800 mb-1">
              Gjendja Fizike e Arkës (e Numëruar Dorazi)
            </label>
            <p className="text-[10px] text-amber-700">
              Vendos shumën që ke numëruar fizikisht në arkë. Ruajtja është automatike.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="0.01"
              value={physInput}
              onChange={e => handlePhysChange(e.target.value)}
              className="input-field w-44 text-right text-lg font-bold text-amber-900"
              placeholder="0.00"
            />
            <span className="text-sm font-medium text-amber-700">LEK</span>
            {savedMsg && <span className="text-xs text-emerald-700 font-medium ml-1">{savedMsg}</span>}
          </div>
        </div>
      </div>

      <div className={`card border-2 ${Math.abs(diff) < 0.005 ? 'border-emerald-300 bg-emerald-50' : diff > 0 ? 'border-rose-300 bg-rose-50' : 'border-amber-300 bg-amber-50'}`}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Diferenca (Fizike − Teorike)
            </p>
            <p className={`text-xs mt-0.5 font-medium ${diffColor}`}>{diffLabel}</p>
          </div>
          <div className={`text-3xl font-extrabold tabular-nums ${diffColor}`}>
            {diff > 0 ? '+' : ''}{fmt(diff)} <span className="text-sm font-medium text-slate-500">LEK</span>
          </div>
        </div>
      </div>

      <div className="card border-2 border-slate-300 bg-slate-50">
        <div className="mb-3">
          <h4 className="text-sm font-bold text-slate-800">🔒 Mbyllje Dite — Ndaj Gjendjen Fizike</h4>
          <p className="text-xs text-slate-500 mt-0.5">
            Vendos sasinë që do të kalojë në kasafortë. Pjesa tjetër mbartet automatikisht si gjendje fillestare e arkës për ditën pasardhëse.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div>
            <label className="form-label text-amber-700">Kalo në Kasafortë (LEK)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              max={data.physical_cash || undefined}
              value={toSafeInput}
              onChange={e => setToSafeInput(e.target.value)}
              className="input-field text-right font-bold text-amber-900"
              placeholder="0.00"
            />
          </div>
          <div>
            <label className="form-label text-emerald-700">Mbart për Ditën Pasardhëse</label>
            <div className="input-field bg-white text-right font-bold text-emerald-800 tabular-nums">
              {fmt(Math.max(0, (data.physical_cash || 0) - (parseFloat(toSafeInput) || 0)))} LEK
            </div>
            <p className="text-[10px] text-slate-400 mt-1">
              Gjendja fizike ({fmt(data.physical_cash || 0)}) − Kasafortë
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <button
              onClick={doCloseout}
              disabled={closingOut || !(data.physical_cash > 0)}
              className="btn-primary disabled:opacity-40"
              title={!(data.physical_cash > 0) ? 'Vendos së pari Gjendjen Fizike' : ''}
            >
              {closingOut ? '⏳ Duke mbyllur...' : '🔒 Mbyll Ditën'}
            </button>
            {closeoutMsg && (
              <span className={`text-[11px] ${closeoutMsg.startsWith('⚠') ? 'text-rose-600' : 'text-emerald-700'}`}>
                {closeoutMsg}
              </span>
            )}
          </div>
        </div>
        {data.closeout_to_safe > 0 && (
          <div className="mt-3 pt-3 border-t border-slate-200 text-xs text-slate-600 flex flex-wrap gap-4">
            <span>Mbyllur më parë: <strong className="text-amber-700">{fmt(data.closeout_to_safe)} LEK</strong> në kasafortë</span>
            <span>Mbartur: <strong className="text-emerald-700">{fmt(data.carryover_next_day)} LEK</strong> për ditën pasardhëse</span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => onNavigate?.('arka-kasaforta')} className="btn-secondary text-xs">→ Kasaforta</button>
        <button onClick={() => onNavigate?.('fatura-shitje')}  className="btn-secondary text-xs">→ Fatura Shitje</button>
        <button onClick={() => onNavigate?.('fatura-blerje')}  className="btn-secondary text-xs">→ Fatura Blerje</button>
        <button onClick={() => onNavigate?.('arka-shpenzime')} className="btn-secondary text-xs">→ Shpenzime</button>
      </div>
    </div>
  )
}
