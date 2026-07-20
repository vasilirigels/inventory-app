// Auth store i thjeshtë + wrapper i fetch-it që injekton Authorization header.
// Përdoret nga AuthGate dhe useAuth() në komponentet.

const TOKEN_KEY = 'auth_token'
const USER_KEY  = 'auth_user'

const listeners = new Set()
function notify() { for (const l of listeners) l() }

export function getToken() { return localStorage.getItem(TOKEN_KEY) }
export function getUser()  {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null') } catch { return null }
}
export function setSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
  notify()
}
export function clearSession() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
  notify()
}
export function onAuthChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// Wrap window.fetch një herë të vetme që të gjitha thirrjet /api/... të kenë
// Authorization: Bearer <token> dhe të reagojnë ndaj 401.
let installed = false
export function installFetchInterceptor() {
  if (installed) return
  installed = true
  const orig = window.fetch.bind(window)
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : (input?.url || '')
    const isApi = url.startsWith('/api/')
    let opts = init
    if (isApi) {
      const token = getToken()
      if (token) {
        opts = { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } }
      }
    }
    const res = await orig(input, opts)
    // 401 nga një endpoint jo-auth → token skaduar, pastro session.
    if (res.status === 401 && isApi && !url.startsWith('/api/auth/')) {
      clearSession()
    }
    return res
  }
}
