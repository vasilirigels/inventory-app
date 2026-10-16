import { useEffect, useState } from 'react'

export default function ChangePasswordModal({ currentUser, onClose }) {
  const [users, setUsers] = useState([])
  const [targetId, setTargetId] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    fetch('/api/auth/users')
      .then(r => r.json())
      .then(d => {
        if (Array.isArray(d)) {
          setUsers(d)
          const self = d.find(u => u.id === currentUser?.id)
          setTargetId(String(self?.id || d[0]?.id || ''))
        }
      })
      .catch(() => setError('Gabim gjatë ngarkimit të përdoruesve.'))
  }, [currentUser])

  const submit = async (e) => {
    e.preventDefault()
    setError(''); setSuccess('')
    if (!targetId) { setError('Zgjidh një përdorues.'); return }
    if (!adminPassword) { setError('Vendos fjalëkalimin tënd aktual.'); return }
    if (newPassword.length < 4) { setError('Fjalëkalimi i ri duhet ≥ 4 karaktere.'); return }
    if (newPassword !== confirmPassword) { setError('Fjalëkalimi i ri dhe konfirmimi nuk përputhen.'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_user_id: parseInt(targetId),
          admin_password: adminPassword,
          new_password: newPassword,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.message || data.error || 'Gabim gjatë ndryshimit.')
      } else {
        setSuccess(`Fjalëkalimi u ndryshua për "${data.username}".`)
        setAdminPassword(''); setNewPassword(''); setConfirmPassword('')
      }
    } catch {
      setError('Gabim rrjeti.')
    } finally {
      setBusy(false)
    }
  }

  const target = users.find(u => u.id === parseInt(targetId))

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="p-6">
          <div className="w-14 h-14 bg-indigo-100 dark:bg-indigo-900/30 rounded-2xl flex items-center justify-center text-2xl mx-auto mb-4">🔑</div>
          <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 text-center mb-1">Ndrysho fjalëkalimin</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 text-center mb-5">Vetëm admin — veto ose shitës.</p>

          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="form-label">Përdoruesi</label>
              <select
                className="input-field w-full"
                value={targetId}
                onChange={e => setTargetId(e.target.value)}
                disabled={busy}
              >
                {users.map(u => (
                  <option key={u.id} value={u.id}>
                    {u.role === 'admin' ? '🔐' : u.role === 'viewer' ? '👁️' : '🧾'} {u.username} ({u.role === 'admin' ? 'Admin' : u.role === 'viewer' ? 'Shikim' : 'Shitës'})
                    {u.id === currentUser?.id ? ' — ti' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="form-label">Fjalëkalimi yt aktual (admin)</label>
              <input
                type="password"
                className="input-field w-full"
                value={adminPassword}
                onChange={e => setAdminPassword(e.target.value)}
                autoComplete="current-password"
                disabled={busy}
              />
            </div>

            <div>
              <label className="form-label">Fjalëkalimi i ri {target ? `për "${target.username}"` : ''}</label>
              <input
                type="password"
                className="input-field w-full"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                autoComplete="new-password"
                disabled={busy}
              />
            </div>

            <div>
              <label className="form-label">Konfirmo fjalëkalimin e ri</label>
              <input
                type="password"
                className="input-field w-full"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                disabled={busy}
              />
            </div>

            {error && (
              <div className="bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300 rounded-lg px-3 py-2 text-xs">
                {error}
              </div>
            )}
            {success && (
              <div className="bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 rounded-lg px-3 py-2 text-xs">
                {success}
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="flex-1 btn-secondary disabled:opacity-50"
              >Mbyll</button>
              <button
                type="submit"
                disabled={busy}
                className="flex-1 btn-primary disabled:opacity-50"
              >{busy ? 'Duke ruajtur...' : 'Ndrysho'}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
