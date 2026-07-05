import { useEffect } from 'react'
import { subscribe } from '../utils/realtime.js'

// Call `onChange` whenever the server broadcasts a mutation touching `table`.
// `table` may be a string or array of strings.
export function useRealtimeSync(table, onChange) {
  useEffect(() => {
    const tables = Array.isArray(table) ? table : [table]
    const unsubs = tables.map(t => subscribe(t, onChange))
    return () => { unsubs.forEach(u => u && u()) }
  }, [Array.isArray(table) ? table.join(',') : table, onChange])
}
