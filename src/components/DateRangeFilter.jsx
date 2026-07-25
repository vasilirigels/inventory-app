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
//   minFrom         — kufizim minimal i "Nga" (YYYY-MM-DD); përdoret p.sh. për shitësit

import { getUser } from '../lib/auth.js'

// Data lokale (jo UTC) — që preseti "Sot" të mos anashkalojë ditën në Shqipëri (UTC+1/+2).
function toISOLocal(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

export default function DateRangeFilter({ from, to, onChange, loading, emptyForAll = false, compact = false, hint, minFrom }) {
  // Shitësit s'kanë akses te periudha më e gjatë se 30 ditë.
  const isSales = getUser()?.role === 'sales'
  const longPresetsDisabled = isSales
  const disabledTitle = isSales ? 'I çaktivizuar për shitësin (kufi 30 ditë)' : undefined
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
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 leading-none">Filtër Periudhe</p>
          {hint && <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">{hint}</p>}
        </div>
      </div>
      <div>
        <label className="form-label">Nga</label>
        <input type="date" value={from || ''} max={to || undefined} min={minFrom || undefined}
          onChange={e => onChange({ from: e.target.value, to })}
          className="input-field" />
      </div>
      <div>
        <label className="form-label">Deri</label>
        <input type="date" value={to || ''} min={from || minFrom || undefined}
          onChange={e => onChange({ from, to: e.target.value })}
          className="input-field" />
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => setRange('today')}     className="btn-secondary text-xs">Sot</button>
        <button type="button" onClick={() => setRange('7d')}        className="btn-secondary text-xs">7 ditë</button>
        <button type="button" onClick={() => setRange('30d')}       className="btn-secondary text-xs">30 ditë</button>
        <button type="button" onClick={() => setRange('month')}     disabled={longPresetsDisabled} title={disabledTitle} className="btn-secondary text-xs disabled:opacity-40 disabled:cursor-not-allowed">Ky muaj</button>
        <button type="button" onClick={() => setRange('prevMonth')} disabled={longPresetsDisabled} title={disabledTitle} className="btn-secondary text-xs disabled:opacity-40 disabled:cursor-not-allowed">Muaji kaluar</button>
        <button type="button" onClick={() => setRange('year')}      disabled={longPresetsDisabled} title={disabledTitle} className="btn-secondary text-xs disabled:opacity-40 disabled:cursor-not-allowed">Ky vit</button>
        <button type="button" onClick={() => setRange('all')}       disabled={longPresetsDisabled} title={disabledTitle} className="btn-secondary text-xs disabled:opacity-40 disabled:cursor-not-allowed">Të gjitha</button>
      </div>
      {loading && (
        <span className="text-[11px] text-blue-600 bg-blue-50 dark:bg-blue-900/30 px-2 py-1 rounded-lg border border-blue-200">
          ⏳ Duke ngarkuar...
        </span>
      )}
    </div>
  )
}
