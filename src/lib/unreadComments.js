import { useCallback, useEffect, useRef, useState } from 'react'
import { getUser } from './auth.js'
import { useRealtimeSync } from '../hooks/useRealtimeSync.js'

// "Last read comment id" ruhet lokalisht për çdo user veç e veç. Kështu, kur
// një PC përdoret nga role të ndryshëm (p.sh. shitësi shkruan, admin bën
// login më vonë), admin-i sheh si "të palexuara" komentet që erdhën ndërsa
// nuk ishte këtu — pa u ndikuar nga leximi i shitësit.
const KEY_PREFIX = 'unread_comments_last_id_'
function keyFor(userId) {
  return `${KEY_PREFIX}${userId || 'anon'}`
}

export function getLastReadCommentId() {
  const me = getUser()
  return Number(localStorage.getItem(keyFor(me?.id)) || 0)
}

const listeners = new Set()
function notify() { for (const l of listeners) l() }

export function setLastReadCommentId(id) {
  const prev = getLastReadCommentId()
  if (id > prev) {
    const me = getUser()
    localStorage.setItem(keyFor(me?.id), String(id))
  }
  notify()
}

// ── Njoftime në aplikacion (toast) — nuk varet nga leja e OS ────────────────
// Pushojmë njoftimet e reja në një listë; Layout tërheq element-in e parë me
// hook-un `useCommentToast()` dhe e shfaq si banner në cep të lart-djathtë.
const toastQueue = []
const toastListeners = new Set()
function notifyToast() { for (const l of toastListeners) l() }

function enqueueToast(comment) {
  const t = {
    id: comment.id,
    username: comment.username || 'përdorues',
    body: String(comment.body || '').slice(0, 200),
    at: Date.now(),
  }
  toastQueue.push(t)
  notifyToast()
}

export function dismissCommentToast(id) {
  const idx = toastQueue.findIndex(t => t.id === id)
  if (idx >= 0) { toastQueue.splice(idx, 1); notifyToast() }
}

export function useCommentToasts() {
  const [, tick] = useState(0)
  useEffect(() => {
    const l = () => tick(x => x + 1)
    toastListeners.add(l)
    return () => { toastListeners.delete(l) }
  }, [])
  return [...toastQueue]
}

// ── Zë i shkurtër kur mbërrin një koment i ri (Web Audio, pa file) ─────────
let audioCtx = null
function playPing() {
  try {
    if (typeof window === 'undefined') return
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    audioCtx = audioCtx || new AC()
    const now = audioCtx.currentTime
    const o = audioCtx.createOscillator()
    const g = audioCtx.createGain()
    o.type = 'sine'
    o.frequency.setValueAtTime(880, now)
    o.frequency.exponentialRampToValueAtTime(1320, now + 0.12)
    g.gain.setValueAtTime(0.0001, now)
    g.gain.exponentialRampToValueAtTime(0.18, now + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.35)
    o.connect(g); g.connect(audioCtx.destination)
    o.start(now)
    o.stop(now + 0.4)
  } catch (_) { /* audio bllokuar nga browser-i deri sa user të klikojë */ }
}

// ── Browser Notification API — nëse leja jepet, shfaqim edhe njoftim OS ────
function canNotify() {
  return typeof window !== 'undefined'
    && 'Notification' in window
    && Notification.permission === 'granted'
}

function requestNotifyPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) return
  if (Notification.permission === 'default') {
    try { Notification.requestPermission().catch(() => {}) } catch (_) {}
  }
}

function isOnKomentetPage() {
  if (typeof window === 'undefined') return false
  const h = window.location.hash || ''
  return h === '#/komentet' || h === '#komentet'
}

