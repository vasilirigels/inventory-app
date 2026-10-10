import { useState } from 'react'

// Modal gjenerik për zgjedhjen e fushave para eksportimit në Excel.
// Përdoret te Produktet (Inventari), Raport Blerje — Artikuj, Raport Shitje —
// Artikuj. Zgjedhja ruhet për çdo komponent te localStorage me `lsKey`.
export default function ExportFieldsModal({
  title = 'Export në Excel',
  subtitle,
  fields,          // [{ key, label }]
  defaultKeys,     // array e çelësave default
  lsKey,           // çelësi te localStorage për të kujtuar zgjedhjen
  onClose,
  onExport,        // async (selectedKeys[]) => void
}) {
  const [selected, setSelected] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(lsKey) || 'null')
      if (Array.isArray(saved) && saved.length > 0) return saved
    } catch {}
    return defaultKeys || fields.map(f => f.key)
  })
  const [exporting, setExporting] = useState(false)

  const toggle = (key) => setSelected(prev =>
    prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
  )
  const selectAll  = () => setSelected(fields.map(f => f.key))
  const selectNone = () => setSelected([])

  const handleExport = async () => {
    if (selected.length === 0 || exporting) return
    setExporting(true)
    try {
      localStorage.setItem(lsKey, JSON.stringify(selected))
      await onExport(selected)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="modal-header">
          <div>
            <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">⬇️ {title}</h3>
            {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 text-xl">×</button>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-2">
            <button onClick={selectAll}  className="text-xs px-3 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 dark:text-blue-300 font-semibold">✓ Të gjitha</button>
            <button onClick={selectNone} className="text-xs px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 dark:bg-slate-700 dark:hover:bg-slate-600 dark:text-slate-300 font-semibold">Asnjë</button>
            <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">{selected.length} / {fields.length} të zgjedhura</span>
          </div>
          <div className="grid grid-cols-2 gap-2 border border-slate-200 dark:border-slate-700 rounded-xl p-3 max-h-80 overflow-y-auto">
            {fields.map(f => {
              const on = selected.includes(f.key)
              return (
                <label key={f.key} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${on ? 'bg-blue-50 dark:bg-blue-900/30' : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'}`}>
                  <input type="checkbox" checked={on} onChange={() => toggle(f.key)} className="w-4 h-4 accent-blue-600" />
                  <span className={`text-sm ${on ? 'font-semibold text-slate-800 dark:text-slate-100' : 'text-slate-600 dark:text-slate-300'}`}>{f.label}</span>
                </label>
              )
            })}
          </div>
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <button onClick={onClose} className="btn-secondary">Anulo</button>
            <button
              onClick={handleExport}
              disabled={selected.length === 0 || exporting}
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {exporting ? 'Duke eksportuar...' : `⬇️ Export ${selected.length} fusha`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
