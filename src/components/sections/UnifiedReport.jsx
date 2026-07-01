import { useEffect, useMemo, useState } from 'react'

const ALBANIAN_MONTHS = [
  '', 'Janar', 'Shkurt', 'Mars', 'Prill', 'Maj', 'Qershor',
  'Korrik', 'Gusht', 'Shtator', 'Tetor', 'Nëntor', 'Dhjetor',
]

function n(v) { return parseFloat(v) || 0 }
function fmt(v) {
  const val = n(v)
  if (val === 0) return '-'
  return val.toLocaleString('sq-AL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}
function pad2(v) { return String(v).padStart(2, '0') }
function toISO(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` }
function parseISO(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
function startOfWeek(date) { const d = new Date(date); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); return d }
function endOfWeek(date) { const d = startOfWeek(date); d.setDate(d.getDate() + 6); return d }
function startOfMonth(date) { return new Date(date.getFullYear(), date.getMonth(), 1) }
function endOfMonth(date) { return new Date(date.getFullYear(), date.getMonth() + 1, 0) }
function startOfYear(date) { return new Date(date.getFullYear(), 0, 1) }
function endOfYear(date) { return new Date(date.getFullYear(), 11, 31) }

function daysBetween(a, b) {
  return Math.round((parseISO(b) - parseISO(a)) / 86400000) + 1
}

export default function UnifiedReport({ initialDate, onNavigate }) {
  const today = initialDate ? parseISO(initialDate) : new Date()

  // Default range = current month
  const [from, setFrom] = useState(toISO(startOfMonth(today)))
  const [to,   setTo]   = useState(toISO(endOfMonth(today)))

  // Auto-decide bucket granularity (day vs month) based on range length
  // User can override with the tabs
  const rangeDays = daysBetween(from, to)
  const [bucketMode, setBucketMode] = useState('auto')  // 'auto' | 'day' | 'month'
  const effectiveBucket = bucketMode === 'auto' ? (rangeDays > 92 ? 'month' : 'day') : bucketMode

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (from > to) return
    setLoading(true)
    fetch(`/api/report?from=${from}&to=${to}`)
      .then(r => r.json())
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [from, to])

  const t  = data?.totals || {}
  const x  = data?.xhiro  || { lek: 0, eur: 0, usd: 0, gbp: 0, chf: 0 }
  const bt = data?.byType || { flori: {}, diamant: {}, online: {} }
  const buckets = data?.buckets || []

  const displayBuckets = useMemo(() => {
    if (effectiveBucket === 'month') {
      const byMonth = {}
      buckets.forEach(b => {
        const ym = b.date.slice(0, 7)
        if (!byMonth[ym]) byMonth[ym] = { key: ym, label: '', ...zeroBucket() }
        for (const k of Object.keys(b)) if (k !== 'date') byMonth[ym][k] = (byMonth[ym][k] || 0) + b[k]
      })
      return Object.values(byMonth)
        .sort((a, b) => a.key.localeCompare(b.key))
        .map(b => {
          const [yy, mm] = b.key.split('-').map(Number)
          return { ...b, label: `${ALBANIAN_MONTHS[mm]} ${yy}` }
        })
    }
    return buckets.map(b => {
      const d = parseISO(b.date)
      return { ...b, key: b.date, label: `${d.getDate()} ${ALBANIAN_MONTHS[d.getMonth()+1]}` }
    })
  }, [buckets, effectiveBucket])

  // Preset ranges
  const applyPreset = (key) => {
    const t = new Date()
    if (key === 'today')         { const s = toISO(t); setFrom(s); setTo(s); }
    else if (key === 'yesterday'){ const y = new Date(t); y.setDate(y.getDate() - 1); const s = toISO(y); setFrom(s); setTo(s); }
    else if (key === 'last7')    { const s = new Date(t); s.setDate(s.getDate() - 6); setFrom(toISO(s)); setTo(toISO(t)); }
    else if (key === 'last30')   { const s = new Date(t); s.setDate(s.getDate() - 29); setFrom(toISO(s)); setTo(toISO(t)); }
    else if (key === 'thisWeek') { setFrom(toISO(startOfWeek(t))); setTo(toISO(endOfWeek(t))); }
    else if (key === 'lastWeek') { const w = new Date(t); w.setDate(w.getDate() - 7); setFrom(toISO(startOfWeek(w))); setTo(toISO(endOfWeek(w))); }
    else if (key === 'thisMonth'){ setFrom(toISO(startOfMonth(t))); setTo(toISO(endOfMonth(t))); }
    else if (key === 'lastMonth'){ const m = new Date(t.getFullYear(), t.getMonth() - 1, 1); setFrom(toISO(startOfMonth(m))); setTo(toISO(endOfMonth(m))); }
    else if (key === 'thisYear') { setFrom(toISO(startOfYear(t))); setTo(toISO(endOfYear(t))); }
    else if (key === 'lastYear') { const y = new Date(t.getFullYear() - 1, 0, 1); setFrom(toISO(startOfYear(y))); setTo(toISO(endOfYear(y))); }
  }

  const rangeLabel = useMemo(() => {
    const a = parseISO(from), b = parseISO(to)
    if (from === to) return `${a.getDate()} ${ALBANIAN_MONTHS[a.getMonth()+1]} ${a.getFullYear()}`
    return `${a.getDate()} ${ALBANIAN_MONTHS[a.getMonth()+1]} ${a.getFullYear()} – ${b.getDate()} ${ALBANIAN_MONTHS[b.getMonth()+1]} ${b.getFullYear()} · ${rangeDays} ditë`
  }, [from, to, rangeDays])

  const invalid = from > to

  return (
    <div className="space-y-4">
      {/* ── Header / controls ── */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-slate-800">Përmbledhëse</h3>
            <p className="text-xs text-slate-500 mt-0.5">{rangeLabel}{data && <span className="ml-2 text-slate-400">({data.days_with_data || 0} ditë me të dhëna)</span>}</p>
          </div>
          <div className="flex items-end gap-2 flex-wrap">
            <div>
              <label className="block text-[10px] text-slate-500 mb-0.5 uppercase font-semibold">Nga</label>
              <input
                type="date" value={from} onChange={e => setFrom(e.target.value)}
                className={`px-2 py-1.5 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${invalid ? 'border-rose-400 bg-rose-50' : 'border-slate-200'}`}
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 mb-0.5 uppercase font-semibold">Deri</label>
              <input
                type="date" value={to} onChange={e => setTo(e.target.value)}
                className={`px-2 py-1.5 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${invalid ? 'border-rose-400 bg-rose-50' : 'border-slate-200'}`}
              />
            </div>
          </div>
        </div>

        {/* Preset chips */}
        <div className="flex flex-wrap gap-1.5">
          {[
            ['today',     'Sot'],
            ['yesterday', 'Dje'],
            ['last7',     '7 ditët e fundit'],
            ['last30',    '30 ditët e fundit'],
            ['thisWeek',  'Kjo javë'],
            ['lastWeek',  'Java e kaluar'],
            ['thisMonth', 'Ky muaj'],
            ['lastMonth', 'Muaji i kaluar'],
            ['thisYear',  'Ky vit'],
            ['lastYear',  'Viti i kaluar'],
          ].map(([k, lbl]) => (
            <button key={k} onClick={() => applyPreset(k)}
              className="px-2.5 py-1 text-xs rounded-md bg-slate-100 hover:bg-blue-100 hover:text-blue-700 text-slate-600 border border-slate-200">
              {lbl}
            </button>
          ))}
        </div>

        {/* Bucket mode (advanced) */}
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <span className="text-[10px] uppercase font-semibold tracking-wider">Ndarja:</span>
          {[
            ['auto',  'Auto'],
            ['day',   'Ditore'],
            ['month', 'Mujore'],
          ].map(([k, lbl]) => (
            <button key={k} onClick={() => setBucketMode(k)}
              className={`px-2 py-1 rounded-md border ${bucketMode === k ? 'bg-slate-800 text-white border-slate-800' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {invalid && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl p-4 text-sm">
          Data fillestare nuk mund të jetë më vonë se data përfundimtare.
        </div>
      )}

      {loading && !invalid && <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500">Duke ngarkuar…</div>}

      {!loading && !invalid && data && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi label="Xhiro LEK"     value={x.lek}            color="emerald" />
            <Kpi label="Xhiro EUR"     value={x.eur}            color="emerald" />
            <Kpi label="Shpenzime LEK" value={t.shpenzime_lek}  color="rose" />
            <Kpi label="Shpenzime EUR" value={t.shpenzime_eur}  color="rose" />
          </div>

          {/* By type */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
            <h4 className="text-sm font-bold text-slate-800 mb-3">Shitje sipas kategorisë</h4>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="text-left px-3 py-2 text-xs font-semibold text-slate-600">Kategoria</th>
                  <th className="text-right px-3 py-2 text-xs font-semibold text-slate-600">Copë</th>
                  <th className="text-right px-3 py-2 text-xs font-semibold text-slate-600">Gram</th>
                  <th className="text-right px-3 py-2 text-xs font-semibold text-slate-600">LEK</th>
                  <th className="text-right px-3 py-2 text-xs font-semibold text-slate-600">EUR</th>
                  <th className="text-right px-3 py-2 text-xs font-semibold text-slate-600">USD</th>
                  <th className="text-right px-3 py-2 text-xs font-semibold text-slate-600">GBP</th>
                  <th className="text-right px-3 py-2 text-xs font-semibold text-slate-600">CHF</th>
                </tr>
              </thead>
              <tbody>
                <TypeRow label="FLORI"          t={bt.flori} />
                <TypeRow label="DIAMANT"        t={bt.diamant} />
                <TypeRow label="ONLINE & STAFI" t={bt.online} />
                <tr className="bg-emerald-50 font-bold border-t-2 border-emerald-200">
                  <td className="px-3 py-2 text-slate-800">TOTAL</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(n(bt.flori.cope) + n(bt.diamant.cope) + n(bt.online.cope))}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(n(bt.flori.gram) + n(bt.diamant.gram) + n(bt.online.gram))}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{fmt(x.lek)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{fmt(x.eur)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{fmt(x.usd)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{fmt(x.gbp)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{fmt(x.chf)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Aggregate sectors */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Sector title="Tërheqje BIBA"  cols={['lek','eur','usd','gbp','chf','gram']}  row={{ lek: t.biba_lek, eur: t.biba_eur, usd: t.biba_usd, gbp: t.biba_gbp, chf: t.biba_chf, gram: t.biba_gram }} />
            <Sector title="Tërheqje DIANA" cols={['lek','eur','usd','gbp','chf','hurda']} row={{ lek: t.diana_lek, eur: t.diana_eur, usd: t.diana_usd, gbp: t.diana_gbp, chf: t.diana_chf, hurda: t.diana_hurda }} />
            <Sector title="Banka — Tërheqje"   cols={['lek','eur','usd']} row={{ lek: t.bank_withdraw_lek, eur: t.bank_withdraw_eur, usd: t.bank_withdraw_usd }} />
            <Sector title="Banka — Depozitim"  cols={['lek','eur','usd']} row={{ lek: t.bank_deposit_lek,  eur: t.bank_deposit_eur,  usd: t.bank_deposit_usd }} />
            <Sector title="Konvertim Valute" cols={['lek','eur','usd','gbp','chf']}        row={{ lek: t.conv_lek, eur: t.conv_eur, usd: t.conv_usd, gbp: t.conv_gbp, chf: t.conv_chf }} />
            <Sector title="Konvertim Hurda"  cols={['lek','eur','usd','gbp','chf','gram']} row={{ lek: t.hurda_lek, eur: t.hurda_eur, usd: t.hurda_usd, gbp: t.hurda_gbp, chf: t.hurda_chf, gram: t.hurda_gram }} />
            <Sector title="Shlyerje Borxhi te Produkteve" cols={['eur','usd','gbp','chf','has']} row={{ eur: t.shlyerje_eur, usd: t.shlyerje_usd, gbp: t.shlyerje_gbp, chf: t.shlyerje_chf, has: t.shlyerje_has }} />
            <Sector title="Borxhe / Kthim Borxhi"
              cols={['lek','eur','usd','gbp','chf']}
              rows={[
                { label: 'Borxhe', vals: { lek: t.borxhe_lek, eur: t.borxhe_eur, usd: t.borxhe_usd, gbp: t.borxhe_gbp, chf: t.borxhe_chf } },
                { label: 'Kthim',  vals: { lek: t.kthim_borxhi_lek, eur: t.kthim_borxhi_eur, usd: t.kthim_borxhi_usd, gbp: t.kthim_borxhi_gbp, chf: t.kthim_borxhi_chf } },
              ]} />
          </div>

          {/* Per-bucket breakdown (skip when single day) */}
          {from !== to && displayBuckets.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 overflow-x-auto">
              <h4 className="text-sm font-bold text-slate-800 mb-3">
                Ndarja {effectiveBucket === 'month' ? 'mujore' : 'ditore'}
              </h4>
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-900 text-white">
                    <th className="px-2 py-2 sticky left-0 bg-slate-900 text-left">{effectiveBucket === 'month' ? 'Muaji' : 'Data'}</th>
                    <th className="px-2 py-2 bg-emerald-800">Xhiro LEK</th>
                    <th className="px-2 py-2 bg-emerald-800">Xhiro EUR</th>
                    <th className="px-2 py-2 bg-emerald-800">Xhiro USD</th>
                    <th className="px-2 py-2 bg-rose-800">Shpenz LEK</th>
                    <th className="px-2 py-2 bg-rose-800">Shpenz EUR</th>
                    <th className="px-2 py-2 bg-purple-800">BIBA LEK</th>
                    <th className="px-2 py-2 bg-purple-800">DIANA LEK</th>
                    <th className="px-2 py-2 bg-blue-800">Bank Tërh</th>
                    <th className="px-2 py-2 bg-blue-800">Bank Dep</th>
                    <th className="px-2 py-2 bg-yellow-800">Flori cp</th>
                    <th className="px-2 py-2 bg-yellow-800">Flori gr</th>
                    <th className="px-2 py-2 bg-cyan-800">Diam cp</th>
                    <th className="px-2 py-2 bg-cyan-800">Diam gr</th>
                    <th className="px-2 py-2 bg-pink-800">Online cp</th>
                  </tr>
                </thead>
                <tbody>
                  {displayBuckets.map((b, i) => (
                    <tr
                      key={b.key}
                      className={`border-b border-slate-100 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}`}
                    >
                      <td className="px-2 py-1.5 sticky left-0 bg-inherit font-medium text-slate-800 whitespace-nowrap">{b.label}</td>
                      <Td value={b.xhiro_lek} className="text-emerald-700" />
                      <Td value={b.xhiro_eur} className="text-emerald-700" />
                      <Td value={b.xhiro_usd} className="text-emerald-700" />
                      <Td value={b.shpenzime_lek} className="text-rose-600" />
                      <Td value={b.shpenzime_eur} className="text-rose-600" />
                      <Td value={b.biba_lek}  className="text-purple-700" />
                      <Td value={b.diana_lek} className="text-purple-700" />
                      <Td value={b.bank_withdraw_lek} className="text-blue-600" />
                      <Td value={b.bank_deposit_lek}  className="text-blue-600" />
                      <Td value={b.flori_cope} />
                      <Td value={b.flori_gram} />
                      <Td value={b.diamant_cope} />
                      <Td value={b.diamant_gram} />
                      <Td value={b.online_cope} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function zeroBucket() {
  return { xhiro_lek: 0, xhiro_eur: 0, xhiro_usd: 0, xhiro_gbp: 0, xhiro_chf: 0, shpenzime_lek: 0, shpenzime_eur: 0, biba_lek: 0, biba_eur: 0, diana_lek: 0, diana_eur: 0, bank_withdraw_lek: 0, bank_deposit_lek: 0, flori_cope: 0, flori_gram: 0, diamant_cope: 0, diamant_gram: 0, online_cope: 0 }
}

function Kpi({ label, value, color }) {
  const colorMap = {
    emerald: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    rose:    'text-rose-700    bg-rose-50    border-rose-200',
    blue:    'text-blue-700    bg-blue-50    border-blue-200',
  }
  return (
    <div className={`rounded-xl border p-4 ${colorMap[color] || colorMap.blue}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wider opacity-80">{label}</p>
      <p className="text-xl font-bold tabular-nums mt-1">{fmt(value)}</p>
    </div>
  )
}

function TypeRow({ label, t }) {
  return (
    <tr className="border-b border-slate-100">
      <td className="px-3 py-2 text-slate-700 font-medium">{label}</td>
      <Td value={n(t.cope)} />
      <Td value={n(t.gram)} />
      <Td value={n(t.lek_cash) + n(t.lek_pb)} />
      <Td value={n(t.eur_cash) + n(t.eur_pb)} />
      <Td value={n(t.usd)} />
      <Td value={n(t.gbp)} />
      <Td value={n(t.chf)} />
    </tr>
  )
}

const CUR_LABELS = { lek: 'LEK', eur: 'EUR', usd: 'USD', gbp: 'GBP', chf: 'CHF', gram: 'Gram', hurda: 'Hurda', has: 'HAS' }

function Sector({ title, cols, row, rows }) {
  const data = rows || [{ label: 'Total', vals: row }]
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
      <h4 className="text-sm font-bold text-slate-800 mb-2">{title}</h4>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50">
            <th className="text-left px-2 py-1.5 text-[10px] font-semibold text-slate-600">Zëri</th>
            {cols.map(c => <th key={c} className="text-right px-2 py-1.5 text-[10px] font-semibold text-slate-600">{CUR_LABELS[c]}</th>)}
          </tr>
        </thead>
        <tbody>
          {data.map((r, i) => (
            <tr key={i} className="border-b border-slate-100">
              <td className="px-2 py-1.5 text-slate-700">{r.label}</td>
              {cols.map(c => <Td key={c} value={r.vals[c]} />)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Td({ value, className = '' }) {
  return <td className={`px-2 py-1.5 text-right tabular-nums whitespace-nowrap ${className}`}>{fmt(value)}</td>
}