function showOsNotification(comment, extraCount) {
  if (!canNotify()) return
  const title = extraCount > 0
    ? `${extraCount + 1} komente të reja`
    : `Koment i ri nga ${comment.username || 'përdorues'}`
  const body = extraCount > 0
    ? `${comment.username}: ${String(comment.body || '').slice(0, 120)}`
    : String(comment.body || '').slice(0, 200)
  try {
    const n = new Notification(title, { body, tag: 'komentet' })
    n.onclick = () => {
      try {
        window.focus()
        window.location.hash = '#/komentet'
        n.close()
      } catch (_) {}
    }
  } catch (_) {}
}

// Hook: numëron komentet e palexuara (të tjerëve, jo tuajat).
// Realtime WebSocket funksionon vetëm brenda PC-së të njëjtë (çdo PC ka
// serverin e vet Express + WS lokal); prandaj shtojmë edhe një poll periodik
// që të kapim komente të reja që vijnë nga user-a në PC të tjera (databaza
// Turso është e përbashkët, por broadcast-i i WS jo).
//
// Adaptive polling — intervali ndryshon sipas aktivitetit të fundit:
//   • <60s pas aktivitetit (chat live)   → poll çdo 2s   (perceptohet instant)
//   • <10 min pas aktivitetit (normal)   → poll çdo 10s
//   • idle >10 min                        → poll çdo 30s  (kursen Turso reads)
// Aktivitet = dërgim mesazhi, hapja e Komenteve, fokus në input, ose marrja
// e një komenti të ri. Reset-ohet nga signalChatActivity().
const POLL_FAST = 2_000
const POLL_NORMAL = 10_000
const POLL_IDLE = 30_000
const WINDOW_FAST = 60_000       // 1 min pas aktivitetit = fast
const WINDOW_NORMAL = 10 * 60_000 // 10 min pas aktivitetit = normal

let lastActivityTs = 0
export function signalChatActivity() {
  lastActivityTs = Date.now()
}
export function getNextPollInterval() {
  const elapsed = Date.now() - lastActivityTs
  if (elapsed < WINDOW_FAST) return POLL_FAST
  if (elapsed < WINDOW_NORMAL) return POLL_NORMAL
  return POLL_IDLE
}

