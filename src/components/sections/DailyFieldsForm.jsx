import { useState, useEffect, useCallback, useRef } from 'react'

const CUR_LABELS = { lek: 'LEK', eur: 'EUR', usd: 'USD', gbp: 'GBP', chf: 'CHF', gram: 'Gram', hurda: 'Hurda', has: 'HAS' }

function n(v) { return parseFloat(v) || 0 }
function fmt(v) {
  if (!v && v !== 0) return '-'
  const val = parseFloat(v)
  if (val === 0) return '-'
  return val.toLocaleString('sq-AL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

// rows: [{ label, fields: { lek: 'biba_lek', eur: 'biba_eur', ... } }]
export default function DailyFieldsForm({ date, title, description, rows, readOnly = false, computed }) {
  const [form, setForm] = useState({})
  const [isDirty, setIsDirty] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')

  const formRef = useRef(form)
  const dateRef = useRef(date)
  const dirtyRef = useRef(false)
  const saveTimer = useRef(null)

  useEffect(() => { formRef.current = form }, [form])
  useEffect(() => { dateRef.current = date }, [date])
  useEffect(() => { dirtyRef.current = isDirty }, [isDirty])

  const flushSave = useCallback(async () => {
    if (readOnly) return
    if (!dirtyRef.current) return
    clearTimeout(saveTimer.current)
    saveTimer.current = null
    const payload = {}
    Object.keys(formRef.current).forEach(k => { payload[k] = n(formRef.current[k]) })
    const target = dateRef.current
    try {
      const res = await fetch(`/api/daily/${target}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok && dateRef.current === target) {
        setIsDirty(false)
        setSavedMsg('Ruajtur ✓')
        setTimeout(() => setSavedMsg(''), 1500)
      }
    } catch (e) { console.error(e) }
  }, [readOnly])

  const load = useCallback(async () => {
    await flushSave()
    try {
      const res = await fetch(`/api/daily/${date}`)
      const rec = await res.json()
      const next = {}
      rows.forEach(r => Object.values(r.fields).forEach(key => {
        next[key] = rec[key] && rec[key] !== 0 ? String(rec[key]) : ''
      }))
      setForm(next)
      setIsDirty(false)
    } catch (e) { console.error(e) }
  }, [date, rows, flushSave])

  useEffect(() => { load() }, [date])

  useEffect(() => () => { flushSave() }, [flushSave])

  const handleChange = (key, value) => {
    setForm(f => ({ ...f, [key]: value }))
    setIsDirty(true)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => flushSave(), 600)
  }

  // Determine which currency columns appear across all rows (preserve insertion order)
  const currencyOrder = ['lek', 'eur', 'usd', 'gbp', 'chf', 'gram', 'hurda', 'has']
  const usedCurrencies = currencyOrder.filter(c => rows.some(r => r.fields[c]))

  // Column totals
  const totals = {}
  usedCurrencies.forEach(c => {
    totals[c] = rows.reduce((sum, r) => sum + (r.fields[c] ? n(form[r.fields[c]]) : 0), 0)
  })

  return (
    <div className="max-w-5xl mx-auto">
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">{title}</h3>
            {description && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{description}</p>}
          </div>
          {!readOnly && (
            <span className={`text-xs px-2 py-1 rounded-md ${savedMsg ? 'bg-emerald-100 text-emerald-700 dark:text-emerald-300' : isDirty ? 'bg-amber-100 text-amber-700 dark:text-amber-300' : 'text-slate-400 dark:text-slate-500'}`}>
              {savedMsg || (isDirty ? 'Duke ruajtur…' : '')}
            </span>
          )}
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-700">
              <th className="text-left px-2 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300">Zëri</th>
              {usedCurrencies.map(c => (
                <th key={c} className="text-right px-2 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 w-32">{CUR_LABELS[c]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-slate-100 dark:border-slate-800">
                <td className="px-2 py-2 text-slate-700 dark:text-slate-200 font-medium">{r.label}</td>
                {usedCurrencies.map(c => {
                  const key = r.fields[c]
                  if (!key) return <td key={c} className="px-2 py-1 bg-slate-50/40" />
                  if (readOnly) {
                    return <td key={c} className="px-2 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">{fmt(form[key])}</td>
                  }
                  return (
                    <td key={c} className="px-1 py-1">
                      <input
                        type="number" step="any" placeholder="0"
                        value={form[key] ?? ''}
                        onChange={e => handleChange(key, e.target.value)}
                        className="w-full text-right border border-slate-200 dark:border-slate-700 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
            {rows.length > 1 && (
              <tr className="bg-slate-50 dark:bg-slate-900 font-semibold">
                <td className="px-2 py-2 text-slate-700 dark:text-slate-200">Total</td>
                {usedCurrencies.map(c => (
                  <td key={c} className="px-2 py-2 text-right tabular-nums text-slate-800 dark:text-slate-100">{fmt(totals[c])}</td>
                ))}
              </tr>
            )}
          </tbody>
        </table>

        {computed && computed.length > 0 && (
          <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-700">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">{computed[0].sectionTitle || 'Llogaritje'}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {computed.map((c, i) => (
                <div key={i} className="flex justify-between bg-slate-50 dark:bg-slate-900 px-3 py-2 rounded-md">
                  <span className="text-sm text-slate-600 dark:text-slate-300">{c.label}</span>
                  <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 tabular-nums">{fmt(c.compute(form))}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
