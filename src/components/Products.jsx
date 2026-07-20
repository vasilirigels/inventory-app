import { useState, useEffect, useCallback, useRef } from 'react'
import { useRealtimeSync } from '../hooks/useRealtimeSync.js'
import { loadXLSX } from '../lib/xlsx.js'

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
  stock: '', min_stock: '5', vat_rate: '20', gram: '',
  serial_no: '', purchase_price_no_vat: '',
}

const VAT_OPTIONS = [0, 6, 10, 20]

// ── Helpers ────────────────────────────────────────────────────────────────────
const productNo = id => `GS-${String(id).padStart(4, '0')}`

// ── Code 39 barcode encoder ───────────────────────────────────────────────────
// Each character = 9 elements (5 bars + 4 spaces), 'n' = narrow, 'w' = wide.
// Alphabet: 0-9 A-Z - . space $ / + %  (plus '*' as start/stop sentinel).
const CODE39 = {
  '0':'nnnwwnwnn','1':'wnnwnnnnw','2':'nnwwnnnnw','3':'wnwwnnnnn','4':'nnnwwnnnw',
  '5':'wnnwwnnnn','6':'nnwwwnnnn','7':'nnnwnnwnw','8':'wnnwnnwnn','9':'nnwwnnwnn',
  'A':'wnnnnwnnw','B':'nnwnnwnnw','C':'wnwnnwnnn','D':'nnnnwwnnw','E':'wnnnwwnnn',
  'F':'nnwnwwnnn','G':'nnnnnwwnw','H':'wnnnnwwnn','I':'nnwnnwwnn','J':'nnnnwwwnn',
  'K':'wnnnnnnww','L':'nnwnnnnww','M':'wnwnnnnwn','N':'nnnnwnnww','O':'wnnnwnnwn',
  'P':'nnwnwnnwn','Q':'nnnnnnwww','R':'wnnnnnwwn','S':'nnwnnnwwn','T':'nnnnwnwwn',
  'U':'wwnnnnnnw','V':'nwwnnnnnw','W':'wwwnnnnnn','X':'nwnnwnnnw','Y':'wwnnwnnnn',
  'Z':'nwwnwnnnn','-':'nwnnnnwnw','.':'wwnnnnwnn',' ':'nwwnnnwnn','$':'nwnwnwnnn',
  '/':'nwnwnnnwn','+':'nwnnnwnwn','%':'nnnwnwnwn','*':'nwnnwnwnn',
}
function code39Clean(v) {
  return String(v || '').toUpperCase().replace(/[^0-9A-Z\- .$/+%]/g, '')
}
function code39SVG(value, { height = 60, narrow = 2, wide = 5, showText = true } = {}) {
  const clean = code39Clean(value)
  if (!clean) return ''
  const encoded = '*' + clean + '*'
  const bars = []
  let x = 0
  for (let ci = 0; ci < encoded.length; ci++) {
    const pattern = CODE39[encoded[ci]]
    if (!pattern) continue
    for (let i = 0; i < 9; i++) {
      const w = pattern[i] === 'w' ? wide : narrow
      if (i % 2 === 0) bars.push(`<rect x="${x}" y="0" width="${w}" height="${height}" fill="#000"/>`)
      x += w
    }
    if (ci < encoded.length - 1) x += narrow
  }
  const totalW = x
  const textArea = showText ? 22 : 0
  const totalH = height + textArea
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:auto;display:block">${bars.join('')}${showText ? `<text x="${totalW / 2}" y="${height + 16}" text-anchor="middle" font-family="monospace" font-size="14" fill="#000">${clean}</text>` : ''}</svg>`
}