export function useUnreadCommentsCount() {
  const [count, setCount] = useState(0)
  // Id-ja më e madhe e komentit për të cilin kemi shfaqur notification-in.
  // Në load-in e parë e mbushim me maksimumin aktual që të mos njoftojmë
  // për komente ekzistuese; pastaj çdo id > kjo → notification.
  const lastNotifiedId = useRef(null)
  // Id-ja më e madhe që kemi parë deri tani. Përdoret nga poll i lehtë — kur
  // MAX(id) nga serveri është <= knownMaxId, s'ka nevojë të bëjmë fetch të
  // plotë. Kur është më i madh, thirret refresh().
  const knownMaxId = useRef(0)

  const refresh = useCallback(async () => {
    try {
      const me = getUser()
      const res = await fetch('/api/comments?limit=500')
      if (!res.ok) return
      const data = await res.json()
      const arr = Array.isArray(data) ? data : []
      const lastRead = getLastReadCommentId()
      const unreadArr = arr.filter(c => c.id > lastRead && c.user_id !== me?.id)
      setCount(unreadArr.length)

      const maxId = arr.reduce((m, c) => Math.max(m, c.id), 0)
      knownMaxId.current = maxId
      const suppress = isOnKomentetPage() && document.visibilityState === 'visible'

      if (lastNotifiedId.current === null) {
        // Load i parë (p.sh. sapo bëri login): njofto për komentet e palexuara
        // që kanë ardhur ndërsa user-i nuk ishte këtu. Këtë e bëjmë vetëm nëse
        // ai s'është aktualisht te faqja e komenteve.
        lastNotifiedId.current = maxId
        if (unreadArr.length > 0 && !suppress) {
          const sorted = [...unreadArr].sort((a, b) => a.id - b.id)
          // Për të mos mbytur me toast-e — shfaq maksimum 3 më të fundit.
          for (const c of sorted.slice(-3)) enqueueToast(c)
          playPing()
          showOsNotification(sorted[sorted.length - 1], sorted.length - 1)
        }
      } else if (maxId > lastNotifiedId.current) {
        const fresh = arr
          .filter(c => c.id > lastNotifiedId.current && c.user_id !== me?.id)
          .sort((a, b) => a.id - b.id)
        lastNotifiedId.current = maxId
        if (fresh.length > 0 && !suppress) {
          for (const c of fresh) enqueueToast(c)
          playPing()
          showOsNotification(fresh[fresh.length - 1], fresh.length - 1)
        }
      }
    } catch (_) { /* offline / boot */ }
  }, [])

  // Poll i lehtë — pyet vetëm MAX(id). Nëse ndryshon, bëj fetch incremental
  // (vetëm komentet pas knownMaxId) — zakonisht 1-3 rreshta/komente të reja në
  // vend të 500. Shumë më lirë në Turso reads.
  const pollLight = useCallback(async () => {
    try {
      const res = await fetch('/api/comments/latest-id')
      if (!res.ok) return
      const { id } = await res.json()
      if ((id || 0) > knownMaxId.current) {
        await fetchIncremental()
      }
    } catch (_) { /* offline / boot */ }
  }, [])

  // Merr vetëm komentet më të reja se ai që njohim. S'kalon përmes `refresh()`
  // që tërheq 500 rreshta — thjesht i shton (ose zëvendëson duplikatet) listës
  // dhe triggeron notification-et për kometet e reja të lexuesit.
  const fetchIncremental = useCallback(async () => {
    try {
      const me = getUser()
      const since = knownMaxId.current || 0
      const res = await fetch(`/api/comments/since?id=${since}`)
      if (!res.ok) return
      const fresh = await res.json()
      if (!Array.isArray(fresh) || fresh.length === 0) return
      const maxId = fresh.reduce((m, c) => Math.max(m, c.id), knownMaxId.current)
      knownMaxId.current = maxId
      const lastRead = getLastReadCommentId()
      // Rifresko count-in me shumën aktuale të palexuarve; count-in e saktë
      // s'mund ta rrisim thjesht me fresh.length sepse disa mund të jenë nga vetja.
      const unreadNew = fresh.filter(c => c.id > lastRead && c.user_id !== me?.id)
      if (unreadNew.length > 0) setCount(c => c + unreadNew.length)
      const suppress = isOnKomentetPage() && document.visibilityState === 'visible'
      const toNotify = fresh.filter(c => c.id > (lastNotifiedId.current ?? 0) && c.user_id !== me?.id)
                            .sort((a, b) => a.id - b.id)
      lastNotifiedId.current = maxId
      if (toNotify.length > 0 && !suppress) {
        for (const c of toNotify) enqueueToast(c)
        playPing()
        showOsNotification(toNotify[toNotify.length - 1], toNotify.length - 1)
      }
      // Komenti i ri ri-nis dritaren e aktivitetit — kështu polling vazhdon te
      // shpejtë për 1 min, duke kapur përgjigjet në kohë reale.
      if (toNotify.length > 0) signalChatActivity()
    } catch (_) { /* offline */ }
  }, [])

  // Kërko lejen për njoftime një herë kur user-i ka bërë login.
  useEffect(() => { requestNotifyPermission() }, [])

  useEffect(() => { refresh() }, [refresh])
  useRealtimeSync('comments', refresh)
  useEffect(() => {
    listeners.add(refresh)
    return () => { listeners.delete(refresh) }
  }, [refresh])

  // Poll adaptiv — rescheduleon vetveten me interval sipas aktivitetit.
  // setTimeout + reschedule (jo setInterval) sepse intervali ndryshon dinamikisht.
  useEffect(() => {
    let timer = null
    let stopped = false
    const tick = async () => {
      if (stopped) return
      await pollLight()
      if (stopped) return
      timer = setTimeout(tick, getNextPollInterval())
    }
    timer = setTimeout(tick, getNextPollInterval())
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      signalChatActivity() // kthimi te tabi është sinjal aktiviteti
      pollLight()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [pollLight])

  return count
}
