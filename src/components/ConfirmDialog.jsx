import { useState, useEffect, useRef } from 'react'

// Modal paralajmërues global. Përdoret në vend të window.confirm() për të
// pasur një UI uniforme në të gjithë aplikacionin. Thirret imperativisht:
//   const ok = await showConfirm('Fshi këtë?', { danger: true, confirmLabel: 'Fshi' })
//   if (!ok) return
let openConfirm = null

export function showConfirm(message, options = {}) {
  return new Promise(resolve => {
    if (!openConfirm) {
      // Fallback (p.sh. para se komponenti të montohet).
      resolve(window.confirm(message))
      return
    }
    openConfirm({ message, options, resolve })
  })
}

export default function ConfirmDialog() {
  const [state, setState] = useState(null)
  const confirmBtnRef = useRef(null)

  useEffect(() => {
    openConfirm = setState
    return () => { openConfirm = null }
  }, [])

  useEffect(() => {
    if (!state) return
    // Fokusi te butoni kryesor për akses me tastierë (Enter = konfirmo).
    confirmBtnRef.current?.focus()
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); decide(false) }
      else if (e.key === 'Enter') { e.preventDefault(); decide(true) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  if (!state) return null

  const decide = (v) => {
    state.resolve(v)
    setState(null)
  }

  const { message, options } = state
  const {
    title = 'Konfirmim',
    confirmLabel = 'Po, vazhdo',
    cancelLabel = 'Anulo',
    danger = false,
    // hideCancel = true e kthen dialogun në një alert bllokues me një buton
    // të vetëm — përdoret kur veprimi që po pritej NUK mund të vazhdojë.
    hideCancel = false,
  } = options

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={() => decide(false)}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-md w-full p-5 border border-slate-200 dark:border-slate-700"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-2">
          <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-2xl flex-shrink-0 ${danger ? 'bg-red-100 dark:bg-red-900/40' : 'bg-amber-100 dark:bg-amber-900/40'}`}>
            {danger ? '⚠️' : '❓'}
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            <h3 id="confirm-title" className="text-base font-bold text-slate-800 dark:text-slate-100 mb-1">{title}</h3>
            <p className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-line break-words">{message}</p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 mt-5">
          {!hideCancel && (
            <button
              type="button"
              onClick={() => decide(false)}
              className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 text-sm font-medium transition-colors"
            >{cancelLabel}</button>
          )}
          <button
            ref={confirmBtnRef}
            type="button"
            onClick={() => decide(true)}
            className={`px-4 py-2 rounded-lg text-white text-sm font-semibold transition-colors ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}
          >{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
