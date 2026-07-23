import { useState, useEffect, useCallback } from 'react'
import DateRangeFilter from './DateRangeFilter.jsx'
import MoneyInput from './MoneyInput.jsx'

// Zgjedhës i zërit të marketingut me krijim inline. Vetëm zëvendëson endpoint-in
// e kategorive nga expense në marketing — logjika është e njëjtë me shpenzimet.
function MarketingCategoryPicker({ value, onChange, categories, onCreated, disabled, className = 'input-field' }) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  const onSelectChange = (e) => {
    const v = e.target.value
    if (v === '__new__') { setCreating(true); setName('') }
    else onChange(v)
  }

  const save = async () => {
    const trimmed = name.trim()
    if (!trimmed || saving) return
    setSaving(true)
    try {
      const res = await fetch('/api/marketing-categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, description: '', active: 1 }),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e.error || 'Gabim'); return }
      const created = await res.json()
      if (created?.id) await onCreated?.(created.id)
      setCreating(false)
      setName('')
    } finally { setSaving(false) }
  }

  if (creating) {
    return (
      <div className="flex gap-1">
        <input
          type="text" autoFocus value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); save() }
            else if (e.key === 'Escape') { e.preventDefault(); setCreating(false); setName('') }
          }}
          className={`${className} flex-1`}
          placeholder="Emri i zërit të ri (p.sh. Facebook Ads)..."
        />
        <button type="button" onClick={save} disabled={saving || !name.trim()}
          className="px-2 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-sm font-semibold disabled:opacity-50"
          title="Ruaj zërin">✓</button>
        <button type="button" onClick={() => { setCreating(false); setName('') }}
          className="px-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm"
          title="Anulo">✕</button>
      </div>
    )
  }

  return (
    <select value={value || ''} onChange={onSelectChange} disabled={disabled} className={className}>
      <option value="">— zgjidh —</option>
      {categories.map(c => (
        <option key={c.id} value={c.id}>{c.name}</option>
      ))}
      <option value="__new__">➕ Krijo zër të ri...</option>
    </select>
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

function emptyDraft() {
  return { category_id: '', description: '', currency: 'EUR', amount: '', exchange_rate: '1' }
}

export default function Marketing({ date }) {
  const [categories, setCategories] = useState([])
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState(emptyDraft())
  const [filterCur, setFilterCur] = useState('all')
  const [rates, setRates] = useState({ LEK: 1 })
  const [rateSource, setRateSource] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState(null)
  const [dateRange, setDateRange] = useState({ from: '', to: '' })

  const rangeActive = !!(dateRange.from || dateRange.to)
  const showDateCol = rangeActive && dateRange.from !== dateRange.to

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const entriesUrl = rangeActive
        ? `/api/reports/marketing?from=${dateRange.from || '2000-01-01'}&to=${dateRange.to || date}`
        : `/api/marketing-entries/${date}`
      const [cats, entries, ratesRes] = await Promise.all([
        fetch('/api/marketing-categories').then(r => r.json()),
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
  }, [date, rangeActive, dateRange.from, dateRange.to])

  useEffect(() => { load() }, [load])

  const addEntry = async () => {
    if (!draft.category_id) { alert('Zgjidh një zër marketingu.'); return }
    if (!n(draft.amount)) { alert('Vendos vlerën.'); return }
    const cur = draft.currency || 'LEK'
    const rate = cur === 'LEK' ? 1 : n(draft.exchange_rate)
    if (cur !== 'LEK' && rate <= 0) { alert(`Vendos kursin për 1 ${cur} (në LEK).`); return }
    setSaving(true)
    try {
      const res = await fetch('/api/marketing-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          category_id: parseInt(draft.category_id) || null,
          description: draft.description,
          currency: cur,
          amount: n(draft.amount),
          exchange_rate: rate,
        }),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e.error || 'Gabim'); return }
      setDraft({ ...emptyDraft(), currency: cur, exchange_rate: String(rate) })
      load()
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
    await fetch(`/api/marketing-entries/${editingId}`, {
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
    if (!confirm('Fshi këtë zë marketingu?')) return
    await fetch(`/api/marketing-entries/${id}`, { method: 'DELETE' })
    if (editingId === id) cancelEdit()
    load()
  }

  const categoryName = (id) => {
    const c = categories.find(c => c.id === id)
    return c?.name || ''
  }

  const visibleRows = filterCur === 'all' ? rows : rows.filter(r => (r.currency || 'LEK') === filterCur)

  const totals = visibleRows.reduce((a, r) => {
    const cur = r.currency || 'LEK'
    a.by_currency[cur] = (a.by_currency[cur] || 0) + n(r.amount)
    a.total_lek += n(r.amount) * n(r.exchange_rate || 1)
    return a
  }, { by_currency: {}, total_lek: 0 })

  const totalsList = Object.entries(totals.by_currency).filter(([, v]) => Math.abs(v) > 0.005)

  if (loading && rows.length === 0) return <div className="card p-8 text-center text-slate-400">Duke ngarkuar...</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Fleta e Marketingut</h2>
          <p className="text-xs text-slate-500">
            Kursi për monedhat e huaja merret automatikisht nga kursi zyrtar i datës
            {rateSource && <span className="ml-1 text-slate-400">(burimi: <span className="font-medium">{rateSource}</span>)</span>}.
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
        <h3 className="text-sm font-semibold text-slate-700 mb-3">+ Shto Shpenzim Marketingu</h3>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 items-end">
          <div className="md:col-span-2">
            <label className="form-label">Zëri</label>
            <MarketingCategoryPicker
              value={draft.category_id}
              onChange={v => setDraft(d => ({ ...d, category_id: v }))}
              categories={categories}
              onCreated={async (newId) => {
                await load()
                setDraft(d => ({ ...d, category_id: String(newId) }))
              }}
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
          <div className="md:col-span-6 flex items-center justify-between">
            <p className="text-xs text-slate-500">
              Total LEK: <span className="font-bold text-blue-700 tabular-nums">
                {fmt(n(draft.amount) * (draft.currency === 'LEK' ? 1 : n(draft.exchange_rate)))}
              </span>
            </p>
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

      {/* Filtër Periudhe */}
      <DateRangeFilter
        from={dateRange.from}
        to={dateRange.to}
        onChange={setDateRange}
        loading={loading}
        emptyForAll
        compact
        hint={rangeActive
          ? 'Shpenzimet e marketingut për periudhën e zgjedhur'
          : `Vetëm data ${date} · zgjidh periudhë për historik më të gjerë`}
      />

      {/* Existing entries */}
      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-800">Shpenzimet e Marketingut</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {rangeActive
                ? 'Kliko ✏️ për të edituar. Data mbetet ajo origjinale e regjistrimit.'
                : 'Kliko ✏️ për të edituar një zë. Ndryshimet ruhen kur klikon ✓.'}
            </p>
          </div>
          <span className="text-xs text-slate-500">
            {visibleRows.length} {visibleRows.length === 1 ? 'rresht' : 'rreshta'}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {showDateCol && (
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase w-24">Data</th>
                )}
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase w-48">Zëri</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase">Përshkrimi</th>
                <th className="px-3 py-2 text-center text-xs font-semibold text-slate-500 uppercase w-24">Monedha</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase w-32">Vlera</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase w-28">Kursi (LEK)</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase w-32 bg-blue-50/60">Total LEK</th>
                <th className="px-3 py-2 text-center text-xs font-semibold text-slate-500 uppercase w-12"></th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={showDateCol ? 8 : 7} className="p-6 text-center text-slate-400 text-sm italic">
                    {rows.length === 0
                      ? (rangeActive
                        ? 'Asnjë shpenzim marketingu në periudhën e zgjedhur.'
                        : 'Asnjë shpenzim marketingu për këtë datë. Shto rreshtin e parë më lart.')
                      : `Asnjë shpenzim në ${filterCur}. Ndrysho filtrin për të parë të tjerët.`}
                  </td>
                </tr>
              ) : visibleRows.map(r => {
                const isEditing = editingId === r.id
                if (isEditing && editDraft) {
                  const eCur = editDraft.currency || 'LEK'
                  const eIsLek = eCur === 'LEK'
                  const eTotalLek = n(editDraft.amount) * (eIsLek ? 1 : n(editDraft.exchange_rate))
                  return (
                    <tr key={r.id} className="border-b border-slate-100 bg-amber-50/40">
                      {showDateCol && (
                        <td className="px-3 py-2 text-slate-600 text-xs font-mono">
                          {fmtDate(editDraft.date || r.date)}
                        </td>
                      )}
                      <td className="px-2 py-1">
                        <MarketingCategoryPicker
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
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-blue-700 bg-blue-50/40">
                        {fmt(eTotalLek)}
                      </td>
                      <td className="px-2 py-1 text-center whitespace-nowrap">
                        <button onClick={saveEdit} className="px-2 py-0.5 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-medium mr-1" title="Ruaj">✓</button>
                        <button onClick={cancelEdit} className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-medium" title="Anulo">✕</button>
                      </td>
                    </tr>
                  )
                }
                const cur = r.currency || 'LEK'
                const isLek = cur === 'LEK'
                const totalLek = n(r.amount) * n(r.exchange_rate || 1)
                return (
                  <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                    {showDateCol && (
                      <td className="px-3 py-2 text-slate-600 text-xs font-mono">{fmtDate(r.date)}</td>
                    )}
                    <td className="px-3 py-2 text-slate-800">
                      {categoryName(r.category_id) || r.category_name || <span className="italic text-slate-400">— pa zër —</span>}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {r.description || <span className="italic text-slate-400">—</span>}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className="badge bg-blue-100 text-blue-700">{cur}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-800 font-semibold">
                      {fmt(r.amount)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                      {isLek ? '1' : fmt(r.exchange_rate)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-blue-700 bg-blue-50/40">
                      {fmt(totalLek)}
                    </td>
                    <td className="px-2 py-1 text-center whitespace-nowrap">
                      <button
                        onClick={() => startEdit(r)}
                        className="px-2 py-0.5 rounded bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-medium mr-1"
                        title="Edito"
                      >✏️</button>
                      <button
                        onClick={() => removeEntry(r.id)}
                        className="px-2 py-0.5 rounded bg-red-50 hover:bg-red-100 text-red-600 text-xs font-medium"
                        title="Fshi"
                      >✕</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="bg-blue-50 border-t-2 border-blue-200">
              <tr className="font-bold text-xs">
                <td colSpan={showDateCol ? 4 : 3} className="px-3 py-2 text-right text-slate-700 uppercase">TOTALI:</td>
                <td colSpan={2} className="px-3 py-2 text-right text-slate-600 text-[11px]">
                  {totalsList.length === 0
                    ? '—'
                    : totalsList.map(([c, v]) => `${fmt(v)} ${c}`).join(' · ')}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-blue-900 text-sm bg-blue-100/60">
                  {fmt(totals.total_lek)} LEK
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-slate-400 italic px-1">
        Kursi për monedhat e huaja plotësohet automatikisht nga kursi zyrtar i datës — mund të mbishkruhet
        dorazi për raste specifike.
      </p>
    </div>
  )
}
