import { useState, useEffect, useCallback, useRef } from 'react'
import { useRealtimeSync } from '../hooks/useRealtimeSync.js'
import * as XLSX from 'xlsx'

// ── Image upload helpers ───────────────────────────────────────────────────────
function ProductImage({ product, onUploaded }) {
  const inputRef = useRef()
  const [uploading, setUploading] = useState(false)

  const imgSrc = product.image_path
    ? `/uploads/products/${product.image_path}`
    : null

  const handleFile = async e => {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    const fd = new FormData()
    fd.append('image', file)
    try {
      const res = await fetch(`/api/products/${product.id}/image`, { method: 'POST', body: fd })
      const data = await res.json()
      if (data.success) onUploaded()
    } catch (err) { console.error(err) }
    setUploading(false)
  }

  const handleRemove = async e => {
    e.stopPropagation()
    await fetch(`/api/products/${product.id}/image`, { method: 'DELETE' })
    onUploaded()
  }

  return (
    <div
      className="relative group/img cursor-pointer"
      onClick={() => inputRef.current.click()}
      title="Kliko për të ndryshuar foton"
    >
      {imgSrc ? (
        <img src={imgSrc} alt={product.name}
          className="w-14 h-14 rounded-2xl object-cover border border-slate-200" />
      ) : (
        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-3xl
          bg-slate-100 hover:bg-blue-50 transition-colors`}>
          {CAT_ICONS[product.category] || '📦'}
        </div>
      )}
      {uploading && (
        <div className="absolute inset-0 rounded-2xl bg-white/70 flex items-center justify-center text-xs">⏳</div>
      )}
      {imgSrc && (
        <button onClick={handleRemove}
          className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full text-xs flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-opacity">
          ×
        </button>
      )}
      <input ref={inputRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
    </div>
  )
}

// ── Constants ──────────────────────────────────────────────────────────────────
const CATEGORIES = [
  'Flori', 'Diamant', 'Ora',
  'Unazë', 'Vathë', 'Byzylyk', 'Gjerdan / Varëse',
  'Komplet', 'Tjeter',
]
const CAT_ICONS = {
  'Flori':           '🟡',
  'Diamant':         '💎',
  'Ora':             '⌚',
  'Unazë':           '💍',
  'Vathë':           '✨',
  'Byzylyk':         '📿',
  'Gjerdan / Varëse':'🏅',
  'Komplet':         '🎁',
  'Tjeter':          '📦',
}
const CAT_COLORS = {
  'Flori':           'bg-yellow-100 text-yellow-800',
  'Diamant':         'bg-blue-100 text-blue-800',
  'Ora':             'bg-slate-100 text-slate-700',
  'Unazë':           'bg-yellow-100 text-yellow-800',
  'Vathë':           'bg-pink-100 text-pink-800',
  'Byzylyk':         'bg-amber-100 text-amber-800',
  'Gjerdan / Varëse':'bg-orange-100 text-orange-800',
  'Komplet':         'bg-purple-100 text-purple-800',
  'Tjeter':          'bg-gray-100 text-gray-700',
}
const EMPTY = {
  name: '', sku: '', barcode: '', category: 'Unazë',
  brand: '', description: '', cost_price: '', sell_price: '',
  stock: '', min_stock: '5', vat_rate: '20',
}

const VAT_OPTIONS = [0, 6, 10, 20]

// ── Helpers ────────────────────────────────────────────────────────────────────
const productNo = id => `GS-${String(id).padStart(4, '0')}`

function StockBadge({ stock, minStock }) {
  if (stock === 0)
    return <span className="badge badge-red">Pa stok</span>
  if (stock <= minStock)
    return <span className="badge badge-yellow">{stock} cope</span>
  return <span className="badge badge-green">{stock} cope</span>
}

// ── Excel column auto-detector ─────────────────────────────────────────────────
function detectMapping(headers) {
  const find = (...keys) => {
    for (const k of keys) {
      const i = headers.findIndex(h =>
        String(h).toLowerCase().replace(/\s+/g, '_').includes(k.toLowerCase())
      )
      if (i !== -1) return i
    }
    return -1
  }
  return {
    name:       find('emri', 'name', 'produkt', 'article', 'pershkrim', 'description', 'artikull'),
    category:   find('kategori', 'category', 'tip', 'lloj'),
    brand:      find('brendi', 'brand', 'prodhu', 'furnitor'),
    sku:        find('sku', 'kodi', 'code', 'ref', 'nr.', 'nr '),
    barcode:    find('barkod', 'barcode'),
    cost_price: find('kosto', 'cost', 'blerje', 'cmimi_k', 'çmimi_k'),
    sell_price: find('shitje', 'sell', 'price', 'çmimi_sh', 'cmimi_sh', 'çmimi', 'cmimi'),
    stock:      find('stoku', 'stock', 'sasia', 'qty', 'quantity', 'gjendje', 'cope'),
    min_stock:  find('minim', 'min_stock', 'alarm'),
  }
}

function rowToProduct(row, m) {
  const get = (idx, def = '') => idx >= 0 ? (row[idx] ?? def) : def
  return {
    name:       String(get(m.name, '')).trim(),
    category:   String(get(m.category, 'Tjeter')).trim() || 'Tjeter',
    brand:      String(get(m.brand, '')).trim(),
    sku:        String(get(m.sku, '')).trim(),
    barcode:    String(get(m.barcode, '')).trim(),
    cost_price: parseFloat(get(m.cost_price, 0)) || 0,
    sell_price: parseFloat(get(m.sell_price, 0)) || 0,
    stock:      parseInt(get(m.stock, 0)) || 0,
    min_stock:  parseInt(get(m.min_stock, 5)) || 5,
  }
}

// ── Template download ──────────────────────────────────────────────────────────
function downloadTemplate() {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([
    ['Emri', 'Kategoria', 'Brendi', 'Kodi_SKU', 'Barkodi',
     'Cmimi_Kosto_EUR', 'Cmimi_Shitje_EUR', 'Stoku', 'Stoku_Minimal'],
    ['Unazë Ari 18K Brillant', 'Unazë', 'Italia Gold', 'UNA-18K-001', '1234567890', 150, 280, 5, 2],
    ['Vathë Diamant 0.5ct', 'Vathë', '', 'VAT-DIA-001', '', 320, 550, 3, 1],
    ['Byzylyk Ari 14K', 'Byzylyk', 'Turkey Gold', 'BYZ-14K-003', '', 200, 380, 8, 3],
    ['Gjerdan Flori 18K', 'Gjerdan / Varëse', '', 'GJE-18K-001', '', 400, 750, 4, 2],
  ])
  // Column widths
  ws['!cols'] = [
    { wch: 30 }, { wch: 18 }, { wch: 16 }, { wch: 14 }, { wch: 14 },
    { wch: 16 }, { wch: 16 }, { wch: 8 }, { wch: 14 },
  ]
  XLSX.utils.book_append_sheet(wb, ws, 'Produktet')
  XLSX.writeFile(wb, 'gold_shop_template.xlsx')
}

// ── Import Modal ───────────────────────────────────────────────────────────────
function ImportModal({ onClose, onDone }) {
  const fileRef = useRef()
  const [step, setStep] = useState('upload')     // upload | preview | done
  const [fileName, setFileName] = useState('')
  const [headers, setHeaders] = useState([])
  const [mapping, setMapping] = useState({})
  const [dataRows, setDataRows] = useState([])
  const [error, setError] = useState('')
  const [importing, setImporting] = useState(false)
  const [importedCount, setImportedCount] = useState(0)

  const handleFile = e => {
    const file = e.target.files[0]
    if (!file) return
    setFileName(file.name)
    setError('')

    const reader = new FileReader()
    reader.onload = evt => {
      try {
        const wb = XLSX.read(evt.target.result, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })

        // Find first row that looks like a header (has at least 2 non-empty cells)
        const hdrIdx = raw.findIndex(row => row.filter(c => String(c).trim()).length >= 2)
        if (hdrIdx === -1) { setError('Nuk u gjet asnjë rresht me të dhëna.'); return }

        const hdrs = raw[hdrIdx].map(c => String(c ?? '').trim())
        const rows = raw.slice(hdrIdx + 1).filter(r => r.some(c => String(c).trim() !== ''))

        setHeaders(hdrs)
        setDataRows(rows)
        setMapping(detectMapping(hdrs))
        setStep('preview')
      } catch (err) {
        setError('Gabim gjatë leximit: ' + err.message)
      }
    }
    reader.readAsArrayBuffer(file)
  }

  const products = dataRows.map(r => rowToProduct(r, mapping)).filter(p => p.name)

  const handleImport = async () => {
    setImporting(true)
    setError('')
    try {
      const res = await fetch('/api/products/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ products }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setImportedCount(data.imported)
      setStep('done')
      onDone()
    } catch (err) {
      setError('Gabim gjatë importit: ' + err.message)
    } finally {
      setImporting(false)
    }
  }

  const setMap = (key, val) => setMapping(m => ({ ...m, [key]: parseInt(val) }))

  const COL_FIELDS = [
    { key: 'name',       label: 'Emri *'           },
    { key: 'category',   label: 'Kategoria'        },
    { key: 'brand',      label: 'Brendi'           },
    { key: 'sku',        label: 'Kodi SKU'         },
    { key: 'barcode',    label: 'Barcode'          },
    { key: 'cost_price', label: 'Çmimi Kosto (€)'  },
    { key: 'sell_price', label: 'Çmimi Shitje (€)' },
    { key: 'stock',      label: 'Stoku'            },
    { key: 'min_stock',  label: 'Stok Minimal'     },
  ]

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="modal-header">
          <div>
            <h3 className="font-bold text-slate-800 text-lg">
              {step === 'done' ? '✅ Import u krye!' : 'Import nga Excel'}
            </h3>
            {fileName && step !== 'upload' && (
              <p className="text-xs text-slate-500 mt-0.5">📄 {fileName}</p>
            )}
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 text-xl">×</button>
        </div>

        <div className="p-6">

          {/* ── STEP: UPLOAD ── */}
          {step === 'upload' && (
            <div className="space-y-5">
              {/* Drop zone */}
              <div
                onClick={() => fileRef.current.click()}
                className="border-2 border-dashed border-slate-300 hover:border-blue-400 rounded-2xl p-10 text-center cursor-pointer transition-colors group"
              >
                <div className="text-5xl mb-3">📂</div>
                <p className="font-semibold text-slate-700 group-hover:text-blue-600">Klikoni për të zgjedhur Excel-in</p>
                <p className="text-sm text-slate-400 mt-1">Mbështet: .xlsx, .xls</p>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleFile}
                  className="hidden"
                />
              </div>

              {error && <p className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{error}</p>}

              {/* Template hint */}
              <div className="flex items-center justify-between p-4 bg-blue-50 rounded-xl border border-blue-100">
                <div>
                  <p className="text-sm font-semibold text-blue-800">Nuk keni template?</p>
                  <p className="text-xs text-blue-600">Shkarkoni modelin e gatshëm me kolonat e sakta</p>
                </div>
                <button onClick={downloadTemplate} className="btn-secondary text-xs whitespace-nowrap">
                  ⬇️ Shkarko Template
                </button>
              </div>
            </div>
          )}

          {/* ── STEP: PREVIEW ── */}
          {step === 'preview' && (
            <div className="space-y-5">
              {/* Column mapping */}
              <div>
                <p className="section-title mb-3">Lidhja e kolonave</p>
                <div className="grid grid-cols-3 gap-2">
                  {COL_FIELDS.map(f => (
                    <div key={f.key} className="flex items-center gap-2">
                      <span className="text-xs text-slate-600 w-32 flex-shrink-0">{f.label}</span>
                      <select
                        value={mapping[f.key] ?? -1}
                        onChange={e => setMap(f.key, e.target.value)}
                        className={`input-field-sm flex-1 ${mapping[f.key] >= 0 ? 'border-green-400' : 'border-slate-300'}`}
                      >
                        <option value={-1}>— Nuk ka —</option>
                        {headers.map((h, i) => (
                          <option key={i} value={i}>{h || `Kolona ${i + 1}`}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              {/* Stats */}
              <div className="flex gap-3">
                <div className="flex-1 p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-center">
                  <p className="text-2xl font-bold text-emerald-700">{products.length}</p>
                  <p className="text-xs text-emerald-600">Produkte të gatshme</p>
                </div>
                <div className="flex-1 p-3 bg-slate-50 rounded-xl border border-slate-200 text-center">
                  <p className="text-2xl font-bold text-slate-700">{dataRows.length - products.length}</p>
                  <p className="text-xs text-slate-500">Rreshta të zbrazur</p>
                </div>
                <div className="flex-1 p-3 bg-blue-50 rounded-xl border border-blue-200 text-center">
                  <p className="text-2xl font-bold text-blue-700">{headers.length}</p>
                  <p className="text-xs text-blue-600">Kolona totale</p>
                </div>
              </div>

              {/* Preview table */}
              <div>
                <p className="section-title">Shembull — 5 produktet e para</p>
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold text-slate-500">Nr.</th>
                        <th className="px-3 py-2 text-left font-semibold text-slate-500">Emri</th>
                        <th className="px-3 py-2 text-left font-semibold text-slate-500">Kategoria</th>
                        <th className="px-3 py-2 text-left font-semibold text-slate-500">SKU</th>
                        <th className="px-3 py-2 text-right font-semibold text-slate-500">Kosto €</th>
                        <th className="px-3 py-2 text-right font-semibold text-slate-500">Shitje €</th>
                        <th className="px-3 py-2 text-center font-semibold text-slate-500">Stoku</th>
                      </tr>
                    </thead>
                    <tbody>
                      {products.slice(0, 5).map((p, i) => (
                        <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                          <td className="px-3 py-2 font-mono text-slate-400">{i + 1}</td>
                          <td className="px-3 py-2 font-medium text-slate-800 max-w-[160px] truncate">{p.name || <span className="text-red-400 italic">bosh</span>}</td>
                          <td className="px-3 py-2 text-slate-600">{p.category}</td>
                          <td className="px-3 py-2 font-mono text-slate-500">{p.sku || '—'}</td>
                          <td className="px-3 py-2 text-right text-slate-700">{p.cost_price || '—'}</td>
                          <td className="px-3 py-2 text-right font-semibold text-slate-900">{p.sell_price || '—'}</td>
                          <td className="px-3 py-2 text-center">
                            <span className={`badge ${p.stock === 0 ? 'badge-red' : 'badge-green'}`}>{p.stock}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {products.length > 5 && (
                  <p className="text-xs text-slate-400 mt-2 text-center">
                    + {products.length - 5} produkte të tjera...
                  </p>
                )}
              </div>

              {error && <p className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{error}</p>}

              <div className="flex gap-3">
                <button onClick={() => setStep('upload')} className="btn-secondary">
                  ← Ndrysho Skedarin
                </button>
                <button
                  onClick={handleImport}
                  disabled={products.length === 0 || importing}
                  className="btn-primary flex-1 justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {importing
                    ? '⏳ Duke importuar...'
                    : `⬆️ Importo ${products.length} Produkte`}
                </button>
              </div>
            </div>
          )}

          {/* ── STEP: DONE ── */}
          {step === 'done' && (
            <div className="text-center py-8">
              <div className="text-6xl mb-4">🎉</div>
              <h3 className="text-xl font-bold text-slate-800 mb-2">
                {importedCount} produkte u importuan!
              </h3>
              <p className="text-slate-500 text-sm mb-6">
                Të gjitha produktet janë shtuar në inventar me numërim automatik.
              </p>
              <button onClick={onClose} className="btn-primary mx-auto">
                Shiko Produktet →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Add / Edit Modal ───────────────────────────────────────────────────────────
function ProductModal({ product, onClose, onSave }) {
  const [form, setForm] = useState(() =>
    product
      ? {
          name:        product.name || '',
          sku:         product.sku || '',
          barcode:     product.barcode || '',
          category:    product.category || 'Unazë',
          brand:       product.brand || '',
          description: product.description || '',
          cost_price:  product.cost_price !== undefined ? String(product.cost_price) : '',
          sell_price:  product.sell_price !== undefined ? String(product.sell_price) : '',
          stock:       product.stock !== undefined ? String(product.stock) : '',
          min_stock:   product.min_stock !== undefined ? String(product.min_stock) : '5',
          vat_rate:    product.vat_rate !== undefined && product.vat_rate !== null ? String(product.vat_rate) : '20',
        }
      : { ...EMPTY }
  )
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const margin =
    parseFloat(form.cost_price) > 0 && parseFloat(form.sell_price) > 0
      ? ((parseFloat(form.sell_price) - parseFloat(form.cost_price)) / parseFloat(form.cost_price) * 100).toFixed(1)
      : null

  const handleSubmit = e => {
    e.preventDefault()
    if (!form.name.trim()) return
    onSave({
      ...(product?.id ? { id: product.id } : {}),
      ...form,
      cost_price: parseFloat(form.cost_price) || 0,
      sell_price: parseFloat(form.sell_price) || 0,
      stock:      parseInt(form.stock)         || 0,
      min_stock:  parseInt(form.min_stock)     || 5,
      vat_rate:   form.vat_rate === '' || form.vat_rate == null ? 20 : parseFloat(form.vat_rate),
    })
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box">
        <div className="modal-header">
          <div>
            <h3 className="font-bold text-slate-800 text-lg">
              {product?.id ? `Ndrysho — ${productNo(product.id)}` : 'Shto Produkt të Ri'}
            </h3>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 text-xl">×</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {/* Category picker */}
            <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-xl">
              <div className="text-5xl select-none">{CAT_ICONS[form.category] || '📦'}</div>
              <div className="flex-1">
                <label className="form-label">Kategoria</label>
                <select value={form.category} onChange={e => set('category', e.target.value)} className="input-field">
                  {CATEGORIES.map(c => <option key={c} value={c}>{CAT_ICONS[c]} {c}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="form-label">Emri i Produktit *</label>
                <input type="text" required autoFocus value={form.name} onChange={e => set('name', e.target.value)}
                  className="input-field" placeholder="p.sh. Unazë Ari 18K me Brilijant" />
              </div>
              <div>
                <label className="form-label">Prodhuesi / Furnitori</label>
                <input type="text" value={form.brand} onChange={e => set('brand', e.target.value)}
                  className="input-field" placeholder="p.sh. Italia Gold" />
              </div>
              <div>
                <label className="form-label">Kodi i Produktit (SKU)</label>
                <input type="text" value={form.sku} onChange={e => set('sku', e.target.value)}
                  className="input-field" placeholder="p.sh. UNA-18K-001" />
              </div>
              <div className="col-span-2">
                <label className="form-label">Barcode</label>
                <input type="text" value={form.barcode} onChange={e => set('barcode', e.target.value)}
                  className="input-field" placeholder="Barcode (opsional)" />
              </div>
              <div>
                <label className="form-label">Çmimi Kosto (€)</label>
                <input type="number" step="0.01" min="0" value={form.cost_price} onChange={e => set('cost_price', e.target.value)}
                  className="input-field" placeholder="0.00" />
              </div>
              <div>
                <label className="form-label">Çmimi Shitje (€)</label>
                <input type="number" step="0.01" min="0" value={form.sell_price} onChange={e => set('sell_price', e.target.value)}
                  className="input-field" placeholder="0.00" />
                <div className="flex flex-wrap items-center gap-1 mt-1.5">
                  <span className="text-[10px] text-slate-500 mr-0.5">nga kosto:</span>
                  {[0.5, 1, 1.5, 2, 2.5, 3].map(m => {
                    const cost = parseFloat(form.cost_price) || 0
                    const disabled = cost <= 0
                    return (
                      <button
                        key={m}
                        type="button"
                        disabled={disabled}
                        onClick={() => set('sell_price', (cost * m).toFixed(2))}
                        title={disabled ? 'Vendos fillimisht koston' : `Çm. Shitje = €${(cost * m).toFixed(2)}`}
                        className="px-2 py-0.5 text-[11px] rounded-md bg-slate-100 hover:bg-emerald-100 hover:text-emerald-700 text-slate-600 font-semibold border border-slate-200 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-slate-100 disabled:hover:text-slate-600"
                      >
                        ×{m}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div>
                <label className="form-label">Stoku Aktual</label>
                <input type="number" min="0" value={form.stock} onChange={e => set('stock', e.target.value)}
                  className="input-field" placeholder="0" />
              </div>
              <div>
                <label className="form-label">Stok Minimal (alarm)</label>
                <input type="number" min="0" value={form.min_stock} onChange={e => set('min_stock', e.target.value)}
                  className="input-field" placeholder="5" />
              </div>
              <div className="col-span-2">
                <label className="form-label">TVSH %</label>
                <div className="flex gap-2 items-center">
                  <select
                    value={VAT_OPTIONS.includes(parseFloat(form.vat_rate)) ? form.vat_rate : 'custom'}
                    onChange={e => {
                      const v = e.target.value
                      set('vat_rate', v === 'custom' ? form.vat_rate : v)
                    }}
                    className="input-field w-40"
                  >
                    {VAT_OPTIONS.map(v => <option key={v} value={v}>{v}%</option>)}
                    <option value="custom">Tjetër...</option>
                  </select>
                  <input
                    type="number" step="0.01" min="0" max="100"
                    value={form.vat_rate}
                    onChange={e => set('vat_rate', e.target.value)}
                    className="input-field w-32"
                    placeholder="20"
                  />
                  <span className="text-xs text-slate-500">do të aplikohet automatikisht kur ky produkt të shitet</span>
                </div>
              </div>
              <div className="col-span-2">
                <label className="form-label">Përshkrimi (opsional)</label>
                <textarea value={form.description} onChange={e => set('description', e.target.value)}
                  className="input-field resize-none" rows={2} placeholder="Detaje shtesë..." />
              </div>
            </div>

            {margin !== null && (
              <div className={`p-3 rounded-xl border text-sm flex justify-between
                ${parseFloat(margin) >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                <span className="text-slate-600">Fitimi për cope:</span>
                <span className={`font-bold ${parseFloat(margin) >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                  €{(parseFloat(form.sell_price) - parseFloat(form.cost_price)).toFixed(2)}
                  &nbsp;({margin}%)
                </span>
              </div>
            )}
          </div>

          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn-secondary">Anulo</button>
            <button type="submit" className="btn-primary">
              {product?.id ? '💾 Ruaj Ndryshimet' : '+ Shto Produktin'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Main Products Page ─────────────────────────────────────────────────────────
export default function Products() {
  const [products, setProducts]     = useState([])
  const [loading, setLoading]       = useState(true)
  const [search, setSearch]         = useState('')
  const [filterCat, setFilterCat]   = useState('Të gjitha')
  const [modal, setModal]           = useState(null)    // null | 'add' | product
  const [confirmDel, setConfirmDel] = useState(null)
  const [showImport, setShowImport] = useState(false)
  const [view, setView]             = useState('list')  // grid | list
  const [fromDate, setFromDate]     = useState('')
  const [toDate, setToDate]         = useState('')
  const [bulkApplying, setBulkApplying] = useState(false)

  const load = useCallback(async () => {
    try {
      const data = await fetch('/api/products').then(r => r.json())
      setProducts(Array.isArray(data) ? data : [])
    } catch (e) { console.error(e) }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Live-refresh when another PC creates/edits/deletes a product.
  useRealtimeSync('products', load)

  // Return product creation date as local YYYY-MM-DD. SQLite stores created_at
  // in UTC, so we parse it explicitly as UTC before reading the local day —
  // otherwise late-night creations would shift to the wrong calendar day.
  const createdLocalDate = (p) => {
    if (!p.created_at) return ''
    const d = new Date(String(p.created_at).replace(' ', 'T') + 'Z')
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  const todayStr = (() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })()

  const filtered = products.filter(p => {
    const q = search.toLowerCase()
    const matchSearch = !q ||
      p.name.toLowerCase().includes(q) ||
      (p.brand || '').toLowerCase().includes(q) ||
      (p.sku || '').toLowerCase().includes(q) ||
      (p.barcode || '').includes(q) ||
      productNo(p.id).toLowerCase().includes(q)
    const matchCat = filterCat === 'Të gjitha' || p.category === filterCat
    let matchDate = true
    if (fromDate || toDate) {
      const d = createdLocalDate(p)
      if (!d) matchDate = false
      else {
        if (fromDate && d < fromDate) matchDate = false
        if (toDate && d > toDate) matchDate = false
      }
    }
    return matchSearch && matchCat && matchDate
  })

  const handleSave = async data => {
    try {
      if (data.id) {
        const res = await fetch(`/api/products/${data.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        })
        // 409 = another PC saved a change while this form was open. Reload the
        // list and warn — user's edits stay in the form so they can retry.
        if (res.status === 409) {
          await load()
          alert('Ky produkt u ndryshua nga një PC tjetër ndërkohë. Të dhënat u rifreskuan — kontrollo dhe ruaj sërish.')
          return
        }
      } else {
        await fetch('/api/products', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        })
      }
      setModal(null)
      load()
    } catch (e) { console.error(e) }
  }

  const handleDelete = async id => {
    try {
      await fetch(`/api/products/${id}`, { method: 'DELETE' })
      setConfirmDel(null)
      load()
    } catch (e) { console.error(e) }
  }

  // Quick per-row sell-price multiplier: sell_price = cost * m, then PUT the
  // full product (the API requires the whole payload, not a partial update).
  const applyMultiplier = async (p, m) => {
    const cost = parseFloat(p.cost_price) || 0
    if (cost <= 0) { alert('Produkti nuk ka çmim kosto.'); return }
    const newSell = +(cost * m).toFixed(2)
    try {
      await fetch(`/api/products/${p.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...p, sell_price: newSell }),
      })
      load()
    } catch (e) { console.error(e) }
  }

  // Bulk multiplier: applies to every product currently shown by the filters
  // (search + category + Sot). Products with no cost are skipped.
  const applyBulkMultiplier = async (m) => {
    const eligible = filtered.filter(p => parseFloat(p.cost_price) > 0)
    if (eligible.length === 0) { alert('Asnjë produkt me kosto > 0 në listë.'); return }
    const skipped = filtered.length - eligible.length
    let scope = 'të shfaqura'
    if (fromDate && toDate) scope = fromDate === toDate ? `të shtuara më ${fromDate}` : `të shtuara nga ${fromDate} deri ${toDate}`
    else if (fromDate)      scope = `të shtuara nga ${fromDate} e tutje`
    else if (toDate)        scope = `të shtuara deri më ${toDate}`
    const msg =
      `Vendos Çm. Shitje = Kosto × ${m} për ${eligible.length} produkte ${scope}` +
      (skipped > 0 ? `\n(${skipped} pa kosto u anashkalohen)` : '') + '?'
    if (!confirm(msg)) return
    setBulkApplying(true)
    try {
      await Promise.all(eligible.map(p => {
        const newSell = +(parseFloat(p.cost_price) * m).toFixed(2)
        return fetch(`/api/products/${p.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...p, sell_price: newSell }),
        })
      }))
      await load()
    } catch (e) {
      console.error(e)
      alert('Gabim gjatë aplikimit në grup.')
    } finally {
      setBulkApplying(false)
    }
  }

  const exportExcel = () => {
    const rows = products.map(p => ({
      Nr: productNo(p.id),
      Emri: p.name,
      Kategoria: p.category,
      Brendi: p.brand || '',
      SKU: p.sku || '',
      Barkodi: p.barcode || '',
      'Cmimi Kosto EUR': p.cost_price || 0,
      'Cmimi Shitje EUR': p.sell_price || 0,
      Stoku: p.stock || 0,
      'Stok Minimal': p.min_stock || 5,
    }))
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = [8,30,14,14,12,14,16,16,8,12].map(w => ({ wch: w }))
    XLSX.utils.book_append_sheet(wb, ws, 'Produktet')
    XLSX.writeFile(wb, `gold_shop_produktet_${new Date().toISOString().split('T')[0]}.xlsx`)
  }

  const usedCats = ['Të gjitha', ...new Set(products.map(p => p.category))]
  const stockOk  = products.filter(p => p.stock > p.min_stock).length
  const stockLow = products.filter(p => p.stock > 0 && p.stock <= p.min_stock).length
  const stockOut = products.filter(p => p.stock === 0).length

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        <div className="text-center">
          <div className="text-4xl mb-3 animate-pulse">💍</div>
          <p className="text-sm">Duke ngarkuar produktet...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">

      {/* ── Top bar ── */}
      <div className="flex items-center gap-3">
        <div className="flex-1 relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">🔍</span>
          <input
            type="text"
            placeholder="Kërko emër, brand, SKU, GS-0001..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="input-field pl-9"
          />
        </div>

        <select value={filterCat} onChange={e => setFilterCat(e.target.value)} className="input-field w-44 flex-shrink-0">
          {usedCats.map(c => (
            <option key={c} value={c}>
              {c === 'Të gjitha' ? '📂 Të gjitha' : `${CAT_ICONS[c] || '📦'} ${c}`}
            </option>
          ))}
        </select>

        {/* Grid / List toggle */}
        <div className="flex bg-slate-100 rounded-lg p-0.5 flex-shrink-0">
          <button onClick={() => setView('grid')} className={`px-3 py-1.5 rounded-md text-sm transition-colors ${view === 'grid' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'}`}>⊞</button>
          <button onClick={() => setView('list')} className={`px-3 py-1.5 rounded-md text-sm transition-colors ${view === 'list' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'}`}>☰</button>
        </div>

        <button onClick={exportExcel} className="btn-secondary flex-shrink-0">
          ⬇️ Export
        </button>
        <button onClick={() => setShowImport(true)} className="btn-secondary flex-shrink-0">
          📂 Import
        </button>
        <button onClick={() => setModal('add')} className="btn-primary flex-shrink-0">
          + Shto Produkt
        </button>
      </div>

      {/* ── Date range filter + Bulk multiplier ── */}
      <div className="card flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">📅</span>
          <span className="text-sm font-semibold text-slate-700">Filtër data (shtimit)</span>
        </div>
        <div>
          <label className="form-label">Nga data</label>
          <input
            type="date" value={fromDate}
            max={toDate || undefined}
            onChange={e => setFromDate(e.target.value)}
            className="input-field"
          />
        </div>
        <div>
          <label className="form-label">Deri më datë</label>
          <input
            type="date" value={toDate}
            min={fromDate || undefined}
            onChange={e => setToDate(e.target.value)}
            className="input-field"
          />
        </div>
        <button
          onClick={() => { setFromDate(todayStr); setToDate(todayStr) }}
          className="btn-secondary text-xs"
          title="Vendos intervalin për datën e sotme"
        >Sot</button>
        {(fromDate || toDate) && (
          <button
            onClick={() => { setFromDate(''); setToDate('') }}
            className="btn-secondary text-xs"
          >Pastro filtrin</button>
        )}

        <div className="flex-1" />

        <div>
          <label className="form-label">Apliko shumëzues për {filtered.length} produkte</label>
          <select
            value=""
            disabled={bulkApplying || filtered.length === 0}
            onChange={e => {
              const m = parseFloat(e.target.value)
              e.target.selectedIndex = 0
              if (m) applyBulkMultiplier(m)
            }}
            title="Apliko Çm. Shitje = Kosto × shumëzues për të gjitha produktet e shfaqura"
            className="input-field w-56 disabled:opacity-50 disabled:cursor-not-allowed font-semibold text-emerald-700"
          >
            <option value="">⚡ {bulkApplying ? 'Duke aplikuar...' : 'Zgjidh shumëzuesin...'}</option>
            <option value="0.5">×0.5 (kosto × 0.5)</option>
            <option value="1">×1 (kosto × 1)</option>
            <option value="1.5">×1.5 (kosto × 1.5)</option>
            <option value="2">×2 (kosto × 2)</option>
            <option value="2.5">×2.5 (kosto × 2.5)</option>
            <option value="3">×3 (kosto × 3)</option>
            <option value="3.5">×3.5 (kosto × 3.5)</option>
            <option value="4">×4 (kosto × 4)</option>
            <option value="4.5">×4.5 (kosto × 4.5)</option>
            <option value="5">×5 (kosto × 5)</option>
          </select>
        </div>
      </div>

      {/* ── Stock strip ── */}
      {products.length > 0 && (
        <div className="flex items-center gap-4 text-xs text-slate-500">
          <span>{filtered.length} produkte{search || filterCat !== 'Të gjitha' ? ' (filtruar)' : ''}</span>
          <span className="w-px h-3 bg-slate-200" />
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 bg-emerald-500 rounded-full" />{stockOk} OK</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 bg-amber-400 rounded-full" />{stockLow} stok i ulët</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 bg-red-500 rounded-full" />{stockOut} pa stok</span>
        </div>
      )}

      {/* ── Empty states ── */}
      {filtered.length === 0 && (
        <div className="card text-center py-16">
          {products.length === 0 ? (
            <>
              <div className="text-6xl mb-4">💍</div>
              <h3 className="text-xl font-bold text-slate-700 mb-2">Nuk ka produkte akoma</h3>
              <p className="text-slate-400 mb-6 text-sm">Shtoni artikuj manualisht ose importoni nga Excel</p>
              <div className="flex gap-3 justify-center">
                <button onClick={() => setShowImport(true)} className="btn-secondary">📂 Import Excel</button>
                <button onClick={() => setModal('add')} className="btn-primary">+ Shto Manualisht</button>
              </div>
            </>
          ) : (
            <>
              <div className="text-4xl mb-3">🔍</div>
              <p className="text-slate-500 mb-4">Nuk u gjet asnjë produkt</p>
              <button onClick={() => { setSearch(''); setFilterCat('Të gjitha') }} className="btn-secondary mx-auto">Pastro filtrat</button>
            </>
          )}
        </div>
      )}

      {/* ── GRID view ── */}
      {filtered.length > 0 && view === 'grid' && (
        <div className="grid grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
          {filtered.map(p => {
            const st = p.stock === 0 ? 'out' : p.stock <= p.min_stock ? 'low' : 'ok'
            const margin = p.cost_price > 0
              ? Math.round((p.sell_price - p.cost_price) / p.cost_price * 100)
              : null

            return (
              <div
                key={p.id}
                className={`card group hover:shadow-md transition-all border-2 ${
                  st === 'out' ? 'border-red-200 hover:border-red-300' :
                  st === 'low' ? 'border-amber-200 hover:border-amber-300' :
                  'border-transparent hover:border-blue-200'
                }`}
              >
                {/* Card top */}
                <div className="flex items-start justify-between mb-3">
                  <ProductImage product={p} onUploaded={load} />
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => setModal(p)} title="Ndrysho"
                      className="w-7 h-7 flex items-center justify-center rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 text-sm">✏️</button>
                    <button onClick={() => setConfirmDel(p)} title="Fshi"
                      className="w-7 h-7 flex items-center justify-center rounded-lg bg-red-50 hover:bg-red-100 text-red-600 text-sm">🗑️</button>
                  </div>
                </div>

                {/* Product number */}
                <p className="text-xs font-mono text-slate-400 mb-0.5">{productNo(p.id)}</p>

                <h4 className="font-semibold text-slate-800 text-sm leading-snug mb-0.5 line-clamp-2">{p.name}</h4>
                {p.brand && <p className="text-xs text-slate-400 mb-2">{p.brand}</p>}
                <span className={`badge text-xs ${CAT_COLORS[p.category] || 'bg-slate-100 text-slate-700'}`}>
                  {CAT_ICONS[p.category]} {p.category}
                </span>

                <div className="border-t border-slate-100 my-3" />

                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-xs text-slate-400 mb-0.5">Çmimi shitje</p>
                    <p className="text-xl font-extrabold text-slate-900">
                      {p.sell_price ? `€${Number(p.sell_price).toLocaleString()}` : '—'}
                    </p>
                    {margin !== null && (
                      <p className={`text-xs font-medium ${margin >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {margin >= 0 ? '+' : ''}{margin}% marzh
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <StockBadge stock={p.stock} minStock={p.min_stock} />
                    {p.sku && <p className="text-xs text-slate-400 mt-1 font-mono">{p.sku}</p>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── LIST view ── */}
      {filtered.length > 0 && view === 'list' && (
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Nr.</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Produkti</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Kategoria</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">SKU</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Barkodi</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase">Kosto €</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase">Shitje €</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase">Stoku</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase">Veprime</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{productNo(p.id)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="text-xl">{CAT_ICONS[p.category] || '📦'}</span>
                      <div>
                        <p className="font-medium text-slate-800">{p.name}</p>
                        {p.brand && <p className="text-xs text-slate-500">{p.brand}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`badge text-xs ${CAT_COLORS[p.category] || 'bg-slate-100 text-slate-700'}`}>{p.category}</span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{p.sku || '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{p.barcode || '—'}</td>
                  <td className="px-4 py-3 text-right text-slate-700">{p.cost_price ? `€${Number(p.cost_price).toLocaleString()}` : '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <span className="font-bold text-slate-900">
                        {p.sell_price ? `€${Number(p.sell_price).toLocaleString()}` : '—'}
                      </span>
                      <select
                        value=""
                        disabled={!p.cost_price}
                        onChange={e => {
                          const m = parseFloat(e.target.value)
                          e.target.selectedIndex = 0
                          if (m) applyMultiplier(p, m)
                        }}
                        title={p.cost_price ? 'Vendos Çm. Shitje = Kosto × shumëzues' : 'Vendos fillimisht koston'}
                        className="text-[10px] bg-white border border-slate-300 rounded px-1 py-0.5 text-emerald-700 font-bold cursor-pointer hover:bg-emerald-50 hover:border-emerald-300 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <option value="">×</option>
                        <option value="0.5">×0.5</option>
                        <option value="1">×1</option>
                        <option value="1.5">×1.5</option>
                        <option value="2">×2</option>
                        <option value="2.5">×2.5</option>
                        <option value="3">×3</option>
                        <option value="3.5">×3.5</option>
                        <option value="4">×4</option>
                        <option value="4.5">×4.5</option>
                        <option value="5">×5</option>
                      </select>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center"><StockBadge stock={p.stock} minStock={p.min_stock} /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1.5">
                      <button onClick={() => setModal(p)} className="px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 text-xs font-medium">Ndrysho</button>
                      <button onClick={() => setConfirmDel(p)} className="px-2.5 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 text-xs font-medium">Fshi</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Import Modal ── */}
      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onDone={() => { load() }}
        />
      )}

      {/* ── Add/Edit Modal ── */}
      {modal && (
        <ProductModal
          product={modal === 'add' ? null : modal}
          onClose={() => setModal(null)}
          onSave={handleSave}
        />
      )}

      {/* ── Delete Confirm ── */}
      {confirmDel && (
        <div className="modal-overlay">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
            <div className="text-center">
              <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-4">🗑️</div>
              <p className="text-xs font-mono text-slate-400 mb-1">{productNo(confirmDel.id)}</p>
              <h3 className="font-bold text-slate-800 text-lg mb-1">Fshi Produktin?</h3>
              <p className="text-slate-500 text-sm mb-6">
                A jeni të sigurt që doni të fshini <strong className="text-slate-700">{confirmDel.name}</strong>?
              </p>
              <div className="flex gap-3">
                <button onClick={() => setConfirmDel(null)} className="btn-secondary flex-1 justify-center">Anulo</button>
                <button onClick={() => handleDelete(confirmDel.id)}
                  className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors">
                  Fshi
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