// ── Barcode modal: generate / edit / preview / save / print ───────────────────
function BarcodeModal({ product, onClose, onSaved }) {
  const suggestion = `GS${String(product.id).padStart(6, '0')}`
  const [value, setValue] = useState(product.barcode ? code39Clean(product.barcode) : suggestion)
  const [saving, setSaving] = useState(false)
  const [copies, setCopies] = useState(1)

  const clean = code39Clean(value)
  const svg = code39SVG(clean, { height: 60, narrow: 2, wide: 5 })

  const save = async () => {
    if (!clean || clean === (product.barcode || '')) return true
    setSaving(true)
    try {
      const res = await fetch(`/api/products/${product.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...product, barcode: clean }),
      })
      if (!res.ok) throw new Error('save failed')
      onSaved?.()
      return true
    } catch (e) {
      console.error(e)
      alert('Gabim gjatë ruajtjes së barkodit.')
      return false
    } finally {
      setSaving(false)
    }
  }

  const printBarcode = async () => {
    if (!clean) return
    const ok = await save()
    if (!ok) return
    const svgHtml = code39SVG(clean, { height: 60, narrow: 2, wide: 5 })
    const n = Math.max(1, Math.min(50, parseInt(copies) || 1))
    const priceLine = product.sell_price
      ? `<div class="price">€${Number(product.sell_price).toFixed(2)}</div>`
      : ''
    const nameSafe = String(product.name || '').replace(/</g, '&lt;').slice(0, 40)
    const oneLabel = `
      <div class="label">
        <div class="name">${nameSafe}</div>
        <div class="bc">${svgHtml}</div>
        ${priceLine}
      </div>
    `
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Barkod</title>
<style>
  @page { margin: 3mm; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 0; font-family: system-ui, sans-serif; }
  .grid { display: flex; flex-wrap: wrap; gap: 3mm; padding: 3mm; }
  .label { width: 50mm; padding: 2mm; text-align: center; border: 1px dashed #ccc; page-break-inside: avoid; }
  .name { font-size: 8pt; font-weight: 600; margin-bottom: 1mm; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bc svg { width: 100%; height: 16mm; }
  .price { font-size: 10pt; font-weight: 700; margin-top: 1mm; }
  @media print { .label { border: none; } }
</style></head>
<body><div class="grid">${oneLabel.repeat(n)}</div></body></html>`
    const frame = document.createElement('iframe')
    Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' })
    document.body.appendChild(frame)
    const doc = frame.contentDocument || frame.contentWindow.document
    doc.open(); doc.write(html); doc.close()
    setTimeout(() => {
      try {
        frame.contentWindow.focus()
        frame.contentWindow.print()
      } catch (e) { console.error(e) }
      setTimeout(() => { try { document.body.removeChild(frame) } catch {} }, 1000)
    }, 250)
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="modal-header">
          <div className="min-w-0">
            <h3 className="font-bold text-slate-800 text-lg">🏷️ Barkod — {productNo(product.id)}</h3>
            <p className="text-xs text-slate-500 mt-0.5 truncate">{product.name}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 text-xl">×</button>
        </div>
        <div className="modal-body space-y-4">
          <div>
            <label className="form-label">Vlera e barkodit</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={value}
                onChange={e => setValue(e.target.value)}
                className="input-field font-mono uppercase tracking-wider"
                placeholder="p.sh. GS000042"
              />
              <button
                type="button"
                onClick={() => setValue(suggestion)}
                className="btn-secondary text-xs whitespace-nowrap"
                title="Gjenero nga numri i produktit"
              >
                🎲 Gjenero
              </button>
            </div>
            <p className="text-[10px] text-slate-500 mt-1">
              Vetëm: 0-9, A-Z, dhe - . $ / + % (Code-39). Skanuesi e lexon si tekst.
            </p>
          </div>

          <div className="bg-white border-2 border-slate-200 rounded-xl p-4">
            <div className="text-center text-xs font-semibold text-slate-700 mb-2 truncate">{product.name}</div>
            {clean ? (
              <div dangerouslySetInnerHTML={{ __html: svg }} />
            ) : (
              <div className="text-center text-xs text-red-500 py-6">Vendos një vlerë të vlefshme.</div>
            )}
            {product.sell_price > 0 && (
              <div className="text-center text-sm font-bold text-slate-800 mt-2">
                €{Number(product.sell_price).toFixed(2)}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <label className="text-xs text-slate-600 font-medium">Kopje për print</label>
            <input
              type="number" min="1" max="50" value={copies}
              onChange={e => setCopies(e.target.value)}
              className="input-field w-24"
            />
            <span className="text-[11px] text-slate-500">etiketa 50×25 mm</span>
          </div>
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="btn-secondary">Mbyll</button>
          <button
            onClick={printBarcode}
            disabled={!clean || saving}
            className="btn-primary"
          >
            {saving ? '⏳ Duke ruajtur...' : '🖨️ Ruaj & Printo'}
          </button>
        </div>
      </div>
    </div>
  )
}

function StockBadge({ stock, minStock }) {
  if (stock === 0)
    return <span className="badge badge-red">Pa stok</span>
  if (stock <= minStock)
    return <span className="badge badge-yellow">{stock} cope</span>
  return <span className="badge badge-green">{stock} cope</span>
}

// ── Excel column auto-detector ─────────────────────────────────────────────
// Detektim priority-based me exclusion: kolonat specifike mapohen para atyre
// gjenerike, dhe një kolonë e mapuar një herë nuk ripërdoret (p.sh. "SHITJET"
// me flag 1 nuk keqinterpretohet si sell_price).
function detectMapping(headers) {
  const norm = h => String(h ?? '')
    .toLowerCase()
    .replace(/[çÇ]/g, 'c')
    .replace(/[ëË]/g, 'e')
    .replace(/\s+/g, '_')
  const normalized = headers.map(norm)
  const used = new Set()

  const findFirst = patterns => {
    for (const p of patterns) {
      for (let i = 0; i < normalized.length; i++) {
        if (used.has(i)) continue
        if (normalized[i].includes(p)) { used.add(i); return i }
      }
    }
    return -1
  }

  const barcode    = findFirst(['barkod', 'barcode'])
  // Nr Serie = fushë e re, e ndarë nga SKU. Priority mbi SKU kur ka të dyja
  // kolona; nëse Excel-i ka vetëm një, ajo mund të shkojë te SKU sipas
  // pattern-it (p.sh. "kodi" → sku).
  const serial_no  = findFirst([
    'nr_serie', 'nr._serie', 'numer_serie', 'seri', 'nr_serial', 'numer_serial',
    'serial_no', 'serial',
  ])
  const sku        = findFirst([
    'sku', 'kodi_art', 'kodi', 'code', 'ref_no', 'ref',
  ])
  // Çmimi PA TVSH (blerje nga furnitori) — fushë e ndarë nga Cmimi Kosto.
  const purchase_price_no_vat = findFirst([
    'cmimi_pa_tvsh', 'cmimi_pa', 'cm_pa', 'cmimi_bler', 'cm_bler',
    'pa_tvsh', 'blerje_pa', 'purchase_pa', 'purchase',
  ])
  // Çmimi Kosto (me TVSH + tarifa) — pas se u zunë "pa_tvsh" më sipër.
  const cost_price = findFirst([
    'cmim_kosto', 'cmimi_kosto', 'cm_kosto', 'kosto', 'cost', 'cmimi_k',
  ])
  const sell_price = findFirst([
    'cmim_shitje', 'cmimi_shitj', 'cm_shitj', 'shitje_pa', 'shit_pa_tvsh',
    'sell_price', 'sell', 'cmimi_sh', 'price',
  ])
  const vat_rate   = findFirst(['tvsh', 'vat', 'tva', 'iva'])
  const unit       = findFirst(['njesi', 'njësi', 'unit', 'unite'])
  const gram       = findFirst(['gramatur', 'gram', 'peshe', 'peshë', 'weight'])
  const stock      = findFirst(['sasia', 'sasi', 'stoku', 'stock', 'qty', 'quantity', 'gjendje', 'cope', 'copë'])
  const min_stock  = findFirst(['stok_min', 'min_stock', 'minim', 'alarm'])
  const category   = findFirst(['kategori', 'category', 'tip', 'lloj'])
  const brand      = findFirst(['brendi', 'brand', 'prodhu', 'furnitor'])
  const name       = findFirst(['pershkrim', 'përshkrim', 'emri', 'name', 'produkt', 'article', 'description', 'artikull'])

  return {
    name, category, brand, sku, serial_no, barcode,
    purchase_price_no_vat, cost_price, sell_price,
    vat_rate, unit, gram, stock, min_stock,
  }
}

function rowToProduct(row, m) {
  const get = (idx, def = '') => idx >= 0 ? (row[idx] ?? def) : def
  return {
    name:       String(get(m.name, '')).trim(),
    category:   String(get(m.category, 'Tjeter')).trim() || 'Tjeter',
    brand:      String(get(m.brand, '')).trim(),
    sku:        String(get(m.sku, '')).trim(),
    serial_no:  String(get(m.serial_no, '')).trim(),
    barcode:    String(get(m.barcode, '')).trim(),
    purchase_price_no_vat: parseFloat(get(m.purchase_price_no_vat, 0)) || 0,
    cost_price: parseFloat(get(m.cost_price, 0)) || 0,
    sell_price: parseFloat(get(m.sell_price, 0)) || 0,
    vat_rate:   get(m.vat_rate, '') === '' ? 20 : (parseFloat(get(m.vat_rate, 20)) || 0),
    unit:       String(get(m.unit, 'copë')).trim() || 'copë',
    gram:       parseFloat(get(m.gram, 0)) || 0,
    stock:      parseInt(get(m.stock, 0)) || 0,
    min_stock:  parseInt(get(m.min_stock, 5)) || 5,
  }
}

// ── Template download ──────────────────────────────────────────────────────────
async function downloadTemplate() {
  const XLSX = await loadXLSX()
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([
    ['Barkodi', 'Nr_Serie', 'Pershkrimi', 'Kategoria', 'Brendi',
     'Njesi', 'Sasi', 'Gramatura', 'Cmimi_PA', 'TVSH',
     'Cmim_Kosto', 'Cmim_Shitje', 'Stoku_Minimal'],
    ['1234567890', 'PR0000001', 'Unazë Ari 18K Brillant', 'Unazë', 'Italia Gold',
     'copë', 5, 5.52, 120, 20, 150, 280, 2],
    ['', 'PR0000002', 'Vathë Diamant 0.5ct', 'Vathë', '',
     'copë', 3, 2.34, 260, 20, 320, 550, 1],
    ['', 'PR0000003', 'Byzylyk Ari 14K', 'Byzylyk', 'Turkey Gold',
     'copë', 8, 7.22, 160, 20, 200, 380, 3],
    ['', 'PR0000004', 'Gjerdan Flori 18K', 'Gjerdan / Varëse', '',
     'copë', 4, 12.5, 330, 20, 400, 750, 2],
  ])
  // Column widths
  ws['!cols'] = [
    { wch: 14 }, { wch: 14 }, { wch: 30 }, { wch: 16 }, { wch: 16 },
    { wch: 8 }, { wch: 6 }, { wch: 10 }, { wch: 10 }, { wch: 6 },
    { wch: 12 }, { wch: 12 }, { wch: 12 },
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
    reader.onload = async evt => {
      try {
        const XLSX = await loadXLSX()
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
    { key: 'barcode',              label: 'Barkodi'          },
    { key: 'serial_no',            label: 'Nr Serie'         },
    { key: 'name',                 label: 'Pershkrimi *'     },
    { key: 'category',             label: 'Kategoria'        },
    { key: 'brand',                label: 'Brendi'           },
    { key: 'unit',                 label: 'Njesi'            },
    { key: 'stock',                label: 'Sasi'             },
    { key: 'gram',                 label: 'Gramatura'        },
    { key: 'purchase_price_no_vat',label: 'Cmimi PA (€)'     },
    { key: 'vat_rate',             label: 'TVSH %'           },
    { key: 'cost_price',           label: 'Cmim Kosto (€)'   },
    { key: 'sell_price',           label: 'Cmim Shitje (€)'  },
    { key: 'min_stock',            label: 'Stok Minimal'     },
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
                        <th className="px-2 py-2 text-left font-semibold text-slate-500">Nr.</th>
                        <th className="px-2 py-2 text-left font-semibold text-slate-500">Barkodi</th>
                        <th className="px-2 py-2 text-left font-semibold text-slate-500">Nr Serie</th>
                        <th className="px-2 py-2 text-left font-semibold text-slate-500">Pershkrimi</th>
                        <th className="px-2 py-2 text-center font-semibold text-slate-500">Njesi</th>
                        <th className="px-2 py-2 text-center font-semibold text-slate-500">Sasi</th>
                        <th className="px-2 py-2 text-right font-semibold text-slate-500">Gram</th>
                        <th className="px-2 py-2 text-right font-semibold text-slate-500">Cm PA</th>
                        <th className="px-2 py-2 text-center font-semibold text-slate-500">TVSH</th>
                        <th className="px-2 py-2 text-right font-semibold text-slate-500">Kosto</th>
                        <th className="px-2 py-2 text-right font-semibold text-slate-500">Shitje</th>
                      </tr>
                    </thead>
                    <tbody>
                      {products.slice(0, 5).map((p, i) => (
                        <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                          <td className="px-2 py-2 font-mono text-slate-400">{i + 1}</td>
                          <td className="px-2 py-2 font-mono text-slate-500">{p.barcode || '—'}</td>
                          <td className="px-2 py-2 font-mono text-slate-500">{p.serial_no || '—'}</td>
                          <td className="px-2 py-2 font-medium text-slate-800 max-w-[180px] truncate">{p.name || <span className="text-red-400 italic">bosh</span>}</td>
                          <td className="px-2 py-2 text-center text-slate-600">{p.unit || '—'}</td>
                          <td className="px-2 py-2 text-center">
                            <span className={`badge ${p.stock === 0 ? 'badge-red' : 'badge-green'}`}>{p.stock}</span>
                          </td>
                          <td className="px-2 py-2 text-right text-slate-600 tabular-nums">{p.gram || '—'}</td>
                          <td className="px-2 py-2 text-right text-slate-700 tabular-nums">{p.purchase_price_no_vat || '—'}</td>
                          <td className="px-2 py-2 text-center text-slate-600">{p.vat_rate != null ? `${p.vat_rate}%` : '—'}</td>
                          <td className="px-2 py-2 text-right text-slate-700 tabular-nums">{p.cost_price || '—'}</td>
                          <td className="px-2 py-2 text-right font-semibold text-slate-900 tabular-nums">{p.sell_price || '—'}</td>
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
          gram:        product.gram !== undefined && product.gram !== null ? String(product.gram) : '',
          serial_no:   product.serial_no || '',
          purchase_price_no_vat: product.purchase_price_no_vat != null ? String(product.purchase_price_no_vat) : '',
          is_promotion: !!product.is_promotion,
          promo_discount_pct: product.promo_discount_pct != null
            ? String(product.promo_discount_pct)
            : '',
        }
      : { ...EMPTY, is_promotion: false, promo_discount_pct: '' }
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
      gram:       parseFloat(form.gram) || 0,
      serial_no:  form.serial_no || '',
      purchase_price_no_vat: parseFloat(form.purchase_price_no_vat) || 0,
      is_promotion: form.is_promotion ? 1 : 0,
      promo_discount_pct: form.is_promotion
        ? Math.max(0, Math.min(100, parseFloat(form.promo_discount_pct) || 0))
        : 0,
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
              <div>
                <label className="form-label">Barcode</label>
                <input type="text" value={form.barcode} onChange={e => set('barcode', e.target.value)}
                  className="input-field" placeholder="Barcode (opsional)" />
              </div>
              <div>
                <label className="form-label">Nr Serie</label>
                <input type="text" value={form.serial_no} onChange={e => set('serial_no', e.target.value)}
                  className="input-field font-mono" placeholder="p.sh. PR0002955" />
              </div>
              <div>
                <label className="form-label">Çmimi PA TVSH — Blerje (€)</label>
                <input type="number" step="0.01" min="0" value={form.purchase_price_no_vat}
                  onChange={e => set('purchase_price_no_vat', e.target.value)}
                  className="input-field" placeholder="0.00" />
                <p className="text-[10px] text-slate-400 mt-0.5">Çmimi bazë nga furnitori (pa TVSH).</p>
              </div>
              <div>
                <label className="form-label">Çmimi Kosto (€)</label>
                <input type="number" step="0.01" min="0" value={form.cost_price} onChange={e => set('cost_price', e.target.value)}
                  className="input-field" placeholder="0.00" />
                <p className="text-[10px] text-slate-400 mt-0.5">Kosto totale (me TVSH + tarifat).</p>
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
                <label className="form-label">Gramatura (gr)</label>
                <input type="number" step="0.001" min="0" value={form.gram} onChange={e => set('gram', e.target.value)}
                  className="input-field" placeholder="0.000" />
                <p className="text-[10px] text-slate-400 mt-1">Do të plotësohet automatikisht në faturat e shitjes.</p>
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
              <div className="col-span-2">
                <div className={`p-3 rounded-xl border transition ${form.is_promotion ? 'bg-rose-50 border-rose-300' : 'bg-slate-50 border-slate-200'}`}>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!form.is_promotion}
                      onChange={e => set('is_promotion', e.target.checked)}
                      className="w-4 h-4 accent-rose-600"
                    />
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-slate-800">🏷️ Në Promocion</p>
                      <p className="text-[11px] text-slate-500">
                        Produkti do të shfaqet edhe tek faqja "Produkte Promocion".
                      </p>
                    </div>
                  </label>
                  {form.is_promotion && (
                    <div className="mt-3 pt-3 border-t border-rose-200 flex items-center gap-3">
                      <label className="text-xs font-semibold text-rose-700 whitespace-nowrap">Zbritja %</label>
                      <input
                        type="number" step="0.01" min="0" max="100"
                        value={form.promo_discount_pct}
                        onChange={e => set('promo_discount_pct', e.target.value)}
                        className="input-field-sm w-24 text-right"
                        placeholder="0"
                        autoFocus
                      />
                      {parseFloat(form.sell_price) > 0 && parseFloat(form.promo_discount_pct) > 0 && (
                        <div className="text-[11px] text-slate-600 flex-1 text-right">
                          <span className="text-slate-400 line-through mr-1.5">€{parseFloat(form.sell_price).toFixed(2)}</span>
                          <span className="font-bold text-emerald-700">
                            €{(parseFloat(form.sell_price) * (1 - parseFloat(form.promo_discount_pct) / 100)).toFixed(2)}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
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
  const [barcodeFor, setBarcodeFor] = useState(null)    // product | null
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

  const exportExcel = async () => {
    const XLSX = await loadXLSX()
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
                    <button onClick={() => setBarcodeFor(p)} title="Barkod"
                      className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm">🏷️</button>
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
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1200px]">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase">Nr.</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase">Barkodi</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase">Nr Serie</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase">Pershkrimi</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase">Kategoria</th>
                <th className="px-3 py-2 text-center text-xs font-semibold text-slate-500 uppercase">Njesi</th>
                <th className="px-3 py-2 text-center text-xs font-semibold text-slate-500 uppercase">Sasi</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase">Gram</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase">Cmimi PA</th>
                <th className="px-3 py-2 text-center text-xs font-semibold text-slate-500 uppercase">TVSH %</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase">Cmim Kosto €</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase">Cmim Shitje €</th>
                <th className="px-3 py-2 text-center text-xs font-semibold text-slate-500 uppercase">Veprime</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                  <td className="px-3 py-2 font-mono text-xs text-slate-500 whitespace-nowrap">{productNo(p.id)}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-600">{p.barcode || <span className="text-slate-300">—</span>}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-600">{p.serial_no || <span className="text-slate-300">—</span>}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{CAT_ICONS[p.category] || '📦'}</span>
                      <div>
                        <p className="font-medium text-slate-800">{p.name}</p>
                        {p.brand && <p className="text-[11px] text-slate-500">{p.brand}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`badge text-xs ${CAT_COLORS[p.category] || 'bg-slate-100 text-slate-700'}`}>{p.category}</span>
                  </td>
                  <td className="px-3 py-2 text-center text-xs text-slate-600">{p.unit || 'copë'}</td>
                  <td className="px-3 py-2 text-center"><StockBadge stock={p.stock} minStock={p.min_stock} /></td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                    {p.gram > 0 ? `${Number(p.gram).toLocaleString('sq-AL', { maximumFractionDigits: 3 })}gr` : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-700">{p.purchase_price_no_vat ? `€${Number(p.purchase_price_no_vat).toLocaleString()}` : '—'}</td>
                  <td className="px-3 py-2 text-center text-xs text-slate-600">{p.vat_rate != null ? `${p.vat_rate}%` : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-700">{p.cost_price ? `€${Number(p.cost_price).toLocaleString()}` : '—'}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <span className="font-bold text-slate-900 tabular-nums">
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
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => setBarcodeFor(p)} title="Gjenero & Printo Barkod"
                        className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium">🏷️</button>
                      <button onClick={() => setModal(p)} className="px-2 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 text-xs font-medium">Ndrysho</button>
                      <button onClick={() => setConfirmDel(p)} className="px-2 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 text-xs font-medium">Fshi</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
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

      {/* ── Barcode Modal ── */}
      {barcodeFor && (
        <BarcodeModal
          product={barcodeFor}
          onClose={() => setBarcodeFor(null)}
          onSaved={load}
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
