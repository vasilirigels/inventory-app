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

function fmt(v, dec = 0) {
  return Number(v || 0).toLocaleString('sq-AL', {
    minimumFractionDigits: dec, maximumFractionDigits: dec,
  })
}

// Fill missing dates in chart data
function fillDates(rows, days) {
  const map = {}
  rows.forEach(r => { map[r.date] = r })
  const result = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const key = d.toISOString().split('T')[0]
    result.push(map[key] || { date: key, eur_total: 0, lek_total: 0, count: 0 })
  }
  return result
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-slate-900 text-white text-xs px-3 py-2 rounded-xl shadow-xl">
      <p className="font-semibold mb-1">{label}</p>
      <p className="text-blue-300">€{fmt(payload[0]?.value, 2)}</p>
      <p className="text-slate-400">{payload[1]?.value} shitje</p>
    </div>
  )
}

export default function Dashboard({ onNavigate }) {
  const [products, setProducts]   = useState([])
  const [chartData, setChartData] = useState([])
  const [loading, setLoading]     = useState(true)
  const DAYS = 14

  useEffect(() => {
    Promise.all([
      fetch('/api/products').then(r => r.json()),
      fetch(`/api/sales/recent?days=${DAYS}`).then(r => r.json()),
    ])
      .then(([prods, sales]) => {
        setProducts(Array.isArray(prods) ? prods : [])
        setChartData(fillDates(Array.isArray(sales) ? sales : [], DAYS))
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const total      = products.length
  const lowStock   = products.filter(p => p.stock > 0 && p.stock <= p.min_stock).length
  const outOfStock = products.filter(p => p.stock === 0).length
  const totalValue = products.reduce((s, p) => s + p.stock * p.sell_price, 0)

  const alertProducts = products
    .filter(p => p.stock <= p.min_stock)
    .sort((a, b) => a.stock - b.stock)

  const catBreakdown = Object.entries(
    products.reduce((acc, p) => { acc[p.category] = (acc[p.category] || 0) + 1; return acc }, {})
  ).sort((a, b) => b[1] - a[1])

  const totalSalesEur = chartData.reduce((s, d) => s + (d.eur_total || 0), 0)
  const salesDays = chartData.filter(d => d.count > 0).length

  const STATS = [
    { label: 'Gjithsej Produkte', value: total,     icon: '📦', bg: 'bg-blue-50',   ic: 'bg-blue-100',    color: 'text-blue-700' },
    { label: 'Stok i Ulët',       value: lowStock,  icon: '⚠️',  bg: 'bg-amber-50',  ic: 'bg-amber-100',   color: 'text-amber-700' },
    { label: 'Pa Stok',           value: outOfStock, icon: '🚫', bg: 'bg-red-50',    ic: 'bg-red-100',     color: 'text-red-700' },
    { label: 'Vlera Inventarit',  value: `€${fmt(totalValue)}`, icon: '💰', bg: 'bg-emerald-50', ic: 'bg-emerald-100', color: 'text-emerald-700' },
  ]

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-slate-400">
      <div className="text-center"><div className="text-4xl mb-3 animate-pulse">💍</div><p className="text-sm">Duke ngarkuar...</p></div>
    </div>
  )

  if (total === 0 && chartData.every(d => d.count === 0)) return (
    <div className="flex items-center justify-center h-[70vh]">
      <div className="card text-center py-16 px-10 max-w-md">
        <div className="text-6xl mb-4">💍</div>
        <h3 className="text-2xl font-bold text-slate-800 mb-2">Mirë se vini në Gold Shop!</h3>
        <p className="text-slate-500 mb-8 text-sm">Katalogu është bosh. Shtoni artikujt e parë.</p>
        <button onClick={() => onNavigate('products')} className="btn-primary mx-auto">
          + Shto Produktin e Parë
        </button>
      </div>
    </div>
  )

  return (
    <div className="space-y-5">

      {/* Stats */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {STATS.map(s => (
          <div key={s.label} className={`card ${s.bg}`}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-slate-500 mb-1">{s.label}</p>
                <p className={`text-3xl font-extrabold ${s.color}`}>{s.value}</p>
              </div>
              <div className={`w-11 h-11 ${s.ic} rounded-xl flex items-center justify-center text-2xl flex-shrink-0`}>
                {s.icon}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Sales chart */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-slate-800">Shitjet — {DAYS} ditët e fundit</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              €{fmt(totalSalesEur, 2)} total · {salesDays} ditë me shitje
            </p>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: '#94a3b8' }}
              tickFormatter={d => d.slice(8)}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 10, fill: '#94a3b8' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={v => v ? `€${fmt(v)}` : ''}
              width={60}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f1f5f9' }} />
            <Bar dataKey="eur_total" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={32} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-3 gap-5">

        {/* Stock alerts */}
        <div className="col-span-2 card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-slate-800">Alarme Stoku</h3>
            {alertProducts.length > 0 && <span className="badge-red">{alertProducts.length} produkte</span>}
          </div>
          {alertProducts.length === 0 ? (
            <div className="text-center py-8 text-slate-400">
              <div className="text-4xl mb-2">✅</div>
              <p className="text-sm">Të gjitha produktet kanë stok të mjaftueshëm</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto">
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
                    <span className={`badge ${p.stock === 0 ? 'badge-red' : 'badge-yellow'}`}>
                      {p.stock === 0 ? 'Pa stok' : `${p.stock} cope`}
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

        {/* Category + quick nav */}
        <div className="space-y-4">
          <div className="card">
            <h3 className="font-semibold text-slate-800 mb-3">Sipas Kategorisë</h3>
            {catBreakdown.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-4">—</p>
            ) : (
              <div className="space-y-1.5">
                {catBreakdown.map(([cat, cnt]) => (
                  <div key={cat} className="flex items-center justify-between py-1.5 border-b border-slate-50 last:border-0">
                    <div className="flex items-center gap-2">
                      <span>{CAT_ICONS[cat] || '📦'}</span>
                      <span className="text-sm text-slate-700">{cat}</span>
                    </div>
                    <span className="badge-blue font-semibold">{cnt}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <h3 className="font-semibold text-slate-800 mb-3">Veprime të Shpejta</h3>
            <div className="space-y-2">
              {[
                { icon: '📦', label: 'Shto Produkt',    page: 'products' },
                { icon: '👥', label: 'Klientët',         page: 'customers' },
              ].map(a => (
                <button key={a.page} onClick={() => onNavigate(a.page)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-50 border border-slate-100 hover:border-blue-200 transition-all text-left">
                  <span className="text-xl">{a.icon}</span>
                  <span className="text-sm font-medium text-slate-700">{a.label}</span>
                  <span className="ml-auto text-slate-300 text-xs">→</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
