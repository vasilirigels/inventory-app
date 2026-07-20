import { useCallback, useEffect, useRef, useState } from 'react'
import { getUser } from './auth.js'
import { useRealtimeSync } from '../hooks/useRealtimeSync.js'

// "Last read comment id" ruhet lokalisht — nuk kalon në server. Përkatësisht,
// nëse hap app-in në PC tjetër shënon si të palexuara pjesën e re, që është
// mirë (dallim vizual për user, jo detyrim server-side).
const KEY = 'unread_comments_last_id'

export function getLastReadCommentId() {
  return Number(localStorage.getItem(KEY) || 0)
}

const listeners = new Set()
function notify() { for (const l of listeners) l() }

export function setLastReadCommentId(id) {
  const prev = getLastReadCommentId()
  if (id > prev) localStorage.setItem(KEY, String(id))
  notify()
}

// Browser Notification API — kur admin/shitësi merr një koment të ri nga
// dikush tjetër ndërsa nuk është në faqen "Komentet", i shfaqet një njoftim
// i sistemit. Bandwidth i ulët (poll 15s), por për situatat multi-PC kjo
// është më e prekshme se një badge në sidebar.
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

function showCommentNotification(comment, extraCount) {
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
const POLL_MS = 5000

export function useUnreadCommentsCount() {
  const [count, setCount] = useState(0)
  // Id-ja më e madhe e komentit për të cilin kemi shfaqur notification-in.
  // Në load-in e parë e mbushim me maksimumin aktual që të mos njoftojmë
  // për komente ekzistuese; pastaj çdo id > kjo → notification.
  const lastNotifiedId = useRef(null)

  const refresh = useCallback(async () => {
    try {
      const me = getUser()
      const res = await fetch('/api/comments?limit=500')
      if (!res.ok) return
      const data = await res.json()
      const arr = Array.isArray(data) ? data : []
      const lastRead = getLastReadCommentId()
      const unread = arr.filter(c => c.id > lastRead && c.user_id !== me?.id).length
      setCount(unread)

      // Notification për komente të reja nga të tjerët.
      const maxId = arr.reduce((m, c) => Math.max(m, c.id), 0)
      if (lastNotifiedId.current === null) {
        lastNotifiedId.current = maxId
      } else if (maxId > lastNotifiedId.current) {
        const fresh = arr
          .filter(c => c.id > lastNotifiedId.current && c.user_id !== me?.id)
          .sort((a, b) => a.id - b.id)
        lastNotifiedId.current = maxId
        if (fresh.length > 0 && !(isOnKomentetPage() && document.visibilityState === 'visible')) {
          showCommentNotification(fresh[fresh.length - 1], fresh.length - 1)
        }
      }
    } catch (_) { /* offline / boot */ }
  }, [])

  // Kërko lejen për njoftime një herë kur user-i ka bërë login.
  useEffect(() => { requestNotifyPermission() }, [])

  useEffect(() => { refresh() }, [refresh])
  useRealtimeSync('comments', refresh)
  useEffect(() => {
    listeners.add(refresh)
    return () => { listeners.delete(refresh) }
  }, [refresh])

  // Poll periodik — kap komentet nga PC të tjera që WS lokal nuk i sheh.
  useEffect(() => {
    const id = setInterval(refresh, POLL_MS)
    // Rifresko menjëherë kur tabi kthehet aktiv (kursen kohën e pritjes).
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])

  return count
}
