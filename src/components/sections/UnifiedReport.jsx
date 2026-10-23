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
  const [pnl, setPnl] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (from > to) return
    setLoading(true)
    // Fetch i ndarë — nëse njëri dështon, tjetri shfaqet. Përndryshe një bug
    // te /api/pnl do bllokonte edhe pjesën tjetër të raportit.
    fetch(`/api/report?from=${from}&to=${to}`)
      .then(r => r.json()).then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))
    fetch(`/api/pnl?from=${from}&to=${to}`)
      .then(r => r.ok ? r.json() : null).then(setPnl)
      .catch(() => setPnl(null))
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
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-4 space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Përmbledhëse</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{rangeLabel}{data && <span className="ml-2 text-slate-400 dark:text-slate-500">({data.days_with_data || 0} ditë me të dhëna)</span>}</p>
          </div>
          <div className="flex items-end gap-2 flex-wrap">
            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-0.5 uppercase font-semibold">Nga</label>
              <input
                type="date" value={from} onChange={e => setFrom(e.target.value)}
                className={`px-2 py-1.5 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${invalid ? 'border-rose-400 bg-rose-50' : 'border-slate-200 dark:border-slate-700'}`}
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-0.5 uppercase font-semibold">Deri</label>
              <input
                type="date" value={to} onChange={e => setTo(e.target.value)}
                className={`px-2 py-1.5 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${invalid ? 'border-rose-400 bg-rose-50' : 'border-slate-200 dark:border-slate-700'}`}
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
              className="px-2.5 py-1 text-xs rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-blue-100 hover:text-blue-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
              {lbl}
            </button>
          ))}
        </div>

        {/* Bucket mode (advanced) */}
        <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
          <span className="text-xs uppercase font-semibold tracking-wider">Ndarja:</span>
          {[
            ['auto',  'Auto'],
            ['day',   'Ditore'],
            ['month', 'Mujore'],
          ].map(([k, lbl]) => (
            <button key={k} onClick={() => setBucketMode(k)}
              className={`px-2 py-1 rounded-md border ${bucketMode === k ? 'bg-slate-800 dark:bg-slate-900 text-white border-slate-800' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}>
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

      {loading && !invalid && <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-8 text-center text-slate-500 dark:text-slate-400">Duke ngarkuar…</div>}

      {!loading && !invalid && data && (
        <>
          {/* Bilanc / P&L — pamja kryesore e Përmbledhëses */}
          {pnl && <BilanciSection pnl={pnl} />}

          {/* Ndarja në kohë — vetëm Xhiro & Shpenzime për trend-in,
              pa fluksit e detajuar të keshit (ato shkojnë te Arka Ditore). */}
          {from !== to && displayBuckets.length > 0 && (
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-4 overflow-x-auto">
              <h4 className="text-base font-bold text-slate-800 dark:text-slate-100 mb-3">
                Trend {effectiveBucket === 'month' ? 'mujor' : 'ditor'} — Xhiro & Shpenzime
              </h4>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-200">
                    <th className="px-2 py-2 sticky left-0 bg-slate-100 dark:bg-slate-900 text-left font-semibold">{effectiveBucket === 'month' ? 'Muaji' : 'Data'}</th>
                    <th className="px-2 py-2 text-right text-emerald-700 dark:text-emerald-300 font-semibold">Xhiro LEK</th>
                    <th className="px-2 py-2 text-right text-emerald-700 dark:text-emerald-300 font-semibold">Xhiro EUR</th>
                    <th className="px-2 py-2 text-right text-rose-700 dark:text-rose-300 font-semibold">Shpenz LEK</th>
                    <th className="px-2 py-2 text-right text-rose-700 dark:text-rose-300 font-semibold">Shpenz EUR</th>
                    <th className="px-2 py-2 text-right text-yellow-700 dark:text-yellow-300 font-semibold">Flori copë</th>
                    <th className="px-2 py-2 text-right text-sky-700 dark:text-sky-300 font-semibold">Diamant copë</th>
                  </tr>
                </thead>
                <tbody>
                  {displayBuckets.map((b, i) => (
                    <tr
                      key={b.key}
                      className={`border-b border-slate-100 dark:border-slate-800 ${i % 2 === 0 ? 'bg-white dark:bg-slate-800' : 'bg-slate-50/60 dark:bg-slate-900/30'}`}
                    >
                      <td className="px-2 py-1.5 sticky left-0 bg-inherit font-medium text-slate-800 dark:text-slate-100 whitespace-nowrap">{b.label}</td>
                      <Td value={b.xhiro_lek}     className="text-emerald-700 dark:text-emerald-300" />
                      <Td value={b.xhiro_eur}     className="text-emerald-700 dark:text-emerald-300" />
                      <Td value={b.shpenzime_lek} className="text-rose-600" />
                      <Td value={b.shpenzime_eur} className="text-rose-600" />
                      <Td value={b.flori_cope} />
                      <Td value={b.diamant_cope} />
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
    emerald: 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200',
    rose:    'text-rose-700    bg-rose-50    border-rose-200',
    blue:    'text-blue-700 dark:text-blue-300    bg-blue-50 dark:bg-blue-900/30    border-blue-200',
  }
  return (
    <div className={`rounded-xl border p-4 ${colorMap[color] || colorMap.blue}`}>
      <p className="text-xs font-semibold uppercase tracking-wider opacity-80">{label}</p>
      <p className="text-xl font-bold tabular-nums mt-1">{fmt(value)}</p>
    </div>
  )
}

function TypeRow({ label, t }) {
  return (
    <tr className="border-b border-slate-100 dark:border-slate-800">
      <td className="px-3 py-2 text-slate-700 dark:text-slate-200 font-medium">{label}</td>
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
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-4">
      <h4 className="text-base font-bold text-slate-800 dark:text-slate-100 mb-2">{title}</h4>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900">
            <th className="text-left px-2 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">Zëri</th>
            {cols.map(c => <th key={c} className="text-right px-2 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">{CUR_LABELS[c]}</th>)}
          </tr>
        </thead>
        <tbody>
          {data.map((r, i) => (
            <tr key={i} className="border-b border-slate-100 dark:border-slate-800">
              <td className="px-2 py-1.5 text-slate-700 dark:text-slate-200">{r.label}</td>
              {cols.map(c => <Td key={c} value={r.vals[c]} />)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Td({ value, className = '' }) {
  return <td className={`px-2 py-2 text-right tabular-nums whitespace-nowrap ${className}`}>{fmt(value)}</td>
}

// ── Bilanc: Shitje / Kosto / Fitim / Marzh — ndaresisht per kategori ──────
// UI i thjeshtë: për çdo kategori, një kartë me 3 rreshta (Shitje / Kosto / Fitim)
// + rreshti i marzhit. Shpenzimet, marketing-u, pagesat e punëtorëve paraqiten
// në fund si listë e shkurtër; nuk zbresin nga fitimi per kategori — janë cost
// pool i veçantë që lexuesi i sheh të ndara.
function BilanciSection({ pnl }) {
  const CUR_ORDER = ['LEK', 'EUR', 'USD', 'GBP', 'CHF']
  const safeMetrics = () => ({ cope: 0, gram: 0, has: 0, revenue: {}, cost: {}, profit: {}, cope_unknown: 0, revenue_unknown: {} })
  const byCat = pnl?.byCategory || {}
  const byCategory = {
    flori:   byCat.flori   || safeMetrics(),
    diamant: byCat.diamant || safeMetrics(),
    tjeter:  byCat.tjeter  || safeMetrics(),
  }
  const marginByCategory = pnl?.marginByCategory || { flori: {}, diamant: {}, tjeter: {} }
  const byPaymentMethod = pnl?.byPaymentMethod || {}
  const expenses = pnl?.expenses || {}
  const totalProfit = pnl?.totalProfit || {}
  const debts = pnl?.debts || {
    clients: {}, clients_count: 0, clients_has: 0,
    suppliers: {}, suppliers_count: 0, suppliers_has: 0,
    clients_all: {}, clients_count_all: 0, clients_has_all: 0,
    suppliers_all: {}, suppliers_count_all: 0, suppliers_has_all: 0,
  }
  const marketing = pnl?.marketing || {
    open_contracts: 0, closed_contracts: 0,
    open_budget_eur: 0, closed_budget_eur: 0,
    paid_cash_eur_total: 0, paid_product_eur_total: 0, paid_extra_eur_total: 0, paid_total_eur: 0,
    product_entries_count: 0, extra_entries_count: 0, budget_variance_eur: 0,
    paid_cash_period_eur: 0, paid_product_period_eur: 0, paid_extra_period_eur: 0, paid_in_period_eur: 0,
    all_time: { open_contracts: 0, open_budget_eur: 0, paid_cash_eur: 0, paid_product_eur: 0, paid_extra_eur: 0, paid_total_eur: 0 },
  }
  const repairs = pnl?.repairs || { total: {}, unpaid: {}, count: 0 }

  // Monedhat aktive = ato që kanë lëvizje; nëse asgjë → mbaj LEK + EUR si default.
  const activeCurs = CUR_ORDER.filter(c => {
    for (const cat of ['flori', 'diamant', 'tjeter']) {
      const m = byCategory[cat]
      if (Math.abs(m.revenue[c] || 0) > 0.5) return true
    }
    for (const pm of ['cash','bank','pos','debt','mikse']) {
      if (Math.abs((byPaymentMethod[pm] || {})[c] || 0) > 0.5) return true
    }
    for (const key of ['daily','transport','marketing','workers']) {
      if (Math.abs((expenses[key] || {})[c] || 0) > 0.5) return true
    }
    if (Math.abs(debts.clients[c] || 0) > 0.5 || Math.abs(debts.suppliers[c] || 0) > 0.5) return true
    if (Math.abs(repairs.total[c] || 0) > 0.5) return true
    return false
  })
  const cols = activeCurs.length > 0 ? activeCurs : ['LEK', 'EUR']

  const CATEGORIES = [
    { key: 'flori',   label: 'FLORI',    icon: '🥇', bar: 'from-amber-400 to-yellow-500' },
    { key: 'diamant', label: 'DIAMANT',  icon: '💎', bar: 'from-sky-400 to-blue-500' },
    { key: 'tjeter',  label: 'TË TJERA', icon: '🛒', bar: 'from-slate-400 to-slate-500' },
  ]

  const fmtMargin = (v) => v == null ? '—' : `${v.toLocaleString('sq-AL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
  const fmtGram = (v) => !v || Math.abs(v) < 0.0005 ? '—' : v.toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <div className="space-y-4">
      {/* ── 1. SHITJE PER KATEGORI — card e madhe me fitim/marzh të dukshëm ── */}
      <div>
        <h3 className="text-base font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">1. Shitjet & Fitimi (sipas kategorisë)</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {CATEGORIES.map(cat => {
            const m = byCategory[cat.key]
            const margin = marginByCategory[cat.key] || {}
            const hasData = cols.some(c => Math.abs(m.revenue[c] || 0) > 0.5) || Math.abs(m.cope) > 0
            return (
              <div key={cat.key} className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className={`h-1 bg-gradient-to-r ${cat.bar}`}></div>
                <div className="p-3">
                  <div className="flex items-baseline justify-between mb-2">
                    <h4 className="text-base font-bold text-slate-800 dark:text-slate-100">{cat.icon} {cat.label}</h4>
                    {hasData && (
                      <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                        {Math.abs(m.cope) > 0 ? `${m.cope} copë` : ''}
                      </span>
                    )}
                  </div>
                  {!hasData ? (
                    <p className="text-center text-xs text-slate-400 py-3">— pa shitje —</p>
                  ) : (
                    <div className="space-y-2">
                      {cols.map(c => {
                        const rev = m.revenue[c] || 0
                        const cost = m.cost[c] || 0
                        const prof = m.profit[c] || 0
                        if (Math.abs(rev) < 0.5) return null
                        return (
                          <div key={c} className="rounded-md bg-slate-50 dark:bg-slate-900/50 p-2">
                            <div className="flex justify-between items-baseline">
                              <span className="text-xs font-bold text-slate-500 uppercase">{c}</span>
                              <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${margin[c] == null ? 'bg-slate-100 text-slate-500' : margin[c] < 0 ? 'bg-rose-100 text-rose-700' : margin[c] < 15 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                marzh {fmtMargin(margin[c])}
                              </span>
                            </div>
                            <div className="grid grid-cols-3 gap-2 mt-1.5 text-[13px]">
                              <div>
                                <div className="text-[13px] uppercase text-slate-400">Shitur</div>
                                <div className="font-semibold text-slate-800 dark:text-slate-100 tabular-nums">{fmt(rev)}</div>
                              </div>
                              <div>
                                <div className="text-[13px] uppercase text-slate-400">Kosto</div>
                                <div className="font-semibold text-rose-700 dark:text-rose-400 tabular-nums">{fmt(cost)}</div>
                              </div>
                              <div>
                                <div className="text-[13px] uppercase text-slate-400">Fitim</div>
                                <div className={`font-bold tabular-nums ${prof < -0.005 ? 'text-rose-700' : 'text-emerald-700 dark:text-emerald-300'}`}>{fmt(prof)}</div>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                  {/* HAS (grama floriri i pastër) ka kuptim vetëm për kategorinë
                      e florit. Për diamant/të tjera nuk shfaqet edhe nëse ndonjë
                      rresht e ka > 0 (zakonisht gabim regjistrimi). */}
                  {hasData && (Math.abs(m.gram) > 0.001 || (cat.key === 'flori' && Math.abs(m.has) > 0.001)) && (
                    <div className="flex gap-3 mt-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
                      {Math.abs(m.gram) > 0.001 && <span className="text-slate-500"><strong>Gram:</strong> {fmtGram(m.gram)}</span>}
                      {cat.key === 'flori' && Math.abs(m.has) > 0.001 && <span className="text-yellow-700 dark:text-yellow-400"><strong>HAS:</strong> {fmtGram(m.has)} g</span>}
                    </div>
                  )}
                  {m.cope_unknown > 0 && (
                    <div className="mt-2 text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded px-2 py-1">
                      ⚠️ {m.cope_unknown} artikuj pa kosto → fitimi i mbivlerësuar
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Riparimet si burim shtesë i të ardhurave (nëse ka) ── */}
      {repairs.count > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-teal-200 dark:border-teal-800 overflow-hidden">
          <div className="h-1 bg-gradient-to-r from-teal-400 to-cyan-500"></div>
          <div className="p-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h4 className="text-base font-bold text-teal-800 dark:text-teal-200">🔧 Të Ardhura nga Riparimet</h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{repairs.count} riparime të dorëzuara në periudhë</p>
            </div>
            <div className="flex gap-3 flex-wrap">
              {cols.map(c => {
                const v = repairs.total[c] || 0
                if (Math.abs(v) < 0.5) return null
                const unpaid = repairs.unpaid[c] || 0
                return (
                  <div key={c} className="text-right">
                    <div className="text-[13px] uppercase text-slate-500 font-bold">{c}</div>
                    <div className="text-lg font-bold text-teal-700 dark:text-teal-300 tabular-nums">{fmt(v)}</div>
                    {Math.abs(unpaid) > 0.5 && (
                      <div className="text-xs text-rose-600 dark:text-rose-400">⚠️ {fmt(unpaid)} pa paguar</div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── 2. FITIMI TOTAL — numër i madh, i qartë ── */}
      <div className="bg-gradient-to-br from-emerald-500 to-emerald-700 dark:from-emerald-700 dark:to-emerald-900 rounded-xl shadow-lg p-4 text-white">
        <h3 className="text-sm font-bold uppercase tracking-wider opacity-90 mb-2">💰 Fitimi Total nga Shitjet</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {cols.map(c => {
            const v = totalProfit[c] || 0
            if (Math.abs(v) < 0.5) return null
            return (
              <div key={c} className="bg-white/15 rounded-lg px-3 py-2">
                <div className="text-xs uppercase font-bold opacity-80">{c}</div>
                <div className="text-2xl font-bold tabular-nums">{fmt(v)}</div>
              </div>
            )
          })}
        </div>
        <p className="text-xs opacity-80 mt-2">= Shitje − Kosto artikujsh. Shpenzimet operative më poshtë s'janë zbritur këtu.</p>
      </div>

      {/* ── 3. GJENDJA E BIZNESIT: Borxhet & Marketing (snapshot aktual) ── */}
      <div>
        <h3 className="text-base font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
          2. Gjendja në Periudhë <span className="text-xs font-normal normal-case text-slate-400">(sipas filtrit të datës)</span>
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Detyrime Klientesh — na detyrohen */}
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-sky-200 dark:border-sky-800 overflow-hidden">
            <div className="h-1 bg-gradient-to-r from-sky-400 to-blue-500"></div>
            <div className="p-3">
              <div className="flex items-baseline justify-between mb-2">
                <h4 className="text-base font-bold text-sky-800 dark:text-sky-200">📥 Na Detyrohen</h4>
                <span className="text-xs text-slate-500 tabular-nums">{debts.clients_count} klientë</span>
              </div>
              {cols.filter(c => Math.abs(debts.clients[c] || 0) > 0.5).length === 0 ? (
                <p className="text-center text-xs text-emerald-600 dark:text-emerald-400 py-3 font-semibold">✓ asnjë borxh klienti</p>
              ) : (
                <div className="space-y-1">
                  {cols.map(c => {
                    const v = debts.clients[c] || 0
                    if (Math.abs(v) < 0.5) return null
                    return (
                      <div key={c} className="flex justify-between items-baseline rounded bg-sky-50 dark:bg-sky-900/20 px-2 py-1">
                        <span className="text-xs font-bold text-sky-700 dark:text-sky-300 uppercase">{c}</span>
                        <span className="text-base font-bold text-sky-800 dark:text-sky-200 tabular-nums">{fmt(v)}</span>
                      </div>
                    )
                  })}
                </div>
              )}
              {debts.clients_has > 0.001 && (
                <div className="mt-1.5 rounded bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 px-2 py-1 text-xs">
                  <span className="font-bold text-yellow-800 dark:text-yellow-200">⚖️ HAS:</span>{' '}
                  <span className="font-bold text-yellow-900 dark:text-yellow-100 tabular-nums">{fmtGram(debts.clients_has)} g</span>
                </div>
              )}
              <div className="text-xs text-slate-400 mt-2 pt-1.5 border-t border-slate-100 dark:border-slate-700">
                <div className="font-semibold uppercase tracking-wider mb-0.5">Gjithsej (gjithë kohës)</div>
                <div className="flex flex-wrap gap-2">
                  <span>{debts.clients_count_all} klientë</span>
                  {cols.map(c => {
                    const v = debts.clients_all[c] || 0
                    if (Math.abs(v) < 0.5) return null
                    return <span key={c} className="tabular-nums"><strong className="text-sky-700 dark:text-sky-300">{fmt(v)}</strong> {c}</span>
                  })}
                  {debts.clients_has_all > 0.001 && (
                    <span className="tabular-nums"><strong className="text-yellow-700 dark:text-yellow-300">{fmtGram(debts.clients_has_all)}</strong> g HAS</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Detyrime Furnitori — u detyrohemi */}
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-rose-200 dark:border-rose-800 overflow-hidden">
            <div className="h-1 bg-gradient-to-r from-rose-400 to-rose-600"></div>
            <div className="p-3">
              <div className="flex items-baseline justify-between mb-2">
                <h4 className="text-base font-bold text-rose-800 dark:text-rose-200">📤 U Detyrohemi</h4>
                <span className="text-xs text-slate-500 tabular-nums">{debts.suppliers_count} furnitorë</span>
              </div>
              {cols.filter(c => Math.abs(debts.suppliers[c] || 0) > 0.5).length === 0 ? (
                <p className="text-center text-xs text-emerald-600 dark:text-emerald-400 py-3 font-semibold">✓ asnjë borxh furnitori</p>
              ) : (
                <div className="space-y-1">
                  {cols.map(c => {
                    const v = debts.suppliers[c] || 0
                    if (Math.abs(v) < 0.5) return null
                    return (
                      <div key={c} className="flex justify-between items-baseline rounded bg-rose-50 dark:bg-rose-900/20 px-2 py-1">
                        <span className="text-xs font-bold text-rose-700 dark:text-rose-300 uppercase">{c}</span>
                        <span className="text-base font-bold text-rose-800 dark:text-rose-200 tabular-nums">{fmt(v)}</span>
                      </div>
                    )
                  })}
                </div>
              )}
              {debts.suppliers_has > 0.001 && (
                <div className="mt-1.5 rounded bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 px-2 py-1 text-xs">
                  <span className="font-bold text-yellow-800 dark:text-yellow-200">⚖️ HAS:</span>{' '}
                  <span className="font-bold text-yellow-900 dark:text-yellow-100 tabular-nums">{fmtGram(debts.suppliers_has)} g</span>
                </div>
              )}
              <div className="text-xs text-slate-400 mt-2 pt-1.5 border-t border-slate-100 dark:border-slate-700">
                <div className="font-semibold uppercase tracking-wider mb-0.5">Gjithsej (gjithë kohës)</div>
                <div className="flex flex-wrap gap-2">
                  <span>{debts.suppliers_count_all} furnitorë</span>
                  {cols.map(c => {
                    const v = debts.suppliers_all[c] || 0
                    if (Math.abs(v) < 0.5) return null
                    return <span key={c} className="tabular-nums"><strong className="text-rose-700 dark:text-rose-300">{fmt(v)}</strong> {c}</span>
                  })}
                  {debts.suppliers_has_all > 0.001 && (
                    <span className="tabular-nums"><strong className="text-yellow-700 dark:text-yellow-300">{fmtGram(debts.suppliers_has_all)}</strong> g HAS</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Marketing — gjendja aktuale me ndarjen cash/produkt dhe variance buxheti */}
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-purple-200 dark:border-purple-800 overflow-hidden">
            <div className="h-1 bg-gradient-to-r from-purple-400 to-purple-600"></div>
            <div className="p-3">
              <div className="flex items-baseline justify-between mb-2">
                <h4 className="text-base font-bold text-purple-800 dark:text-purple-200">📣 Marketing</h4>
                <span className="text-xs text-slate-500 tabular-nums">{marketing.open_contracts} të hapura · {marketing.closed_contracts} mbyllur</span>
              </div>

              {/* Kostoja totale e marketing-ut (gjithë kohës) */}
              <div className="rounded bg-purple-50 dark:bg-purple-900/20 px-2 py-1.5 mb-2">
                <div className="text-[13px] uppercase text-purple-700 dark:text-purple-300 font-bold">Kostoja në Periudhë</div>
                <div className="text-lg font-bold text-purple-900 dark:text-purple-100 tabular-nums">{fmt(marketing.paid_total_eur)} EUR</div>
                <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs mt-0.5">
                  <span className="text-slate-600 dark:text-slate-300">💵 Cash: <strong>{fmt(marketing.paid_cash_eur_total)}</strong></span>
                  <span className="text-slate-600 dark:text-slate-300">🎁 Produkte: <strong>{fmt(marketing.paid_product_eur_total)}</strong> <span className="text-slate-400">({marketing.product_entries_count})</span></span>
                  <span className="text-slate-600 dark:text-slate-300">📎 Ekstra: <strong>{fmt(marketing.paid_extra_eur_total)}</strong> <span className="text-slate-400">({marketing.extra_entries_count})</span></span>
                </div>
              </div>

              {/* Buxheti vs reale */}
              <div className="space-y-1 text-[13px]">
                <div className="flex justify-between rounded px-2 py-0.5">
                  <span className="text-slate-500 dark:text-slate-400">Buxhet i caktuar (aktiv)</span>
                  <span className="font-semibold text-slate-700 dark:text-slate-200 tabular-nums">{fmt(marketing.open_budget_eur)} EUR</span>
                </div>
                <div className={`flex justify-between rounded px-2 py-0.5 ${marketing.budget_variance_eur > 0 ? 'bg-rose-50 dark:bg-rose-900/20' : 'bg-emerald-50 dark:bg-emerald-900/20'}`}>
                  <span className={marketing.budget_variance_eur > 0 ? 'text-rose-700 dark:text-rose-300 font-semibold' : 'text-emerald-700 dark:text-emerald-300 font-semibold'}>
                    {marketing.budget_variance_eur > 0 ? '⚠️ Mbi buxhet' : '✓ Nën buxhet'}
                  </span>
                  <span className={`font-bold tabular-nums ${marketing.budget_variance_eur > 0 ? 'text-rose-800 dark:text-rose-200' : 'text-emerald-800 dark:text-emerald-200'}`}>
                    {marketing.budget_variance_eur > 0 ? '+' : ''}{fmt(marketing.budget_variance_eur)} EUR
                  </span>
                </div>
              </div>

              {/* Totali gjithë kohës — reference e vazhdueshme pavarësisht
                  filtrit, që user të mos humbasë figurën e madhe të marketing-ut. */}
              <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-700 text-xs text-slate-400">
                <div className="font-semibold uppercase tracking-wider mb-0.5">Gjithsej (gjithë kohës)</div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  <span>{marketing.all_time.open_contracts} kontrata aktive</span>
                  <span className="tabular-nums"><strong className="text-purple-700 dark:text-purple-300">{fmt(marketing.all_time.paid_total_eur)}</strong> EUR paguar</span>
                  <span className="tabular-nums">{fmt(marketing.all_time.open_budget_eur)} EUR buxhet</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── 3. Metodat e pagesës + Shpenzime operative ── */}
      <div>
        <h3 className="text-base font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">3. Flukset Monetare (në periudhë)</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Metodat e pagesës */}
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-3">
          <h3 className="text-base font-bold text-slate-800 dark:text-slate-100 mb-2">💳 Metodat e Pagesës</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                <th className="text-left px-2 py-1.5 text-xs font-semibold uppercase">Metoda</th>
                {cols.map(c => <th key={c} className="text-right px-2 py-1.5 text-xs font-semibold">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {[
                ['cash',  '💵 Cash'],
                ['bank',  '🏦 Bankë'],
                ['pos',   '💳 POS'],
                ['debt',  '⚠️ Borxh'],
                ['mikse', '🔀 Mikse'],
              ].map(([key, label]) => {
                const row = byPaymentMethod[key] || {}
                const hasRow = cols.some(c => Math.abs(row[c] || 0) > 0.5)
                if (!hasRow) return null
                return (
                  <tr key={key} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="px-2 py-1.5 text-slate-700 dark:text-slate-200">{label}</td>
                    {cols.map(c => <Td key={c} value={row[c]} />)}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Shpenzime operative */}
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-rose-200 dark:border-rose-800 p-3">
          <h3 className="text-base font-bold text-rose-800 dark:text-rose-200 mb-2">🧾 Shpenzime (veçmas, s'zbriten)</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                <th className="text-left px-2 py-1.5 text-xs font-semibold uppercase">Zëri</th>
                {cols.map(c => <th key={c} className="text-right px-2 py-1.5 text-xs font-semibold">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {[
                ['daily',     'Ditore'],
                ['transport', 'Transporti'],
                ['marketing', 'Marketing'],
                ['workers',   'Punëtorët'],
              ].map(([key, label]) => {
                const row = expenses[key] || {}
                const hasRow = cols.some(c => Math.abs(row[c] || 0) > 0.5)
                if (!hasRow) return null
                return (
                  <tr key={key} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="px-2 py-1.5 text-slate-700 dark:text-slate-200">{label}</td>
                    {cols.map(c => <Td key={c} value={row[c]} className="text-rose-700 dark:text-rose-400" />)}
                  </tr>
                )
              })}
              {/* Rreshti i totalit */}
              <tr className="font-bold border-t-2 border-rose-200 dark:border-rose-800 bg-rose-50/50 dark:bg-rose-900/20">
                <td className="px-2 py-1.5 text-rose-800 dark:text-rose-200">TOTAL</td>
                {cols.map(c => {
                  const total = ['daily','transport','marketing','workers']
                    .reduce((s, k) => s + ((expenses[k] || {})[c] || 0), 0)
                  return <Td key={c} value={total} className="text-rose-800 dark:text-rose-200" />
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      </div>
    </div>
  )
}
