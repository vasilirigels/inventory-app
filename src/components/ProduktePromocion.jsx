import { useEffect, useState } from 'react'
import { getUser } from '../lib/auth.js'
import MoneyInput from './MoneyInput.jsx'

const CAT_ICONS = {
  'Unazë': '💍', 'Vathë': '✨', 'Byzylyk': '📿',
  'Gjerdan / Varëse': '🏅', 'Komplet': '🎁',
  'Ora': '⌚', 'Diamant': '💎', 'Tjeter': '📦',
}

function fmt(v) {
  const x = parseFloat(v) || 0
  return x.toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Listë e produkteve që janë aktualisht në promocion. Admin mund të ndryshojë
// çmimin origjinal, % e zbritjes, ose të heqë promocionin nga këtu.
export default function ProduktePromocion({ onNavigate }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [search, setSearch] = useState('')
  // Edits lokale për çdo rresht: { [id]: { sell_price?, promo_discount_pct? } }
  const [edits, setEdits] = useState({})
  // Feedback pas ruajtjes: { [id]: 'ok' | 'err' }
  const [flash, setFlash] = useState({})
  const isAdmin = getUser()?.role === 'admin'

  const load = async () => {
    setLoading(true)
    try {
      const all = await fetch('/api/products').then(r => r.json())
      const promo = (Array.isArray(all) ? all : []).filter(p => !!p.is_promotion)
      setRows(promo)
      setEdits({})
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

  const setEdit = (id, patch) => {
    setEdits(prev => ({ ...prev, [id]: { ...(prev[id] || {}), ...patch } }))
  }

  const showFlash = (id, kind) => {
    setFlash(prev => ({ ...prev, [id]: kind }))
    setTimeout(() => setFlash(prev => {
      const { [id]: _, ...rest } = prev
      return rest
    }), 1500)
  }

  const save = async (p) => {
    const patch = edits[p.id] || {}
    const newSell = patch.sell_price != null ? parseFloat(patch.sell_price) : (parseFloat(p.sell_price) || 0)
    const newPct  = patch.promo_discount_pct != null
      ? Math.max(0, Math.min(100, parseFloat(patch.promo_discount_pct) || 0))
      : (parseFloat(p.promo_discount_pct) || 0)
    setBusyId(p.id)
    try {
      const res = await fetch(`/api/products/${p.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...p,
          sell_price: newSell,
          promo_discount_pct: newPct,
          is_promotion: 1,
        }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        alert(e.message || e.error || 'Gabim gjatë ruajtjes')
        showFlash(p.id, 'err')
        return
      }
      showFlash(p.id, 'ok')
      // Përditëso rreshtin lokalisht pa u nisur për një load të plotë
      setRows(prev => prev.map(x => x.id === p.id
        ? { ...x, sell_price: newSell, promo_discount_pct: newPct }
        : x))
      setEdits(prev => { const { [p.id]: _, ...rest } = prev; return rest })
    } catch (e) {
      alert(e.message || 'Gabim')
      showFlash(p.id, 'err')
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
              Produktet e shënuara nga admin si aktualisht në promocion. Mund të ndryshosh Çmimin Origjinal dhe % e Zbritjes direkt këtu.
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
            <span className="text-[10px] text-slate-400">Ndrysho vlerat dhe kliko 💾 për të ruajtur</span>
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
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase w-32">Çmimi Origjinal</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-rose-600 uppercase w-24" title="Zbritja aktuale e promocionit">Zbritja %</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-emerald-700 uppercase" title="Çmimi pas aplikimit të zbritjes së promocionit">Çmimi me Promo</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase">Stok</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase w-28"></th>
                </tr>
              </thead>
              <tbody>
                {visible.map(p => {
                  const patch = edits[p.id] || {}
                  const editedSell = patch.sell_price != null ? parseFloat(patch.sell_price) : parseFloat(p.sell_price) || 0
                  const editedPct  = patch.promo_discount_pct != null
                    ? parseFloat(patch.promo_discount_pct) || 0
                    : parseFloat(p.promo_discount_pct) || 0
                  const promoPrice = +(editedSell * (1 - editedPct / 100)).toFixed(2)
                  const dirty = patch.sell_price != null || patch.promo_discount_pct != null
                  const busy = busyId === p.id
                  const fl = flash[p.id]
                  return (
                  <tr key={p.id} className={`border-b border-slate-100 hover:bg-slate-50 ${dirty ? 'bg-amber-50/40' : ''}`}>
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
                    <td className="px-3 py-2">
                      {isAdmin ? (
                        <MoneyInput
                          value={editedSell}
                          onChange={v => setEdit(p.id, { sell_price: v })}
                          className="input-field-sm text-right tabular-nums w-full"
                        />
                      ) : (
                        <span className="text-right tabular-nums text-slate-500 line-through">€{fmt(editedSell)}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {isAdmin ? (
                        <input
                          type="number" step="0.01" min="0" max="100"
                          value={editedPct}
                          onChange={e => setEdit(p.id, { promo_discount_pct: e.target.value })}
                          className="input-field-sm text-right tabular-nums w-full font-bold text-rose-600"
                        />
                      ) : (
                        <span className="text-right tabular-nums font-bold text-rose-600">
                          {editedPct > 0 ? `-${fmt(editedPct)}%` : '—'}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-bold text-emerald-700">
                      €{fmt(promoPrice)}
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums font-medium ${p.stock === 0 ? 'text-rose-600' : p.stock <= p.min_stock ? 'text-amber-600' : 'text-slate-700'}`}>
                      {p.stock ?? 0}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {isAdmin ? (
                        <div className="flex items-center justify-end gap-1">
                          {fl === 'ok' && <span className="text-[10px] text-emerald-600 font-semibold">✓</span>}
                          {fl === 'err' && <span className="text-[10px] text-rose-600 font-semibold">✕</span>}
                          <button
                            onClick={() => save(p)}
                            disabled={busy || !dirty}
                            className="px-2 py-1 rounded-lg text-xs bg-blue-50 text-blue-700 hover:bg-blue-100 font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                            title="Ruaj ndryshimet"
                          >💾</button>
                          <button
                            onClick={() => remove(p.id)}
                            disabled={busy}
                            className="px-2 py-1 rounded-lg text-xs text-rose-600 hover:bg-rose-50 font-medium disabled:opacity-50"
                            title="Hiqe nga promocioni"
                          >🗑</button>
                        </div>
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
