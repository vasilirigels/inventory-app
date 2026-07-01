import { useEffect, useState } from 'react'

const ALBANIAN_MONTHS = [
  '', 'Janar', 'Shkurt', 'Mars', 'Prill', 'Maj', 'Qershor',
  'Korrik', 'Gusht', 'Shtator', 'Tetor', 'Nëntor', 'Dhjetor',
]

function n(v) { return parseFloat(v) || 0 }
function fmt(v) {
  const val = n(v)
  if (val === 0) return '-'
  return val.toLocaleString('sq-AL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

function prevMonth(month) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function nextMonth(month) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// Sum sales by type for a given day's sales array. Returns net (sale − return).
function salesTotalsByType(salesForDay) {
  const init = () => ({ cope: 0, gram: 0, lek_cash: 0, lek_pb: 0, eur_cash: 0, eur_pb: 0, usd: 0, gbp: 0, chf: 0 })
  const out = { flori: init(), diamant: init(), online: init() }
  salesForDay.forEach(s => {
    const sign = s.is_return ? -1 : 1
    const t = out[s.type]; if (!t) return
    t.cope     += sign * n(s.cope)
    t.gram     += sign * n(s.gram)
    t.lek_cash += sign * n(s.lek_cash)
    t.lek_pb   += sign * n(s.lek_pb)
    t.eur_cash += sign * n(s.eur_cash)
    t.eur_pb   += sign * n(s.eur_pb)
    t.usd      += sign * n(s.usd_cash)
    t.gbp      += sign * n(s.gbp_cash)
    t.chf      += sign * n(s.chf_cash)
  })
  return out
}

export default function MonthlyReport({ month: initialMonth, onNavigate }) {
  const [month, setMonth] = useState(initialMonth || new Date().toISOString().slice(0, 7))
  const [records, setRecords] = useState([])
  const [salesByDay, setSalesByDay] = useState({})
  const [debts, setDebts] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const [y, m] = month.split('-').map(Number)
        const recRes = await fetch(`/api/summary/${y}/${String(m).padStart(2, '0')}`)
        const recs = await recRes.json()
        setRecords(recs)

        // Load sales for each day in the month
        const salesMap = {}
        await Promise.all(recs.map(async r => {
          try {
            const sRes = await fetch(`/api/sales/${r.date}`)
            salesMap[r.date] = await sRes.json()
          } catch { salesMap[r.date] = [] }
        }))
        setSalesByDay(salesMap)

        // Aggregate debts for the month
        const allDebts = []
        await Promise.all(recs.map(async r => {
          try {
            const dRes = await fetch(`/api/debts/${r.date}`)
            const arr = await dRes.json()
            allDebts.push(...arr)
          } catch {}
        }))
        setDebts(allDebts)
      } catch (e) { console.error(e) }
      finally { setLoading(false) }
    }
    load()
  }, [month])

  const [y, m] = month.split('-').map(Number)
  const monthLabel = `${ALBANIAN_MONTHS[m]} ${y}`

  // Monthly aggregates of daily_records fields
  const aggD = field => records.reduce((s, r) => s + n(r[field]), 0)

  const aggDebts = (type, cur) => debts.filter(d => d.type === type).reduce((s, d) => s + n(d[cur]), 0)

  // Per-day sales rows
  const perDay = records.map(r => ({
    date: r.date,
    day: parseInt(r.date.split('-')[2]),
    byType: salesTotalsByType(salesByDay[r.date] || []),
  }))

  // Monthly sale totals per type
  const monthlyByType = perDay.reduce((acc, d) => {
    Object.keys(d.byType).forEach(t => {
      if (!acc[t]) acc[t] = { cope: 0, gram: 0, lek_cash: 0, lek_pb: 0, eur_cash: 0, eur_pb: 0, usd: 0, gbp: 0, chf: 0 }
      Object.keys(d.byType[t]).forEach(k => { acc[t][k] += d.byType[t][k] })
    })
    return acc
  }, { flori: { cope: 0, gram: 0, lek_cash: 0, lek_pb: 0, eur_cash: 0, eur_pb: 0, usd: 0, gbp: 0, chf: 0 }, diamant: { cope: 0, gram: 0, lek_cash: 0, lek_pb: 0, eur_cash: 0, eur_pb: 0, usd: 0, gbp: 0, chf: 0 }, online: { cope: 0, gram: 0, lek_cash: 0, lek_pb: 0, eur_cash: 0, eur_pb: 0, usd: 0, gbp: 0, chf: 0 } })

  const formatDate = dateStr => {
    const [yy, mm, dd] = dateStr.split('-')
    return `${parseInt(dd)} ${ALBANIAN_MONTHS[parseInt(mm)]}`
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-slate-800">Përmbledhëse Mujore — {monthLabel}</h3>
          <p className="text-xs text-slate-500 mt-1">Agregim i të gjithë sektorëve të arkës + ndarje ditore e shitjeve sipas kategorisë.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setMonth(prevMonth(month))} className="w-8 h-8 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700">‹</button>
          <input
            type="month" value={month}
            onChange={e => setMonth(e.target.value)}
            className="px-2 py-1.5 border border-slate-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button onClick={() => setMonth(nextMonth(month))} className="w-8 h-8 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700">›</button>
        </div>
      </div>

      {loading && <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500">Duke ngarkuar…</div>}

      {!loading && (
        <>
          {/* ── Agregate sipas sektorit ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <AggSection title="Shpenzime" rows={[
              { label: 'Shpenzime', lek: aggD('expenses_lek'), eur: aggD('expenses_eur'), usd: aggD('expenses_usd') },
            ]} cols={['lek','eur','usd']} />
            <AggSection title="Shlyerje Borxhi te Produkteve" rows={[
              { label: 'Shlyerje', eur: aggD('debt_settlement_eur'), usd: aggD('debt_settlement_usd'), gbp: aggD('debt_settlement_gbp'), chf: aggD('debt_settlement_chf'), has: aggD('debt_settlement_has') },
            ]} cols={['eur','usd','gbp','chf','has']} />
            <AggSection title="Tërheqje BIBA" rows={[
              { label: 'BIBA', lek: aggD('biba_lek'), eur: aggD('biba_eur'), usd: aggD('biba_usd'), gbp: aggD('biba_gbp'), chf: aggD('biba_chf'), gram: aggD('biba_gram') },
            ]} cols={['lek','eur','usd','gbp','chf','gram']} />
            <AggSection title="Tërheqje DIANA" rows={[
              { label: 'DIANA', lek: aggD('diana_lek'), eur: aggD('diana_eur'), usd: aggD('diana_usd'), gbp: aggD('diana_gbp'), chf: aggD('diana_chf'), hurda: aggD('diana_hurda') },
            ]} cols={['lek','eur','usd','gbp','chf','hurda']} />
            <AggSection title="Tërheqje nga Banka" rows={[
              { label: 'Tërheqje', lek: aggD('bank_withdraw_lek'), eur: aggD('bank_withdraw_eur'), usd: aggD('bank_withdraw_usd') },
            ]} cols={['lek','eur','usd']} />
            <AggSection title="Depozitim në Bankë" rows={[
              { label: 'Depozitim', lek: aggD('bank_deposit_lek'), eur: aggD('bank_deposit_eur'), usd: aggD('bank_deposit_usd') },
            ]} cols={['lek','eur','usd']} />
            <AggSection title="Konvertim Valute" rows={[
              { label: 'Konvertim', lek: aggD('conv_lek'), eur: aggD('conv_eur'), usd: aggD('conv_usd'), gbp: aggD('conv_gbp'), chf: aggD('conv_chf') },
            ]} cols={['lek','eur','usd','gbp','chf']} />
            <AggSection title="Konvertim Hurda" rows={[
              { label: 'Hurda', lek: aggD('hurda_lek'), eur: aggD('hurda_eur'), usd: aggD('hurda_usd'), gbp: aggD('hurda_gbp'), chf: aggD('hurda_chf'), gram: aggD('hurda_gram') },
            ]} cols={['lek','eur','usd','gbp','chf','gram']} />
            <AggSection title="Borxhe Klienti" rows={[
              { label: 'Total', lek: aggDebts('debt','lek'), eur: aggDebts('debt','eur'), usd: aggDebts('debt','usd'), gbp: aggDebts('debt','gbp'), chf: aggDebts('debt','chf') },
            ]} cols={['lek','eur','usd','gbp','chf']} />
            <AggSection title="Kthim Borxhi Klienti" rows={[
              { label: 'Total', lek: aggDebts('repayment','lek'), eur: aggDebts('repayment','eur'), usd: aggDebts('repayment','usd'), gbp: aggDebts('repayment','gbp'), chf: aggDebts('repayment','chf') },
            ]} cols={['lek','eur','usd','gbp','chf']} />
          </div>

          {/* ── Per-day sales breakdown ── */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 overflow-x-auto">
            <h4 className="text-sm font-bold text-slate-800 mb-3">Shitjet ditore sipas kategorisë</h4>
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-900 text-white">
                  <th className="px-2 py-2 sticky left-0 bg-slate-900 text-left">Data</th>
                  <th className="px-2 py-2 bg-yellow-800" colSpan={5}>FLORI</th>
                  <th className="px-2 py-2 bg-blue-800" colSpan={5}>DIAMANT</th>
                  <th className="px-2 py-2 bg-purple-800" colSpan={5}>ONLINE & STAFI</th>
                </tr>
                <tr className="bg-slate-700 text-white text-[10px]">
                  <th className="px-1 py-1 sticky left-0 bg-slate-700" />
                  {['Cp','Gr','LEK','EUR','USD'].map((c, i) => <th key={'f'+i} className="px-1 py-1">{c}</th>)}
                  {['Cp','Gr','LEK','EUR','USD'].map((c, i) => <th key={'d'+i} className="px-1 py-1">{c}</th>)}
                  {['Cp','LEK','EUR','USD','GBP'].map((c, i) => <th key={'o'+i} className="px-1 py-1">{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {perDay.length === 0 && (
                  <tr><td colSpan={16} className="text-center text-slate-400 py-6">Nuk ka të dhëna për këtë muaj.</td></tr>
                )}
                {perDay.map((d, i) => (
                  <tr key={d.date} className={`border-b border-slate-100 hover:bg-yellow-50 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}`}>
                    <td className="px-2 py-1.5 sticky left-0 bg-inherit text-slate-700 font-medium whitespace-nowrap">
                      {formatDate(d.date)}
                    </td>
                    <Td value={d.byType.flori.cope} />
                    <Td value={d.byType.flori.gram} />
                    <Td value={d.byType.flori.lek_cash + d.byType.flori.lek_pb} />
                    <Td value={d.byType.flori.eur_cash + d.byType.flori.eur_pb} />
                    <Td value={d.byType.flori.usd} />
                    <Td value={d.byType.diamant.cope} />
                    <Td value={d.byType.diamant.gram} />
                    <Td value={d.byType.diamant.lek_cash + d.byType.diamant.lek_pb} />
                    <Td value={d.byType.diamant.eur_cash + d.byType.diamant.eur_pb} />
                    <Td value={d.byType.diamant.usd} />
                    <Td value={d.byType.online.cope} />
                    <Td value={d.byType.online.lek_cash + d.byType.online.lek_pb} />
                    <Td value={d.byType.online.eur_cash + d.byType.online.eur_pb} />
                    <Td value={d.byType.online.usd} />
                    <Td value={d.byType.online.gbp} />
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-yellow-100 font-bold border-t-2 border-yellow-400">
                  <td className="px-2 py-2 sticky left-0 bg-yellow-100">TOTAL</td>
                  <Td value={monthlyByType.flori.cope} />
                  <Td value={monthlyByType.flori.gram} />
                  <Td value={monthlyByType.flori.lek_cash + monthlyByType.flori.lek_pb} />
                  <Td value={monthlyByType.flori.eur_cash + monthlyByType.flori.eur_pb} />
                  <Td value={monthlyByType.flori.usd} />
                  <Td value={monthlyByType.diamant.cope} />
                  <Td value={monthlyByType.diamant.gram} />
                  <Td value={monthlyByType.diamant.lek_cash + monthlyByType.diamant.lek_pb} />
                  <Td value={monthlyByType.diamant.eur_cash + monthlyByType.diamant.eur_pb} />
                  <Td value={monthlyByType.diamant.usd} />
                  <Td value={monthlyByType.online.cope} />
                  <Td value={monthlyByType.online.lek_cash + monthlyByType.online.lek_pb} />
                  <Td value={monthlyByType.online.eur_cash + monthlyByType.online.eur_pb} />
                  <Td value={monthlyByType.online.usd} />
                  <Td value={monthlyByType.online.gbp} />
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function AggSection({ title, rows, cols }) {
  const CUR_LABELS = { lek: 'LEK', eur: 'EUR', usd: 'USD', gbp: 'GBP', chf: 'CHF', gram: 'Gram', hurda: 'Hurda', has: 'HAS' }
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
      <h4 className="text-sm font-bold text-slate-800 mb-2">{title}</h4>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50">
            <th className="text-left px-2 py-1.5 text-[10px] font-semibold text-slate-600">Zëri</th>
            {cols.map(c => <th key={c} className="text-right px-2 py-1.5 text-[10px] font-semibold text-slate-600">{CUR_LABELS[c]}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-slate-100">
              <td className="px-2 py-1.5 text-slate-700">{r.label}</td>
              {cols.map(c => <Td key={c} value={r[c]} />)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Td({ value, className = '' }) {
  return <td className={`px-2 py-1.5 text-right tabular-nums whitespace-nowrap ${className}`}>{fmt(value)}</td>
}
