import { useEffect, useState, useCallback } from 'react'

const EMPTY = { nipt: '', name: '', address: '', phone: '', notes: '' }

function SupplierModal({ supplier, onClose, onSave }) {
  const [form, setForm] = useState(() => supplier ? { ...EMPTY, ...supplier } : { ...EMPTY })
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const submit = (e) => {
    e.preventDefault()
    if (!form.name.trim() && !form.nipt.trim()) {
      alert('Plotësoni të paktën emrin ose NIPT-in.')
      return
    }
    onSave({ ...(supplier?.id ? { id: supplier.id } : {}), ...form })
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box">
        <div className="modal-header">
          <h3 className="font-bold text-slate-800 text-lg">
            {supplier?.id ? 'Edito Furnitorin' : 'Furnitor i Ri'}
          </h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 text-xl">×</button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="form-label">NIPT</label>
                <input type="text" value={form.nipt} onChange={e => set('nipt', e.target.value)}
                  className="input-field font-mono" placeholder="p.sh. L91234567A" autoFocus />
              </div>
              <div className="col-span-2">
                <label className="form-label">Emri i Subjektit</label>
                <input type="text" value={form.name} onChange={e => set('name', e.target.value)}
                  className="input-field" placeholder="p.sh. Italia Gold SHPK" />
              </div>
              <div className="col-span-2">
                <label className="form-label">Nr. Telefon</label>
                <input type="tel" value={form.phone} onChange={e => set('phone', e.target.value)}
                  className="input-field" placeholder="p.sh. +355 69 xxx xxxx" />
              </div>
              <div className="col-span-2">
                <label className="form-label">Adresa <span className="text-[10px] text-slate-400">(opsional)</span></label>
                <input type="text" value={form.address} onChange={e => set('address', e.target.value)}
                  className="input-field" placeholder="Rr., Nr., Qyteti" />
              </div>
              <div className="col-span-2">
                <label className="form-label">Shënime <span className="text-[10px] text-slate-400">(opsional)</span></label>
                <textarea value={form.notes} onChange={e => set('notes', e.target.value)}
                  className="input-field resize-none" rows={2} />
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn-secondary">Anulo</button>
            <button type="submit" className="btn-primary">
              {supplier?.id ? '💾 Ruaj' : '+ Shto Furnitor'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function Furnitor() {
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState(null)
  const [confirmDel, setConfirmDel] = useState(null)

  const load = useCallback(async () => {
    try {
      const data = await fetch('/api/suppliers').then(r => r.json())
      setSuppliers(Array.isArray(data) ? data : [])
    } catch (e) { console.error(e) }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const handleSave = async (data) => {
    const url = data.id ? `/api/suppliers/${data.id}` : '/api/suppliers'
    const method = data.id ? 'PUT' : 'POST'
    await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    setModal(null)
    load()
  }

  const handleDelete = async (id) => {
    await fetch(`/api/suppliers/${id}`, { method: 'DELETE' })
    setConfirmDel(null)
    load()
  }

  const q = search.toLowerCase()
  const filtered = suppliers.filter(s => {
    if (!q) return true
    return [s.nipt, s.name, s.phone, s.address].some(v => (v || '').toLowerCase().includes(q))
  })

  if (loading) {
    return <div className="card text-center py-16 text-slate-400">Duke ngarkuar furnitorët...</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex-1 relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">🔍</span>
          <input
            type="text" placeholder="Kërko sipas NIPT, emër, tel..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="input-field pl-9"
          />
        </div>
        <button onClick={() => setModal('add')} className="btn-primary flex-shrink-0">+ Furnitor i Ri</button>
      </div>

      <div className="card p-0 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-10 text-center">
            <div className="text-5xl mb-3">🏭</div>
            <p className="text-slate-500 mb-4">
              {suppliers.length === 0 ? 'Nuk ka furnitorë akoma.' : 'Asnjë furnitor nuk përputhet me kërkimin.'}
            </p>
            {suppliers.length === 0 && (
              <button onClick={() => setModal('add')} className="btn-primary mx-auto">+ Shto Furnitorin e Parë</button>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">NIPT</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Emri i Subjektit</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Telefoni</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Adresa</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase">Veprime</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(s => (
                <tr key={s.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">{s.nipt || '—'}</td>
                  <td className="px-4 py-3 font-medium text-slate-800">{s.name || <span className="italic text-slate-400">—</span>}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{s.phone || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{s.address || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1.5">
                      <button onClick={() => setModal(s)} className="px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 text-xs font-medium">Edito</button>
                      <button onClick={() => setConfirmDel(s)} className="px-2.5 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 text-xs font-medium">Fshi</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal && (
        <SupplierModal
          supplier={modal === 'add' ? null : modal}
          onClose={() => setModal(null)}
          onSave={handleSave}
        />
      )}

      {confirmDel && (
        <div className="modal-overlay">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
            <div className="text-center">
              <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-4">🗑️</div>
              <h3 className="font-bold text-slate-800 text-lg mb-1">Fshi Furnitorin?</h3>
              <p className="text-slate-500 text-sm mb-6">
                <strong className="text-slate-700">{confirmDel.name || confirmDel.nipt}</strong>
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
