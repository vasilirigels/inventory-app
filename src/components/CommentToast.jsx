import { useEffect } from 'react'
import { useCommentToasts, dismissCommentToast } from '../lib/unreadComments.js'

// Banner-njoftim në cepin lart-djathtë kur mbërrijnë komente të reja nga të
// tjerët. Nuk varet nga leja e OS për njoftime — gjithmonë duket brenda
// aplikacionit. Auto-mbyllet pas 6s.
const AUTO_DISMISS_MS = 6000

export default function CommentToast({ onOpenKomentet }) {
  const toasts = useCommentToasts()

  useEffect(() => {
    if (toasts.length === 0) return
    // Përdor një timer për secilin që skadon më herët.
    const timers = toasts.map(t => {
      const remaining = Math.max(500, AUTO_DISMISS_MS - (Date.now() - t.at))
      return setTimeout(() => dismissCommentToast(t.id), remaining)
    })
    return () => { for (const id of timers) clearTimeout(id) }
  }, [toasts])

  if (toasts.length === 0) return null

  return (
    <div className="fixed top-4 right-4 z-50 space-y-2 max-w-sm">
      {toasts.slice(-3).map(t => (
        <div
          key={t.id}
          className="bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden animate-slide-in-right"
          role="alert"
        >
          <div className="flex items-start gap-2 p-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center text-lg flex-shrink-0">
              💬
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-slate-800 truncate">
                  {t.username}
                </p>
                <button
                  onClick={() => dismissCommentToast(t.id)}
                  className="text-slate-400 hover:text-slate-600 text-sm leading-none"
                  aria-label="Mbyll"
                >✕</button>
              </div>
              <p className="text-xs text-slate-600 mt-0.5 break-words line-clamp-2">
                {t.body}
              </p>
              <button
                onClick={() => {
                  dismissCommentToast(t.id)
                  onOpenKomentet?.()
                }}
                className="mt-1.5 text-[10px] font-semibold text-blue-600 hover:text-blue-800"
              >
                Hap komentet →
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
