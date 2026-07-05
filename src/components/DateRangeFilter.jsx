// Filtër i përbashkët i periudhës me presete të shpejta.
// Përdoret nga Dashboard-i, raportet dhe detyrimet.
//
// Props:
//   from, to        — vlerat aktuale (strings YYYY-MM-DD ose '')
//   onChange({from, to}) — thirret kur ndryshojnë vlerat (nga input ose preset)
//   loading         — nëse është true tregon indikator "Duke ngarkuar..."
//   emptyForAll     — nëse true, "Të gjitha" dërgon strings bosh (default: false → '2000-01-01' → sot)
//   compact         — variant më i vogël pa hapësirë vizuale
//   hint            — tekst i vogël nën titullin, p.sh. "Ndikon: grafiku, faturat"

// Data lokale (jo UTC) — që preseti "Sot" të mos anashkalojë ditën në Shqipëri (UTC+1/+2).
function toISOLocal(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

export default function DateRangeFilter({ from, to, onChange, loading, emptyForAll = false, compact = false, hint }) {
  const setRange = (preset) => {
    const t = new Date()
    if (preset === 'today')      return onChange({ from: toISOLocal(t), to: toISOLocal(t) })
    if (preset === '7d')         {
      const start = new Date(t); start.setDate(t.getDate() - 6)
      return onChange({ from: toISOLocal(start), to: toISOLocal(t) })
    }
    if (preset === '30d')        {
      const start = new Date(t); start.setDate(t.getDate() - 29)
      return onChange({ from: toISOLocal(start), to: toISOLocal(t) })
    }
    if (preset === 'month')      {
      const first = new Date(t.getFullYear(), t.getMonth(), 1)
      return onChange({ from: toISOLocal(first), to: toISOLocal(t) })
    }
    if (preset === 'prevMonth')  {
      const first = new Date(t.getFullYear(), t.getMonth() - 1, 1)
      const last  = new Date(t.getFullYear(), t.getMonth(), 0)
      return onChange({ from: toISOLocal(first), to: toISOLocal(last) })
    }
    if (preset === 'year')       {
      const first = new Date(t.getFullYear(), 0, 1)
      return onChange({ from: toISOLocal(first), to: toISOLocal(t) })
    }
    if (preset === 'all') {
      if (emptyForAll) return onChange({ from: '', to: '' })
      return onChange({ from: '2000-01-01', to: toISOLocal(t) })
    }
  }
  return (
    <div className={`card flex flex-wrap items-end gap-3 ${compact ? '!p-3' : ''}`}>
      <div className="flex items-center gap-2">
        <span className="text-2xl">📅</span>
        <div>
          <p className="text-sm font-semibold text-slate-700 leading-none">Filtër Periudhe</p>
          {hint && <p className="text-[10px] text-slate-500 mt-0.5">{hint}</p>}
        </div>
      </div>
      <div>
        <label className="form-label">Nga</label>
        <input type="date" value={from || ''} max={to || undefined}
          onChange={e => onChange({ from: e.target.value, to })}
          className="input-field" />
      </div>
      <div>
        <label className="form-label">Deri</label>
        <input type="date" value={to || ''} min={from || undefined}
          onChange={e => onChange({ from, to: e.target.value })}
          className="input-field" />
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => setRange('today')}     className="btn-secondary text-xs">Sot</button>
        <button type="button" onClick={() => setRange('7d')}        className="btn-secondary text-xs">7 ditë</button>
        <button type="button" onClick={() => setRange('30d')}       className="btn-secondary text-xs">30 ditë</button>
        <button type="button" onClick={() => setRange('month')}     className="btn-secondary text-xs">Ky muaj</button>
        <button type="button" onClick={() => setRange('prevMonth')} className="btn-secondary text-xs">Muaji kaluar</button>
        <button type="button" onClick={() => setRange('year')}      className="btn-secondary text-xs">Ky vit</button>
        <button type="button" onClick={() => setRange('all')}       className="btn-secondary text-xs">Të gjitha</button>
      </div>
      {loading && (
        <span className="text-[11px] text-blue-600 bg-blue-50 px-2 py-1 rounded-lg border border-blue-200">
          ⏳ Duke ngarkuar...
        </span>
      )}
    </div>
  )
}
