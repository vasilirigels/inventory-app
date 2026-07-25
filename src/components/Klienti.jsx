import { useEffect, useState, useCallback } from 'react'

const EMPTY = { nipt: '', first_name: '', last_name: '', address: '', phone: '', notes: '' }

function ClientModal({ client, onClose, onSave }) {
  const [form, setForm] = useState(() => client ? { ...EMPTY, ...client } : { ...EMPTY })
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const submit = (e) => {
    e.preventDefault()
    if (!form.first_name.trim() && !form.last_name.trim() && !form.nipt.trim()) {
      alert('Plotësoni të paktën emrin, mbiemrin ose NIPT-in.')
      return
    }
    onSave({ ...(client?.id ? { id: client.id } : {}), ...form })
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box">
        <div className="modal-header">
          <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">
            {client?.id ? 'Edito Klientin' : 'Klient i Ri'}
          </h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 dark:text-slate-500 text-xl">×</button>
        </div>

        <form onSubmit={submit}>
          <div className="modal-body">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="form-label">NIPT</label>
                <input type="text" value={form.nipt} onChange={e => set('nipt', e.target.value)}
                  className="input-field font-mono" placeholder="p.sh. L91234567A" autoFocus />
              </div>
              <div>
                <label className="form-label">Emër</label>
                <input type="text" value={form.first_name} onChange={e => set('first_name', e.target.value)}
                  className="input-field" placeholder="p.sh. Arben" />
              </div>
              <div>
                <label className="form-label">Mbiemër</label>
                <input type="text" value={form.last_name} onChange={e => set('last_name', e.target.value)}
                  className="input-field" placeholder="p.sh. Hoxha" />
              </div>
              <div className="col-span-2">
                <label className="form-label">Adresa</label>
                <input type="text" value={form.address} onChange={e => set('address', e.target.value)}
                  className="input-field" placeholder="Rr., Nr., Qyteti" />
              </div>
              <div className="col-span-2">
                <label className="form-label">Nr. Telefon</label>
                <input type="tel" value={form.phone} onChange={e => set('phone', e.target.value)}
                  className="input-field" placeholder="p.sh. +355 69 xxx xxxx" />
              </div>
              <div className="col-span-2">
                <label className="form-label">Shënime</label>
                <textarea value={form.notes} onChange={e => set('notes', e.target.value)}
                  className="input-field resize-none" rows={2} placeholder="opsional" />
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn-secondary">Anulo</button>
            <button type="submit" className="btn-primary">
              {client?.id ? '💾 Ruaj' : '+ Shto Klient'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function Klienti() {
  const [clients, setClients]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [modal, setModal]       = useState(null)  // null | 'add' | client
  const [confirmDel, setConfirmDel] = useState(null)

  const load = useCallback(async () => {
    try {
      const data = await fetch('/api/clients').then(r => r.json())
      setClients(Array.isArray(data) ? data : [])
    } catch (e) { console.error(e) }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const handleSave = async (data) => {
    try {
      const url = data.id ? `/api/clients/${data.id}` : '/api/clients'
      const method = data.id ? 'PUT' : 'POST'
      await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      setModal(null)
      load()
    } catch (e) { console.error(e) }
  }

  const handleDelete = async (id) => {
    await fetch(`/api/clients/${id}`, { method: 'DELETE' })
    setConfirmDel(null)
    load()
  }

  const q = search.toLowerCase()
  const filtered = clients.filter(c => {
    if (!q) return true
    return [c.nipt, c.first_name, c.last_name, c.phone, c.address].some(
      v => (v || '').toLowerCase().includes(q)
    )
  })

  if (loading) {
    return <div className="card text-center py-16 text-slate-400 dark:text-slate-500">Duke ngarkuar klientët...</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex-1 relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 text-sm pointer-events-none">🔍</span>
          <input
            type="text" placeholder="Kërko sipas NIPT, emër, mbiemër, tel..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="input-field pl-9"
          />
        </div>
        <button onClick={() => setModal('add')} className="btn-primary flex-shrink-0">
          + Klient i Ri
        </button>
      </div>

      <div className="card p-0 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-10 text-center">
            <div className="text-5xl mb-3">👥</div>
            <p className="text-slate-500 dark:text-slate-400 mb-4">
              {clients.length === 0 ? 'Nuk ka klientë akoma.' : 'Asnjë klient nuk përputhet me kërkimin.'}
            </p>
            {clients.length === 0 && (
              <button onClick={() => setModal('add')} className="btn-primary mx-auto">+ Shto Klientin e Parë</button>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">NIPT</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Emër Mbiemër</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Adresa</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Telefon</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Veprime</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-3 font-mono text-xs text-slate-700 dark:text-slate-200">{c.nipt || '—'}</td>
                  <td className="px-4 py-3 text-slate-800 dark:text-slate-100 font-medium">
                    {[c.first_name, c.last_name].filter(Boolean).join(' ') || <span className="text-slate-400 dark:text-slate-500 italic">—</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{c.address || '—'}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300 font-mono text-xs">{c.phone || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1.5">
                      <button onClick={() => setModal(c)} className="px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 text-blue-600 text-xs font-medium">Edito</button>
                      <button onClick={() => setConfirmDel(c)} className="px-2.5 py-1 rounded-lg bg-red-50 dark:bg-red-900/30 hover:bg-red-100 text-red-600 text-xs font-medium">Fshi</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal && (
        <ClientModal
          client={modal === 'add' ? null : modal}
          onClose={() => setModal(null)}
          onSave={handleSave}
        />
      )}

      {confirmDel && (
        <div className="modal-overlay">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-6 w-full max-w-sm">
            <div className="text-center">
              <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-4">🗑️</div>
              <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg mb-1">Fshi Klientin?</h3>
              <p className="text-slate-500 dark:text-slate-400 text-sm mb-6">
                <strong className="text-slate-700 dark:text-slate-200">
                  {[confirmDel.first_name, confirmDel.last_name].filter(Boolean).join(' ') || confirmDel.nipt}
                </strong>
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
