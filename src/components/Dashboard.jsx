import { useState, useEffect } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from 'recharts'

const CAT_ICONS = {
  'Unazë': '💍', 'Vathë': '✨', 'Byzylyk': '📿',
  'Gjerdan / Varëse': '🏅', 'Komplet': '🎁',
  'Ora': '⌚', 'Diamant': '💎', 'Tjeter': '📦',
}

function n(v) { return parseFloat(v) || 0 }
function fmt(v, dec = 0) {
  return Number(v || 0).toLocaleString('sq-AL', {
    minimumFractionDigits: dec, maximumFractionDigits: dec,
  })
}
// Data lokale (jo UTC) — që të mos anashkalojmë ditën kur ora e serverit kthen UTC.
function toISOLocal(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}
function today() { return toISOLocal(new Date()) }
function daysAgo(k) {
  const d = new Date(); d.setDate(d.getDate() - k)
  return toISOLocal(d)
}
function monthStart() {
  const d = new Date(); d.setDate(1)
  return toISOLocal(d)
}

function diffDays(from, to) {
  const a = new Date(from + 'T00:00:00')
  const b = new Date(to   + 'T00:00:00')
  return Math.max(1, Math.round((b - a) / 86400000) + 1)
}
function dateAdd(iso, k) {
  const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + k)
  return toISOLocal(d)
}

// Grupimi automatik i grafikut për të shmangur 10 000+ shtylla:
//   ≤ 60 ditë → ditore
//   ≤ 180 ditë → javore (7-ditore)
//   > 180 ditë → mujore
function pickBucket(days) {
  if (days <= 60)  return 'day'
  if (days <= 180) return 'week'
  return 'month'
}

function bucketKey(dateStr, mode) {
  if (mode === 'day')   return dateStr
  if (mode === 'month') return dateStr.slice(0, 7) // YYYY-MM
  // week: hidhe në ditën e hënë (ISO week start)
  const d = new Date(dateStr + 'T00:00:00')
  const dow = d.getDay() // 0=Sun..6=Sat
  const backToMon = (dow === 0 ? 6 : dow - 1)
  d.setDate(d.getDate() - backToMon)
  return toISOLocal(d)
}

// Grupimi i shitjeve në kategoria kohore për grafikun.
function fillDailySales(invoices, from, to) {
  const days = diffDays(from, to)
  const mode = pickBucket(days)
  const bucket = {}
  for (const inv of invoices) {
    if (inv.cancelled) continue
    if (!inv.date) continue
    if (inv.date < from || inv.date > to) continue
    const rate = n(inv.exchange_rate) || 1
    const totLek = n(inv.total_with_vat) * rate
    const key = bucketKey(inv.date, mode)
    if (!bucket[key]) bucket[key] = { total: 0, count: 0 }
    bucket[key].total += totLek
    bucket[key].count += 1
  }
  // Kthe të gjitha rreshtat e bucket-it të renditura sipas çelësit.
  const keys = Object.keys(bucket).sort()
  return keys.map(key => ({
    date: key,
    lek_total: +bucket[key].total.toFixed(2),
    count: bucket[key].count,
    mode,
  }))
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  const mode = payload[0]?.payload?.mode
  const modeLabel = mode === 'week' ? 'java që fillon' : mode === 'month' ? 'muaji' : 'data'
  return (
    <div className="bg-slate-900 text-white text-xs px-3 py-2 rounded-xl shadow-xl">
      <p className="font-semibold mb-1">{modeLabel}: {label}</p>
      <p className="text-blue-300 tabular-nums">{fmt(payload[0]?.value, 0)} LEK</p>
      <p className="text-slate-400">{payload[0]?.payload?.count || 0} fatura</p>
    </div>
  )
}

