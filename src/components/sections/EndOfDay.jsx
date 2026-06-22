import { useState, useEffect } from 'react'

const CUR = [
  { key: 'lek', label: 'LEK' },
  { key: 'eur', label: 'EUR' },
  { key: 'usd', label: 'USD' },
  { key: 'gbp', label: 'GBP' },
  { key: 'chf', label: 'CHF' },
]

function n(v) { return parseFloat(v) || 0 }
function fmt(v) {
  const val = n(v)
  if (val === 0) return '-'
  return val.toLocaleString('sq-AL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

function prevDate(date) {
  const d = new Date(date + 'T12:00:00')
  d.setDate(d.getDate() - 1)
  return d.toISOString().split('T')[0]
}

// Compute xhiro neto per currency from sales rows.
// Returns { lek, eur, usd, gbp, chf } summed cash+pb across flori/diamant/online.
function xhiroNeto(salesArr) {
  const sums = { lek: 0, eur: 0, usd: 0, gbp: 0, chf: 0 }
  salesArr.forEach(s => {
    const sign = s.is_return ? -1 : 1
    sums.lek += sign * (n(s.lek_cash) + n(s.lek_pb))
    sums.eur += sign * (n(s.eur_cash) + n(s.eur_pb))
    sums.usd += sign * n(s.usd_cash)
    sums.gbp += sign * n(s.gbp_cash)
    sums.chf += sign * n(s.chf_cash)
  })
  return sums
}

function debtsTotal(debtsArr, type) {
  const sums = { lek: 0, eur: 0, usd: 0, gbp: 0, chf: 0 }
  debtsArr.filter(d => d.type === type).forEach(d => {
    sums.lek += n(d.lek); sums.eur += n(d.eur); sums.usd += n(d.usd); sums.gbp += n(d.gbp); sums.chf += n(d.chf)
  })
  return sums
}

export default function EndOfDay({ date, mode = 'arka' }) {
  // mode: 'arka' = "Arka në fund të ditës", 'mbyllje' = "Mbyllje ditore kasaforta"
  const [rec, setRec] = useState({})
  const [prevRec, setPrevRec] = useState({})
  const [sales, setSales] = useState([])
  const [debts, setDebts] = useState([])

  useEffect(() => {
    const load = async () => {
      try {
        const [r1, r2, s, d] = await Promise.all([
          fetch(`/api/daily/${date}`).then(r => r.json()),
          fetch(`/api/daily/${prevDate(date)}`).then(r => r.json()),
          fetch(`/api/sales/${date}`).then(r => r.json()),
          fetch(`/api/debts/${date}`).then(r => r.json()),
        ])
        setRec(r1 || {}); setPrevRec(r2 || {}); setSales(s || []); setDebts(d || [])
      } catch (e) { console.error(e) }
    }
    load()
  }, [date])

  const xhiro = xhiroNeto(sales)
  const debtsOut = debtsTotal(debts, 'debt')        // money given as debt (out)
  const debtsIn  = debtsTotal(debts, 'repayment')   // money received back (in)

  // Per-currency calculation matching Excel I72 formula:
  // Arka = prevSafe + xhiroNeto - shpenzime - (biba+diana) - borxheKlienti + kthimBorxhi - shlyerje + safeWithdraw - safeDeposit - bankDeposit + bankWithdraw
  const calc = cur => {
    const opening = n(rec[`opening_${cur}`])               // today's opening / carryover
    const prevSafe = n(prevRec[`safe_deposit_${cur}`]) - n(prevRec[`safe_withdraw_${cur}`])
    const xn = xhiro[cur]
    const shp = n(rec[`expenses_${cur}`])
    const biba = n(rec[`biba_${cur}`])
    const diana = n(rec[`diana_${cur}`])
    const shlyerje = n(rec[`debt_settlement_${cur}`])
    const safeW = n(rec[`safe_withdraw_${cur}`])
    const safeD = n(rec[`safe_deposit_${cur}`])
    const bankW = n(rec[`bank_withdraw_${cur}`])
    const bankD = n(rec[`bank_deposit_${cur}`])
    const conv = n(rec[`conv_${cur}`])
    const hurda = n(rec[`hurda_${cur}`])

    // arka = opening + xhiro_neto - shpenzime - biba - diana - borxh + kthim_borxh - shlyerje + safe_w - safe_d + bank_w - bank_d + conv + hurda
    const arka = opening + xn - shp - biba - diana - debtsOut[cur] + debtsIn[cur] - shlyerje
                 + safeW - safeD + bankW - bankD + conv + hurda

    // Mbyllje kasaforta = openingSafe - withdraw + deposit  (prevSafe + safeD - safeW)
    const safeBalance = prevSafe + safeD - safeW

    return { opening, xn, shp, biba, diana, debtsOut: debtsOut[cur], debtsIn: debtsIn[cur], shlyerje, safeW, safeD, bankW, bankD, conv, hurda, arka, safeBalance }
  }

  const rows = CUR.map(c => ({ ...c, ...calc(c.key) }))

  const isSafe = mode === 'mbyllje'
  const title = isSafe ? 'Mbyllje Ditore Kasaforta' : 'Arka në Fund të Ditës'
  const description = isSafe
    ? 'Gjendja përfundimtare e kasafortës = gjendja e mbartur + derdhje − tërheqje.'
    : 'Llogaritje automatike sipas formulës së Excel-it: gjendja fillestare + xhiro neto − shpenzime − tërheqje BIBA/DIANA − borxhe klienti + kthim borxhi − shlyerje + lëvizje kasaforte + lëvizje bankë + konvertime.'

  return (
    <div className="max-w-6xl mx-auto">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <h3 className="text-lg font-bold text-slate-800">{title}</h3>
        <p className="text-xs text-slate-500 mt-1 mb-4">{description}</p>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="text-left px-3 py-2 text-xs font-semibold text-slate-600">Zëri</th>
              {rows.map(r => <th key={r.key} className="text-right px-3 py-2 text-xs font-semibold text-slate-600 w-28">{r.label}</th>)}
            </tr>
          </thead>
          <tbody className="text-sm">
            {!isSafe && <>
              <Row label="Gjendja fillestare (Celja)"     vals={rows.map(r => r.opening)} />
              <Row label="Xhiro Neto"                     vals={rows.map(r => r.xn)} />
              <Row label="− Shpenzime"                    vals={rows.map(r => -r.shp)} />
              <Row label="− Tërheqje BIBA"                vals={rows.map(r => -r.biba)} />
              <Row label="− Tërheqje DIANA"               vals={rows.map(r => -r.diana)} />
              <Row label="− Borxhe Klienti"               vals={rows.map(r => -r.debtsOut)} />
              <Row label="+ Kthim Borxhi"                 vals={rows.map(r => r.debtsIn)} />
              <Row label="− Shlyerje Borxhi te Produkteve" vals={rows.map(r => -r.shlyerje)} />
              <Row label="+ Tërheqje nga Kasaforta"       vals={rows.map(r => r.safeW)} />
              <Row label="− Derdhje në Kasafortë"         vals={rows.map(r => -r.safeD)} />
              <Row label="+ Tërheqje nga Banka"           vals={rows.map(r => r.bankW)} />
              <Row label="− Depozitim në Bankë"           vals={rows.map(r => -r.bankD)} />
              <Row label="± Konvertim Valute"             vals={rows.map(r => r.conv)} />
              <Row label="± Konvertim Hurda"              vals={rows.map(r => r.hurda)} />
              <tr className="border-t-2 border-slate-300 bg-emerald-50">
                <td className="px-3 py-3 font-bold text-slate-800">Arka në fund të ditës</td>
                {rows.map(r => (
                  <td key={r.key} className="px-3 py-3 text-right tabular-nums font-bold text-emerald-700">{fmt(r.arka)}</td>
                ))}
              </tr>
            </>}

            {isSafe && <>
              <Row label="Gjendje e mbartur (kasaforta)"  vals={rows.map(r => 0)} />
              <Row label="+ Derdhje në Kasafortë"         vals={rows.map(r => r.safeD)} />
              <Row label="− Tërheqje nga Kasaforta"       vals={rows.map(r => -r.safeW)} />
              <tr className="border-t-2 border-slate-300 bg-emerald-50">
                <td className="px-3 py-3 font-bold text-slate-800">Mbyllje kasaforta</td>
                {rows.map(r => (
                  <td key={r.key} className="px-3 py-3 text-right tabular-nums font-bold text-emerald-700">{fmt(r.safeBalance)}</td>
                ))}
              </tr>
            </>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Row({ label, vals }) {
  return (
    <tr className="border-b border-slate-100">
      <td className="px-3 py-2 text-slate-700">{label}</td>
      {vals.map((v, i) => (
        <td key={i} className="px-3 py-2 text-right tabular-nums text-slate-700">{fmt(v)}</td>
      ))}
    </tr>
  )
}
