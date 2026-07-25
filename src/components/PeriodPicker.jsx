// Zgjedhës i periudhës për raportet mujore/vjetore.
// Përdoret nga Kasaforta, LevizjeBanke, TerheqjaKasaforta, Shpenzime, etj.
//
// Props:
//   mode   ('month' | 'year')
//   month  ('YYYY-MM')
//   year   ('YYYY')
//   onModeChange, onMonthChange, onYearChange

export function currentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function currentYear() {
  return String(new Date().getFullYear())
}

export function fmtPeriodLabel(mode, month, year) {
  if (mode === 'year') return `Viti ${year}`
  if (!month) return ''
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, (m || 1) - 1, 1)
  const label = d.toLocaleDateString('sq-AL', { month: 'long', year: 'numeric' })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

// Kthen datat nga/deri për një periudhë (për thirrjet e API-t).
export function periodRange(mode, month, year) {
  if (mode === 'month') {
    if (!month) return { from: '', to: '' }
    const [y, m] = month.split('-').map(Number)
    const from = `${y}-${String(m).padStart(2, '0')}-01`
    const last = new Date(y, m, 0).getDate()
    const to   = `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`
    return { from, to }
  }
  if (!year) return { from: '', to: '' }
  return { from: `${year}-01-01`, to: `${year}-12-31` }
}

export default function PeriodPicker({
  mode, month, year,
  onModeChange, onMonthChange, onYearChange,
}) {
  return (
    <div className="flex items-end gap-2 flex-wrap">
      <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
        <button
          type="button"
          onClick={() => onModeChange('month')}
          className={`px-3 py-1.5 text-xs font-semibold ${mode === 'month' ? 'bg-slate-800 dark:bg-slate-900 text-white' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}
        >Mujor</button>
        <button
          type="button"
          onClick={() => onModeChange('year')}
          className={`px-3 py-1.5 text-xs font-semibold border-l border-slate-200 dark:border-slate-700 ${mode === 'year' ? 'bg-slate-800 dark:bg-slate-900 text-white' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}
        >Vjetor</button>
      </div>
      {mode === 'month' ? (
        <>
          <div>
            <label className="form-label text-[10px]">Muaji</label>
            <input
              type="month"
              value={month}
              onChange={e => onMonthChange(e.target.value || currentMonth())}
              className="input-field text-xs py-1.5"
            />
          </div>
          <button
            type="button"
            onClick={() => onMonthChange(currentMonth())}
            className="btn-secondary text-xs py-1.5"
            title="Kthehu tek muaji aktual"
          >Ky muaj</button>
        </>
      ) : (
        <>
          <div>
            <label className="form-label text-[10px]">Viti</label>
            <input
              type="number"
              min="2000" max="2100" step="1"
              value={year}
              onChange={e => onYearChange(e.target.value || currentYear())}
              className="input-field text-xs py-1.5 w-24"
            />
          </div>
          <button
            type="button"
            onClick={() => onYearChange(currentYear())}
            className="btn-secondary text-xs py-1.5"
            title="Kthehu tek viti aktual"
          >Ky vit</button>
        </>
      )}
    </div>
  )
}
