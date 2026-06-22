import { useState, useEffect } from 'react'

function n(v) { return parseFloat(v) || 0 }
function fmt(v) {
  const val = n(v)
  if (val === 0) return '-'
  return val.toLocaleString('sq-AL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

function getToday() {
  return new Date().toISOString().split('T')[0]
}

export default function Marketing() {
  const [expenses, setExpenses] = useState([])
  const [selectedMonth, setSelectedMonth] = useState(getToday().substring(0, 7))
  const [form, setForm] = useState({ date: getToday(), description: '', amount_lek: '', amount_eur: '', amount_usd: '' })
  const [savedMsg, setSavedMsg] = useState('')

  const loadData = async () => {
    try {
      const res = await fetch(`/api/marketing/${selectedMonth}`)
      setExpenses(await res.json())
    } catch (e) { console.error(e) }
  }

  useEffect(() => { loadData() }, [selectedMonth])

  const handleAdd = async () => {
    if (!form.description && !form.amount_lek && !form.amount_eur && !form.amount_usd) {
      setSavedMsg('⚠ Plotëso përshkrimin ose një vlerë')
      setTimeout(() => setSavedMsg(''), 2500)
      return
    }
    try {
      const res = await fetch('/api/marketing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      })
      if (!res.ok) throw new Error('Gabim në ruajtje')
      setForm({ date: getToday(), description: '', amount_lek: '', amount_eur: '', amount_usd: '' })
      await loadData()
      setSavedMsg('Shtuar ✓')
      setTimeout(() => setSavedMsg(''), 1500)
    } catch (e) {
      console.error(e)
      setSavedMsg('⚠ ' + (e.message || 'Gabim'))
      setTimeout(() => setSavedMsg(''), 2500)
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('Fshij këtë shpenzim?')) return
    await fetch(`/api/marketing/${id}`, { method: 'DELETE' })
    await loadData()
  }

  const totals = {
    lek: expenses.reduce((s, e) => s + n(e.amount_lek), 0),
    eur: expenses.reduce((s, e) => s + n(e.amount_eur), 0),
    usd: expenses.reduce((s, e) => s + n(e.amount_usd), 0),
  }

  const ALBANIAN_MONTHS = [
    '', 'Janar', 'Shkurt', 'Mars', 'Prill', 'Maj', 'Qershor',
    'Korrik', 'Gusht', 'Shtator', 'Tetor', 'Nëntor', 'Dhjetor'
  ]

  const [my, mm] = selectedMonth.split('-').map(Number)

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-gray-800">Shpenzime Marketingu</h2>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Muaj:</label>
          <input
            type="month"
            value={selectedMonth}
            onChange={e => setSelectedMonth(e.target.value)}
            className="input-field w-auto"
          />
        </div>
      </div>

      {/* Add Form */}
      <div className="card mb-4 bg-yellow-50 border-yellow-200">
        <div className="section-title">Shto Shpenzim të Ri</div>
        <div className="grid grid-cols-6 gap-2 items-end">
          <div>
            <label className="text-xs text-gray-500 block mb-0.5">Data</label>
            <input type="date" value={form.date}
              onChange={e => setForm(p => ({ ...p, date: e.target.value }))}
              className="input-field" />
          </div>
          <div className="col-span-2">
            <label className="text-xs text-gray-500 block mb-0.5">Përshkrimi</label>
            <input type="text" placeholder="Psh: Reklama Facebook, Google Ads..." value={form.description}
              onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
              className="input-field" />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-0.5">LEK</label>
            <input type="number" step="any" placeholder="0" value={form.amount_lek}
              onChange={e => setForm(p => ({ ...p, amount_lek: e.target.value }))}
              className="input-field" />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-0.5">EUR</label>
            <input type="number" step="any" placeholder="0" value={form.amount_eur}
              onChange={e => setForm(p => ({ ...p, amount_eur: e.target.value }))}
              className="input-field" />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-0.5">USD</label>
            <input type="number" step="any" placeholder="0" value={form.amount_usd}
              onChange={e => setForm(p => ({ ...p, amount_usd: e.target.value }))}
              className="input-field" />
          </div>
        </div>
        <div className="flex items-center gap-3 mt-3">
          <button onClick={handleAdd} className="btn-primary">+ Shto</button>
          {savedMsg && <span className="text-green-600 text-sm">{savedMsg}</span>}
        </div>
      </div>

      {/* Expenses Table */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-700">{ALBANIAN_MONTHS[mm]} {my}</h3>
          <span className="text-xs text-gray-500">{expenses.length} rekorde</span>
        </div>

        {expenses.length === 0 ? (
          <div className="text-center text-gray-400 py-8 italic">
            Nuk ka shpenzime marketingu për këtë muaj
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-100 text-xs text-gray-600">
                <th className="px-3 py-1.5 text-left">Data</th>
                <th className="px-3 py-1.5 text-left">Përshkrimi</th>
                <th className="px-3 py-1.5 text-right">LEK</th>
                <th className="px-3 py-1.5 text-right">EUR</th>
                <th className="px-3 py-1.5 text-right">USD</th>
                <th className="px-3 py-1.5 w-12"></th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((e, i) => (
                <tr key={e.id} className={`border-b ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-yellow-50`}>
                  <td className="px-3 py-1.5 text-xs text-gray-500">{e.date}</td>
                  <td className="px-3 py-1.5">{e.description || <span className="text-gray-400 italic">Pa përshkrim</span>}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-sm">{fmt(e.amount_lek)}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-sm">{fmt(e.amount_eur)}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-sm">{fmt(e.amount_usd)}</td>
                  <td className="px-3 py-1.5 text-center">
                    <button onClick={() => handleDelete(e.id)} className="text-red-400 hover:text-red-600 text-xs">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-yellow-50 font-semibold border-t-2 border-yellow-300">
                <td className="px-3 py-1.5 text-xs" colSpan={2}>TOTAL</td>
                <td className="px-3 py-1.5 text-right font-mono text-sm text-yellow-700">{fmt(totals.lek)}</td>
                <td className="px-3 py-1.5 text-right font-mono text-sm text-yellow-700">{fmt(totals.eur)}</td>
                <td className="px-3 py-1.5 text-right font-mono text-sm text-yellow-700">{fmt(totals.usd)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {/* Summary Cards */}
      {expenses.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mt-4">
          {[['LEK', totals.lek], ['EUR', totals.eur], ['USD', totals.usd]].map(([cur, val]) => (
            val > 0 && (
              <div key={cur} className="card text-center bg-orange-50 border-orange-200">
                <div className="text-xs text-orange-700 mb-1">Total {cur}</div>
                <div className="text-lg font-bold text-orange-800">{fmt(val)}</div>
              </div>
            )
          ))}
        </div>
      )}
    </div>
  )
}
