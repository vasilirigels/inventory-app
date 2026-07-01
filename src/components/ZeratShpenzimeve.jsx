import { useEffect, useState, useCallback } from 'react'

const EMPTY = { name: '', description: '', active: 1 }

function CategoryModal({ category, onClose, onSave }) {
  const [form, setForm] = useState(() => category ? { ...EMPTY, ...category } : { ...EMPTY })
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const submit = (e) => {
    e.preventDefault()
    if (!form.name.trim()) { alert('Plotësoni emrin e zërit.'); return }
    onSave({ ...(category?.id ? { id: category.id } : {}), ...form })
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box">
        <div className="modal-header">
          <h3 className="font-bold text-slate-800 text-lg">
            {category?.id ? 'Edito Zërin' : 'Zëri i Ri Shpenzimi'}
          </h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 text-xl">×</button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body">
            <div className="space-y-3">
              <div>
                <label className="form-label">Emri i Zërit *</label>
                <input
                  type="text" value={form.name}
                  onChange={e => set('name', e.target.value)}
                  className="input-field" placeholder="p.sh. Energji, Qera, Internet, Karburant..." autoFocus
                />
              </div>
              <div>
                <label className="form-label">Përshkrim</label>
                <textarea
                  value={form.description}
                  onChange={e => set('description', e.target.value)}
                  className="input-field resize-none" rows={2} placeholder="opsional"
                />
              </div>
              {category?.id && (
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={!!form.active} onChange={e => set('active', e.target.checked ? 1 : 0)} />
                  Aktiv (i përdorshëm te fleta e shpenzimeve)
                </label>
              )}
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn-secondary">Anulo</button>
            <button type="submit" className="btn-primary">
              {category?.id ? '💾 Ruaj' : '+ Shto Zërin'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function ZeratShpenzimeve() {
  const [items, setItems]   = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [modal, setModal]   = useState(null)
  const [confirmDel, setConfirmDel] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    fetch('/api/expense-categories?all=1')
      .then(r => r.json())
      .then(d => { setItems(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => { setItems([]); setLoading(false) })
  }, [])

  useEffect(() => { load() }, [load])

  const save = async (data) => {
    const isEdit = !!data.id
    const url = isEdit ? `/api/expense-categories/${data.id}` : '/api/expense-categories'
    const method = isEdit ? 'PUT' : 'POST'
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e.error || 'Gabim'); return }
    setModal(null)
    load()
  }

  const remove = async (id) => {
    await fetch(`/api/expense-categories/${id}`, { method: 'DELETE' })
    setConfirmDel(null)
    load()
  }

  const q = search.toLowerCase().trim()
  const filtered = !q ? items : items.filter(i =>
    (i.name || '').toLowerCase().includes(q) || (i.description || '').toLowerCase().includes(q)
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Zërat e Shpenzimeve</h2>
          <p className="text-xs text-slate-500">Regjistri i kategorive të shpenzimit (përdoren te Fleta e Shpenzimeve)</p>
        </div>
        <button onClick={() => setModal('add')} className="btn-primary">+ Zëri i Ri</button>
      </div>

      <div className="card">
        <input
          type="text" value={search} onChange={e => setSearch(e.target.value)}
          className="input-field" placeholder="Kërko zër..."
        />
      </div>

      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-400 text-sm">Duke ngarkuar...</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center">
            <div className="text-5xl mb-3">🧾</div>
            <p className="text-slate-500 mb-4">
              {items.length === 0 ? 'Nuk ka zëra shpenzimi të regjistruar.' : 'Asnjë zër nuk përputhet me kërkimin.'}
            </p>
            {items.length === 0 && (
              <button onClick={() => setModal('add')} className="btn-primary mx-auto">+ Krijo Zërin e Parë</button>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Emri</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Përshkrim</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase">Status</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase">Veprime</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">{c.name}</td>
                  <td className="px-4 py-3 text-slate-600 text-xs">{c.description || <span className="italic text-slate-400">—</span>}</td>
                  <td className="px-4 py-3 text-center">
                    {c.active
                      ? <span className="badge badge-green">Aktiv</span>
                      : <span className="badge badge-slate">Joaktiv</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => setModal(c)} className="px-2 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 text-[11px] font-medium">Edito</button>
                      <button onClick={() => setConfirmDel(c)} className="px-2 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 text-[11px] font-medium">Fshi</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal && (
        <CategoryModal
          category={modal === 'add' ? null : modal}
          onClose={() => setModal(null)}
          onSave={save}
        />
      )}

      {confirmDel && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setConfirmDel(null)}>
          <div className="modal-box max-w-md">
            <div className="modal-header"><h3 className="font-bold text-slate-800">Konfirmo fshirjen</h3></div>
            <div className="modal-body">
              <p className="text-sm text-slate-600">
                Fshi zërin <span className="font-semibold">{confirmDel.name}</span>?
                Zërat ekzistues te fletët ditore do të mbeten, por pa kategori.
              </p>
            </div>
            <div className="modal-footer">
              <button onClick={() => setConfirmDel(null)} className="btn-secondary">Anulo</button>
              <button onClick={() => remove(confirmDel.id)} className="btn-danger">Fshi</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
