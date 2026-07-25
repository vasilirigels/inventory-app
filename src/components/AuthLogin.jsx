import { useState } from 'react'
import { setSession } from '../lib/auth.js'

export default function AuthLogin({ onLoggedIn }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const submit = async e => {
    e.preventDefault()
    setErr('')
    setSaving(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (data.error === 'invalid_credentials') throw new Error('Username ose password i gabuar.')
        throw new Error(data.error || 'Gabim')
      }
      setSession(data.token, data.user)
      onLoggedIn?.(data.user)
    } catch (ex) {
      setErr(ex.message || 'Gabim')
    } finally { setSaving(false) }
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center p-4">
      <div className="card w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="text-4xl mb-2">💍</div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Gold Shop</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Hyr në llogari</p>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="form-label">Username</label>
            <input value={username} onChange={e => setUsername(e.target.value)}
              className="input-field" autoFocus required />
          </div>
          <div>
            <label className="form-label">Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              className="input-field" required />
          </div>
          {err && <p className="text-sm text-rose-600">⚠ {err}</p>}
          <button type="submit" disabled={saving} className="btn-primary w-full justify-center">
            {saving ? '⏳ Duke hyrë...' : 'Hyr'}
          </button>
        </form>
      </div>
    </div>
  )
}
