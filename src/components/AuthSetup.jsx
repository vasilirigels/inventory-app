import { useState } from 'react'

// Ekrani i setup-it të parë — pranon vetëm nëse tabela users është bosh.
// Krijon njëherazi admin + sales, pastaj njofton parent-in.
export default function AuthSetup({ onDone }) {
  const [adminU, setAdminU] = useState('admin')
  const [adminP, setAdminP] = useState('')
  const [adminP2, setAdminP2] = useState('')
  const [salesU, setSalesU] = useState('shites')
  const [salesP, setSalesP] = useState('')
  const [salesP2, setSalesP2] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const submit = async e => {
    e.preventDefault()
    setErr('')
    if (adminP !== adminP2)  return setErr('Passwordet e admin nuk përputhen.')
    if (salesP !== salesP2)  return setErr('Passwordet e shitësit nuk përputhen.')
    if (adminP.length < 4)   return setErr('Passwordi i admin duhet të ketë ≥ 4 karaktere.')
    if (salesP.length < 4)   return setErr('Passwordi i shitësit duhet të ketë ≥ 4 karaktere.')
    if (adminU.trim() === salesU.trim()) return setErr('Username-t duhet të ndryshojnë.')
    setSaving(true)
    try {
      const res = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          admin_username: adminU.trim(),
          admin_password: adminP,
          sales_username: salesU.trim(),
          sales_password: salesP,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Gabim')
      onDone?.()
    } catch (ex) {
      setErr(ex.message || 'Gabim')
    } finally { setSaving(false) }
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center p-4">
      <div className="card w-full max-w-lg">
        <div className="text-center mb-6">
          <div className="text-4xl mb-2">💍</div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Cham Shop — Konfigurim Fillestar</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Krijo dy përdorues: admin dhe shitës. Ky ekran shfaqet vetëm një herë.</p>
        </div>
        <form onSubmit={submit} className="space-y-6">
          <fieldset className="border border-slate-200 dark:border-slate-700 rounded-xl p-4">
            <legend className="px-2 text-sm font-semibold text-slate-700 dark:text-slate-200">🔐 Admin (akses i plotë)</legend>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="form-label">Username</label>
                <input value={adminU} onChange={e => setAdminU(e.target.value)} className="input-field" required />
              </div>
              <div />
              <div>
                <label className="form-label">Password</label>
                <input type="password" value={adminP} onChange={e => setAdminP(e.target.value)} className="input-field" required />
              </div>
              <div>
                <label className="form-label">Përsërit Password</label>
                <input type="password" value={adminP2} onChange={e => setAdminP2(e.target.value)} className="input-field" required />
              </div>
            </div>
          </fieldset>
          <fieldset className="border border-slate-200 dark:border-slate-700 rounded-xl p-4">
            <legend className="px-2 text-sm font-semibold text-slate-700 dark:text-slate-200">🧾 Shitës (akses i kufizuar)</legend>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="form-label">Username</label>
                <input value={salesU} onChange={e => setSalesU(e.target.value)} className="input-field" required />
              </div>
              <div />
              <div>
                <label className="form-label">Password</label>
                <input type="password" value={salesP} onChange={e => setSalesP(e.target.value)} className="input-field" required />
              </div>
              <div>
                <label className="form-label">Përsërit Password</label>
                <input type="password" value={salesP2} onChange={e => setSalesP2(e.target.value)} className="input-field" required />
              </div>
            </div>
          </fieldset>
          {err && <p className="text-sm text-rose-600 text-center">⚠ {err}</p>}
          <button type="submit" disabled={saving} className="btn-primary w-full justify-center">
            {saving ? '⏳ Duke krijuar...' : 'Krijo Përdoruesit'}
          </button>
        </form>
      </div>
    </div>
  )
}
