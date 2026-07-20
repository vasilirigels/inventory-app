import { useEffect, useState } from 'react'
import {
  getToken, getUser, clearSession, onAuthChange, installFetchInterceptor,
} from '../lib/auth.js'
import AuthSetup from './AuthSetup.jsx'
import AuthLogin from './AuthLogin.jsx'

installFetchInterceptor()

// Cikli i vendimit:
//   1) Kontrollo /api/auth/status → needsSetup?
//   2) Nëse ka token, valido me /api/auth/me
//   3) Nëse jo → shfaq Login (ose Setup nëse needsSetup)
export default function AuthGate({ children }) {
  const [phase, setPhase] = useState('boot') // 'boot' | 'setup' | 'login' | 'ready'
  const [user, setUser]   = useState(getUser())

  const bootstrap = async () => {
    setPhase('boot')
    try {
      const st = await fetch('/api/auth/status').then(r => r.json()).catch(() => null)
      if (st?.needsSetup) { setPhase('setup'); return }
      const tok = getToken()
      if (!tok) { setPhase('login'); return }
      const res = await fetch('/api/auth/me').catch(() => null)
      if (!res || !res.ok) { clearSession(); setPhase('login'); return }
      const data = await res.json()
      setUser(data.user)
      setPhase('ready')
    } catch {
      setPhase('login')
    }
  }

  useEffect(() => { bootstrap() }, [])
  useEffect(() => onAuthChange(() => {
    const u = getUser()
    setUser(u)
    if (!u) setPhase('login')
  }), [])

  if (phase === 'boot') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center text-slate-400">
          <div className="text-3xl mb-2 animate-pulse">💍</div>
          <p className="text-sm">Duke ngarkuar...</p>
        </div>
      </div>
    )
  }
  if (phase === 'setup') return <AuthSetup onDone={() => setPhase('login')} />
  if (phase === 'login') return <AuthLogin onLoggedIn={u => { setUser(u); setPhase('ready') }} />

  // 'ready' — kalon user te fëmijët
  return typeof children === 'function' ? children(user) : children
}
