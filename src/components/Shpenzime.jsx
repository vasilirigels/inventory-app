import { useState, useEffect, useCallback } from 'react'
import MoneyInput from './MoneyInput.jsx'
import { showConfirm } from './ConfirmDialog.jsx'

// Zgjedhës i zërit të shpenzimit me krijim/editim/fshirje inline.
// - `➕ Krijo zër të ri` → kthen picker-in në modalitet krijimi
// - ✏️ pranë select-it → riemërto zërin ekzistues (kur është zgjedhur)
// - ✕ pranë select-it → fshi zërin ekzistues (me konfirmim)
// `canManage=false` fsheh krijimin/editimin/fshirjen e zërave (për rolin 'sales').
function ExpenseCategoryPicker({
  value, onChange, categories, onCreated, onUpdated, onDeleted,
  disabled, canManage = true, className = 'input-field',
}) {
  const [mode, setMode] = useState('view') // 'view' | 'create' | 'edit'
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  const selectedId = value ? parseInt(value) : null
  const selected = categories.find(c => c.id === selectedId)

  const onSelectChange = (e) => {
    const v = e.target.value
    if (v === '__new__') { setMode('create'); setName('') }
    else onChange(v)
  }

  const startEdit = () => {
    if (!selected) return
    setMode('edit'); setName(selected.name)
  }

  const saveCreate = async () => {
    const trimmed = name.trim()
    if (!trimmed || saving) return
    setSaving(true)
    try {
      const res = await fetch('/api/expense-categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, description: '', active: 1 }),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e.error || 'Gabim'); return }
      const created = await res.json()
      if (created?.id) await onCreated?.(created.id)
      setMode('view'); setName('')
    } finally { setSaving(false) }
  }

  const saveEdit = async () => {
    const trimmed = name.trim()
    if (!trimmed || saving || !selected) return
    setSaving(true)
    try {
      const res = await fetch(`/api/expense-categories/${selected.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, description: selected.description || '', active: 1 }),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e.error || 'Gabim'); return }
      await onUpdated?.()
      setMode('view'); setName('')
    } finally { setSaving(false) }
  }

  const doDelete = async () => {
    if (!selected) return
    if (!(await showConfirm(
      `Fshi zërin "${selected.name}"?\nShpenzimet ekzistuese mbeten, por pa zër të lidhur.`,
      { title: 'Fshi zërin', confirmLabel: 'Fshi', danger: true }
    ))) return
    setSaving(true)
    try {
      const res = await fetch(`/api/expense-categories/${selected.id}`, { method: 'DELETE' })
      if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e.error || 'Gabim'); return }
      onChange('')
      await onDeleted?.()
    } finally { setSaving(false) }
  }

  if (mode === 'create' || mode === 'edit') {
    const submit = mode === 'edit' ? saveEdit : saveCreate
    return (
      <div className="flex gap-1">
        <input
          type="text" autoFocus value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); submit() }
            else if (e.key === 'Escape') { e.preventDefault(); setMode('view'); setName('') }
          }}
          className={`${className} flex-1`}
          placeholder={mode === 'edit' ? 'Riemërto zërin...' : 'Emri i zërit të ri (p.sh. Qera)...'}
        />
        <button type="button" onClick={submit} disabled={saving || !name.trim()}
          className="px-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 hover:bg-emerald-100 text-emerald-700 dark:text-emerald-300 text-sm font-semibold disabled:opacity-50"
          title="Ruaj zërin">✓</button>
        <button type="button" onClick={() => { setMode('view'); setName('') }}
          className="px-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-sm"
          title="Anulo">✕</button>
      </div>
    )
  }

  return (
    <div className="flex gap-1">
      <select value={value || ''} onChange={onSelectChange} disabled={disabled} className={`${className} flex-1`}>
        <option value="">— zgjidh —</option>
        {categories.map(c => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
        {canManage && <option value="__new__">➕ Krijo zër të ri...</option>}
      </select>
      {canManage && selected && (
        <>
          <button type="button" onClick={startEdit} disabled={disabled || saving}
            className="px-2 rounded-lg bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 text-blue-700 dark:text-blue-300 text-sm font-semibold disabled:opacity-50"
            title={`Riemërto "${selected.name}"`}>✏️</button>
          <button type="button" onClick={doDelete} disabled={disabled || saving}
            className="px-2 rounded-lg bg-red-50 dark:bg-red-900/30 hover:bg-red-100 text-red-600 dark:text-red-300 text-sm font-semibold disabled:opacity-50"
            title={`Fshi "${selected.name}"`}>✕</button>
        </>
      )}
    </div>
  )
}

const CURRENCIES = ['LEK', 'EUR', 'USD', 'GBP', 'CHF']

function fmtDate(d) {
  if (!d) return ''
  return d.split('-').reverse().join('.')
}

function n(v) { return parseFloat(v) || 0 }
function fmt(v) {
  const x = n(v)
  if (x === 0) return '—'
  return x.toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function emptyDraft(defaultDate = '') {
  return { date: defaultDate, category_id: '', description: '', currency: 'EUR', amount: '', exchange_rate: '1' }
}

export default function Shpenzime({ date, onNavigate }) {
  const [categories, setCategories] = useState([])
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState(() => emptyDraft(date))
  const [filterCur, setFilterCur] = useState('all')
  const [rates, setRates] = useState({ LEK: 1 })
  const [rateSource, setRateSource] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState(null)
  const [fromDate, setFromDate] = useState(() => date)
  const [toDate,   setToDate]   = useState(() => date)

  const rangeActive = fromDate !== date || toDate !== date
  const showDateCol = fromDate !== toDate

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const entriesUrl = fromDate === toDate
        ? `/api/expense-entries/${fromDate}`
        : `/api/reports/expenses?from=${fromDate}&to=${toDate}`
      const [cats, entries, ratesRes] = await Promise.all([
        fetch('/api/expense-categories').then(r => r.json()),
        fetch(entriesUrl).then(r => r.json()),
        fetch(`/api/exchange-rates/${date}`).then(r => r.json()).catch(() => ({})),
      ])
      setCategories(Array.isArray(cats) ? cats : [])
      setRows(Array.isArray(entries?.rows) ? entries.rows : [])
      const r = ratesRes?.rates || { LEK: 1 }
      setRates(r)
      setRateSource(ratesRes?.source || '')
      setDraft(d => {
        if (d.currency === 'LEK') return d
        const autoRate = r[d.currency]
        if (autoRate && (d.exchange_rate === '' || d.exchange_rate === '1')) {
          return { ...d, exchange_rate: String(autoRate) }
        }
        return d
      })
    } catch (e) {
      console.error(e)
      setCategories([]); setRows([])
    } finally {
      setLoading(false)
    }
  }, [date, fromDate, toDate])

  useEffect(() => {
    const t = setTimeout(() => { load() }, 400)
    return () => clearTimeout(t)
  }, [load])

  useEffect(() => {
    setDraft(d => ({ ...d, date }))
  }, [date])

  const addEntry = async () => {
    if (!draft.category_id) { alert('Zgjidh një zër shpenzimi.'); return }
    if (!n(draft.amount)) { alert('Vendos vlerën.'); return }
    if (!draft.date) { alert('Vendos datën.'); return }
    const cur = draft.currency || 'LEK'
    const rate = cur === 'LEK' ? 1 : n(draft.exchange_rate)
    if (cur !== 'LEK' && rate <= 0) { alert(`Vendos kursin për 1 ${cur} (në LEK).`); return }
    setSaving(true)
    try {
      const res = await fetch('/api/expense-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: draft.date,
          category_id: parseInt(draft.category_id) || null,
          description: draft.description,
          currency: cur,
          amount: n(draft.amount),
          exchange_rate: rate,
        }),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e.error || 'Gabim'); return }
      const savedDate = draft.date
      setDraft({ ...emptyDraft(savedDate), currency: cur, exchange_rate: String(rate) })
      if (savedDate !== date) {
        // Zgjero periudhën për të përfshirë datën e sapo-ruajtur.
        setFromDate(prev => (prev && prev < savedDate ? prev : savedDate))
        setToDate(prev => (prev && prev > savedDate ? prev : (savedDate > date ? savedDate : date)))
      } else {
        load()
      }
    } finally { setSaving(false) }
  }

  const startEdit = (row) => {
    setEditingId(row.id)
    setEditDraft({
      date: row.date || date,
      category_id: row.category_id || '',
      description: row.description || '',
      currency: row.currency || 'LEK',
      amount: row.amount != null ? String(row.amount) : '',
      exchange_rate: row.exchange_rate != null ? String(row.exchange_rate) : '1',
    })
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditDraft(null)
  }

  const saveEdit = async () => {
    if (!editDraft || editingId == null) return
    const cur = editDraft.currency || 'LEK'
    const rate = cur === 'LEK' ? 1 : n(editDraft.exchange_rate)
    if (cur !== 'LEK' && rate <= 0) { alert(`Vendos kursin për 1 ${cur} (në LEK).`); return }
    if (!n(editDraft.amount)) { alert('Vendos vlerën.'); return }
    await fetch(`/api/expense-entries/${editingId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: editDraft.date || date,
        category_id: parseInt(editDraft.category_id) || null,
        description: editDraft.description || '',
        currency: cur,
        amount: n(editDraft.amount),
        exchange_rate: rate,
      }),
    })
    cancelEdit()
    load()
  }

  const removeEntry = async (id) => {
    if (!(await showConfirm('Fshi këtë zë shpenzimi?', {
      title: 'Fshi shpenzimin', confirmLabel: 'Fshi', danger: true,
    }))) return
    await fetch(`/api/expense-entries/${id}`, { method: 'DELETE' })
    if (editingId === id) cancelEdit()
    load()
  }

  const categoryName = (id) => {
    const c = categories.find(c => c.id === id)
    return c?.name || ''
  }

  const visibleRows = filterCur === 'all' ? rows : rows.filter(r => (r.currency || 'LEK') === filterCur)

  const eurRate = n(rates.EUR) > 0 ? n(rates.EUR) : 0
  const lekToEur = (lek) => (eurRate > 0 ? lek / eurRate : 0)
  const rowTotalEur = (row) => {
    const cur = row.currency || 'LEK'
    if (cur === 'EUR') return n(row.amount)
    return lekToEur(n(row.amount) * n(row.exchange_rate || 1))
  }

  const totals = visibleRows.reduce((a, r) => {
    const cur = r.currency || 'LEK'
    a.by_currency[cur] = (a.by_currency[cur] || 0) + n(r.amount)
    a.total_lek += n(r.amount) * n(r.exchange_rate || 1)
    a.total_eur += rowTotalEur(r)
    return a
  }, { by_currency: {}, total_lek: 0, total_eur: 0 })

  const totalsList = Object.entries(totals.by_currency).filter(([, v]) => Math.abs(v) > 0.005)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">Fleta e Shpenzimeve</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Kursi për monedhat e huaja merret automatikisht nga kursi zyrtar i datës
            {rateSource && <span className="ml-1 text-slate-400 dark:text-slate-500">(burimi: <span className="font-medium">{rateSource}</span>)</span>}.
            Mund të mbishkruhet dorazi nëse duhet.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="form-label">Filtër Monedha</label>
            <select
              value={filterCur}
              onChange={e => setFilterCur(e.target.value)}
              className="input-field w-36"
            >
              <option value="all">Të gjitha</option>
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* New entry row */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">+ Shto Shpenzim</h3>
          {draft.date && draft.date !== date && (
            <span className="text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 px-2 py-1 rounded">
              Po regjistrohet për datën {fmtDate(draft.date)} (jashtë datës aktuale {fmtDate(date)})
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-7 gap-2 items-end">
          <div>
            <label className="form-label">Data</label>
            <input
              type="date"
              value={draft.date || ''}
              onChange={e => setDraft(d => ({ ...d, date: e.target.value }))}
              className="input-field"
              max={date}
            />
          </div>
          <div className="md:col-span-2">
            <label className="form-label">Zëri</label>
            <ExpenseCategoryPicker
              value={draft.category_id}
              onChange={v => setDraft(d => ({ ...d, category_id: v }))}
              categories={categories}
              onCreated={async (newId) => {
                await load()
                setDraft(d => ({ ...d, category_id: String(newId) }))
              }}
              onUpdated={load}
              onDeleted={() => { setDraft(d => ({ ...d, category_id: '' })); return load() }}
            />
          </div>
          <div className="md:col-span-2">
            <label className="form-label">Përshkrimi</label>
            <input
              type="text" value={draft.description}
              onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
              className="input-field" placeholder="opsional"
            />
          </div>
          <div>
            <label className="form-label">Monedha</label>
            <select
              value={draft.currency}
              onChange={e => {
                const newCur = e.target.value
                setDraft(d => {
                  if (newCur === 'LEK') return { ...d, currency: newCur, exchange_rate: '1' }
                  const autoRate = rates[newCur]
                  return {
                    ...d,
                    currency: newCur,
                    exchange_rate: autoRate ? String(autoRate) : '',
                  }
                })
              }}
              className="input-field"
            >
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label">Vlera ({draft.currency})</label>
            <MoneyInput
              value={draft.amount}
              onChange={v => setDraft(d => ({ ...d, amount: String(v) }))}
              className="input-field text-right tabular-nums"
            />
          </div>
          <div className="md:col-span-7 flex items-center justify-end">
            <button
              onClick={addEntry}
              disabled={saving || categories.length === 0}
              className="btn-primary disabled:opacity-50"
            >
              {saving ? '⏳ Duke ruajtur...' : '+ Shto'}
            </button>
          </div>
        </div>
      </div>

      {/* Filtër Periudhe — i njëjtë me atë të Blerjeve */}
      <div className="card flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">📅</span>
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Filtër data</span>
        </div>
        <div>
          <label className="form-label">Nga data</label>
          <input
            type="date" value={fromDate}
            max={toDate}
            onChange={e => setFromDate(e.target.value)}
            className="input-field"
          />
        </div>
        <div>
          <label className="form-label">Deri më datë</label>
          <input
            type="date" value={toDate}
            min={fromDate}
            onChange={e => setToDate(e.target.value)}
            className="input-field"
          />
        </div>
        {rangeActive && (
          <button
            onClick={() => { setFromDate(date); setToDate(date) }}
            className="btn-secondary text-xs"
          >Pastro filtrin</button>
        )}
        {loading && (
          <span className="text-[11px] text-blue-600 bg-blue-50 dark:bg-blue-900/30 px-2 py-1 rounded-lg border border-blue-200">
            ⏳ Duke ngarkuar...
          </span>
        )}
      </div>

      {/* Existing entries */}
      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
              Shpenzimet e Regjistruara
              {rangeActive && (
                <span className="ml-2 text-xs font-normal text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 rounded">
                  {fmtDate(fromDate)} → {fmtDate(toDate)}
                </span>
              )}
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              {rangeActive
                ? 'Kliko ✏️ për të edituar. Data mbetet ajo origjinale e regjistrimit.'
                : 'Kliko ✏️ për të edituar një zë. Ndryshimet ruhen kur klikon ✓.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {rangeActive && (
              <button
                type="button"
                onClick={() => { setFromDate(date); setToDate(date) }}
                className="text-[11px] text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 px-2 py-1 rounded"
                title="Hiq filtrin dhe kthehu te data aktuale"
              >✕ Pastro filtrin</button>
            )}
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {visibleRows.length} {visibleRows.length === 1 ? 'rresht' : 'rreshta'}
            </span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
              <tr>
                {showDateCol && (
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase w-24">Data</th>
                )}
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase w-48">Zëri</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Përshkrimi</th>
                <th className="px-3 py-2 text-center text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase w-24">Monedha</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase w-32">Vlera</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase w-28">Kursi (LEK)</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase w-32 bg-blue-50/60">Total EUR</th>
                <th className="px-3 py-2 text-center text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase w-12"></th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={showDateCol ? 8 : 7} className="p-6 text-center text-slate-400 dark:text-slate-500 text-sm italic">
                    {rows.length === 0
                      ? (rangeActive
                        ? `Asnjë shpenzim në periudhën ${fmtDate(fromDate)} → ${fmtDate(toDate)}.`
                        : 'Asnjë shpenzim për këtë datë. Shto rreshtin e parë më lart.')
                      : `Asnjë shpenzim në ${filterCur}. Ndrysho filtrin për të parë të tjerët.`}
                  </td>
                </tr>
              ) : visibleRows.map(r => {
                const isEditing = editingId === r.id
                if (isEditing && editDraft) {
                  const eCur = editDraft.currency || 'LEK'
                  const eIsLek = eCur === 'LEK'
                  const eTotalLek = n(editDraft.amount) * (eIsLek ? 1 : n(editDraft.exchange_rate))
                  const eTotalEur = eCur === 'EUR' ? n(editDraft.amount) : lekToEur(eTotalLek)
                  return (
                    <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800 bg-amber-50/40">
                      {showDateCol && (
                        <td className="px-3 py-2 text-slate-600 dark:text-slate-300 text-xs font-mono">
                          {fmtDate(editDraft.date || r.date)}
                        </td>
                      )}
                      <td className="px-2 py-1">
                        <ExpenseCategoryPicker
                          value={editDraft.category_id}
                          onChange={v => setEditDraft(d => ({ ...d, category_id: v }))}
                          categories={
                            editDraft.category_id && !categories.some(c => c.id === parseInt(editDraft.category_id))
                              ? [...categories, { id: parseInt(editDraft.category_id), name: r.category_name || '(zër i fshirë)' }]
                              : categories
                          }
                          onCreated={async (newId) => {
                            await load()
                            setEditDraft(d => ({ ...d, category_id: String(newId) }))
                          }}
                          onUpdated={load}
                          onDeleted={() => { setEditDraft(d => ({ ...d, category_id: '' })); return load() }}
                          className="input-field-sm"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="text" value={editDraft.description}
                          onChange={e => setEditDraft(d => ({ ...d, description: e.target.value }))}
                          className="input-field-sm"
                          placeholder="opsional"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <select
                          value={eCur}
                          onChange={e => {
                            const newCur = e.target.value
                            setEditDraft(d => {
                              if (newCur === 'LEK') return { ...d, currency: newCur, exchange_rate: '1' }
                              const autoRate = rates[newCur]
                              return {
                                ...d,
                                currency: newCur,
                                exchange_rate: autoRate ? String(autoRate) : d.exchange_rate,
                              }
                            })
                          }}
                          className="input-field-sm"
                        >
                          {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-1">
                        <MoneyInput
                          value={editDraft.amount}
                          onChange={v => setEditDraft(d => ({ ...d, amount: String(v) }))}
                          className="input-field-sm text-right tabular-nums"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="number" step="0.0001" min="0"
                          value={eIsLek ? 1 : editDraft.exchange_rate}
                          disabled={eIsLek}
                          onChange={e => setEditDraft(d => ({ ...d, exchange_rate: e.target.value }))}
                          className="input-field-sm text-right tabular-nums disabled:bg-slate-100 disabled:text-slate-400"
                        />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-blue-700 dark:text-blue-300 bg-blue-50/40">
                        {fmt(eTotalEur)}
                      </td>
                      <td className="px-2 py-1 text-center whitespace-nowrap">
                        <button onClick={saveEdit} className="px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-900/30 hover:bg-emerald-100 text-emerald-700 dark:text-emerald-300 text-xs font-medium mr-1" title="Ruaj">✓</button>
                        <button onClick={cancelEdit} className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-medium" title="Anulo">✕</button>
                      </td>
                    </tr>
                  )
                }
                const cur = r.currency || 'LEK'
                const isLek = cur === 'LEK'
                const totalEur = rowTotalEur(r)
                return (
                  <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    {showDateCol && (
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-300 text-xs font-mono">{fmtDate(r.date)}</td>
                    )}
                    <td className="px-3 py-2 text-slate-800 dark:text-slate-100">
                      {categoryName(r.category_id) || r.category_name || <span className="italic text-slate-400 dark:text-slate-500">— pa zër —</span>}
                    </td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                      {r.description || <span className="italic text-slate-400 dark:text-slate-500">—</span>}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className="badge bg-blue-100 text-blue-700 dark:text-blue-300">{cur}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-800 dark:text-slate-100 font-semibold">
                      {fmt(r.amount)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">
                      {isLek ? '1' : fmt(r.exchange_rate)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-blue-700 dark:text-blue-300 bg-blue-50/40">
                      {fmt(totalEur)}
                    </td>
                    <td className="px-2 py-1 text-center whitespace-nowrap">
                      <button
                        onClick={() => startEdit(r)}
                        className="px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 text-blue-700 dark:text-blue-300 text-xs font-medium mr-1"
                        title="Edito"
                      >✏️</button>
                      <button
                        onClick={() => removeEntry(r.id)}
                        className="px-2 py-0.5 rounded bg-red-50 dark:bg-red-900/30 hover:bg-red-100 text-red-600 text-xs font-medium"
                        title="Fshi"
                      >✕</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="bg-blue-50 dark:bg-blue-900/30 border-t-2 border-blue-200">
              <tr className="font-bold text-xs">
                <td colSpan={showDateCol ? 4 : 3} className="px-3 py-2 text-right text-slate-700 dark:text-slate-200 uppercase">TOTALI:</td>
                <td colSpan={2} className="px-3 py-2 text-right text-slate-600 dark:text-slate-300 text-[11px]">
                  {totalsList.length === 0
                    ? '—'
                    : totalsList.map(([c, v]) => `${fmt(v)} ${c}`).join(' · ')}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-blue-900 text-sm bg-blue-100/60">
                  {fmt(totals.total_eur)} EUR
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-slate-400 dark:text-slate-500 italic px-1">
        Kursi për monedhat e huaja plotësohet automatikisht nga kursi zyrtar i datës — mund të mbishkruhet
        dorazi për raste specifike. Totali ditor në LEK ruhet automatikisht te regjistri ditor
        (Përmbledhja Mujore, EndOfDay, etj.).
      </p>
    </div>
  )
}
