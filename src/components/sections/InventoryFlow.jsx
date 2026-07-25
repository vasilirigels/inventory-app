import { useEffect, useState, useCallback, useRef } from 'react'

const TYPE_LABELS = {
  flori: 'Flori', diamant: 'Diamant',
}

function n(v) { return parseFloat(v) || 0 }

// Focused form for a single inventory flow field on a single type.
// kind: 'hyrje' (gram_in/cope_in), 'dalje' (gram_out/cope_out)
export default function InventoryFlow({ date, type, kind }) {
  const fieldGram = kind === 'hyrje' ? 'gram_in' : 'gram_out'
  const fieldCope = kind === 'hyrje' ? 'cope_in' : 'cope_out'

  const [rec, setRec] = useState({ gram_start: 0, cope_start: 0, gram_in: 0, cope_in: 0, gram_out: 0, cope_out: 0, gram_sold: 0, cope_sold: 0 })
  const [form, setForm] = useState({ gram: '', cope: '' })
  const [dirty, setDirty] = useState(false)
  const [msg, setMsg] = useState('')
  const formRef = useRef(form)
  const dateRef = useRef(date)
  const dirtyRef = useRef(false)
  const saveTimer = useRef(null)

  useEffect(() => { formRef.current = form }, [form])
  useEffect(() => { dateRef.current = date }, [date])
  useEffect(() => { dirtyRef.current = dirty }, [dirty])

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/inventory/${date}`)
      const arr = await res.json()
      const row = arr.find(r => r.type === type) || {}
      setRec(row)
      setForm({
        gram: row[fieldGram] && row[fieldGram] !== 0 ? String(row[fieldGram]) : '',
        cope: row[fieldCope] && row[fieldCope] !== 0 ? String(row[fieldCope]) : '',
      })
      setDirty(false)
    } catch (e) { console.error(e) }
  }, [date, type, fieldGram, fieldCope])

  useEffect(() => { load() }, [load])

  const flushSave = useCallback(async () => {
    if (!dirtyRef.current) return
    clearTimeout(saveTimer.current)
    saveTimer.current = null
    const payload = {
      ...rec, date, type,
      [fieldGram]: n(formRef.current.gram),
      [fieldCope]: n(formRef.current.cope),
    }
    try {
      const res = await fetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        setDirty(false); setMsg('Ruajtur ✓')
        setTimeout(() => setMsg(''), 1500)
      }
    } catch (e) { console.error(e) }
  }, [rec, date, type, fieldGram, fieldCope])

  const handleChange = (k, v) => {
    setForm(f => ({ ...f, [k]: v }))
    setDirty(true)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => flushSave(), 600)
  }

  const title = kind === 'hyrje'
    ? `Hyrje ${TYPE_LABELS[type]}`
    : `Dalje nga Inventari — ${TYPE_LABELS[type]}`
  const description = kind === 'hyrje'
    ? `Mall i ri që hyn në inventarin e ${TYPE_LABELS[type].toLowerCase()}.`
    : `Mall që del nga inventari (transferim, prishje, etj).`

  return (
    <div className="max-w-3xl mx-auto">
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">{title}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{description}</p>
          </div>
          {msg && <span className="text-xs px-2 py-1 rounded-md bg-emerald-100 text-emerald-700 dark:text-emerald-300">{msg}</span>}
        </div>

        <div className="grid grid-cols-2 gap-3 mb-6">
          <div>
            <label className="block text-xs text-slate-600 dark:text-slate-300 mb-1">Gram</label>
            <input
              type="number" step="any" placeholder="0"
              value={form.gram} onChange={e => handleChange('gram', e.target.value)}
              className="w-full text-right border border-slate-200 dark:border-slate-700 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-600 dark:text-slate-300 mb-1">Copë</label>
            <input
              type="number" step="any" placeholder="0"
              value={form.cope} onChange={e => handleChange('cope', e.target.value)}
              className="w-full text-right border border-slate-200 dark:border-slate-700 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Inventari sot</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
            <Stat label="Fillim gr"  value={rec.gram_start} />
            <Stat label="Fillim cp"  value={rec.cope_start} />
            <Stat label="Hyrje gr"   value={rec.gram_in} />
            <Stat label="Hyrje cp"   value={rec.cope_in} />
            <Stat label="Dalje gr"   value={rec.gram_out} />
            <Stat label="Dalje cp"   value={rec.cope_out} />
            <Stat label="Shitur gr"  value={rec.gram_sold} />
            <Stat label="Shitur cp"  value={rec.cope_sold} />
          </div>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }) {
  const v = n(value)
  return (
    <div className="bg-slate-50 dark:bg-slate-900 rounded-md px-3 py-2">
      <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase">{label}</p>
      <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 tabular-nums">{v || '-'}</p>
    </div>
  )
}
