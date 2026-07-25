import { useEffect, useState } from 'react'

const ALBANIAN_MONTHS = [
  '', 'JANAR', 'SHKURT', 'MARS', 'PRILL', 'MAJ', 'QERSHOR',
  'KORRIK', 'GUSHT', 'SHTATOR', 'TETOR', 'NËNTOR', 'DHJETOR',
]

function n(v) { return parseFloat(v) || 0 }
function fmt(v) {
  const val = n(v)
  if (val === 0) return '-'
  return val.toLocaleString('sq-AL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

// Compute "Arka" running balance per currency for the row,
// mirroring "Permbledhese per Biben" formula: Xhiro − Shpenzime − Borxhe + Kthim − BIBA − DIANA − Shlyerje − Konvertim − Pagese Banke ± Levizje Banke
function arkaPerCur(row, cur) {
  const xhiro    = n(row[`xhiro_${cur}`])
  const shp      = n(row[`shpenzime_${cur}`])
  const borxhe   = n(row[`borxhe_${cur}`])
  const kthim    = n(row[`kthim_borxhi_${cur}`])
  const biba     = n(row[`biba_${cur}`])
  const diana    = n(row[`diana_${cur}`])
  const shlyerje = n(row[`shlyerje_${cur}`])
  const konv     = n(row[`konv_${cur}`])
  const hurda    = n(row[`hurda_${cur}`])
  const bankW    = n(row[`bank_withdraw_${cur}`])
  const bankD    = n(row[`bank_deposit_${cur}`])
  return xhiro - shp - borxhe + kthim - biba - diana - shlyerje - konv - hurda + bankW - bankD
}

export default function YearlyReport({ initialYear }) {
  const now = new Date()
  const [year, setYear] = useState(initialYear || now.getFullYear())
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/yearly/${year}`)
      .then(r => r.json())
      .then(setData)
      .catch(() => setData([]))
      .finally(() => setLoading(false))
  }, [year])

  // Totals row
  const total = {}
  if (data.length) {
    Object.keys(data[0]).forEach(k => {
      if (typeof data[0][k] === 'number') total[k] = data.reduce((s, r) => s + (r[k] || 0), 0)
    })
  }

  return (
    <div className="max-w-full">
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-4 mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Përmbledhëse Vjetore</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Një rresht për çdo muaj me agregimin e arkës, shpenzimeve, BIBA/DIANA, bankës dhe llogaritjes së Arka neto.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setYear(y => y - 1)} className="w-8 h-8 rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200">‹</button>
          <input
            type="number" value={year}
            onChange={e => setYear(parseInt(e.target.value) || now.getFullYear())}
            className="w-24 text-center px-2 py-1.5 border border-slate-200 dark:border-slate-700 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button onClick={() => setYear(y => y + 1)} className="w-8 h-8 rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200">›</button>
        </div>
      </div>

      {loading ? (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-8 text-center text-slate-500 dark:text-slate-400">Duke ngarkuar…</div>
      ) : (
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-900 dark:bg-slate-950 text-white">
                <th className="px-2 py-2 sticky left-0 bg-slate-900 dark:bg-slate-950 z-10 text-left">#</th>
                <th className="px-2 py-2 sticky left-8 bg-slate-900 dark:bg-slate-950 z-10 text-left">Muaji</th>
                <th className="px-2 py-2 bg-emerald-800">Xhiro LEK</th>
                <th className="px-2 py-2 bg-emerald-800">Xhiro EUR</th>
                <th className="px-2 py-2 bg-emerald-800">Xhiro USD</th>
                <th className="px-2 py-2 bg-rose-800">Shpenz LEK</th>
                <th className="px-2 py-2 bg-rose-800">Shpenz EUR</th>
                <th className="px-2 py-2 bg-amber-800">Borxhe LEK</th>
                <th className="px-2 py-2 bg-amber-800">Borxhe EUR</th>
                <th className="px-2 py-2 bg-amber-800">Kthim LEK</th>
                <th className="px-2 py-2 bg-amber-800">Kthim EUR</th>
                <th className="px-2 py-2 bg-purple-800">BIBA LEK</th>
                <th className="px-2 py-2 bg-purple-800">BIBA EUR</th>
                <th className="px-2 py-2 bg-purple-800">DIANA LEK</th>
                <th className="px-2 py-2 bg-purple-800">DIANA EUR</th>
                <th className="px-2 py-2 bg-pink-800">Shlyerje EUR</th>
                <th className="px-2 py-2 bg-pink-800">Shlyerje USD</th>
                <th className="px-2 py-2 bg-cyan-800">Konv EUR</th>
                <th className="px-2 py-2 bg-cyan-800">Hurda Gr</th>
                <th className="px-2 py-2 bg-blue-800">Bank Tërh LEK</th>
                <th className="px-2 py-2 bg-blue-800">Bank Dep LEK</th>
                <th className="px-2 py-2 bg-blue-800">Bank Tërh EUR</th>
                <th className="px-2 py-2 bg-blue-800">Bank Dep EUR</th>
                <th className="px-2 py-2 bg-teal-800">ARKA LEK</th>
                <th className="px-2 py-2 bg-teal-800">ARKA EUR</th>
                <th className="px-2 py-2 bg-teal-800">ARKA USD</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r, i) => (
                <tr key={r.month} className={`border-b border-slate-100 dark:border-slate-800 ${i % 2 === 0 ? 'bg-white dark:bg-slate-800' : 'bg-slate-50/60'} ${r.days_with_data === 0 ? 'opacity-50' : ''}`}>
                  <td className="px-2 py-2 sticky left-0 bg-inherit z-10 font-medium text-slate-600 dark:text-slate-300">{r.month}</td>
                  <td className="px-2 py-2 sticky left-8 bg-inherit z-10 font-semibold text-slate-800 dark:text-slate-100 whitespace-nowrap">{ALBANIAN_MONTHS[r.month]}</td>
                  <Td value={r.xhiro_lek}     className="text-emerald-700 dark:text-emerald-300" />
                  <Td value={r.xhiro_eur}     className="text-emerald-700 dark:text-emerald-300" />
                  <Td value={r.xhiro_usd}     className="text-emerald-700 dark:text-emerald-300" />
                  <Td value={r.shpenzime_lek} className="text-rose-600" />
                  <Td value={r.shpenzime_eur} className="text-rose-600" />
                  <Td value={r.borxhe_lek}    className="text-amber-700 dark:text-amber-300" />
                  <Td value={r.borxhe_eur}    className="text-amber-700 dark:text-amber-300" />
                  <Td value={r.kthim_borxhi_lek} />
                  <Td value={r.kthim_borxhi_eur} />
                  <Td value={r.biba_lek}      className="text-purple-700 dark:text-purple-300" />
                  <Td value={r.biba_eur}      className="text-purple-700 dark:text-purple-300" />
                  <Td value={r.diana_lek}     className="text-purple-700 dark:text-purple-300" />
                  <Td value={r.diana_eur}     className="text-purple-700 dark:text-purple-300" />
                  <Td value={r.shlyerje_eur}  className="text-pink-700" />
                  <Td value={r.shlyerje_usd}  className="text-pink-700" />
                  <Td value={r.konv_eur} />
                  <Td value={r.hurda_gram} />
                  <Td value={r.bank_withdraw_lek} className="text-blue-600" />
                  <Td value={r.bank_deposit_lek} className="text-blue-600" />
                  <Td value={r.bank_withdraw_eur} className="text-blue-600" />
                  <Td value={r.bank_deposit_eur} className="text-blue-600" />
                  <Td value={arkaPerCur(r, 'lek')} className="font-bold text-teal-700" />
                  <Td value={arkaPerCur(r, 'eur')} className="font-bold text-teal-700" />
                  <Td value={arkaPerCur(r, 'usd')} className="font-bold text-teal-700" />
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-100 dark:bg-slate-800 font-bold border-t-2 border-slate-300 dark:border-slate-700">
                <td colSpan={2} className="px-2 py-2 sticky left-0 bg-slate-100 dark:bg-slate-800">TOTAL</td>
                <Td value={total.xhiro_lek} className="text-emerald-700 dark:text-emerald-300" />
                <Td value={total.xhiro_eur} className="text-emerald-700 dark:text-emerald-300" />
                <Td value={total.xhiro_usd} className="text-emerald-700 dark:text-emerald-300" />
                <Td value={total.shpenzime_lek} className="text-rose-600" />
                <Td value={total.shpenzime_eur} className="text-rose-600" />
                <Td value={total.borxhe_lek} />
                <Td value={total.borxhe_eur} />
                <Td value={total.kthim_borxhi_lek} />
                <Td value={total.kthim_borxhi_eur} />
                <Td value={total.biba_lek} />
                <Td value={total.biba_eur} />
                <Td value={total.diana_lek} />
                <Td value={total.diana_eur} />
                <Td value={total.shlyerje_eur} />
                <Td value={total.shlyerje_usd} />
                <Td value={total.konv_eur} />
                <Td value={total.hurda_gram} />
                <Td value={total.bank_withdraw_lek} className="text-blue-600" />
                <Td value={total.bank_deposit_lek} className="text-blue-600" />
                <Td value={total.bank_withdraw_eur} className="text-blue-600" />
                <Td value={total.bank_deposit_eur} className="text-blue-600" />
                <Td value={data.reduce((s, r) => s + arkaPerCur(r, 'lek'), 0)} className="text-teal-700" />
                <Td value={data.reduce((s, r) => s + arkaPerCur(r, 'eur'), 0)} className="text-teal-700" />
                <Td value={data.reduce((s, r) => s + arkaPerCur(r, 'usd'), 0)} className="text-teal-700" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}

function Td({ value, className = '' }) {
  return <td className={`px-2 py-2 text-right tabular-nums whitespace-nowrap ${className}`}>{fmt(value)}</td>
}
