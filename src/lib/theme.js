// Dark/light mode toggle me persistencë në localStorage.
// Klasa `.dark` vendoset te <html> — Tailwind reagon me variantin `dark:` në klasa.
import { useEffect, useState } from 'react'

const KEY = 'theme'

function initialTheme() {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'dark' || saved === 'light') return saved
    if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark'
  } catch { /* ignore */ }
  return 'light'
}

function apply(theme) {
  const root = document.documentElement
  if (theme === 'dark') root.classList.add('dark')
  else root.classList.remove('dark')
}

// Aplikohet menjëherë kur ngarkohet moduli — që të mos ketë "flash" të bardhë.
apply(initialTheme())

const listeners = new Set()

export function getTheme() { return initialTheme() }

export function setTheme(theme) {
  try { localStorage.setItem(KEY, theme) } catch { /* ignore */ }
  apply(theme)
  for (const l of listeners) l(theme)
}

export function useTheme() {
  const [theme, setThemeState] = useState(initialTheme)
  useEffect(() => {
    const onChange = (t) => setThemeState(t)
    listeners.add(onChange)
    return () => listeners.delete(onChange)
  }, [])
  const toggle = () => setTheme(theme === 'dark' ? 'light' : 'dark')
  return { theme, toggle, setTheme }
}