export default function Dashboard({ onNavigate }) {
  // Periudha e zgjedhur — default: nga fillimi i muajit → sot.
  const [dateRange, setDateRange] = useState({ from: monthStart(), to: today() })

  const [products, setProducts]         = useState([])
  const [invoicesRange, setInvoicesRange] = useState([])
  const [arkaToday, setArkaToday]       = useState(null)
  const [clientDebts, setClientDebts]   = useState([])
  const [supplierDebts, setSupplierDebts] = useState([])
  const [invSummary, setInvSummary]     = useState(null)     // e përgjithshme (stok aktual)
  const [invSummaryRange, setInvSummaryRange] = useState(null) // për periudhën e zgjedhur (fitim)
  const [loading, setLoading]           = useState(false)      // range fetch
  const [initialLoad, setInitialLoad]   = useState(true)       // vetëm herën e parë

  // Snapshot-et që nuk varen nga data (stok, borxhe të hapura, arka e sotme).
  useEffect(() => {
    const t = today()
    Promise.all([
      fetch('/api/products').then(r => r.json()).catch(() => []),
      fetch(`/api/arka-ditore/${t}`).then(r => r.json()).catch(() => null),
      fetch('/api/client-debts/summary?onlyDebt=1').then(r => r.json()).catch(() => []),
      fetch('/api/supplier-debts/summary?onlyDebt=1').then(r => r.json()).catch(() => []),
      fetch('/api/inventory-summary').then(r => r.json()).catch(() => null),
    ])
      .then(([prods, arka, cDebts, sDebts, invSum]) => {
        setProducts(Array.isArray(prods) ? prods : [])
        setArkaToday(arka || null)
        setClientDebts(Array.isArray(cDebts) ? cDebts : [])
        setSupplierDebts(Array.isArray(sDebts) ? sDebts : [])
        setInvSummary(invSum || null)
      })
  }, [])

  // Të dhëna që varen nga periudha e zgjedhur (fatura, fitim).
  useEffect(() => {
    if (!dateRange.from || !dateRange.to) return
    setLoading(true)
    Promise.all([
      fetch(`/api/invoices/by-range?from=${dateRange.from}&to=${dateRange.to}`).then(r => r.json()).catch(() => []),
      fetch(`/api/inventory-summary?from=${dateRange.from}&to=${dateRange.to}`).then(r => r.json()).catch(() => null),
    ])
      .then(([invs, invSumRng]) => {
        setInvoicesRange(Array.isArray(invs) ? invs : [])
        setInvSummaryRange(invSumRng || null)
      })
      .finally(() => { setLoading(false); setInitialLoad(false) })
  }, [dateRange.from, dateRange.to])

  // ── Inventar
  const total      = products.length
  const lowStock   = products.filter(p => p.stock > 0 && p.stock <= p.min_stock).length
  const outOfStock = products.filter(p => p.stock === 0).length
  const invValueLek = n(invSummary?.totals?.total_value_with_vat_lek ?? invSummary?.totals?.total_value_lek)

  const alertProducts = products
    .filter(p => p.stock <= p.min_stock)
    .sort((a, b) => a.stock - b.stock)
    .slice(0, 8)

  const catBreakdown = Object.entries(
    products.reduce((acc, p) => { acc[p.category] = (acc[p.category] || 0) + 1; return acc }, {})
  ).sort((a, b) => b[1] - a[1])

  // ── Sales chart data — për periudhën e zgjedhur
  const chartData = fillDailySales(invoicesRange, dateRange.from, dateRange.to)
  const totalSalesLek = chartData.reduce((s, d) => s + d.lek_total, 0)
  const salesDays = chartData.filter(d => d.count > 0).length
  const rangeDays = diffDays(dateRange.from, dateRange.to)
  const chartMode = chartData[0]?.mode || 'day'
  const chartModeLabel = chartMode === 'week' ? 'javore' : chartMode === 'month' ? 'mujore' : 'ditore'

  // ── Fitimi për periudhën e zgjedhur (nga inventory-summary me date range)
  const salesRangeLek  = n(invSummaryRange?.totals?.sales_no_vat_lek)
  const cogsRangeLek   = n(invSummaryRange?.totals?.cogs_no_vat_lek)
  const profitRangeLek = n(invSummaryRange?.totals?.profit_no_vat_lek)
  const profitMarginPct = salesRangeLek > 0
    ? +((profitRangeLek / salesRangeLek) * 100).toFixed(2)
    : 0

  // Numri i faturave në periudhë
  const rangeInvoiceCount = invoicesRange.filter(i => !i.cancelled).length

  // Xhiro për periudhën, e ndarë sipas monedhës origjinale (pa konvertim).
  const xhiroByCurRange = invoicesRange.reduce((acc, inv) => {
    if (inv.cancelled) return acc
    const cur = inv.currency || 'LEK'
    acc[cur] = (acc[cur] || 0) + n(inv.total_with_vat)
    return acc
  }, {})
  const activeXhiroRange = Object.keys(xhiroByCurRange)
    .map(cur => ({ cur, v: xhiroByCurRange[cur] }))
    .filter(x => x.v > 0.005)

  // ── Sot: nga arka-ditore — multi-currency
  const CURS = ['LEK', 'EUR', 'USD', 'GBP', 'CHF']
  const CUR_SYM = { LEK: 'L', EUR: '€', USD: '$', GBP: '£', CHF: '₣' }
  const activeCash = CURS
    .map(c => ({ cur: c, v: n(arkaToday?.cash_balance?.[c]) }))
    .filter(x => Math.abs(x.v) > 0.005)
  const dueToday = CURS
    .map(c => ({ cur: c, v: n(arkaToday?.amount_due?.[c]) }))
    .filter(x => x.v > 0.005)
  const expensesToday = CURS
    .map(c => ({ cur: c, v: n(arkaToday?.expenses?.[c]) }))
    .filter(x => x.v > 0.005)
  const purchasesToday = CURS
    .map(c => ({ cur: c, v: n(arkaToday?.purchase_cash?.[c]) }))
    .filter(x => x.v > 0.005)

  // ── Borxhe të hapura (të përmbledhura nga /api/client-debts/summary dhe /supplier-debts)
  // Rreshtat vijnë të ndara sipas monedhës — për krye shfaqim total (LEK ekuivalent
  // afërsisht: nuk kemi këtu rate, kështu që vetëm ato në LEK grumbullojmë ekzakt,
  // për të tjerat po tregojmë numër furnitorësh/klientësh).
  const cDebtByCur = groupByCurrency(clientDebts)
  const sDebtByCur = groupByCurrency(supplierDebts)
  const clientDueLek   = cDebtByCur.LEK?.due || 0
  const supplierDueLek = sDebtByCur.LEK?.due || 0
  const clientDueOthers   = totalNonLek(cDebtByCur)
  const supplierDueOthers = totalNonLek(sDebtByCur)

  // ── Fatura fundit
  const recentInvoices = [...invoicesRange]
    .filter(i => !i.cancelled)
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.id || 0) - (a.id || 0))
    .slice(0, 6)

  if (initialLoad) return (
    <div className="flex items-center justify-center h-64 text-slate-400">
      <div className="text-center"><div className="text-4xl mb-3 animate-pulse">💍</div><p className="text-sm">Duke ngarkuar...</p></div>
    </div>
  )

  if (total === 0 && invoicesRange.length === 0) return (
    <div className="flex items-center justify-center h-[70vh]">
      <div className="card text-center py-16 px-10 max-w-md">
        <div className="text-6xl mb-4">💍</div>
        <h3 className="text-2xl font-bold text-slate-800 mb-2">Mirë se vini në Gold Shop!</h3>
        <p className="text-slate-500 mb-8 text-sm">Fillo me shtimin e produkteve ose regjistrimin e faturës së parë.</p>
        <div className="flex flex-col gap-2 max-w-xs mx-auto">
          <button onClick={() => onNavigate('products')} className="btn-primary">+ Shto Produktin e Parë</button>
          <button onClick={() => onNavigate('fatura-shitje')} className="btn-secondary">🧾 Fatura Shitje</button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="space-y-4 md:space-y-5">

      {/* Filtër Periudhe — ndikon te grafi, faturat, dhe fitimi */}
      <DateRangeFilter from={dateRange.from} to={dateRange.to} onChange={setDateRange} loading={loading} />

      {/* Rreshti 1 — SOT (Arka + Detyrime) */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 md:gap-4">
        <MultiCurrencyCard
          label="Xhiro (Periudha)"
          items={activeXhiroRange}
          emptyText="Asnjë faturë në periudhë"
          sub={`${rangeInvoiceCount} fatura · ${dateRange.from} → ${dateRange.to}`}
          icon="📈"
          color="emerald"
          onClick={() => onNavigate('fatura-shitje')}
        />
        <MultiCurrencyCard
          label="Kesh në Arkë Sot"
          items={activeCash}
          emptyText="Arka bosh"
          sub="Mbartje + Kesh − Shpenzime − Blerje kesh"
          icon="💵"
          color="blue"
          onClick={() => onNavigate('arka-ditore')}
        />
        <StatCard
          label="Detyrime Klientësh"
          value={clientDueLek > 0 ? fmt(clientDueLek) : '—'}
          sub={buildDebtSub(cDebtByCur, clientDebts.length, 'klientë')}
          icon="👥"
          color="rose"
          onClick={() => onNavigate('detyrime')}
        />
        <StatCard
          label="Detyrime Furnitorësh"
          value={supplierDueLek > 0 ? fmt(supplierDueLek) : '—'}
          sub={buildDebtSub(sDebtByCur, supplierDebts.length, 'furnitorë')}
          icon="🏭"
          color="amber"
          onClick={() => onNavigate('detyrime-furnitor')}
        />
      </div>

      {/* Rreshti 2 — Inventari */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 md:gap-4">
        <StatCard label="Gjithsej Produkte" value={fmt(total)} icon="📦" color="blue"
          onClick={() => onNavigate('products')} />
        <StatCard label="Stok i Ulët" value={fmt(lowStock)} icon="⚠️" color="amber"
          sub={lowStock > 0 ? 'shih listën poshtë' : 'gjithçka në rregull'} />
        <StatCard label="Pa Stok" value={fmt(outOfStock)} icon="🚫" color="rose"
          sub={outOfStock > 0 ? 'kërkon rifurnizim' : ''} />
        <StatCard label="Vlera Inventarit (LEK)" value={invValueLek > 0 ? fmt(invValueLek) : '—'} icon="💰" color="emerald"
          onClick={() => onNavigate('inventar-permbledhese')} />
      </div>

      {/* Rreshti 3 — Fitim & Marzh për periudhën */}
      <div className="card bg-gradient-to-r from-emerald-50 via-white to-emerald-50 border border-emerald-200">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div>
            <h3 className="font-semibold text-slate-800">💰 Fitimi &amp; Marzhi për Periudhën</h3>
            <p className="text-[11px] text-slate-500">
              {dateRange.from} → {dateRange.to} · nga faturat e shitjes minus kosto mesatare e blerjes (pa TVSH)
            </p>
          </div>
          <button onClick={() => onNavigate('inventar-permbledhese')} className="btn-secondary text-xs">Përmbledhëse Inventari →</button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MiniStat label="Shitje pa TVSH (LEK)" value={fmt(salesRangeLek)} color="blue" />
          <MiniStat label="Kosto e Shitur (LEK)" value={fmt(cogsRangeLek)} color="slate" />
          <MiniStat
            label="Fitim (LEK)"
            value={fmt(profitRangeLek)}
            color={profitRangeLek < 0 ? 'rose' : 'emerald'}
          />
          <MiniStat
            label="Marzh %"
            value={salesRangeLek > 0 ? `${fmt(profitMarginPct, 2)}%` : '—'}
            color={profitMarginPct < 0 ? 'rose' : 'emerald'}
          />
        </div>
      </div>

      {/* Sales chart */}
      <div className="card">
        <div className="flex items-center justify-between mb-3 md:mb-4 flex-wrap gap-2">
          <div className="min-w-0">
            <h3 className="text-sm md:text-base font-semibold text-slate-800">Shitjet — {rangeDays} ditë <span className="text-[10px] md:text-xs font-normal text-slate-500">({chartModeLabel})</span></h3>
            <p className="text-[10px] md:text-xs text-slate-500 mt-0.5 truncate">
              {fmt(totalSalesLek)} LEK · {rangeInvoiceCount} fatura · {chartData.length} kategori
            </p>
          </div>
          <button onClick={() => onNavigate('fatura-shitje')} className="btn-secondary text-xs whitespace-nowrap">Fatura Shitje →</button>
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: '#94a3b8' }}
              tickFormatter={d =>
                chartMode === 'month' ? d.slice(5) :        // MM
                chartMode === 'week'  ? d.slice(5, 10) :    // MM-DD (dita e hënë)
                d.slice(8)                                   // DD
              }
              axisLine={false}
              tickLine={false}
              interval={chartData.length > 40 ? Math.floor(chartData.length / 20) : 0}
            />
            <YAxis
              tick={{ fontSize: 10, fill: '#94a3b8' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={v => v ? fmt(v) : ''}
              width={50}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f1f5f9' }} />
            <Bar dataKey="lek_total" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={32} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Detaje ditore: shpenzime + blerje kesh + borxh (multi-currency) */}
      {(expensesToday.length > 0 || purchasesToday.length > 0 || dueToday.length > 0) && (
        <div className="card bg-slate-50">
          <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Sot — Dalje &amp; Borxh (sipas monedhës)</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <MiniList label="Shpenzime"   items={expensesToday}   color="orange" />
            <MiniList label="Blerje Kesh" items={purchasesToday}  color="amber"  />
            <MiniList label="Borxh sot"   items={dueToday}        color="rose"   />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 md:gap-5">

        {/* Kolona majtas: Alarme + Fatura Fundit */}
        <div className="xl:col-span-2 space-y-4 md:space-y-5">
          {/* Stock alerts */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-slate-800">Alarme Stoku</h3>
              {alertProducts.length > 0 && <span className="badge bg-red-100 text-red-700">{alertProducts.length} produkte</span>}
            </div>
            {alertProducts.length === 0 ? (
              <div className="text-center py-8 text-slate-400">
                <div className="text-4xl mb-2">✅</div>
                <p className="text-sm">Të gjitha produktet kanë stok të mjaftueshëm</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {alertProducts.map(p => (
                  <div key={p.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100 hover:border-blue-200 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0 ${p.stock === 0 ? 'bg-red-100' : 'bg-amber-100'}`}>
                        {CAT_ICONS[p.category] || '📦'}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-800 leading-tight">{p.name}</p>
                        <p className="text-xs text-slate-500">{p.brand && `${p.brand} · `}{p.category}</p>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <span className={`badge ${p.stock === 0 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                        {p.stock === 0 ? 'Pa stok' : `${p.stock} copë`}
                      </span>
                      <p className="text-xs text-slate-400 mt-0.5">Min: {p.min_stock}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {alertProducts.length > 0 && (
              <button onClick={() => onNavigate('products')} className="btn-secondary w-full mt-4 justify-center text-xs">
                Shko tek Produktet →
              </button>
            )}
          </div>

          {/* Fatura të fundit */}
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-slate-800">Faturat e Fundit</h3>
              <button onClick={() => onNavigate('fatura-shitje')} className="text-xs text-blue-600 hover:underline">Shih të gjitha →</button>
            </div>
            {recentInvoices.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-6">Asnjë faturë në këtë periudhë.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {recentInvoices.map(inv => {
                  const rate = n(inv.exchange_rate) || 1
                  const totLek = n(inv.total_with_vat) * rate
                  const pm = inv.payment_method
                  const pmBadge = pm === 'debt'
                    ? { cls: 'bg-amber-100 text-amber-700', txt: '⚠️ Borxh' }
                    : pm === 'bank'
                    ? { cls: 'bg-blue-100 text-blue-700', txt: '🏦 Bankë' }
                    : pm === 'pos'
                    ? { cls: 'bg-purple-100 text-purple-700', txt: '💳 POS' }
                    : pm === 'mikse'
                    ? { cls: 'bg-teal-100 text-teal-700', txt: '🔀 Mikse' }
                    : { cls: 'bg-emerald-100 text-emerald-700', txt: '💵 Cash' }
                  return (
                    <button
                      key={inv.id}
                      onClick={() => onNavigate('fatura-shitje', { date: inv.date, invoiceId: inv.id })}
                      className="w-full flex items-center justify-between py-2.5 hover:bg-slate-50 rounded-lg px-2"
                    >
                      <div className="min-w-0 text-left">
                        <p className="text-sm font-semibold text-slate-800 truncate">
                          {inv.customer_name || <span className="italic text-slate-400">— pa klient —</span>}
                        </p>
                        <p className="text-[11px] text-slate-500 font-mono">{inv.invoice_no} · {inv.date}</p>
                      </div>
                      <div className="text-right flex-shrink-0 ml-3">
                        <p className="text-sm font-bold text-slate-800 tabular-nums">{fmt(inv.total_with_vat, 2)} {inv.currency}</p>
                        <p className="text-[10px] text-slate-400 tabular-nums">≈ {fmt(totLek)} LEK</p>
                        <span className={`badge text-[9px] mt-0.5 inline-block ${pmBadge.cls}`}>{pmBadge.txt}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Kolona djathtas: Kategori + Veprime të Shpejta */}
        <div className="space-y-4">
          <div className="card">
            <h3 className="font-semibold text-slate-800 mb-3">Produkte sipas Kategorisë</h3>
            {catBreakdown.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-4">—</p>
            ) : (
              <div className="space-y-1.5 max-h-56 overflow-y-auto">
                {catBreakdown.map(([cat, cnt]) => (
                  <div key={cat} className="flex items-center justify-between py-1.5 border-b border-slate-50 last:border-0">
                    <div className="flex items-center gap-2">
                      <span>{CAT_ICONS[cat] || '📦'}</span>
                      <span className="text-sm text-slate-700">{cat}</span>
                    </div>
                    <span className="badge bg-blue-100 text-blue-700 font-semibold">{cnt}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <h3 className="font-semibold text-slate-800 mb-3">Veprime të Shpejta</h3>
            <div className="grid grid-cols-2 gap-2">
              {[
                { icon: '🧾', label: 'Fatura Shitje',      page: 'fatura-shitje' },
                { icon: '🛒', label: 'Fatura Blerje',      page: 'fatura-blerje' },
                { icon: '🏦', label: 'Arka Ditore',        page: 'arka-ditore' },
                { icon: '💼', label: 'Kasaforta',          page: 'arka-kasaforta' },
                { icon: '👥', label: 'Detyrime Klienti',   page: 'detyrime' },
                { icon: '🏭', label: 'Detyrime Furnitor',  page: 'detyrime-furnitor' },
                { icon: '📦', label: 'Produktet',          page: 'products' },
                { icon: '🏬', label: 'Magazina',           page: 'inventar-permbledhese' },
              ].map(a => (
                <button key={a.page} onClick={() => onNavigate(a.page)}
                  className="flex flex-col items-center gap-1 px-2 py-3 rounded-xl hover:bg-slate-50 border border-slate-100 hover:border-blue-200 transition-all text-center">
                  <span className="text-2xl">{a.icon}</span>
                  <span className="text-[11px] font-medium text-slate-700 leading-tight">{a.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── UI helpers ────────────────────────────────────────────────────────────

const COLOR_MAP = {
  blue:    { bg: 'bg-blue-50',    icBg: 'bg-blue-100',    text: 'text-blue-700' },
  emerald: { bg: 'bg-emerald-50', icBg: 'bg-emerald-100', text: 'text-emerald-700' },
  amber:   { bg: 'bg-amber-50',   icBg: 'bg-amber-100',   text: 'text-amber-700' },
  rose:    { bg: 'bg-rose-50',    icBg: 'bg-rose-100',    text: 'text-rose-700' },
  orange:  { bg: 'bg-orange-50',  icBg: 'bg-orange-100',  text: 'text-orange-700' },
  slate:   { bg: 'bg-slate-50',   icBg: 'bg-slate-100',   text: 'text-slate-700' },
}

function StatCard({ label, value, sub, icon, color = 'blue', onClick }) {
  const c = COLOR_MAP[color] || COLOR_MAP.blue
  const isClickable = typeof onClick === 'function'
  const Wrapper = isClickable ? 'button' : 'div'
  return (
    <Wrapper
      onClick={onClick}
      className={`card ${c.bg} !p-3 md:!p-4 ${isClickable ? 'text-left hover:ring-2 hover:ring-blue-200 transition' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] md:text-xs font-medium text-slate-500 mb-1 leading-tight">{label}</p>
          <p className={`text-lg md:text-2xl xl:text-3xl font-extrabold tabular-nums ${c.text} truncate leading-tight`}>{value}</p>
          {sub && <p className="text-[9px] md:text-[10px] text-slate-500 mt-1 truncate">{sub}</p>}
        </div>
        <div className={`w-8 h-8 md:w-11 md:h-11 ${c.icBg} rounded-lg md:rounded-xl flex items-center justify-center text-lg md:text-2xl flex-shrink-0`}>
          {icon}
        </div>
      </div>
    </Wrapper>
  )
}

function MiniStat({ label, value, color = 'slate' }) {
  const c = COLOR_MAP[color] || COLOR_MAP.slate
  return (
    <div className={`${c.bg} rounded-lg px-3 py-2`}>
      <p className="text-[10px] text-slate-500 uppercase font-semibold">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${c.text}`}>{value}</p>
    </div>
  )
}

function MiniList({ label, items, color = 'slate' }) {
  const c = COLOR_MAP[color] || COLOR_MAP.slate
  return (
    <div className={`${c.bg} rounded-lg px-3 py-2`}>
      <p className="text-[10px] text-slate-500 uppercase font-semibold">{label}</p>
      {items.length === 0 ? (
        <p className="text-lg font-bold tabular-nums text-slate-300">—</p>
      ) : (
        <div className="space-y-0.5 mt-0.5">
          {items.map(({ cur, v }) => (
            <div key={cur} className="flex items-baseline justify-between gap-2">
              <span className={`text-base font-bold tabular-nums ${c.text}`}>{fmt(v)}</span>
              <span className="text-[10px] text-slate-500 font-semibold">{cur}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Karta për një metrikë me shumësi monedhash (Xhiro / Kesh / Detyrime).
// Shfaq monedhën më të madhe si vlerë kryesore, të tjerat si sub-listë.
function MultiCurrencyCard({ label, items, emptyText, sub, icon, color = 'blue', onClick }) {
  const c = COLOR_MAP[color] || COLOR_MAP.blue
  const isClickable = typeof onClick === 'function'
  const Wrapper = isClickable ? 'button' : 'div'
  // Renditje: më e madhja në krye
  const sorted = [...items].sort((a, b) => Math.abs(b.v) - Math.abs(a.v))
  const primary = sorted[0]
  const rest    = sorted.slice(1)
  return (
    <Wrapper
      onClick={onClick}
      className={`card ${c.bg} !p-3 md:!p-4 ${isClickable ? 'text-left hover:ring-2 hover:ring-blue-200 transition' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] md:text-xs font-medium text-slate-500 mb-1 leading-tight">{label}</p>
          {!primary ? (
            <p className={`text-lg md:text-2xl xl:text-3xl font-extrabold ${c.text} truncate leading-tight`}>—</p>
          ) : (
            <>
              <p className={`text-lg md:text-2xl xl:text-3xl font-extrabold tabular-nums ${c.text} truncate leading-tight`}>
                {fmt(primary.v)} <span className="text-xs md:text-sm font-semibold text-slate-500">{primary.cur}</span>
              </p>
              {rest.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {rest.map(r => (
                    <div key={r.cur} className="text-[11px] md:text-xs text-slate-600 tabular-nums">
                      <span className="font-semibold">{fmt(r.v)}</span>{' '}
                      <span className="text-[9px] md:text-[10px] text-slate-500 font-medium">{r.cur}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {(!primary && emptyText) && <p className="text-[9px] md:text-[10px] text-slate-500 mt-1 truncate">{emptyText}</p>}
          {primary && sub && rest.length === 0 && <p className="text-[9px] md:text-[10px] text-slate-500 mt-1 truncate">{sub}</p>}
        </div>
        <div className={`w-8 h-8 md:w-11 md:h-11 ${c.icBg} rounded-lg md:rounded-xl flex items-center justify-center text-lg md:text-2xl flex-shrink-0`}>
          {icon}
        </div>
      </div>
    </Wrapper>
  )
}

// Filtër periudhe me presete të shpejta.
function DateRangeFilter({ from, to, onChange, loading }) {
  const setRange = (preset) => {
    const t = new Date()
    const iso = (d) => {
      const y = d.getFullYear()
      const m = String(d.getMonth() + 1).padStart(2, '0')
      const dd = String(d.getDate()).padStart(2, '0')
      return `${y}-${m}-${dd}`
    }
    if (preset === 'today')      onChange({ from: iso(t), to: iso(t) })
    else if (preset === '7d')    {
      const start = new Date(t); start.setDate(t.getDate() - 6)
      onChange({ from: iso(start), to: iso(t) })
    }
    else if (preset === '30d')   {
      const start = new Date(t); start.setDate(t.getDate() - 29)
      onChange({ from: iso(start), to: iso(t) })
    }
    else if (preset === 'month') {
      const first = new Date(t.getFullYear(), t.getMonth(), 1)
      onChange({ from: iso(first), to: iso(t) })
    }
    else if (preset === 'prevMonth') {
      const first = new Date(t.getFullYear(), t.getMonth() - 1, 1)
      const last  = new Date(t.getFullYear(), t.getMonth(), 0)
      onChange({ from: iso(first), to: iso(last) })
    }
    else if (preset === 'year')  {
      const first = new Date(t.getFullYear(), 0, 1)
      onChange({ from: iso(first), to: iso(t) })
    }
    else if (preset === 'all') {
      onChange({ from: '2000-01-01', to: iso(t) })
    }
  }
  return (
    <div className="card flex flex-wrap items-end gap-3">
      <div className="flex items-center gap-2">
        <span className="text-2xl">📅</span>
        <div>
          <p className="text-sm font-semibold text-slate-700 leading-none">Filtër Periudhe</p>
          <p className="text-[10px] text-slate-500 mt-0.5">Ndikon: grafiku, faturat, fitim &amp; marzh</p>
        </div>
      </div>
      <div>
        <label className="form-label">Nga</label>
        <input type="date" value={from} max={to}
          onChange={e => onChange({ from: e.target.value, to })}
          className="input-field" />
      </div>
      <div>
        <label className="form-label">Deri</label>
        <input type="date" value={to} min={from}
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

// Përmbledh rreshtat e endpoint-it debts/summary sipas monedhës
function groupByCurrency(rows) {
  const g = {}
  for (const r of rows) {
    const cur = r.currency || 'LEK'
    if (!g[cur]) g[cur] = { total: 0, paid: 0, due: 0, count: 0 }
    g[cur].total += n(r.total)
    g[cur].paid  += n(r.paid)
    g[cur].due   += n(r.due)
    g[cur].count += 1
  }
  return g
}
function totalNonLek(byCur) {
  let s = 0
  for (const cur of Object.keys(byCur)) {
    if (cur === 'LEK') continue
    s += byCur[cur].due
  }
  return s
}
function buildDebtSub(byCur, entityCount, entityLabel) {
  const parts = []
  const others = Object.entries(byCur).filter(([c]) => c !== 'LEK')
  for (const [cur, t] of others) {
    if (t.due > 0.005) parts.push(`${fmt(t.due, 0)} ${cur}`)
  }
  if (parts.length === 0 && entityCount > 0) return `${entityCount} ${entityLabel} me borxh`
  if (parts.length === 0) return 'asnjë borxh i hapur'
  return parts.join(' · ') + ` · ${entityCount} ${entityLabel}`
}
