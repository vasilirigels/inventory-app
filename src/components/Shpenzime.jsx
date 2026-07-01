import { useState, useEffect, useCallback } from 'react'

const CURRENCIES = ['LEK', 'EUR', 'USD', 'GBP', 'CHF']

function n(v) { return parseFloat(v) || 0 }
function fmt(v) {
  const x = n(v)
  if (x === 0) return '—'
  return x.toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function emptyDraft() {
  return { category_id: '', description: '', currency: 'LEK', amount: '', exchange_rate: '1' }
}

export default function Shpenzime({ date, onNavigate }) {
  const [categories, setCategories] = useState([])
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState(emptyDraft())
  const [filterCur, setFilterCur] = useState('all')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [cats, entries] = await Promise.all([
        fetch('/api/expense-categories').then(r => r.json()),
        fetch(`/api/expense-entries/${date}`).then(r => r.json()),
      ])
      setCategories(Array.isArray(cats) ? cats : [])
      setRows(Array.isArray(entries?.rows) ? entries.rows : [])
    } catch (e) {
      console.error(e)
      setCategories([]); setRows([])
    } finally {
      setLoading(false)
    }
  }, [date])

  useEffect(() => { load() }, [load])

  const addEntry = async () => {
    if (!draft.category_id) { alert('Zgjidh një zër shpenzimi.'); return }
    if (!n(draft.amount)) { alert('Vendos vlerën.'); return }
    const cur = draft.currency || 'LEK'
    const rate = cur === 'LEK' ? 1 : n(draft.exchange_rate)
    if (cur !== 'LEK' && rate <= 0) { alert(`Vendos kursin për 1 ${cur} (në LEK).`); return }
    setSaving(true)
    try {
      const res = await fetch('/api/expense-entries', {
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

  const updateEntry = async (row, patch) => {
    const merged = { ...row, ...patch }
    const cur = merged.currency || 'LEK'
    const rate = cur === 'LEK' ? 1 : n(merged.exchange_rate)
    await fetch(`/api/expense-entries/${row.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date,
        category_id: parseInt(merged.category_id) || null,
        description: merged.description || '',
        currency: cur,
        amount: n(merged.amount),
        exchange_rate: rate,
      }),
    })
    load()
  }

  const removeEntry = async (id) => {
    if (!confirm('Fshi këtë zë shpenzimi?')) return
    await fetch(`/api/expense-entries/${id}`, { method: 'DELETE' })
    load()
  }

  const visibleRows = filterCur === 'all' ? rows : rows.filter(r => (r.currency || 'LEK') === filterCur)

  const totals = visibleRows.reduce((a, r) => {
    const cur = r.currency || 'LEK'
    a.by_currency[cur] = (a.by_currency[cur] || 0) + n(r.amount)
    a.total_lek += n(r.amount) * n(r.exchange_rate || 1)
    return a
  }, { by_currency: {}, total_lek: 0 })

  const totalsList = Object.entries(totals.by_currency).filter(([, v]) => Math.abs(v) > 0.005)

  if (loading) return <div className="card p-8 text-center text-slate-400">Duke ngarkuar...</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Fleta e Shpenzimeve</h2>
          <p className="text-xs text-slate-500">
            Çdo shpenzim ka monedhën dhe kursin e vet (kursi vendoset dorazi për monedhat e huaja).
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
          <button onClick={() => onNavigate?.('zerat-shpenzimeve')} className="btn-secondary text-xs">
            ⚙️ Menaxho Zërat
          </button>
        </div>
      </div>

      {categories.length === 0 && (
        <div className="card bg-amber-50 border-amber-200">
          <div className="flex items-start gap-3">
            <span className="text-2xl">⚠️</span>
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-800">Nuk ka zëra shpenzimi të regjistruar</p>
              <p className="text-xs text-amber-700 mt-1">
                Krijo së pari zërat (Energji, Qera, Internet, etj.) që të mund t'i përdorësh këtu.
              </p>
            </div>
            <button onClick={() => onNavigate?.('zerat-shpenzimeve')} className="btn-primary text-xs">
              Krijo Zëra
            </button>
          </div>
        </div>
      )}

      {/* Existing entries */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
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
                  <td colSpan={7} className="p-6 text-center text-slate-400 text-sm italic">
                    {rows.length === 0
                      ? 'Asnjë shpenzim për këtë datë. Shto rreshtin e parë më poshtë.'
                      : `Asnjë shpenzim në ${filterCur}. Ndrysho filtrin për të parë të tjerët.`}
                  </td>
                </tr>
              ) : visibleRows.map(r => {
                const cur = r.currency || 'LEK'
                const isLek = cur === 'LEK'
                const totalLek = n(r.amount) * n(r.exchange_rate || 1)
                return (
                  <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-2 py-1">
                      <select
                        value={r.category_id || ''}
                        onChange={e => updateEntry(r, { category_id: e.target.value })}
                        className="input-field-sm"
                      >
                        <option value="">— pa zër —</option>
                        {categories.map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                        {r.category_id && !categories.some(c => c.id === r.category_id) && (
                          <option value={r.category_id}>{r.category_name || '(zër i fshirë)'}</option>
                        )}
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <input
                        type="text" value={r.description || ''}
                        onChange={e => setRows(prev => prev.map(p => p.id === r.id ? { ...p, description: e.target.value } : p))}
                        onBlur={e => updateEntry(r, { description: e.target.value })}
                        className="input-field-sm"
                        placeholder="opsional"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <select
                        value={cur}
                        onChange={e => {
                          const newCur = e.target.value
                          const newRate = newCur === 'LEK' ? 1 : n(r.exchange_rate) || 1
                          updateEntry(r, { currency: newCur, exchange_rate: newRate })
                        }}
                        className="input-field-sm"
                      >
                        {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <input
                        type="number" step="0.01" value={r.amount ?? ''}
                        onChange={e => setRows(prev => prev.map(p => p.id === r.id ? { ...p, amount: e.target.value } : p))}
                        onBlur={e => updateEntry(r, { amount: e.target.value })}
                        className="input-field-sm text-right tabular-nums"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        type="number" step="0.0001" min="0"
                        value={isLek ? 1 : (r.exchange_rate ?? '')}
                        disabled={isLek}
                        onChange={e => setRows(prev => prev.map(p => p.id === r.id ? { ...p, exchange_rate: e.target.value } : p))}
                        onBlur={e => updateEntry(r, { exchange_rate: e.target.value })}
                        className="input-field-sm text-right tabular-nums disabled:bg-slate-100 disabled:text-slate-400"
                      />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-blue-700 bg-blue-50/40">
                      {fmt(totalLek)}
                    </td>
                    <td className="px-2 py-1 text-center">
                      <button onClick={() => removeEntry(r.id)} className="text-red-500 hover:text-red-700 text-sm" title="Fshi">✕</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="bg-blue-50 border-t-2 border-blue-200">
              <tr className="font-bold text-xs">
                <td colSpan={3} className="px-3 py-2 text-right text-slate-700 uppercase">TOTALI:</td>
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

      {/* New entry row */}
      <div className="card">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">+ Shto Shpenzim</h3>
        <div className="grid grid-cols-2 md:grid-cols-7 gap-2 items-end">
          <div className="md:col-span-2">
            <label className="form-label">Zëri</label>
            <select
              value={draft.category_id}
              onChange={e => setDraft(d => ({ ...d, category_id: e.target.value }))}
              className="input-field"
              disabled={categories.length === 0}
            >
              <option value="">— zgjidh —</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
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
                setDraft(d => ({
                  ...d,
                  currency: newCur,
                  exchange_rate: newCur === 'LEK' ? '1' : (d.exchange_rate === '1' ? '' : d.exchange_rate),
                }))
              }}
              className="input-field"
            >
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label">Vlera ({draft.currency})</label>
            <input
              type="number" step="0.01" value={draft.amount}
              onChange={e => setDraft(d => ({ ...d, amount: e.target.value }))}
              className="input-field text-right tabular-nums"
            />
          </div>
          <div>
            <label className="form-label">
              Kursi <span className="text-[10px] text-slate-400">(1 {draft.currency} = ? LEK)</span>
            </label>
            <input
              type="number" step="0.0001" min="0"
              value={draft.currency === 'LEK' ? 1 : draft.exchange_rate}
              disabled={draft.currency === 'LEK'}
              onChange={e => setDraft(d => ({ ...d, exchange_rate: e.target.value }))}
              className="input-field text-right tabular-nums disabled:bg-slate-100 disabled:text-slate-400"
              placeholder={draft.currency === 'LEK' ? '1' : 'p.sh. 98.5'}
            />
          </div>
          <div className="md:col-span-7 flex items-center justify-between">
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

      <p className="text-[11px] text-slate-400 italic px-1">
        Kursi vendoset dorazi për çdo shpenzim me monedhë të huaj. Totali ditor në LEK ruhet automatikisht
        te regjistri ditor (Përmbledhja Mujore, EndOfDay, etj.).
      </p>
    </div>
  )
}
