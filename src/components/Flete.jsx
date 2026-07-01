import { useState, useEffect, useRef } from 'react'

// Shared component for both Fletë Hyrje (kind='hyrje', adds stock) and Fletë Dalje
// (kind='dalje', removes stock). Each note has a number, date, optional notes, and
// a list of line items with product, barcode, name and quantity.

function n(v) { return parseFloat(v) || 0 }

function emptyItem() {
  return { product_id: null, barcode: '', name: '', qty: 1 }
}

function ProductPickerCell({ value, onPick }) {
  const [query, setQuery] = useState(value?.name || value?.barcode || '')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const timerRef = useRef(null)
  const boxRef = useRef(null)

  useEffect(() => { setQuery(value?.name || value?.barcode || '') }, [value?.name, value?.barcode])

  useEffect(() => {
    function onDoc(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const search = (q) => {
    clearTimeout(timerRef.current)
    if (!q.trim()) { setResults([]); return }
    timerRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const data = await fetch(`/api/products/search?q=${encodeURIComponent(q)}`).then(r => r.json())
        setResults(Array.isArray(data) ? data : [])
      } catch { setResults([]) }
      setLoading(false)
    }, 200)
  }

  const pick = (p) => { onPick(p); setOpen(false) }

  return (
    <div ref={boxRef} className="relative">
      <input
        type="text" value={query}
        placeholder="barkod ose emër..."
        onChange={e => { setQuery(e.target.value); search(e.target.value); setOpen(true) }}
        onFocus={() => query && setOpen(true)}
        onKeyDown={e => {
          if (e.key === 'Enter' && results.length > 0) { e.preventDefault(); pick(results[0]) }
        }}
        className="input-field-sm"
      />
      {open && (results.length > 0 || loading) && (
        <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-60 overflow-y-auto min-w-[280px]">
          {loading && <div className="p-2 text-[11px] text-slate-400">Duke kërkuar...</div>}
          {results.map(p => (
            <button
              key={p.id} type="button" onClick={() => pick(p)}
              className="w-full text-left px-3 py-1.5 hover:bg-blue-50 border-b border-slate-100 last:border-0"
            >
              <div className="text-xs font-medium text-slate-800 truncate">{p.name}</div>
              <div className="flex items-center justify-between text-[10px] text-slate-500">
                <span className="font-mono">{p.barcode || p.sku || '—'}</span>
                <span>stok: {p.stock}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function FleteList({ kind, date, onOpen, onCreate, onDelete, refreshKey }) {
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [fromDate, setFromDate] = useState(date)
  const [toDate, setToDate]     = useState(date)

  useEffect(() => { setFromDate(date); setToDate(date) }, [date])

  useEffect(() => {
    if (!fromDate || !toDate) return
    setLoading(true)
    const url = fromDate === toDate
      ? `/api/flete-${kind}/by-date/${fromDate}`
      : `/api/flete-${kind}/by-range?from=${fromDate}&to=${toDate}`
    fetch(url)
      .then(r => r.json())
      .then(d => { setList(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => { setList([]); setLoading(false) })
  }, [kind, fromDate, toDate, refreshKey])

  const rangeActive = fromDate !== date || toDate !== date
  const title = kind === 'hyrje' ? 'Fletë Hyrje' : 'Fletë Dalje'
  const icon  = kind === 'hyrje' ? '⬇️' : '⬆️'
  const verb  = kind === 'hyrje' ? 'hyrjes' : 'daljes'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-800">{icon} {title}</h2>
          <p className="text-xs text-slate-500">
            {fromDate === toDate
              ? `Lista e fletëve të ${verb} për këtë datë`
              : `Lista e fletëve të ${verb} nga ${fromDate} në ${toDate}`}
          </p>
        </div>
        <button onClick={onCreate} className="btn-primary">+ Fletë e Re</button>
      </div>

      <div className="card flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">📅</span>
          <span className="text-sm font-semibold text-slate-700">Filtër data</span>
        </div>
        <div>
          <label className="form-label">Nga data</label>
          <input type="date" value={fromDate} max={toDate}
            onChange={e => setFromDate(e.target.value)} className="input-field" />
        </div>
        <div>
          <label className="form-label">Deri më datë</label>
          <input type="date" value={toDate} min={fromDate}
            onChange={e => setToDate(e.target.value)} className="input-field" />
        </div>
        {rangeActive && (
          <button onClick={() => { setFromDate(date); setToDate(date) }} className="btn-secondary text-xs">
            Pastro filtrin
          </button>
        )}
      </div>

      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-400 text-sm">Duke ngarkuar...</div>
        ) : list.length === 0 ? (
          <div className="p-10 text-center">
            <div className="text-5xl mb-3">{icon}</div>
            <p className="text-slate-500 mb-4">Nuk ka fletë për këtë periudhë.</p>
            <button onClick={onCreate} className="btn-primary mx-auto">+ Krijo Fletën e Parë</button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Data</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Nr. Fletë</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Shënime</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase">Artikuj</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase">Sasi Totale</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase">Veprime</th>
              </tr>
            </thead>
            <tbody>
              {list.map(f => (
                <tr key={f.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-700">{f.date}</td>
                  <td className="px-4 py-3 font-mono text-xs">
                    <button onClick={() => onOpen(f.id)} className="text-blue-600 hover:underline font-semibold">
                      {f.ref_no}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-slate-600 text-xs">{f.notes || '—'}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">{f.item_count}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold text-slate-800">{n(f.total_qty).toLocaleString('sq-AL')}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1.5">
                      <button onClick={() => onOpen(f.id)} className="px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 text-xs font-medium">Hap</button>
                      <button onClick={() => onDelete(f.id, f.ref_no)} className="px-2.5 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 text-xs font-medium">Fshi</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function FleteEditor({ kind, date, fleteId, onClose, onSaved }) {
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [fleteDate, setFleteDate] = useState(date)
  const [refNo, setRefNo]       = useState('')
  const [notes, setNotes]       = useState('')
  const [items, setItems]       = useState([emptyItem()])

  useEffect(() => {
    let cancel = false
    async function init() {
      try {
        if (fleteId) {
          const f = await fetch(`/api/flete-${kind}/${fleteId}`).then(r => r.json())
          if (cancel) return
          setFleteDate(f.date || date)
          setRefNo(f.ref_no || '')
          setNotes(f.notes || '')
          setItems((f.items && f.items.length > 0) ? f.items : [emptyItem()])
        } else {
          setFleteDate(date)
          const r = await fetch(`/api/flete-${kind}/next-no?date=${date}`).then(r => r.json())
          if (cancel) return
          setRefNo(r.ref_no || '')
          setItems([emptyItem()])
        }
      } finally { if (!cancel) setLoading(false) }
    }
    init()
    return () => { cancel = true }
  }, [kind, date, fleteId])

  // When date changes (for new fletë), refresh ref_no
  useEffect(() => {
    if (loading || !fleteDate || fleteId) return
    let cancel = false
    fetch(`/api/flete-${kind}/next-no?date=${fleteDate}`)
      .then(r => r.json())
      .then(r => { if (!cancel) setRefNo(r.ref_no || '') })
      .catch(() => {})
    return () => { cancel = true }
  }, [fleteDate])

  const setItem = (idx, patch) =>
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, ...patch } : it))
  const addItem = () => setItems(prev => [...prev, emptyItem()])
  const removeItem = (idx) =>
    setItems(prev => prev.length === 1 ? [emptyItem()] : prev.filter((_, i) => i !== idx))
  const pickProduct = (idx, p) => {
    setItem(idx, { product_id: p.id, barcode: p.barcode || '', name: p.name })
  }

  const totalQty = items.reduce((s, it) => s + n(it.qty), 0)
  const validCount = items.filter(it => (it.name && it.name.trim()) || n(it.qty) > 0).length

  const save = async () => {
    if (saving) return
    const valid = items.filter(it => (it.name && it.name.trim()) || n(it.qty) > 0)
    if (valid.length === 0) { alert('Shtoni të paktën një artikull.'); return }
    setSaving(true)
    try {
      const payload = { date: fleteDate, ref_no: refNo, notes, items: valid }
      const url = fleteId ? `/api/flete-${kind}/${fleteId}` : `/api/flete-${kind}`
      const method = fleteId ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Gabim në ruajtje')
      }
      onSaved?.()
    } catch (e) { alert(e.message) }
    finally { setSaving(false) }
  }

  if (loading) {
    return <div className="card p-8 text-center text-slate-400">Duke ngarkuar...</div>
  }

  const title = kind === 'hyrje' ? 'Fletë Hyrje' : 'Fletë Dalje'
  const icon  = kind === 'hyrje' ? '⬇️' : '⬆️'
  const stockEffect = kind === 'hyrje'
    ? 'Stoku do të rritet me sasitë e mëposhtme.'
    : 'Stoku do të zbritet me sasitë e mëposhtme.'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="btn-secondary">← Mbrapa</button>
          <div>
            <h2 className="text-lg font-bold text-slate-800">
              {icon} {fleteId ? `Edito ${title}` : `${title} e Re`}
            </h2>
            <p className="text-xs text-slate-500 font-mono">Nr. {refNo}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="btn-secondary">Anulo</button>
          <button onClick={save} disabled={saving} className="btn-primary disabled:opacity-50">
            {saving ? '⏳ Duke ruajtur...' : '💾 Ruaj Fletën'}
          </button>
        </div>
      </div>

      <div className="card grid grid-cols-2 md:grid-cols-3 gap-4">
        <div>
          <label className="form-label">Nr. Fletë <span className="text-[10px] text-slate-400">(auto)</span></label>
          <input type="text" value={refNo} readOnly className="input-field font-mono bg-slate-50 cursor-not-allowed" />
        </div>
        <div>
          <label className="form-label">Datë</label>
          <input type="date" value={fleteDate} onChange={e => setFleteDate(e.target.value)} className="input-field" />
        </div>
        <div className="col-span-2 md:col-span-1">
          <label className="form-label">Shënime</label>
          <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
            className="input-field" placeholder="opsional" />
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
          ℹ️ {stockEffect}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-slate-500">
                <th className="px-2 py-2 text-left font-semibold w-8">#</th>
                <th className="px-2 py-2 text-left font-semibold w-72">Produkti (barkod ose emër)</th>
                <th className="px-2 py-2 text-left font-semibold w-32">Barkodi</th>
                <th className="px-2 py-2 text-right font-semibold w-20">Sasia</th>
                <th className="px-2 py-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => (
                <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-2 py-1 text-center text-slate-400">{idx + 1}</td>
                  <td className="px-1 py-1">
                    <ProductPickerCell value={it} onPick={p => pickProduct(idx, p)} />
                  </td>
                  <td className="px-1 py-1">
                    <input type="text" value={it.barcode} readOnly
                      className="input-field-sm font-mono bg-slate-50 text-slate-600" placeholder="—" />
                  </td>
                  <td className="px-1 py-1">
                    <input type="number" step="any" min="0" value={it.qty}
                      onChange={e => setItem(idx, { qty: e.target.value })}
                      className="input-field-sm text-right" />
                  </td>
                  <td className="px-1 py-1 text-center">
                    <button onClick={() => removeItem(idx)}
                      className="text-red-500 hover:text-red-700 text-sm" title="Hiq">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-blue-50 border-t-2 border-blue-200">
              <tr className="font-bold text-xs">
                <td colSpan={3} className="px-2 py-2 text-right text-slate-600">
                  TOTALI — {validCount} artikuj
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-blue-700">
                  {n(totalQty).toLocaleString('sq-AL')}
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="p-3 border-t border-slate-100">
          <button onClick={addItem} className="btn-secondary text-xs">+ Shto Artikull</button>
        </div>
      </div>
    </div>
  )
}

export default function Flete({ kind, date }) {
  const [mode, setMode] = useState('list')
  const [editingId, setEditingId] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const openFlete = (id) => { setEditingId(id); setMode('edit') }
  const createNew = ()   => { setEditingId(null); setMode('edit') }
  const backToList = ()  => { setEditingId(null); setMode('list') }
  const onSaved = ()     => { setRefreshKey(k => k + 1); backToList() }

  const deleteFlete = async (id, ref) => {
    const verb = kind === 'hyrje' ? 'rritur' : 'zbritur'
    if (!confirm(`Fshi fletën ${ref}? Stoku që ishte ${verb} do të kthehet.`)) return
    await fetch(`/api/flete-${kind}/${id}`, { method: 'DELETE' })
    setRefreshKey(k => k + 1)
  }

  if (mode === 'edit') {
    return <FleteEditor kind={kind} date={date} fleteId={editingId} onClose={backToList} onSaved={onSaved} />
  }
  return (
    <FleteList kind={kind} date={date}
      onOpen={openFlete} onCreate={createNew} onDelete={deleteFlete} refreshKey={refreshKey} />
  )
}
