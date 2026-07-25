import { useCallback, useEffect, useRef, useState } from 'react'
import { getUser } from '../lib/auth.js'
import { setLastReadCommentId } from '../lib/unreadComments.js'
import { useRealtimeSync } from '../hooks/useRealtimeSync.js'

// Chat i brendshëm — çdo përdorues shikon të njëjtat mesazhe, dhe realtime
// sync-i i freskon menjëherë kur dikush tjetër shkruan diçka.

function formatTs(ts) {
  if (!ts) return ''
  // libSQL kthen 'YYYY-MM-DD HH:MM:SS' pa timezone → trajtoje si UTC.
  const iso = ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z'
  const d = new Date(iso)
  if (isNaN(d)) return ts
  return d.toLocaleString('sq-AL', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function initials(name) {
  const s = String(name || '').trim()
  if (!s) return '?'
  const parts = s.split(/\s+/)
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase()
}

// Ngjyrë e qëndrueshme për çdo emër përdoruesi — nga një paletë fikse.
const AVATAR_COLORS = [
  'bg-rose-500', 'bg-orange-500', 'bg-amber-500', 'bg-emerald-500',
  'bg-teal-500', 'bg-sky-500', 'bg-indigo-500', 'bg-violet-500',
  'bg-fuchsia-500', 'bg-pink-500',
]
function avatarColor(name) {
  const s = String(name || '')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

export default function Komentet() {
  const me = getUser()
  const [messages, setMessages] = useState([])
  const [loading, setLoading]   = useState(true)
  const [text, setText]         = useState('')
  const [sending, setSending]   = useState(false)
  const [confirmDel, setConfirmDel] = useState(null)
  const scrollRef = useRef(null)
  const wasNearBottom = useRef(true)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/comments?limit=500')
      const data = await res.json()
      const arr = Array.isArray(data) ? data : []
      setMessages(arr)
      // Sapo user hap faqen ose merr mesazh të ri ndërsa është këtu, e shënojmë
      // id-në më të lartë si të lexuar — badge-i i kuq pastrohet menjëherë.
      const maxId = arr.reduce((m, c) => Math.max(m, c.id), 0)
      if (maxId > 0) setLastReadCommentId(maxId)
    } catch (_) {
      setMessages([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  useRealtimeSync('comments', load)

  // Poll periodik — WS lokal nuk sheh komente të postuara nga PC të tjera
  // (secili PC ka serverin e vet Express); polling e mbush këtë hendek pa
  // ndryshuar arkitekturën. 10s është mjaftueshëm i shpejtë për një chat.
  useEffect(() => {
    const id = setInterval(load, 10000)
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  // Ruaj pozicionin: nëse user-i është poshtë, e mbajmë poshtë kur vijnë mesazhe;
  // nëse është duke lexuar lart, nuk e zhvendosim.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (wasNearBottom.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    wasNearBottom.current = (el.scrollHeight - el.scrollTop - el.clientHeight) < 80
  }

  const send = async (e) => {
    e?.preventDefault?.()
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    try {
      const res = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        alert(e.error || 'Nuk u dërgua')
        return
      }
      setText('')
      wasNearBottom.current = true
      // Rifresko lokalisht; realtime do ta rifreskojë edhe te userat e tjerë.
      load()
    } finally {
      setSending(false)
    }
  }

  const remove = async (id) => {
    try {
      const res = await fetch(`/api/comments/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        alert(e.error || 'Nuk u fshi')
        return
      }
      setConfirmDel(null)
      load()
    } catch (_) {
      setConfirmDel(null)
    }
  }

  // Enter dërgo, Shift+Enter shkon në rresht të ri.
  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="flex flex-col h-full max-h-full">
      <div className="mb-3">
        <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">Komentet</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Chat i brendshëm midis përdoruesve — të gjithë e shikojnë e mund të shkruajnë.
        </p>
      </div>

      <div className="card p-0 flex-1 min-h-0 flex flex-col overflow-hidden">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50 dark:bg-slate-900"
        >
          {loading ? (
            <div className="text-center text-slate-400 dark:text-slate-500 text-sm py-8">Duke ngarkuar…</div>
          ) : messages.length === 0 ? (
            <div className="text-center py-16">
              <div className="text-5xl mb-3">💬</div>
              <p className="text-slate-500 dark:text-slate-400 text-sm">
                Ende s'ka komente. Shkruaj i pari!
              </p>
            </div>
          ) : messages.map(m => {
            const mine = me && m.user_id === me.id
            const canDelete = mine || me?.role === 'admin'
            return (
              <div key={m.id} className={`flex gap-2 ${mine ? 'flex-row-reverse' : ''}`}>
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 ${avatarColor(m.username)}`}>
                  {initials(m.username)}
                </div>
                <div className={`max-w-[75%] ${mine ? 'items-end' : 'items-start'} flex flex-col`}>
                  <div className={`flex items-baseline gap-2 text-xs mb-0.5 ${mine ? 'flex-row-reverse' : ''}`}>
                    <span className="font-semibold text-slate-700 dark:text-slate-200">{m.username}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${m.role === 'admin' ? 'bg-yellow-100 text-yellow-700 dark:text-yellow-300' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>
                      {m.role === 'admin' ? 'Admin' : 'Shitës'}
                    </span>
                    <span className="text-slate-400 dark:text-slate-500">{formatTs(m.created_at)}</span>
                  </div>
                  <div className={`
                    px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap break-words shadow-sm
                    ${mine
                      ? 'bg-blue-600 text-white rounded-br-sm'
                      : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-bl-sm border border-slate-200 dark:border-slate-700'}
                  `}>
                    {m.body}
                  </div>
                  {canDelete && (
                    <button
                      onClick={() => setConfirmDel(m)}
                      className="text-[10px] text-slate-400 dark:text-slate-500 hover:text-red-600 mt-1 px-1"
                    >Fshi</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <form onSubmit={send} className="border-t border-slate-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-800 flex items-end gap-2 flex-shrink-0">
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Shkruaj një koment… (Enter për të dërguar, Shift+Enter për rresht të ri)"
            rows={2}
            maxLength={2000}
            className="input-field resize-none flex-1"
          />
          <button
            type="submit"
            disabled={sending || !text.trim()}
            className="btn-primary whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {sending ? '…' : 'Dërgo'}
          </button>
        </form>
      </div>

      {confirmDel && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setConfirmDel(null)}>
          <div className="modal-box max-w-md">
            <div className="modal-header"><h3 className="font-bold text-slate-800 dark:text-slate-100">Fshi komentin?</h3></div>
            <div className="modal-body">
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Do të fshihet komenti i <span className="font-semibold">{confirmDel.username}</span>. Ky veprim nuk kthehet.
              </p>
              <div className="mt-2 p-2 bg-slate-50 dark:bg-slate-900 rounded text-xs text-slate-600 dark:text-slate-300 whitespace-pre-wrap max-h-32 overflow-auto">
                {confirmDel.body}
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setConfirmDel(null)} className="btn-secondary">Anulo</button>
              <button onClick={() => remove(confirmDel.id)} className="btn-danger">Fshi</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
