import { useEffect, useState, useCallback } from 'react'

const EMPTY = { code: '', name: '', address: '', notes: '' }

function WarehouseModal({ warehouse, onClose, onSave }) {
  const [form, setForm] = useState(() => warehouse ? { ...EMPTY, ...warehouse } : { ...EMPTY })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const submit = async (e) => {
    e.preventDefault()
    if (!form.code.trim()) { setError('Kodi është i detyrueshëm.'); return }
    setSaving(true); setError('')
    try {
      await onSave({ ...(warehouse?.id ? { id: warehouse.id } : {}), ...form, code: form.code.trim() })
    } catch (err) {
      setError(err.message || 'Gabim në ruajtje')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box">
        <div className="modal-header">
          <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">
            {warehouse?.id ? 'Edito Magazinën' : 'Magazinë e Re'}
          </h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 dark:text-slate-500 text-xl">×</button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="form-label">Kodi i Magazinës <span className="text-red-500">*</span></label>
                <input
                  type="text" value={form.code}
                  onChange={e => set('code', e.target.value.toUpperCase())}
                  className="input-field font-mono uppercase"
                  placeholder="p.sh. MAG-01"
                  autoFocus
                />
              </div>
              <div className="col-span-2">
                <label className="form-label">Emri / Përshkrimi</label>
                <input
                  type="text" value={form.name}
                  onChange={e => set('name', e.target.value)}
                  className="input-field" placeholder="p.sh. Magazina Kryesore"
                />
              </div>
              <div className="col-span-2">
                <label className="form-label">Adresa <span className="text-[10px] text-slate-400 dark:text-slate-500">(opsional)</span></label>
                <input
                  type="text" value={form.address}
                  onChange={e => set('address', e.target.value)}
                  className="input-field" placeholder="Rr., Nr., Qyteti"
                />
              </div>
              <div className="col-span-2">
                <label className="form-label">Shënime <span className="text-[10px] text-slate-400 dark:text-slate-500">(opsional)</span></label>
                <textarea
                  value={form.notes} onChange={e => set('notes', e.target.value)}
                  className="input-field resize-none" rows={2}
                />
              </div>
              {error && (
                <div className="col-span-2 text-sm text-red-600 bg-red-50 dark:bg-red-900/30 border border-red-200 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn-secondary">Anulo</button>
            <button type="submit" disabled={saving} className="btn-primary disabled:opacity-50">
              {saving ? '⏳' : (warehouse?.id ? '💾 Ruaj' : '+ Shto Magazinën')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function Magazinat() {
  const [warehouses, setWarehouses] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState(null)
  const [confirmDel, setConfirmDel] = useState(null)

  const load = useCallback(async () => {
    try {
      const data = await fetch('/api/warehouses').then(r => r.json())
      setWarehouses(Array.isArray(data) ? data : [])
    } catch (e) { console.error(e) }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const handleSave = async (data) => {
    const url = data.id ? `/api/warehouses/${data.id}` : '/api/warehouses'
    const method = data.id ? 'PUT' : 'POST'
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      const e = await res.json().catch(() => ({}))
      throw new Error(e.error || 'Gabim në ruajtje')
    }
    setModal(null)
    load()
  }

  const handleDelete = async (id) => {
    await fetch(`/api/warehouses/${id}`, { method: 'DELETE' })
    setConfirmDel(null)
    load()
  }

  const q = search.toLowerCase()
  const filtered = warehouses.filter(w => {
    if (!q) return true
    return [w.code, w.name, w.address].some(v => (v || '').toLowerCase().includes(q))
  })

  if (loading) {
    return <div className="card text-center py-16 text-slate-400 dark:text-slate-500">Duke ngarkuar magazinat...</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex-1 relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 text-sm pointer-events-none">🔍</span>
          <input
            type="text" placeholder="Kërko sipas kodit ose emrit..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="input-field pl-9"
          />
        </div>
        <button onClick={() => setModal('add')} className="btn-primary flex-shrink-0">+ Magazinë e Re</button>
      </div>

      <div className="card p-0 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-10 text-center">
            <div className="text-5xl mb-3">🏬</div>
            <p className="text-slate-500 dark:text-slate-400 mb-4">
              {warehouses.length === 0 ? 'Nuk ka magazina të regjistruara.' : 'Asnjë magazinë nuk përputhet me kërkimin.'}
            </p>
            {warehouses.length === 0 && (
              <button onClick={() => setModal('add')} className="btn-primary mx-auto">+ Shto Magazinën e Parë</button>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Kodi</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Emri</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Adresa</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Shënime</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Veprime</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(w => (
                <tr key={w.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-3 font-mono text-xs font-bold text-slate-800 dark:text-slate-100">{w.code}</td>
                  <td className="px-4 py-3 text-slate-800 dark:text-slate-100">{w.name || <span className="italic text-slate-400 dark:text-slate-500">—</span>}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{w.address || '—'}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300 text-xs">{w.notes || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1.5">
                      <button onClick={() => setModal(w)} className="px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 text-blue-600 text-xs font-medium">Edito</button>
                      <button onClick={() => setConfirmDel(w)} className="px-2.5 py-1 rounded-lg bg-red-50 dark:bg-red-900/30 hover:bg-red-100 text-red-600 text-xs font-medium">Fshi</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal && (
        <WarehouseModal
          warehouse={modal === 'add' ? null : modal}
          onClose={() => setModal(null)}
          onSave={handleSave}
        />
      )}

      {confirmDel && (
        <div className="modal-overlay">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-6 w-full max-w-sm">
            <div className="text-center">
              <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-4">🗑️</div>
              <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg mb-1">Fshi Magazinën?</h3>
              <p className="text-slate-500 dark:text-slate-400 text-sm mb-6">
                <strong className="text-slate-700 dark:text-slate-200">{confirmDel.code}</strong>
                {confirmDel.name && <> — {confirmDel.name}</>}
              </p>
              <div className="flex gap-3">
                <button onClick={() => setConfirmDel(null)} className="btn-secondary flex-1 justify-center">Anulo</button>
                <button onClick={() => handleDelete(confirmDel.id)}
                  className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg">
                  Fshi
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
