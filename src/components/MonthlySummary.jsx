import { useState, useEffect, useCallback } from 'react'

function n(v) { return parseFloat(v) || 0 }
function fmt(v) {
  const val = n(v)
  if (val === 0) return '-'
  return val.toLocaleString('sq-AL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

const ALBANIAN_MONTHS = [
  '', 'Janar', 'Shkurt', 'Mars', 'Prill', 'Maj', 'Qershor',
  'Korrik', 'Gusht', 'Shtator', 'Tetor', 'Nëntor', 'Dhjetor'
]

export default function MonthlySummary({ month, onNavigate }) {
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)

  const [y, m] = month.split('-').map(Number)
  const monthLabel = `${ALBANIAN_MONTHS[m]} ${y}`

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/summary/${y}/${String(m).padStart(2, '0')}`)
      setRecords(await res.json())
    } catch (e) { console.error(e) }
    setLoading(false)
  }, [month])

  useEffect(() => { loadData() }, [loadData])

  const totals = records.reduce((acc, r) => {
    const fields = [
      'total_sales_lek', 'total_sales_eur', 'total_sales_usd', 'total_sales_gbp', 'total_sales_chf',
      'expenses_lek', 'expenses_eur', 'expenses_usd',
      'biba_lek', 'biba_eur', 'biba_usd',
      'diana_lek', 'diana_eur', 'diana_usd',
      'bank_deposit_lek', 'bank_deposit_eur',
      'bank_withdraw_lek', 'bank_withdraw_eur',
      'sales_count',
    ]
    fields.forEach(f => { acc[f] = (acc[f] || 0) + n(r[f]) })
    return acc
  }, {})

  const TH = ({ children, className = '' }) => (
    <th className={`px-2 py-1.5 text-xs font-semibold whitespace-nowrap ${className}`}>{children}</th>
  )
  const TD = ({ value, className = '', onClick }) => (
    <td
      className={`px-2 py-1.5 text-xs text-right font-mono cursor-pointer ${className}`}
      onClick={onClick}
    >
      {fmt(value)}
    </td>
  )

  function formatDate(dateStr) {
    const [y, m, d] = dateStr.split('-')
    return `${parseInt(d)} ${ALBANIAN_MONTHS[parseInt(m)]}`
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-gray-800">Permbledhëse — {monthLabel}</h2>
        <button onClick={loadData} className="btn-secondary text-xs">Rifresko</button>
      </div>

      {loading ? (
        <div className="text-center text-gray-500 py-12">Duke ngarkuar...</div>
      ) : records.length === 0 ? (
        <div className="card text-center text-gray-500 py-12">
          Nuk ka të dhëna për {monthLabel}
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-max">
            <thead>
              <tr className="bg-gray-900 text-white">
                <TH className="text-left sticky left-0 bg-gray-900 z-10">Data</TH>
                <TH className="bg-yellow-800">Shitje LEK</TH>
                <TH className="bg-yellow-800">Shitje EUR</TH>
                <TH className="bg-yellow-800">Shitje USD</TH>
                <TH className="bg-yellow-800">Shitje GBP</TH>
                <TH className="bg-yellow-800">Shitje CHF</TH>
                <TH className="bg-blue-900">Hapje LEK</TH>
                <TH className="bg-blue-900">Hapje EUR</TH>
                <TH className="bg-blue-900">Hapje USD</TH>
                <TH className="bg-blue-900">Hapje GBP</TH>
                <TH className="bg-blue-900">Hapje CHF</TH>
                <TH className="bg-red-900">Shpenz LEK</TH>
                <TH className="bg-red-900">Shpenz EUR</TH>
                <TH className="bg-red-900">BIBA LEK</TH>
                <TH className="bg-red-900">BIBA EUR</TH>
                <TH className="bg-red-900">DIANA LEK</TH>
                <TH className="bg-red-900">DIANA EUR</TH>
                <TH className="bg-green-900">Bank Dep LEK</TH>
                <TH className="bg-green-900">Bank Dep EUR</TH>
                <TH className="bg-green-900">Bank Terh LEK</TH>
                <TH className="bg-green-900">Bank Terh EUR</TH>
                <TH>Shitje #</TH>
              </tr>
            </thead>
            <tbody>
              {records.map((r, i) => (
                <tr
                  key={r.date}
                  className={`border-b hover:bg-yellow-50 transition-colors ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}
                >
                  <td
                    className="px-2 py-1.5 text-xs font-medium text-blue-600 hover:text-blue-800 cursor-pointer sticky left-0 bg-inherit whitespace-nowrap"
                    onClick={() => onNavigate('daily', { date: r.date })}
                  >
                    {formatDate(r.date)}
                  </td>
                  <TD value={r.total_sales_lek} className="text-green-700" />
                  <TD value={r.total_sales_eur} className="text-green-700" />
                  <TD value={r.total_sales_usd} className="text-green-700" />
                  <TD value={r.total_sales_gbp} className="text-green-700" />
                  <TD value={r.total_sales_chf} className="text-green-700" />
                  <TD value={r.opening_lek} />
                  <TD value={r.opening_eur} />
                  <TD value={r.opening_usd} />
                  <TD value={r.opening_gbp} />
                  <TD value={r.opening_chf} />
                  <TD value={r.expenses_lek} className="text-red-600" />
                  <TD value={r.expenses_eur} className="text-red-600" />
                  <TD value={r.biba_lek} className="text-red-600" />
                  <TD value={r.biba_eur} className="text-red-600" />
                  <TD value={r.diana_lek} className="text-red-600" />
                  <TD value={r.diana_eur} className="text-red-600" />
                  <TD value={r.bank_deposit_lek} className="text-blue-600" />
                  <TD value={r.bank_deposit_eur} className="text-blue-600" />
                  <TD value={r.bank_withdraw_lek} className="text-blue-600" />
                  <TD value={r.bank_withdraw_eur} className="text-blue-600" />
                  <td className="px-2 py-1.5 text-xs text-center text-gray-600">{r.sales_count || '-'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-yellow-100 font-bold border-t-2 border-yellow-400">
                <td className="px-2 py-1.5 text-xs sticky left-0 bg-yellow-100">TOTAL</td>
                <td className="px-2 py-1.5 text-xs text-right font-mono text-green-700">{fmt(totals.total_sales_lek)}</td>
                <td className="px-2 py-1.5 text-xs text-right font-mono text-green-700">{fmt(totals.total_sales_eur)}</td>
                <td className="px-2 py-1.5 text-xs text-right font-mono text-green-700">{fmt(totals.total_sales_usd)}</td>
                <td className="px-2 py-1.5 text-xs text-right font-mono text-green-700">{fmt(totals.total_sales_gbp)}</td>
                <td className="px-2 py-1.5 text-xs text-right font-mono text-green-700">{fmt(totals.total_sales_chf)}</td>
                <td colSpan={5}></td>
                <td className="px-2 py-1.5 text-xs text-right font-mono text-red-600">{fmt(totals.expenses_lek)}</td>
                <td className="px-2 py-1.5 text-xs text-right font-mono text-red-600">{fmt(totals.expenses_eur)}</td>
                <td className="px-2 py-1.5 text-xs text-right font-mono text-red-600">{fmt(totals.biba_lek)}</td>
                <td className="px-2 py-1.5 text-xs text-right font-mono text-red-600">{fmt(totals.biba_eur)}</td>
                <td className="px-2 py-1.5 text-xs text-right font-mono text-red-600">{fmt(totals.diana_lek)}</td>
                <td className="px-2 py-1.5 text-xs text-right font-mono text-red-600">{fmt(totals.diana_eur)}</td>
                <td className="px-2 py-1.5 text-xs text-right font-mono text-blue-600">{fmt(totals.bank_deposit_lek)}</td>
                <td className="px-2 py-1.5 text-xs text-right font-mono text-blue-600">{fmt(totals.bank_deposit_eur)}</td>
                <td className="px-2 py-1.5 text-xs text-right font-mono text-blue-600">{fmt(totals.bank_withdraw_lek)}</td>
                <td className="px-2 py-1.5 text-xs text-right font-mono text-blue-600">{fmt(totals.bank_withdraw_eur)}</td>
                <td className="px-2 py-1.5 text-xs text-center">{totals.sales_count}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Monthly stats summary cards */}
      {records.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          <div className="card bg-green-50 border-green-200 text-center">
            <div className="text-xs text-green-700 mb-1">Total Shitje LEK</div>
            <div className="text-lg font-bold text-green-800">{fmt(totals.total_sales_lek)}</div>
          </div>
          <div className="card bg-green-50 border-green-200 text-center">
            <div className="text-xs text-green-700 mb-1">Total Shitje EUR</div>
            <div className="text-lg font-bold text-green-800">{fmt(totals.total_sales_eur)}</div>
          </div>
          <div className="card bg-red-50 border-red-200 text-center">
            <div className="text-xs text-red-700 mb-1">Total Shpenzime EUR</div>
            <div className="text-lg font-bold text-red-800">{fmt(totals.expenses_eur)}</div>
          </div>
          <div className="card bg-blue-50 border-blue-200 text-center">
            <div className="text-xs text-blue-700 mb-1">Ditë me Shitje</div>
            <div className="text-lg font-bold text-blue-800">{records.filter(r => r.sales_count > 0).length}</div>
          </div>
        </div>
      )}
    </div>
  )
}
