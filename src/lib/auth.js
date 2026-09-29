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
// Rol 'viewer' — vetëm shikim. Përdoret te komponentet për të fshehur butonat
// e modifikimit/fshirjes që nga UI-ja (backend-i i bllokon si backup).
export function isViewer()  { return getUser()?.role === 'viewer' }
export function canWrite()  { return getUser()?.role !== 'viewer' }
export function isSales()   { return getUser()?.role === 'sales' }

// Data minimale që një shitës mund të shohë (30 ditë duke përfshirë sot).
// Kthen YYYY-MM-DD, ose undefined për role të tjerë (pa kufizim).
// Përdoret te date-input min attributes dhe DateRangeFilter minFrom.
export const SALES_DAYS_BACK = 30
export function getSalesMinDate() {
  if (!isSales()) return undefined
  const d = new Date()
  d.setDate(d.getDate() - (SALES_DAYS_BACK - 1))
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
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

// Toast i thjeshtë (throttled) që shfaqet kur viewer tenton një shkrim.
// Regjistrohet një herë; DOM-elementi ripërdoret.
let readonlyToastEl = null
let readonlyToastTimer = null
let lastToastAt = 0
function showReadOnlyToast() {
  const now = Date.now()
  if (now - lastToastAt < 1500) return // throttle
  lastToastAt = now
  if (!readonlyToastEl) {
    readonlyToastEl = document.createElement('div')
    readonlyToastEl.style.cssText = [
      'position:fixed', 'left:50%', 'top:24px', 'transform:translateX(-50%)',
      'background:#dc2626', 'color:#fff', 'padding:12px 20px',
      'border-radius:12px', 'font-weight:600', 'font-size:14px',
      'box-shadow:0 10px 25px rgba(0,0,0,.25)', 'z-index:99999',
      'pointer-events:none', 'transition:opacity .2s',
    ].join(';')
    readonlyToastEl.textContent = '👁️ Vetëm shikim — nuk mund të bësh ndryshime'
    document.body.appendChild(readonlyToastEl)
  }
  readonlyToastEl.style.opacity = '1'
  clearTimeout(readonlyToastTimer)
  readonlyToastTimer = setTimeout(() => {
    if (readonlyToastEl) readonlyToastEl.style.opacity = '0'
  }, 2500)
}

// Wrap window.fetch — ruaj fetch-in ORIGJINAL veças që re-installimi pas HMR-së
// të mos e wrap-ojë kaskadë. Për rolin 'viewer', bllokon çdo shkrim (POST/PUT
// /PATCH/DELETE) para se të prekë rrjetin — kthen 403 sintetik dhe shfaq toast.
let originalFetch = null
export function installFetchInterceptor() {
  if (!originalFetch) originalFetch = window.fetch.bind(window)
  const orig = originalFetch
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : (input?.url || '')
    const isApi = url.startsWith('/api/')
    const method = String(init.method || 'GET').toUpperCase()

    // Viewer read-only guard: bllokon shkrimet me 403 sintetik, pa network call.
    if (isApi && !url.startsWith('/api/auth/') && isViewer()
        && method !== 'GET' && method !== 'OPTIONS' && method !== 'HEAD') {
      showReadOnlyToast()
      return new Response(JSON.stringify({ error: 'readonly' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    }

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
