import { useEffect, useRef } from 'react'
import { subscribe } from '../utils/realtime.js'

// Call `onChange` whenever the server broadcasts a mutation touching `table`.
// `table` may be a string or array of strings.
//
// Debounce 800ms: kur bëhen shumë ndryshime njëkohësisht (p.sh. import Excel-i
// që fut 100 produkte, ose një transaksion që prek 3-4 tabela), çdo event tjetër
// përndryshe do të triggerohet një refetch të shtrenjtë. Me debounce, N events
// brenda 800ms → 1 refetch. Kursen Turso reads sidomos gjatë orëve me trafik.
const DEBOUNCE_MS = 800

export function useRealtimeSync(table, onChange) {
  const timerRef = useRef(null)
  useEffect(() => {
    const tables = Array.isArray(table) ? table : [table]
    const debounced = () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        onChange()
      }, DEBOUNCE_MS)
    }
    const unsubs = tables.map(t => subscribe(t, debounced))
    return () => {
      unsubs.forEach(u => u && u())
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    }
  }, [Array.isArray(table) ? table.join(',') : table, onChange])
}
