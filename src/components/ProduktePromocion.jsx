import { useEffect, useState } from 'react'
import { getUser } from '../lib/auth.js'

const CAT_ICONS = {
  'Unazë': '💍', 'Vathë': '✨', 'Byzylyk': '📿',
  'Gjerdan / Varëse': '🏅', 'Komplet': '🎁',
  'Ora': '⌚', 'Diamant': '💎', 'Tjeter': '📦',
}

function fmt(v) {
  const x = parseFloat(v) || 0
  return x.toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Listë e produkteve që janë aktualisht në promocion.
// Admin mund të heqë promocionin direkt nga këtu.
export default function ProduktePromocion({ onNavigate }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [search, setSearch] = useState('')
  const isAdmin = getUser()?.role === 'admin'

  const load = async () => {
    setLoading(true)
    try {
      const all = await fetch('/api/products').then(r => r.json())
      const promo = (Array.isArray(all) ? all : []).filter(p => !!p.is_promotion)
      setRows(promo)
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const remove = async (id) => {
    if (!confirm('Hiqe produktin nga promocioni?')) return
    setBusyId(id)
    try {
      await fetch(`/api/products/${id}/promotion`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ on: false }),
      })
      load()
    } finally { setBusyId(null) }
  }

  const q = search.toLowerCase().trim()
  const visible = q
    ? rows.filter(p =>
        [p.name, p.sku, p.barcode, p.brand, p.category].some(f =>
          String(f || '').toLowerCase().includes(q)
        ))
    : rows

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-800">🏷️ Produkte në Promocion</h2>
            <p className="text-xs text-slate-500 mt-1">
              Produktet e shënuara nga admin si aktualisht në promocion. Për t'i shtuar, shko tek Produktet ose Fatura Blerje.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text" value={search} onChange={e => setSearch(e.target.value)}
              className="input-field w-56 text-sm"
              placeholder="Kërko emër / SKU / barkod..."
            />
            {isAdmin && (
              <button onClick={() => onNavigate?.('products')} className="btn-secondary text-xs whitespace-nowrap">
                → Të gjitha produktet
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {visible.length} {visible.length === 1 ? 'produkt' : 'produkte'}
          </h3>
          {rows.length > 0 && isAdmin && (
            <span className="text-[10px] text-slate-400">Kliko 🗑 për të hequr promocionin</span>
          )}
        </div>

        {loading ? (
          <div className="p-8 text-center text-slate-400 text-sm">Duke ngarkuar...</div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-slate-400">
            <div className="text-4xl mb-2">🏷️</div>
            <p className="text-sm">Asnjë produkt në promocion aktualisht.</p>
            <p className="text-xs mt-1">Shënoje një produkt nga Produktet ose gjatë krijimit të Fatura Blerje.</p>
          </div>
        ) : visible.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">Asgjë nuk përputhet me kërkimin.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-3 py-2 text-left  text-xs font-semibold text-slate-500 uppercase">Kategoria</th>
                  <th className="px-3 py-2 text-left  text-xs font-semibold text-slate-500 uppercase">Produkti</th>
                  <th className="px-3 py-2 text-left  text-xs font-semibold text-slate-500 uppercase">SKU / Barkod</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase">Çmimi Origjinal</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-rose-600 uppercase" title="Zbritja aktuale e promocionit">Zbritja %</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-emerald-700 uppercase" title="Çmimi pas aplikimit të zbritjes së promocionit">Çmimi me Promo</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase">Stok</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase"></th>
                </tr>
              </thead>
              <tbody>
                {visible.map(p => {
                  const pct = parseFloat(p.promo_discount_pct) || 0
                  const orig = parseFloat(p.sell_price) || 0
                  const promoPrice = +(orig * (1 - pct / 100)).toFixed(2)
                  return (
                  <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2 text-slate-600">
                      <span className="mr-1.5">{CAT_ICONS[p.category] || '📦'}</span>
                      <span className="text-xs">{p.category}</span>
                    </td>
                    <td className="px-3 py-2">
                      <p className="text-sm font-semibold text-slate-800 leading-tight">{p.name}</p>
                      {p.brand && <p className="text-[11px] text-slate-500">{p.brand}</p>}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-500">
                      {p.sku || '—'}
                      {p.barcode && <div className="text-slate-400">{p.barcode}</div>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500 line-through">
                      €{fmt(orig)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-bold text-rose-600">
                      {pct > 0 ? `-${fmt(pct)}%` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-bold text-emerald-700">
                      €{fmt(promoPrice)}
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums font-medium ${p.stock === 0 ? 'text-rose-600' : p.stock <= p.min_stock ? 'text-amber-600' : 'text-slate-700'}`}>
                      {p.stock ?? 0}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {isAdmin ? (
                        <button
                          onClick={() => remove(p.id)}
                          disabled={busyId === p.id}
                          className="px-2 py-1 rounded-lg text-xs text-rose-600 hover:bg-rose-50 font-medium disabled:opacity-50"
                          title="Hiqe nga promocioni"
                        >🗑 Hiq</button>
                      ) : <span className="text-[10px] text-slate-300">—</span>}
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
