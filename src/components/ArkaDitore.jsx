import { useCallback, useEffect, useRef, useState } from 'react'
import MoneyInput from './MoneyInput.jsx'
import { useRealtimeSync } from '../hooks/useRealtimeSync.js'

const CURS = ['LEK', 'EUR', 'USD', 'GBP', 'CHF']

function fmt(v) {
  const x = parseFloat(v) || 0
  if (x === 0) return '-'
  return x.toLocaleString('sq-AL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

function fmtSigned(v, sign) {
  const x = parseFloat(v) || 0
  if (x === 0) return '-'
  return sign + ' ' + x.toLocaleString('sq-AL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

function zeroPerCur() { return { LEK: 0, EUR: 0, USD: 0, GBP: 0, CHF: 0 } }

export default function ArkaDitore({ date, onNavigate }) {
  const [data, setData]       = useState(null)
  const [rates, setRates]     = useState(null)   // { LEK, EUR, USD, GBP, CHF } — LEK për 1 njësi
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [physInput, setPhysInput] = useState(zeroPerCur())
  const [toSafeInput, setToSafeInput] = useState(zeroPerCur())
  const [closingOut, setClosingOut]   = useState(false)
  const [closeoutMsg, setCloseoutMsg] = useState('')
  const [savedMsg, setSavedMsg]   = useState('')
  const saveTimer = useRef(null)

  // Rifresko vetëm data-t e llogaritura (arka + kurset) — pa prekur inputet e
  // përdoruesit për cash fizik / kasafortë (që mund të jenë duke u shkruar).
  const refreshData = useCallback(async () => {
    try {
      const [d, rt] = await Promise.all([
        fetch(`/api/arka-ditore/${date}`).then(r => r.json()),
        fetch(`/api/exchange-rates/${date}`).then(r => r.json()).catch(() => null),
      ])
      setData(d)
      setRates(rt?.rates || null)
      return d
    } catch (e) { setError(e.message || 'Gabim'); return null }
  }, [date])

  const load = async () => {
    setLoading(true); setError('')
    const d = await refreshData()
    if (d) {
      const phys = zeroPerCur()
      const safe = zeroPerCur()
      for (const c of CURS) {
        phys[c] = d.physical_cash?.[c] ? String(d.physical_cash[c]) : ''
        safe[c] = d.closeout_to_safe?.[c] ? String(d.closeout_to_safe[c]) : ''
      }
      setPhysInput(phys); setToSafeInput(safe)
    }
    setLoading(false)
  }

  useEffect(() => { load() /* eslint-disable-next-line */ }, [date])

  // Rifresko automatikisht sa herë që një shitje/blerje/shpenzim/pagesë ndikon
  // xhiron ose fluksin e keshit të ditës.
  useRealtimeSync(
    ['invoices', 'invoice_payments', 'expense_entries', 'purchase_invoices',
     'hurda_purchases', 'has_purchases', 'daily_records', 'safe_withdrawals',
     'worker_payments'],
    refreshData
  )

  const savePhysical = async (values) => {
    const payload = {}
    for (const c of CURS) payload[c] = parseFloat(values[c]) || 0
    try {
      const resp = await fetch(`/api/arka-ditore/${date}/physical`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ physical_cash: payload }),
      })
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${resp.status}`)
      }
      // Rifreskim që të përditësohen difference-ët
      const fresh = await fetch(`/api/arka-ditore/${date}`).then(r => r.json())
      setData(fresh)
      setSavedMsg('Ruajtur ✓'); setTimeout(() => setSavedMsg(''), 1200)
    } catch (e) {
      setSavedMsg(`⚠ ${e.message || 'Gabim'}`); setTimeout(() => setSavedMsg(''), 2500)
    }
  }

  const handlePhysChange = (cur, v) => {
    setPhysInput(prev => {
      const next = { ...prev, [cur]: v }
      clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => savePhysical(next), 600)
      return next
    })
  }

  const doCloseout = async () => {
    if (closingOut) return
    const toSafe = {}
    for (const c of CURS) toSafe[c] = parseFloat(toSafeInput[c]) || 0
    for (const c of CURS) {
      const phys = parseFloat(physInput[c]) || 0
      if (toSafe[c] > phys) {
        setCloseoutMsg(`⚠ Në ${c} shuma për kasafortë (${toSafe[c]}) është më e madhe se gjendja fizike (${phys}).`)
        setTimeout(() => setCloseoutMsg(''), 4000)
        return
      }
    }
    setClosingOut(true)
    try {
      const resp = await fetch(`/api/arka-ditore/${date}/closeout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to_safe: toSafe }),
      })
      const r = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(r.error || `HTTP ${resp.status}`)
      const fresh = await fetch(`/api/arka-ditore/${date}`).then(r => r.json())
      setData(fresh)
      setCloseoutMsg(`✓ Mbyllur për ${r.next_date}`)
      setTimeout(() => setCloseoutMsg(''), 3000)
    } catch (e) {
      setCloseoutMsg(`⚠ Gabim në mbyllje: ${e.message || ''}`)
      setTimeout(() => setCloseoutMsg(''), 4000)
    } finally { setClosingOut(false) }
  }

  if (loading) return <div className="card p-8 text-center text-slate-400 dark:text-slate-500 text-sm">Duke ngarkuar...</div>
  if (error)   return <div className="card p-8 text-center text-red-500 text-sm">⚠ {error}</div>
  if (!data)   return null

  // Cilat monedha kanë aktivitet ndonjë (për të vendosur se çfarë të shfaqet).
  const activeCurs = CURS.filter(c =>
    (data.xhiro_total?.[c]     || 0) ||
    (data.debt_repayments?.[c] || 0) ||
    (data.porosi_deposits?.[c] || 0) ||
    (data.safe_to_arka?.[c]    || 0) ||
    (data.worker_payments_cash?.[c] || 0) ||
    (data.returns_gross?.[c]   || 0) ||
    (data.opening_cash?.[c]    || 0) ||
    (data.expenses?.[c]        || 0) ||
    (data.expenses_daily?.[c]     || 0) ||
    (data.expenses_transport?.[c] || 0) ||
    (data.expenses_marketing?.[c] || 0) ||
    (data.marketing_in_kind?.[c]  || 0) ||
    (data.purchase_cash?.[c]   || 0) ||
    (data.hurda_cash?.[c]      || 0) ||
    (data.physical_cash?.[c]   || 0) ||
    (data.closeout_to_safe?.[c]|| 0)
  )
  // Gjithmonë shfaq të paktën LEK.
  const shownCurs = activeCurs.length ? activeCurs : ['LEK']
  // Për seksionet e input-it (fizik, mbyllje) shfaqim gjithmonë të 5 monedhat
  // që user të mund të plotësojë EUR/USD/GBP edhe kur s'ka aktivitet automatik
  // në ato monedha (p.sh. cash që hyn nga jashtë sistemit).
  const inputCurs = CURS

  const rows = [
    { label: 'Gjendje Fillestare (mbartje)',   src: 'opening_cash',      sign: '+', color: 'text-slate-700 dark:text-slate-200',   bg: 'bg-slate-50 dark:bg-slate-900',   detail: 'nga dita e mëparshme' },
    { label: 'Xhiro Totale (Fatura Shitje)',   src: 'xhiro_total',       sign: '+', color: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-50 dark:bg-emerald-900/30', detail: `${data.counts.invoices} fatura` },
    { label: 'Marketingu Shitje',              src: 'marketing_in_kind',  sign: '+', color: 'text-pink-700 dark:text-pink-300', bg: 'bg-pink-50 dark:bg-pink-900/30', detail: `${data.counts?.marketing_in_kind || 0} produkte dhënë si marketing in-kind (vlera = kostoja për ditën)` },
    { label: 'Pagesa me Bankë',                 src: 'paid_bank',         sign: '−', color: 'text-blue-700 dark:text-blue-300',    bg: 'bg-blue-50 dark:bg-blue-900/30',    detail: 'paid_bank' },
    { label: 'Pagesa me POS',                   src: 'paid_pos',          sign: '−', color: 'text-indigo-700',  bg: 'bg-indigo-50 dark:bg-indigo-900/30',  detail: 'paid_pos' },
    { label: 'Borxh i Papaguar',                src: 'amount_due',        sign: '−', color: 'text-rose-700',    bg: 'bg-rose-50',    detail: 'mbetja e papaguar' },
    { label: 'Kesh nga Shitjet',                src: 'cash_from_sales',   sign: '=', color: 'text-emerald-800 dark:text-emerald-200', bg: 'bg-emerald-50/60', detail: 'Xhiro − Bankë − POS − Borxh (përfshin parapagimin nga borxhet)' },
    { label: 'Pagesë Borxhi',                   src: 'debt_repayments',   sign: '+', color: 'text-teal-700',    bg: 'bg-teal-50',    detail: `${data.counts.debt_repayments || 0} pagesa kesh nga fatura të vjetra (jo pjesë e xhiros)` },
    { label: 'Depozita Porosi',                 src: 'porosi_deposits',   sign: '+', color: 'text-fuchsia-700', bg: 'bg-fuchsia-50', detail: `${data.counts.porosi_deposits || 0} depozita kesh nga porositë (custom orders)` },
    { label: 'Tërheqje nga Kasaforta',          src: 'safe_to_arka',      sign: '+', color: 'text-sky-700 dark:text-sky-300', bg: 'bg-sky-50 dark:bg-sky-900/30', detail: `${data.counts?.safe_to_arka || 0} tërheqje me destinacion arkë` },
  ]
  const outRows = [
    { label: 'Kthime Shitjesh (Kesh)',          src: 'returns_cash',      sign: '−', color: 'text-red-700 dark:text-red-300',      bg: 'bg-red-50 dark:bg-red-900/30',       detail: `${data.counts?.credit_notes || 0} kreditore · rimbursim kesh (dalje nga sirtari)` },
    { label: 'Shpenzime Ditore',                src: 'expenses_daily',    sign: '−', color: 'text-orange-700 dark:text-orange-300',  bg: 'bg-orange-50 dark:bg-orange-900/30',  detail: `${data.counts?.expenses_daily || 0} regjistrime` },
    { label: 'Shpenzime Transporti',            src: 'expenses_transport', sign: '−', color: 'text-cyan-700 dark:text-cyan-300',     bg: 'bg-cyan-50 dark:bg-cyan-900/30',       detail: `${data.counts?.expenses_transport || 0} pagesa (me/pa faturë)` },
    { label: 'Shpenzime Marketingu',            src: 'expenses_marketing', sign: '−', color: 'text-pink-700 dark:text-pink-300',     bg: 'bg-pink-50 dark:bg-pink-900/30',       detail: `${data.counts?.expenses_marketing || 0} zëra cash${(data.marketing_in_kind_eur || 0) > 0 ? ` + ${(data.marketing_in_kind_eur).toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR in-kind (i njëjti që del si "Marketingu Shitje" sipër — efekti neto në arkë = 0)` : ''}` },
    { label: 'Fatura Blerje Kesh',              src: 'purchase_cash',     sign: '−', color: 'text-amber-700 dark:text-amber-300',   bg: 'bg-amber-50 dark:bg-amber-900/30',   detail: `${data.counts.purchases_cash} fatura` },
    { label: 'Konvertim Hurdë',                 src: 'hurda_cash',        sign: '−', color: 'text-yellow-700 dark:text-yellow-300',  bg: 'bg-yellow-50 dark:bg-yellow-900/30',  detail: `${data.counts.hurda_purchases || 0} blerje · ${(data.hurda_gram_total || 0).toLocaleString('sq-AL', { maximumFractionDigits: 3 })} g` },
    { label: 'Blerje HAS',                      src: 'has_cash',          sign: '−', color: 'text-amber-800 dark:text-amber-200',   bg: 'bg-amber-50 dark:bg-amber-900/30',   detail: `${data.counts.has_purchases || 0} blerje · ${(data.has_gram_total || 0).toLocaleString('sq-AL', { maximumFractionDigits: 3 })} g HAS` },
    { label: 'Pagesa Punëtorësh',               src: 'worker_payments_cash', sign: '−', color: 'text-purple-700 dark:text-purple-300', bg: 'bg-purple-50 dark:bg-purple-900/30', detail: `${data.counts?.worker_payments || 0} pagesa (pjesa kesh + shpërblim kesh)` },
  ]

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div className="card flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Arka Ditore</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Bilanc i ditës për çdo monedhë, bazuar tek Fatura Shitje, Fatura Blerje (kesh) dhe Shpenzimet.
          </p>
        </div>
        <button
          type="button"
          onClick={refreshData}
          className="btn-secondary text-xs whitespace-nowrap"
          title="Ringarko të dhënat nga serveri"
        >🔄 Rifresko</button>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Të Ardhura nga Shitja</h4>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800">
            <tr>
              <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Zëri</th>
              {shownCurs.map(c => (
                <th key={c} className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.label} className={`border-b border-slate-100 dark:border-slate-800 ${r.bg}`}>
                <td className="px-4 py-2.5 text-slate-700 dark:text-slate-200">
                  {r.label}
                  <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">{r.detail}</span>
                </td>
                {shownCurs.map(c => (
                  <td key={c} className={`px-3 py-2.5 text-right tabular-nums font-semibold ${r.color}`}>
                    {fmtSigned(data[r.src]?.[c], r.sign)}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="border-t-2 border-slate-300 dark:border-slate-700 bg-emerald-100">
              <td className="px-4 py-3 font-bold text-slate-800 dark:text-slate-100">
                = Kesh në Dispozicion
                <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">Mbartje + Xhiro − Bankë − POS − Borxh</span>
              </td>
              {shownCurs.map(c => (
                <td key={c} className="px-3 py-3 text-right tabular-nums font-bold text-emerald-800 dark:text-emerald-200 text-base">
                  {fmt((data.opening_cash?.[c] || 0) + (data.cash_from_sales?.[c] || 0))}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Dalje nga Arka</h4>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800">
            <tr>
              <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Zëri</th>
              {shownCurs.map(c => (
                <th key={c} className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {outRows.map(r => (
              <tr key={r.label} className={`border-b border-slate-100 dark:border-slate-800 ${r.bg}`}>
                <td className="px-4 py-2.5 text-slate-700 dark:text-slate-200">
                  {r.label}
                  <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">{r.detail}</span>
                </td>
                {shownCurs.map(c => (
                  <td key={c} className={`px-3 py-2.5 text-right tabular-nums font-semibold ${r.color}`}>
                    {fmtSigned(data[r.src]?.[c], r.sign)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card bg-slate-900 dark:bg-slate-950 text-white">
        <div className="mb-2">
          <p className="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide font-semibold">Gjendja e Arkës në Fund të Ditës (Teorike)</p>
          <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
            Mbartje + Kesh nga shitjet − Shpenzime − Blerje kesh
          </p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-3">
          {CURS.map(c => {
            const v = data.cash_balance?.[c] || 0
            return (
              <div key={c} className="bg-slate-800 dark:bg-slate-900 rounded-lg px-3 py-2">
                <div className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-semibold">{c}</div>
                <div className={`text-lg font-extrabold tabular-nums ${v < 0 ? 'text-rose-400' : v > 0 ? 'text-emerald-300' : 'text-slate-500 dark:text-slate-400'}`}>
                  {fmt(v)}
                </div>
              </div>
            )
          })}
        </div>

        {/* Totali i konvertuar në EUR me kursin e ditës (BSH) */}
        {(() => {
          const eurRate = parseFloat(rates?.EUR) || 0
          if (eurRate <= 0) {
            return (
              <div className="mt-3 rounded-lg bg-slate-800/60 border border-slate-700 px-3 py-2 text-[11px] text-slate-400 dark:text-slate-500">
                Nuk u gjet kursi i EUR për këtë datë — nuk mund të llogaritet totali.
              </div>
            )
          }
          // Kthe çdo monedhë në LEK, pastaj LEK → EUR
          let lekTotal = 0
          for (const c of CURS) {
            const v = parseFloat(data.cash_balance?.[c]) || 0
            const r = c === 'LEK' ? 1 : (parseFloat(rates?.[c]) || 0)
            lekTotal += v * r
          }
          const eurTotal = lekTotal / eurRate
          const totalCls = eurTotal < 0 ? 'text-rose-400' : eurTotal > 0 ? 'text-emerald-300' : 'text-slate-500 dark:text-slate-400'
          return (
            <div className="mt-3 rounded-lg bg-gradient-to-r from-emerald-900/40 to-slate-800 border border-emerald-800/50 px-4 py-3 flex items-baseline justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[10px] text-emerald-300/80 uppercase tracking-wide font-semibold">Total i Konvertuar</div>
              </div>
              <div className={`text-2xl font-extrabold tabular-nums whitespace-nowrap ${totalCls}`}>
                {fmt(eurTotal)} <span className="text-sm font-semibold text-slate-300">EUR</span>
              </div>
            </div>
          )
        })()}
      </div>

      <div className="card border-2 border-amber-200 bg-amber-50 dark:bg-amber-900/30">
        <div className="mb-3">
          <label className="block text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-200">
            Gjendja Fizike e Arkës (e Numëruar Dorazi)
          </label>
          <p className="text-[10px] text-amber-700 dark:text-amber-300 mt-0.5">
            Vendos shumën e numëruar fizikisht për çdo monedhë. Ruajtja është automatike.
          </p>
          {savedMsg && <span className="text-xs text-emerald-700 dark:text-emerald-300 font-medium mt-1 inline-block">{savedMsg}</span>}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {inputCurs.map(c => (
            <div key={c}>
              <label className="text-[10px] text-amber-800 dark:text-amber-200 font-semibold uppercase">{c}</label>
              <MoneyInput
                value={physInput[c] ?? ''}
                onChange={v => handlePhysChange(c, String(v))}
                allowNegative
                className="input-field text-right font-bold text-amber-900"
                placeholder="0.00"
              />
            </div>
          ))}
        </div>
      </div>

      <div className="card p-0 overflow-hidden border-2 border-slate-200 dark:border-slate-700">
        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Diferenca (Fizike − Teorike)</h4>
        </div>
        <table className="w-full text-sm">
          <tbody>
            <tr>
              <td className="px-4 py-3 text-slate-700 dark:text-slate-200 font-medium">Diferenca</td>
              {inputCurs.map(c => {
                const v = data.difference?.[c] || 0
                // v > 0 → fizike > teorike (teprica) — jo krizë, por çudi
                // v < 0 → fizike < teorike (paratë kanë munguar) — problem serioz
                const cls = Math.abs(v) < 0.005 ? 'text-emerald-600'
                          : v > 0 ? 'text-amber-600'
                          : 'text-rose-600'
                const title = Math.abs(v) < 0.005 ? 'Diferenca 0 — arka përputhet'
                            : v > 0 ? `Teprica: ${fmt(v)} ${c} më shumë se teorikja`
                            : `Mungon: ${fmt(-v)} ${c} nga arka`
                return (
                  <td key={c} className={`px-3 py-3 text-right tabular-nums font-bold text-base ${cls}`} title={title}>
                    {v > 0 ? '+' : ''}{fmt(v)}
                  </td>
                )
              })}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card border-2 border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900">
        <div className="mb-3">
          <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">🔒 Mbyllje Dite — Ndaj Gjendjen Fizike</h4>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Vendos sasinë që do të kalojë në kasafortë për çdo monedhë. Pjesa tjetër mbartet automatikisht si gjendje fillestare për ditën pasardhëse.
          </p>
        </div>
        <table className="w-full text-sm mb-3">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-700">
              <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500 dark:text-slate-400">Zëri</th>
              {inputCurs.map(c => (
                <th key={c} className="text-right px-3 py-2 text-xs font-semibold text-slate-500 dark:text-slate-400 w-28">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-100 dark:border-slate-800">
              <td className="px-3 py-2 text-slate-700 dark:text-slate-200">Gjendja fizike</td>
              {inputCurs.map(c => (
                <td key={c} className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{fmt(parseFloat(physInput[c]) || 0)}</td>
              ))}
            </tr>
            <tr className="border-b border-slate-100 dark:border-slate-800 bg-amber-50/50">
              <td className="px-3 py-2 font-semibold text-amber-800 dark:text-amber-200">Kalo në Kasafortë</td>
              {inputCurs.map(c => (
                <td key={c} className="px-2 py-1">
                  <MoneyInput
                    value={toSafeInput[c] ?? ''}
                    onChange={v => setToSafeInput(prev => ({ ...prev, [c]: String(v) }))}
                    className="w-full text-right border border-amber-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 font-bold text-amber-900"
                    placeholder="0"
                  />
                </td>
              ))}
            </tr>
            <tr className="bg-emerald-50/50">
              <td className="px-3 py-2 font-semibold text-emerald-800 dark:text-emerald-200">Mbart për ditën pasardhëse</td>
              {inputCurs.map(c => {
                const phys = parseFloat(physInput[c]) || 0
                const safe = parseFloat(toSafeInput[c]) || 0
                return (
                  <td key={c} className="px-3 py-2 text-right tabular-nums font-bold text-emerald-800 dark:text-emerald-200">
                    {fmt(Math.max(0, phys - safe))}
                  </td>
                )
              })}
            </tr>
          </tbody>
        </table>
        <div className="flex items-center gap-3">
          <button
            onClick={doCloseout}
            disabled={closingOut}
            className="btn-primary disabled:opacity-40"
          >
            {closingOut ? '⏳ Duke mbyllur...' : '🔒 Mbyll Ditën'}
          </button>
          {closeoutMsg && (
            <span className={`text-sm ${closeoutMsg.startsWith('⚠') ? 'text-rose-600' : 'text-emerald-700 dark:text-emerald-300'}`}>
              {closeoutMsg}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => onNavigate?.('arka-kasaforta')} className="btn-secondary text-xs">→ Kasaforta</button>
        <button onClick={() => onNavigate?.('fatura-shitje')}  className="btn-secondary text-xs">→ Fatura Shitje</button>
        <button onClick={() => onNavigate?.('artikuj-te-tjere')}  className="btn-secondary text-xs">→ Artikuj Të Tjerë</button>
        <button onClick={() => onNavigate?.('arka-shpenzime')} className="btn-secondary text-xs">→ Shpenzime</button>
      </div>
    </div>
  )
}
