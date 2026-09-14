import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useRealtimeSync } from '../hooks/useRealtimeSync.js'
import { loadXLSX } from '../lib/xlsx.js'
import MoneyInput from './MoneyInput.jsx'
import { showConfirm } from './ConfirmDialog.jsx'

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
          className="w-14 h-14 rounded-2xl object-cover border border-slate-200 dark:border-slate-700" />
      ) : (
        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-3xl
          bg-slate-100 dark:bg-slate-800 hover:bg-blue-50 transition-colors`}>
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
  'Flori':           'bg-yellow-100 text-yellow-800 dark:text-yellow-200',
  'Diamant':         'bg-blue-100 text-blue-800 dark:text-blue-200',
  'Ora':             'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200',
  'Unazë':           'bg-yellow-100 text-yellow-800 dark:text-yellow-200',
  'Vathë':           'bg-pink-100 text-pink-800',
  'Byzylyk':         'bg-amber-100 text-amber-800 dark:text-amber-200',
  'Gjerdan / Varëse':'bg-orange-100 text-orange-800 dark:text-orange-200',
  'Komplet':         'bg-purple-100 text-purple-800 dark:text-purple-200',
  'Tjeter':          'bg-gray-100 text-gray-700',
}
const EMPTY = {
  name: '', sku: '', barcode: '', category: 'Unazë',
  brand: '', description: '', cost_price: '', sell_price: '',
  stock: '', min_stock: '5', vat_rate: '0', gram: '',
  serial_no: '', purchase_price_no_vat: '',
  // Blerje në gram HAS (peshë floriri të pastër) + kursi EUR/gram HAS te blerja
  has_gram: '', has_currency: 'HAS', has_rate: '',
  // Fusha flori: kodi (585/750...), shumëzuesi për çmim shitjeje, dhe kursi
  // i shitjes. Kur mbushen (bashkë me gram), has_gram, cost_price, sell_price
  // llogariten auto sipas formulës flori te Fatura Blerje:
  //   has_gram = (kodi/1000) × gram.
  kodi: '', multiplier: '', sell_rate: '',
  has_rate_currency: 'USD', sell_rate_currency: 'EUR',
}

const VAT_OPTIONS = [0, 6, 10, 20]

// Toggle €/$ për etiketën e valutës — propagohet nga blerja te produkti dhe
// mund të ndryshohet manualisht nga rreshti. Formulat përdorin vlerën numerike.
function CurrencyToggle({ value, onChange }) {
  const cur = value === 'USD' ? 'USD' : 'EUR'
  const symbol = cur === 'USD' ? '$' : '€'
  return (
    <button
      type="button"
      onClick={() => onChange(cur === 'EUR' ? 'USD' : 'EUR')}
      title={`Valuta: ${cur} (kliko për të ndryshuar)`}
      className="px-1.5 py-0.5 rounded border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-800 text-xs font-bold text-amber-800 dark:text-amber-200 hover:bg-amber-50 dark:hover:bg-amber-900/20 leading-none shrink-0"
    >
      {symbol}
    </button>
  )
}

// Selector kompakt për kategorinë: shfaq vetëm ikonën në qelizë, por hap
// një select nativ (opsione me ikonë + emër) kur user-i klikon. Selecti është
// i mbivendosur me opacity 0, kështu klikimet regjistrohen normalisht dhe
// dropdown-i i browser-it shfaqet i lexueshëm.
function CategoryIconSelect({ value, onChange }) {
  return (
    <div className="relative inline-flex items-center justify-center w-12 h-8 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer" title={value}>
      <span className="text-lg leading-none pointer-events-none select-none">
        {CAT_ICONS[value] || '📦'}
      </span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        aria-label="Kategoria"
      >
        {CATEGORIES.map(c => (
          <option key={c} value={c}>{CAT_ICONS[c] || '📦'} {c}</option>
        ))}
      </select>
    </div>
  )
}

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
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md">
        <div className="modal-header">
          <div className="min-w-0">
            <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">🏷️ Barkod — {productNo(product.id)}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">{product.name}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 dark:text-slate-500 text-xl">×</button>
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
            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
              Vetëm: 0-9, A-Z, dhe - . $ / + % (Code-39). Skanuesi e lexon si tekst.
            </p>
          </div>

          <div className="bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 rounded-xl p-4">
            <div className="text-center text-xs font-semibold text-slate-700 dark:text-slate-200 mb-2 truncate">{product.name}</div>
            {clean ? (
              <div dangerouslySetInnerHTML={{ __html: svg }} />
            ) : (
              <div className="text-center text-xs text-red-500 py-6">Vendos një vlerë të vlefshme.</div>
            )}
            {product.sell_price > 0 && (
              <div className="text-center text-sm font-bold text-slate-800 dark:text-slate-100 mt-2">
                €{Number(product.sell_price).toFixed(2)}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <label className="text-xs text-slate-600 dark:text-slate-300 font-medium">Kopje për print</label>
            <input
              type="number" min="1" max="50" value={copies}
              onChange={e => setCopies(e.target.value)}
              className="input-field w-24"
            />
            <span className="text-[11px] text-slate-500 dark:text-slate-400">etiketa 50×25 mm</span>
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
    vat_rate:   get(m.vat_rate, '') === '' ? 0 : (parseFloat(get(m.vat_rate, 0)) || 0),
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

// ── Export Fields Modal ────────────────────────────────────────────────────
// Zgjedhësi i fushave për export në Excel. Ruaj zgjedhjen në localStorage që
// të kujtohet herën tjetër.
const EXPORT_FIELDS = [
  { key: 'nr',         label: 'Nr' },
  { key: 'barcode',    label: 'Barkodi' },
  { key: 'name',       label: 'Pershkrimi' },
  { key: 'category',   label: 'Kategoria' },
  { key: 'brand',      label: 'Brendi' },
  { key: 'sku',        label: 'SKU' },
  { key: 'stock',      label: 'Sasia' },
  { key: 'min_stock',  label: 'Stok Minimal' },
  { key: 'gram',       label: 'Gram' },
  { key: 'kodi',       label: 'Kodi (flori)' },
  { key: 'has_gram',   label: 'Has (gram)' },
  { key: 'has_rate',   label: 'Kursi Blerje' },
  { key: 'sell_rate',  label: 'Kursi Shitje' },
  { key: 'multiplier', label: 'Shumëzues' },
  { key: 'cost_price', label: 'Cmim Blerje (€)' },
  { key: 'sell_price', label: 'Cmim Shitje (€)' },
  { key: 'vat_rate',   label: 'TVSH %' },
  { key: 'promo',      label: 'Në promocion' },
  { key: 'promo_pct',  label: 'Zbritje Promo %' },
]
const EXPORT_LS_KEY = 'products_export_fields_v1'
const DEFAULT_EXPORT_KEYS = ['nr', 'barcode', 'name', 'category', 'brand', 'sku', 'cost_price', 'sell_price', 'stock', 'min_stock']

function ExportFieldsModal({ count, onClose, onExport }) {
  const [selected, setSelected] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(EXPORT_LS_KEY) || 'null')
      if (Array.isArray(saved) && saved.length > 0) return saved
    } catch {}
    return DEFAULT_EXPORT_KEYS
  })
  const [exporting, setExporting] = useState(false)

  const toggle = (key) => setSelected(prev =>
    prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
  )
  const selectAll  = () => setSelected(EXPORT_FIELDS.map(f => f.key))
  const selectNone = () => setSelected([])

  const handleExport = async () => {
    if (selected.length === 0 || exporting) return
    setExporting(true)
    try {
      localStorage.setItem(EXPORT_LS_KEY, JSON.stringify(selected))
      await onExport(selected)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="modal-header">
          <div>
            <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">⬇️ Export produkte në Excel</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{count} produkte · zgjidh cilat fusha të përfshihen</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 text-xl">×</button>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-2">
            <button onClick={selectAll}  className="text-xs px-3 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 dark:text-blue-300 font-semibold">✓ Të gjitha</button>
            <button onClick={selectNone} className="text-xs px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 dark:bg-slate-700 dark:hover:bg-slate-600 dark:text-slate-300 font-semibold">Asnjë</button>
            <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">{selected.length} / {EXPORT_FIELDS.length} të zgjedhura</span>
          </div>
          <div className="grid grid-cols-2 gap-2 border border-slate-200 dark:border-slate-700 rounded-xl p-3 max-h-80 overflow-y-auto">
            {EXPORT_FIELDS.map(f => {
              const on = selected.includes(f.key)
              return (
                <label key={f.key} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${on ? 'bg-blue-50 dark:bg-blue-900/30' : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'}`}>
                  <input type="checkbox" checked={on} onChange={() => toggle(f.key)} className="w-4 h-4 accent-blue-600" />
                  <span className={`text-sm ${on ? 'font-semibold text-slate-800 dark:text-slate-100' : 'text-slate-600 dark:text-slate-300'}`}>{f.label}</span>
                </label>
              )
            })}
          </div>
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <button onClick={onClose} className="btn-secondary">Anulo</button>
            <button
              onClick={handleExport}
              disabled={selected.length === 0 || exporting}
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {exporting ? 'Duke eksportuar...' : `⬇️ Export ${selected.length} fusha`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
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
    { key: 'cost_price',           label: 'Cmim Kosto ($)'   },
    { key: 'sell_price',           label: 'Cmim Shitje (€)'  },
    { key: 'min_stock',            label: 'Stok Minimal'     },
  ]

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="modal-header">
          <div>
            <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">
              {step === 'done' ? '✅ Import u krye!' : 'Import nga Excel'}
            </h3>
            {fileName && step !== 'upload' && (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">📄 {fileName}</p>
            )}
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 text-xl">×</button>
        </div>

        <div className="p-6">

          {/* ── STEP: UPLOAD ── */}
          {step === 'upload' && (
            <div className="space-y-5">
              {/* Drop zone */}
              <div
                onClick={() => fileRef.current.click()}
                className="border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-blue-400 rounded-2xl p-10 text-center cursor-pointer transition-colors group"
              >
                <div className="text-5xl mb-3">📂</div>
                <p className="font-semibold text-slate-700 dark:text-slate-200 group-hover:text-blue-600">Klikoni për të zgjedhur Excel-in</p>
                <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">Mbështet: .xlsx, .xls</p>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleFile}
                  className="hidden"
                />
              </div>

              {error && <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/30 p-3 rounded-lg">{error}</p>}

              {/* Template hint */}
              <div className="flex items-center justify-between p-4 bg-blue-50 dark:bg-blue-900/30 rounded-xl border border-blue-100">
                <div>
                  <p className="text-sm font-semibold text-blue-800 dark:text-blue-200">Nuk keni template?</p>
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
                      <span className="text-xs text-slate-600 dark:text-slate-300 w-32 flex-shrink-0">{f.label}</span>
                      <select
                        value={mapping[f.key] ?? -1}
                        onChange={e => setMap(f.key, e.target.value)}
                        className={`input-field-sm flex-1 ${mapping[f.key] >= 0 ? 'border-green-400' : 'border-slate-300 dark:border-slate-700'}`}
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
                <div className="flex-1 p-3 bg-emerald-50 dark:bg-emerald-900/30 rounded-xl border border-emerald-200 text-center">
                  <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">{products.length}</p>
                  <p className="text-xs text-emerald-600">Produkte të gatshme</p>
                </div>
                <div className="flex-1 p-3 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 text-center">
                  <p className="text-2xl font-bold text-slate-700 dark:text-slate-200">{dataRows.length - products.length}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Rreshta të zbrazur</p>
                </div>
                <div className="flex-1 p-3 bg-blue-50 dark:bg-blue-900/30 rounded-xl border border-blue-200 text-center">
                  <p className="text-2xl font-bold text-blue-700 dark:text-blue-300">{headers.length}</p>
                  <p className="text-xs text-blue-600">Kolona totale</p>
                </div>
              </div>

              {/* Preview table */}
              <div>
                <p className="section-title">Shembull — 5 produktet e para</p>
                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-900">
                      <tr>
                        <th className="px-2 py-2 text-left font-semibold text-slate-500 dark:text-slate-400">Nr.</th>
                        <th className="px-2 py-2 text-left font-semibold text-slate-500 dark:text-slate-400">Barkodi</th>
                        <th className="px-2 py-2 text-left font-semibold text-slate-500 dark:text-slate-400">Nr Serie</th>
                        <th className="px-2 py-2 text-left font-semibold text-slate-500 dark:text-slate-400">Pershkrimi</th>
                        <th className="px-2 py-2 text-center font-semibold text-slate-500 dark:text-slate-400">Njesi</th>
                        <th className="px-2 py-2 text-center font-semibold text-slate-500 dark:text-slate-400">Sasi</th>
                        <th className="px-2 py-2 text-right font-semibold text-slate-500 dark:text-slate-400">Gram</th>
                        <th className="px-2 py-2 text-right font-semibold text-slate-500 dark:text-slate-400">Cm PA</th>
                        <th className="px-2 py-2 text-center font-semibold text-slate-500 dark:text-slate-400">TVSH</th>
                        <th className="px-2 py-2 text-right font-semibold text-slate-500 dark:text-slate-400">Kosto</th>
                        <th className="px-2 py-2 text-right font-semibold text-slate-500 dark:text-slate-400">Shitje</th>
                      </tr>
                    </thead>
                    <tbody>
                      {products.slice(0, 5).map((p, i) => (
                        <tr key={i} className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <td className="px-2 py-2 font-mono text-slate-400 dark:text-slate-500">{i + 1}</td>
                          <td className="px-2 py-2 font-mono text-slate-500 dark:text-slate-400">{p.barcode || '—'}</td>
                          <td className="px-2 py-2 font-mono text-slate-500 dark:text-slate-400">{p.serial_no || '—'}</td>
                          <td className="px-2 py-2 font-medium text-slate-800 dark:text-slate-100 max-w-[180px] truncate">{p.name || <span className="text-red-400 italic">bosh</span>}</td>
                          <td className="px-2 py-2 text-center text-slate-600 dark:text-slate-300">{p.unit || '—'}</td>
                          <td className="px-2 py-2 text-center">
                            <span className={`badge ${p.stock === 0 ? 'badge-red' : 'badge-green'}`}>{p.stock}</span>
                          </td>
                          <td className="px-2 py-2 text-right text-slate-600 dark:text-slate-300 tabular-nums">{p.gram || '—'}</td>
                          <td className="px-2 py-2 text-right text-slate-700 dark:text-slate-200 tabular-nums">{p.purchase_price_no_vat || '—'}</td>
                          <td className="px-2 py-2 text-center text-slate-600 dark:text-slate-300">{p.vat_rate != null ? `${p.vat_rate}%` : '—'}</td>
                          <td className="px-2 py-2 text-right text-slate-700 dark:text-slate-200 tabular-nums">{p.cost_price || '—'}</td>
                          <td className="px-2 py-2 text-right font-semibold text-slate-900 dark:text-white tabular-nums">{p.sell_price || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {products.length > 5 && (
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-2 text-center">
                    + {products.length - 5} produkte të tjera...
                  </p>
                )}
              </div>

              {error && <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/30 p-3 rounded-lg">{error}</p>}

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
              <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-2">
                {importedCount} produkte u importuan!
              </h3>
              <p className="text-slate-500 dark:text-slate-400 text-sm mb-6">
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

// ── Inline "new product" row ──────────────────────────────────────────────
// Shfaqet në krye të tabelës kur user-i shtyp "+ Shto Produkt". Formula flori
// aplikohet auto; user-i ruan me butonin ✓ ose anulon me ✕.
function NewProductRow({ rowData, onChange, onSave, onCancel }) {
  const set = (k, v) => onChange({ [k]: v })

  // Formula flori — vetëm çmimi i shitjes:
  //   sell_price = has_gram × multiplier × sell_rate   (fallback: has_rate)
  // has_gram, cost_price, has_rate merren nga importi/user-i pa formulë.
  useEffect(() => {
    const hg  = parseFloat(rowData.has_gram) || 0
    const mul = parseFloat(rowData.multiplier) || 0
    const hr  = parseFloat(rowData.has_rate) || 0
    const sr  = parseFloat(rowData.sell_rate) || 0
    if (hg <= 0 || mul <= 0) return
    const effSell = sr > 0 ? sr : hr
    if (effSell <= 0) return
    const newSell = +(hg * mul * effSell).toFixed(2)
    if (String(newSell) === String(parseFloat(rowData.sell_price) || 0)) return
    onChange({ sell_price: String(newSell) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowData.has_gram, rowData.multiplier, rowData.has_rate, rowData.sell_rate])

  return (
    <tr className="border-b border-slate-200 dark:border-slate-700 bg-blue-50/40 dark:bg-blue-900/10">
      <td className="px-2 py-1 font-mono text-xs text-blue-600 dark:text-blue-300 whitespace-nowrap font-bold">
        i ri
      </td>
      <td className="px-2 py-1 text-xs text-slate-400 dark:text-slate-500 whitespace-nowrap" title="Data caktohet automatikisht kur ruhet">—</td>
      <td className="px-1 py-1 min-w-[160px]">
        <input type="text" value={rowData.barcode}
          onChange={e => set('barcode', e.target.value)}
          className="input-field-sm font-mono text-xs w-full" placeholder="—" />
      </td>
      <td className="px-1 py-1 min-w-[300px]">
        <input type="text" value={rowData.name} autoFocus
          onChange={e => set('name', e.target.value)}
          className="input-field-sm w-full text-sm font-medium py-1.5" placeholder="Emri i produktit *" />
      </td>
      <td className="px-1 py-1 w-16 text-center">
        <CategoryIconSelect value={rowData.category} onChange={v => set('category', v)} />
      </td>
      <td className="px-1 py-1">
        <input type="number" min="0" value={rowData.stock}
          onChange={e => set('stock', e.target.value)}
          className="input-field-sm text-center" placeholder="0" />
      </td>
      <td className="px-1 py-1">
        <input type="number" step="0.001" min="0" value={rowData.gram}
          onChange={e => set('gram', e.target.value)}
          className="input-field-sm text-right" placeholder="0.000" />
      </td>
      <td className="px-1 py-1 bg-amber-50/40 dark:bg-amber-900/10">
        <input type="number" step="1" min="0" value={rowData.kodi}
          onChange={e => set('kodi', e.target.value)}
          className="input-field-sm text-right font-semibold text-amber-800 dark:text-amber-200"
          placeholder="585" />
      </td>
      <td className="px-1 py-1 bg-amber-50/40 dark:bg-amber-900/10">
        <input type="number" step="0.001" min="0" value={rowData.has_gram}
          onChange={e => set('has_gram', e.target.value)}
          className="input-field-sm text-right font-semibold text-amber-700 dark:text-amber-300"
          placeholder="0.000" />
      </td>
      <td className="px-1 py-1 bg-amber-50/40 dark:bg-amber-900/10">
        <div className="flex items-center gap-1">
          <MoneyInput value={rowData.has_rate}
            onChange={v => set('has_rate', String(v))}
            className="input-field-sm text-right font-semibold text-amber-800 dark:text-amber-200 flex-1 min-w-0"
            placeholder="0.00" />
          <span
            title="Valuta: USD (fikse për Kursi Blerje)"
            className="px-1.5 py-0.5 rounded border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-800 text-xs font-bold text-amber-800 dark:text-amber-200 leading-none shrink-0"
          >$</span>
        </div>
      </td>
      <td className="px-1 py-1">
        <MoneyInput value={rowData.cost_price}
          onChange={v => set('cost_price', String(v))}
          className="input-field-sm text-right font-semibold"
          placeholder="0.00" />
      </td>
      <td className="px-1 py-1 bg-emerald-50/40 dark:bg-emerald-900/10">
        <input type="number" step="0.01" min="0" value={rowData.multiplier}
          onChange={e => set('multiplier', e.target.value)}
          className="input-field-sm text-right font-semibold text-emerald-800 dark:text-emerald-200"
          placeholder="1.8" />
      </td>
      {(() => {
        const hg  = parseFloat(rowData.has_gram) || 0
        const mul = parseFloat(rowData.multiplier) || 0
        const hasSell = hg > 0 && mul > 0 ? +(hg * mul).toFixed(2) : 0
        return (
          <td className="px-2 py-1 text-right tabular-nums font-semibold bg-emerald-50/40 dark:bg-emerald-900/10 text-emerald-800 dark:text-emerald-200"
              title="Auto: Cmim Blerje Has × Shumëzues">
            {hasSell > 0 ? hasSell.toFixed(2) : '—'}
          </td>
        )
      })()}
      <td className="px-1 py-1 bg-emerald-50/40 dark:bg-emerald-900/10">
        <div className="flex items-center gap-1">
          <MoneyInput value={rowData.sell_rate}
            onChange={v => set('sell_rate', String(v))}
            className="input-field-sm text-right font-semibold text-emerald-800 dark:text-emerald-200 flex-1 min-w-0"
            placeholder="0.00" />
          <CurrencyToggle value={rowData.sell_rate_currency}
            onChange={v => set('sell_rate_currency', v)} />
        </div>
      </td>
      <td className="px-1 py-1">
        <MoneyInput value={rowData.purchase_price_no_vat}
          onChange={v => set('purchase_price_no_vat', String(v))}
          className="input-field-sm text-right" placeholder="0.00" />
      </td>
      <td className="px-1 py-1">
        <input type="number" step="0.01" min="0" max="100" value={rowData.vat_rate}
          onChange={e => set('vat_rate', e.target.value)}
          className="input-field-sm text-center" />
      </td>
      <td className="px-1 py-1">
        <MoneyInput value={rowData.sell_price}
          onChange={v => set('sell_price', String(v))}
          disabled={parseFloat(rowData.has_gram) > 0 && parseFloat(rowData.multiplier) > 0}
          className={`input-field-sm text-right font-bold text-slate-900 dark:text-white ${parseFloat(rowData.has_gram) > 0 && parseFloat(rowData.multiplier) > 0 ? 'bg-slate-100 dark:bg-slate-800 cursor-not-allowed' : ''}`}
          placeholder="0.00" />
      </td>
      {(() => {
        const cp = parseFloat(rowData.cost_price) || 0
        const sp = parseFloat(rowData.sell_price) || 0
        const fit = cp > 0 ? ((sp - cp) / cp) * 100 : 0
        const mar = sp > 0 ? ((sp - cp) / sp) * 100 : 0
        const cls = v => v > 0
          ? 'text-emerald-700 dark:text-emerald-300'
          : v < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400 dark:text-slate-500'
        return (
          <>
            <td className={`px-2 py-1 text-right tabular-nums font-semibold ${cls(fit)}`}>
              {cp > 0 ? fit.toFixed(1) + '%' : '—'}
            </td>
            <td className={`px-2 py-1 text-right tabular-nums font-semibold ${cls(mar)}`}>
              {sp > 0 ? mar.toFixed(1) + '%' : '—'}
            </td>
          </>
        )
      })()}
      <td className="px-1 py-1 bg-rose-50/40 dark:bg-rose-900/10">
        <div className="flex items-center justify-center gap-1">
          <input type="checkbox" checked={!!rowData.is_promotion}
            onChange={e => onChange({
              is_promotion: e.target.checked,
              promo_discount_pct: e.target.checked ? (rowData.promo_discount_pct || '') : '',
            })}
            className="w-4 h-4 accent-rose-600"
            title="Shënoje si produkt në promocion" />
          <input type="number" step="0.01" min="0" max="100"
            value={rowData.is_promotion ? rowData.promo_discount_pct : ''}
            disabled={!rowData.is_promotion}
            onChange={e => set('promo_discount_pct', e.target.value)}
            className="input-field-sm text-right w-14 disabled:bg-slate-100 dark:disabled:bg-slate-800 disabled:text-slate-300"
            placeholder="%"
            title="Zbritja % për këtë produkt gjatë promocionit" />
        </div>
      </td>
      <td className="px-2 py-1">
        <div className="flex items-center justify-center gap-1">
          <button onClick={onSave} title="Ruaj"
            className="px-2 py-0.5 rounded bg-emerald-100 hover:bg-emerald-200 text-emerald-700 text-xs font-bold">✓</button>
          <button onClick={onCancel} title="Anulo"
            className="px-2 py-0.5 rounded bg-red-100 hover:bg-red-200 text-red-700 text-xs font-bold">✕</button>
        </div>
      </td>
    </tr>
  )
}

// ── Inline-editable list row ──────────────────────────────────────────────
// Çdo qelizë e rreshtit të produktit është input i editueshëm — si te
// Fatura Blerje. Ndryshimet ruhen me debounce (500ms) me PUT /api/products/:id.
// Formula flori aplikohet auto kur ndryshojnë kodi/gram/has_rate/multiplier/sell_rate.
function EditableProductRow({ p, onSaved, onEdit, onDelete, onBarcode, onMultiplierApply }) {
  const initForm = () => ({
    barcode:               p.barcode || '',
    name:                  p.name || '',
    brand:                 p.brand || '',
    category:              p.category || 'Tjeter',
    stock:                 p.stock != null ? String(p.stock) : '',
    gram:                  p.gram != null ? String(p.gram) : '',
    kodi:                  p.kodi != null && parseFloat(p.kodi) > 0 ? String(p.kodi) : '',
    has_gram:              p.has_gram != null ? String(p.has_gram) : '',
    has_currency:          p.has_currency || 'HAS',
    has_rate:              p.has_rate != null && parseFloat(p.has_rate) > 0 ? String(p.has_rate) : '',
    multiplier:            p.multiplier != null && parseFloat(p.multiplier) > 0 ? String(p.multiplier) : '',
    sell_rate:             p.sell_rate != null && parseFloat(p.sell_rate) > 0 ? String(p.sell_rate) : '',
    purchase_price_no_vat: p.purchase_price_no_vat != null ? String(p.purchase_price_no_vat) : '',
    vat_rate:              p.vat_rate != null ? String(p.vat_rate) : '0',
    cost_price:            p.cost_price != null ? String(p.cost_price) : '',
    sell_price:            p.sell_price != null ? String(p.sell_price) : '',
    is_promotion:          !!p.is_promotion,
    promo_discount_pct:    p.promo_discount_pct != null && parseFloat(p.promo_discount_pct) > 0 ? String(p.promo_discount_pct) : '',
    has_rate_currency:     'USD',
    sell_rate_currency:    p.sell_rate_currency || 'EUR',
  })
  const [form, setForm] = useState(initForm)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const initialMount = useRef(true)
  const savedSnapshot = useRef(JSON.stringify(initForm()))
  const savingRef = useRef(false)
  const formRef = useRef(form)
  const lastSaveAt = useRef(0)
  useEffect(() => { formRef.current = form }, [form])

  // Rifresko formin kur produkti ndryshon nga jashtë (reload, realtime sync),
  // vetëm nëse s'kemi ndryshime lokale të pa-ruajtura DHE nuk kemi bërë save
  // rishtazi (nën 3s). Turso ndonjëherë kthen të dhëna të vjetra pas një PUT
  // të suksesshëm (replica lag) → pa këtë guard, form-i i mbishkruar do ta
  // rikthente ndryshimin që sapo user-i bëri.
  useEffect(() => {
    const fresh = initForm()
    const freshStr = JSON.stringify(fresh)
    if (freshStr === savedSnapshot.current) return
    const currentFormStr = JSON.stringify(formRef.current)
    if (currentFormStr !== savedSnapshot.current) return // dirty — mos e prek
    if (Date.now() - lastSaveAt.current < 3000) return // just saved — prit propagimin
    setForm(fresh)
    savedSnapshot.current = freshStr
    initialMount.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.id, p.updated_at, p.barcode, p.name, p.stock, p.cost_price, p.sell_price,
      p.gram, p.has_gram, p.has_rate, p.kodi, p.multiplier, p.sell_rate,
      p.is_promotion, p.promo_discount_pct])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Formula flori — vetëm çmimi i shitjes:
  //   sell_price = has_gram × multiplier × sell_rate   (fallback: has_rate)
  // has_gram, cost_price, has_rate, gram, kodi merren nga importi/user-i pa formulë.
  useEffect(() => {
    const hg  = parseFloat(form.has_gram) || 0
    const mul = parseFloat(form.multiplier) || 0
    const hr  = parseFloat(form.has_rate) || 0
    const sr  = parseFloat(form.sell_rate) || 0
    if (hg <= 0 || mul <= 0) return
    const effSell = sr > 0 ? sr : hr
    if (effSell <= 0) return
    const newSell = +(hg * mul * effSell).toFixed(2)
    setForm(prev => {
      if (String(newSell) === String(parseFloat(prev.sell_price) || 0)) return prev
      return { ...prev, sell_price: String(newSell) }
    })
  }, [form.has_gram, form.multiplier, form.has_rate, form.sell_rate])

  // Ekzekuton PUT me formin më të fundit. Përdoret nga debounce dhe nga
  // butoni manual 💾. Pret çdo save të mëparshëm të mbarojë para se të nisë
  // dhe surface-on error nëse server ktheu != 2xx.
  const performSave = async () => {
    while (savingRef.current) {
      await new Promise(r => setTimeout(r, 100))
    }
    savingRef.current = true
    setSaving(true)
    setSaveError(null)
    const currentForm = formRef.current
    // Hiq updated_at nga payload — server-i bën optimistic lock nese e gjen,
    // dhe replica lag mund te shkaktoje 409 false-positive. Per inline edit,
    // last-write-wins eshte i deshirueshem (user's own change should not fail).
    const { updated_at: _skipTs, ...pRest } = p
    const payload = {
      ...pRest,
      barcode:               currentForm.barcode,
      name:                  currentForm.name,
      brand:                 currentForm.brand,
      category:              currentForm.category,
      stock:                 parseInt(currentForm.stock) || 0,
      gram:                  parseFloat(currentForm.gram) || 0,
      kodi:                  parseFloat(currentForm.kodi) || 0,
      has_gram:              parseFloat(currentForm.has_gram) || 0,
      has_currency:          currentForm.has_currency || 'HAS',
      has_rate:              parseFloat(currentForm.has_rate) || 0,
      multiplier:            parseFloat(currentForm.multiplier) || 0,
      sell_rate:             parseFloat(currentForm.sell_rate) || 0,
      purchase_price_no_vat: parseFloat(currentForm.purchase_price_no_vat) || 0,
      vat_rate:              parseFloat(currentForm.vat_rate) || 0,
      cost_price:            parseFloat(currentForm.cost_price) || 0,
      sell_price:            parseFloat(currentForm.sell_price) || 0,
      is_promotion:          currentForm.is_promotion ? 1 : 0,
      promo_discount_pct:    currentForm.is_promotion ? Math.max(0, Math.min(100, parseFloat(currentForm.promo_discount_pct) || 0)) : 0,
      has_rate_currency:     'USD',
      sell_rate_currency:    currentForm.sell_rate_currency === 'USD' ? 'USD' : 'EUR',
    }
    try {
      const res = await fetch(`/api/products/${p.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const errBody = await res.text().catch(() => '')
        throw new Error(`HTTP ${res.status}${errBody ? ': ' + errBody.slice(0, 100) : ''}`)
      }
      savedSnapshot.current = JSON.stringify(currentForm)
      lastSaveAt.current = Date.now()
      onSaved?.()
    } catch (e) {
      console.error('Product save failed:', e)
      setSaveError(e?.message || 'Gabim në ruajtje')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  // Debounced auto-save — 600ms pas ndalimit të shkrimit.
  useEffect(() => {
    if (initialMount.current) { initialMount.current = false; return }
    const t = setTimeout(performSave, 600)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form])

  const isDirty = JSON.stringify(form) !== savedSnapshot.current

  return (
    <tr className={`border-b border-slate-100 dark:border-slate-800 hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors ${isDirty ? 'bg-amber-50/60 dark:bg-amber-900/20' : ''}`}>
      <td className="px-2 py-1 font-mono text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
        {productNo(p.id)}
        {saving && <span className="ml-1 text-[10px] text-blue-500" title="Duke ruajtur...">⏳</span>}
        {!saving && saveError && (
          <span className="ml-1 text-[10px] text-red-600 cursor-help" title={`Ruajtja dështoi: ${saveError}. Kliko 💾 për të riprovuar.`}>⚠️</span>
        )}
        {!saving && !saveError && isDirty && (
          <span className="ml-1 text-[10px] text-amber-500" title="Ndryshim i paruajtur">●</span>
        )}
      </td>
      {(() => {
        // last_purchase_date vjen si TEXT "YYYY-MM-DD" nga fatura e fundit e
        // blerjes; nuk ka orë. Nëse produkti s'ka fatura, shfaq "—".
        const raw = p.last_purchase_date
        if (!raw) return <td className="px-2 py-1 text-base font-semibold text-slate-400 dark:text-slate-500 whitespace-nowrap" title="S'ka faturë blerjeje për këtë produkt">—</td>
        const m = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})/)
        if (!m) return <td className="px-2 py-1 text-base font-semibold text-slate-400 dark:text-slate-500 whitespace-nowrap">—</td>
        const [, y, mo, da] = m
        const short = `${da}.${mo}.${y.slice(-2)}`
        return (
          <td className="px-2 py-1 text-base font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap tabular-nums" title={`Data e faturës së fundit të blerjes: ${y}-${mo}-${da}`}>
            {short}
          </td>
        )
      })()}
      <td className="px-1 py-1 min-w-[160px]">
        <input type="text" value={form.barcode}
          onChange={e => set('barcode', e.target.value)}
          className="input-field-sm font-mono text-xs w-full" placeholder="—" />
      </td>
      <td className="px-1 py-1 min-w-[300px]">
        <input type="text" value={form.name}
          onChange={e => set('name', e.target.value)}
          className="input-field-sm w-full text-sm font-medium py-1.5" placeholder="Emri i produktit" />
      </td>
      <td className="px-1 py-1 w-16 text-center">
        <CategoryIconSelect value={form.category} onChange={v => set('category', v)} />
      </td>
      <td className="px-1 py-1">
        <input type="number" min="0" value={form.stock}
          onChange={e => set('stock', e.target.value)}
          className="input-field-sm text-center" />
      </td>
      <td className="px-1 py-1">
        <input type="number" step="0.001" min="0" value={form.gram}
          onChange={e => set('gram', e.target.value)}
          className="input-field-sm text-right" placeholder="0.000" />
      </td>
      <td className="px-1 py-1 bg-amber-50/40 dark:bg-amber-900/10">
        <input type="number" step="1" min="0" value={form.kodi}
          onChange={e => set('kodi', e.target.value)}
          className="input-field-sm text-right font-semibold text-amber-800 dark:text-amber-200"
          placeholder="585" />
      </td>
      <td className="px-1 py-1 bg-amber-50/40 dark:bg-amber-900/10">
        <input type="number" step="0.001" min="0" value={form.has_gram}
          onChange={e => set('has_gram', e.target.value)}
          className="input-field-sm text-right font-semibold text-amber-700 dark:text-amber-300"
          placeholder="0.000" />
      </td>
      <td className="px-1 py-1 bg-amber-50/40 dark:bg-amber-900/10">
        <div className="flex items-center gap-1">
          <MoneyInput value={form.has_rate}
            onChange={v => set('has_rate', String(v))}
            className="input-field-sm text-right font-semibold text-amber-800 dark:text-amber-200 flex-1 min-w-0"
            placeholder="0.00" />
          <span
            title="Valuta: USD (fikse për Kursi Blerje)"
            className="px-1.5 py-0.5 rounded border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-800 text-xs font-bold text-amber-800 dark:text-amber-200 leading-none shrink-0"
          >$</span>
        </div>
      </td>
      <td className="px-1 py-1">
        <MoneyInput value={form.cost_price}
          onChange={v => set('cost_price', String(v))}
          className="input-field-sm text-right font-semibold"
          placeholder="0.00" />
      </td>
      <td className="px-1 py-1 bg-emerald-50/40 dark:bg-emerald-900/10">
        <input type="number" step="0.01" min="0" value={form.multiplier}
          onChange={e => set('multiplier', e.target.value)}
          className="input-field-sm text-right font-semibold text-emerald-800 dark:text-emerald-200"
          placeholder="1.8" />
      </td>
      {(() => {
        const hg  = parseFloat(form.has_gram) || 0
        const mul = parseFloat(form.multiplier) || 0
        const hasSell = hg > 0 && mul > 0 ? +(hg * mul).toFixed(2) : 0
        return (
          <td className="px-2 py-1 text-right tabular-nums font-semibold bg-emerald-50/40 dark:bg-emerald-900/10 text-emerald-800 dark:text-emerald-200"
              title="Auto: Cmim Blerje Has × Shumëzues">
            {hasSell > 0 ? hasSell.toFixed(2) : '—'}
          </td>
        )
      })()}
      <td className="px-1 py-1 bg-emerald-50/40 dark:bg-emerald-900/10">
        <div className="flex items-center gap-1">
          <MoneyInput value={form.sell_rate}
            onChange={v => set('sell_rate', String(v))}
            className="input-field-sm text-right font-semibold text-emerald-800 dark:text-emerald-200 flex-1 min-w-0"
            placeholder="0.00" />
          <CurrencyToggle value={form.sell_rate_currency}
            onChange={v => set('sell_rate_currency', v)} />
        </div>
      </td>
      <td className="px-1 py-1">
        <MoneyInput value={form.purchase_price_no_vat}
          onChange={v => set('purchase_price_no_vat', String(v))}
          className="input-field-sm text-right" placeholder="0.00" />
      </td>
      <td className="px-1 py-1">
        <input type="number" step="0.01" min="0" max="100" value={form.vat_rate}
          onChange={e => set('vat_rate', e.target.value)}
          className="input-field-sm text-center" />
      </td>
      <td className="px-1 py-1">
        <MoneyInput value={form.sell_price}
          onChange={v => set('sell_price', String(v))}
          disabled={parseFloat(form.has_gram) > 0 && parseFloat(form.multiplier) > 0}
          className={`input-field-sm text-right font-bold text-slate-900 dark:text-white ${parseFloat(form.has_gram) > 0 && parseFloat(form.multiplier) > 0 ? 'bg-slate-100 dark:bg-slate-800 cursor-not-allowed' : ''}`}
          title={parseFloat(form.has_gram) > 0 && parseFloat(form.multiplier) > 0 ? 'Auto: Cmim Blerje Has × Shumëzues × Kursi Shitje' : undefined}
          placeholder="0.00" />
      </td>
      {(() => {
        const cp = parseFloat(form.cost_price) || 0
        const sp = parseFloat(form.sell_price) || 0
        const fit = cp > 0 ? ((sp - cp) / cp) * 100 : 0
        const mar = sp > 0 ? ((sp - cp) / sp) * 100 : 0
        const cls = v => v > 0
          ? 'text-emerald-700 dark:text-emerald-300'
          : v < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400 dark:text-slate-500'
        return (
          <>
            <td className={`px-2 py-1 text-right tabular-nums font-semibold ${cls(fit)}`}>
              {cp > 0 ? fit.toFixed(1) + '%' : '—'}
            </td>
            <td className={`px-2 py-1 text-right tabular-nums font-semibold ${cls(mar)}`}>
              {sp > 0 ? mar.toFixed(1) + '%' : '—'}
            </td>
          </>
        )
      })()}
      <td className="px-1 py-1 bg-rose-50/40 dark:bg-rose-900/10">
        <div className="flex items-center justify-center gap-1">
          <input type="checkbox" checked={!!form.is_promotion}
            onChange={e => setForm(f => ({
              ...f,
              is_promotion: e.target.checked,
              promo_discount_pct: e.target.checked ? (f.promo_discount_pct || '') : '',
            }))}
            className="w-4 h-4 accent-rose-600"
            title="Shënoje si produkt në promocion" />
          <input type="number" step="0.01" min="0" max="100"
            value={form.is_promotion ? form.promo_discount_pct : ''}
            disabled={!form.is_promotion}
            onChange={e => set('promo_discount_pct', e.target.value)}
            className="input-field-sm text-right w-14 disabled:bg-slate-100 dark:disabled:bg-slate-800 disabled:text-slate-300"
            placeholder="%"
            title="Zbritja % për këtë produkt gjatë promocionit" />
        </div>
      </td>
      <td className="px-2 py-1">
        <div className="flex items-center justify-center gap-1">
          {(isDirty || saveError) && (
            <button onClick={performSave} disabled={saving}
              title={saveError ? `Ruaj sërish (${saveError})` : 'Ruaj ndryshimet e paruajtura'}
              className={`px-1.5 py-0.5 rounded text-white text-xs font-bold disabled:opacity-40 ${saveError ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
              💾
            </button>
          )}
          <button onClick={() => onBarcode(p)} title="Gjenero & Printo Barkod"
            className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs">🏷️</button>
          <button onClick={() => onEdit(p)} title="Hap modal-in e plotë"
            className="px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 text-blue-600 text-xs">✎</button>
          <button onClick={() => onDelete(p)} title="Fshi"
            className="px-1.5 py-0.5 rounded bg-red-50 dark:bg-red-900/30 hover:bg-red-100 text-red-600 text-xs">✕</button>
        </div>
      </td>
    </tr>
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
          vat_rate:    product.vat_rate !== undefined && product.vat_rate !== null ? String(product.vat_rate) : '0',
          gram:        product.gram !== undefined && product.gram !== null ? String(product.gram) : '',
          serial_no:   product.serial_no || '',
          purchase_price_no_vat: product.purchase_price_no_vat != null ? String(product.purchase_price_no_vat) : '',
          has_gram:     product.has_gram != null ? String(product.has_gram) : '',
          has_currency: product.has_currency || 'HAS',
          has_rate:     product.has_rate != null ? String(product.has_rate) : '',
          kodi:         product.kodi != null && parseFloat(product.kodi) > 0 ? String(product.kodi) : '',
          multiplier:   product.multiplier != null && parseFloat(product.multiplier) > 0 ? String(product.multiplier) : '',
          sell_rate:    product.sell_rate != null && parseFloat(product.sell_rate) > 0 ? String(product.sell_rate) : '',
          is_promotion: !!product.is_promotion,
          promo_discount_pct: product.promo_discount_pct != null
            ? String(product.promo_discount_pct)
            : '',
        }
      : { ...EMPTY, is_promotion: false, promo_discount_pct: '' }
  )
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  // Formula flori — kur kodi, gram dhe has_rate janë > 0, llogarit auto:
  //   has_gram   = (kodi/1000 + has_rate/1000) × gram
  //   cost_price = has_gram × has_rate
  //   sell_price = has_gram × multiplier × sell_rate    (sell_rate ose has_rate si fallback)
  useEffect(() => {
    const g   = parseFloat(form.gram) || 0
    const k   = parseFloat(form.kodi) || 0
    const hr  = parseFloat(form.has_rate) || 0
    const mul = parseFloat(form.multiplier) || 0
    const sr  = parseFloat(form.sell_rate) || 0
    if (k <= 0 || g <= 0 || hr <= 0) return
    const effSell = sr > 0 ? sr : hr
    const newHas  = +(((k / 1000) + (hr / 1000)) * g).toFixed(4)
    const newCost = +(newHas * hr).toFixed(2)
    const newSell = mul > 0 ? +(newHas * mul * effSell).toFixed(2) : null
    setForm(prev => {
      const patch = {}
      if (String(newHas)  !== String(parseFloat(prev.has_gram)   || 0)) patch.has_gram   = String(newHas)
      if (String(newCost) !== String(parseFloat(prev.cost_price) || 0)) patch.cost_price = String(newCost)
      if (newSell != null && String(newSell) !== String(parseFloat(prev.sell_price) || 0)) patch.sell_price = String(newSell)
      return Object.keys(patch).length ? { ...prev, ...patch } : prev
    })
  }, [form.gram, form.kodi, form.has_rate, form.multiplier, form.sell_rate])

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
      vat_rate:   form.vat_rate === '' || form.vat_rate == null ? 0 : parseFloat(form.vat_rate),
      gram:       parseFloat(form.gram) || 0,
      serial_no:  form.serial_no || '',
      purchase_price_no_vat: parseFloat(form.purchase_price_no_vat) || 0,
      has_gram:     parseFloat(form.has_gram) || 0,
      has_currency: form.has_currency || 'HAS',
      has_rate:     parseFloat(form.has_rate) || 0,
      kodi:         parseFloat(form.kodi) || 0,
      multiplier:   parseFloat(form.multiplier) || 0,
      sell_rate:    parseFloat(form.sell_rate) || 0,
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
            <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">
              {product?.id ? `Ndrysho — ${productNo(product.id)}` : 'Shto Produkt të Ri'}
            </h3>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 dark:text-slate-500 text-xl">×</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {/* Category picker */}
            <div className="flex items-center gap-4 p-4 bg-slate-50 dark:bg-slate-900 rounded-xl">
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
                <label className="form-label">Çmimi PA TVSH — Blerje (€)</label>
                <MoneyInput value={form.purchase_price_no_vat}
                  onChange={v => set('purchase_price_no_vat', String(v))}
                  className="input-field" placeholder="0.00" />
                <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">Çmimi bazë nga furnitori (pa TVSH).</p>
              </div>
              <div>
                <label className="form-label">Çmimi Kosto ($)</label>
                <MoneyInput value={form.cost_price} onChange={v => set('cost_price', String(v))}
                  className="input-field" placeholder="0.00" />
                <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">Kosto totale (me TVSH + tarifat).</p>
              </div>
              <div>
                <label className="form-label">Çmimi Shitje (€)</label>
                <MoneyInput value={form.sell_price} onChange={v => set('sell_price', String(v))}
                  className="input-field" placeholder="0.00" />
                <div className="flex flex-wrap items-center gap-1 mt-1.5">
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 mr-0.5">nga kosto:</span>
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
                        className="px-2 py-0.5 text-[11px] rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-emerald-100 hover:text-emerald-700 text-slate-600 dark:text-slate-300 font-semibold border border-slate-200 dark:border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-slate-100 disabled:hover:text-slate-600"
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
                <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">Do të plotësohet automatikisht në faturat e shitjes.</p>
              </div>
              <div className="col-span-2 grid grid-cols-3 gap-3 p-3 rounded-xl bg-amber-50/60 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/50">
                <div className="col-span-3 text-[11px] font-bold uppercase tracking-wide text-amber-800 dark:text-amber-200">
                  🟡 Blerje në gram HAS
                </div>
                <div>
                  <label className="form-label">Kodi (585/750...)</label>
                  <input type="number" step="1" min="0" value={form.kodi}
                    onChange={e => set('kodi', e.target.value)}
                    className="input-field font-semibold text-amber-800 dark:text-amber-200"
                    placeholder="585" />
                </div>
                <div>
                  <label className="form-label">Blerje Ne Monedhe</label>
                  <input type="number" step="0.001" min="0" value={form.has_gram}
                    onChange={e => set('has_gram', e.target.value)}
                    className="input-field"
                    placeholder="0.000" />
                </div>
                <div>
                  <label className="form-label">Monedha</label>
                  <input type="text" value={form.has_currency}
                    onChange={e => set('has_currency', e.target.value)}
                    className="input-field font-mono" placeholder="HAS" />
                </div>
                <div>
                  <label className="form-label">Kursi Blerje ($/g)</label>
                  <MoneyInput value={form.has_rate}
                    onChange={v => set('has_rate', String(v))}
                    className="input-field tabular-nums font-semibold text-amber-800 dark:text-amber-200"
                    placeholder="0.00" />
                </div>
                <div>
                  <label className="form-label">Shumëzues Shitjeje</label>
                  <input type="number" step="0.01" min="0" value={form.multiplier}
                    onChange={e => set('multiplier', e.target.value)}
                    className="input-field font-semibold text-emerald-800 dark:text-emerald-200"
                    placeholder="1.8" />
                </div>
                <div>
                  <label className="form-label">Kursi Shitje (EUR/g)</label>
                  <MoneyInput value={form.sell_rate}
                    onChange={v => set('sell_rate', String(v))}
                    className="input-field tabular-nums font-semibold text-emerald-800 dark:text-emerald-200"
                    placeholder="0.00" />
                </div>
                <p className="col-span-3 text-[10px] text-amber-700 dark:text-amber-300">
                  Kur mbushet Kodi + Gram + Kursi Blerje, llogariten auto: <strong>Cmim Kosto</strong> = has_gram × Kursi Blerje. Kur mbushet edhe Shumëzuesi + Kursi Shitje: <strong>Cmim Shitje</strong> = has_gram × Shumëzues × Kursi Shitje.
                </p>
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
                  <span className="text-xs text-slate-500 dark:text-slate-400">do të aplikohet automatikisht kur ky produkt të shitet</span>
                </div>
              </div>
              <div className="col-span-2">
                <label className="form-label">Përshkrimi (opsional)</label>
                <textarea value={form.description} onChange={e => set('description', e.target.value)}
                  className="input-field resize-none" rows={2} placeholder="Detaje shtesë..." />
              </div>
              <div className="col-span-2">
                <div className={`p-3 rounded-xl border transition ${form.is_promotion ? 'bg-rose-50 border-rose-300' : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700'}`}>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!form.is_promotion}
                      onChange={e => set('is_promotion', e.target.checked)}
                      className="w-4 h-4 accent-rose-600"
                    />
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">🏷️ Në Promocion</p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
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
                        <div className="text-[11px] text-slate-600 dark:text-slate-300 flex-1 text-right">
                          <span className="text-slate-400 dark:text-slate-500 line-through mr-1.5">€{parseFloat(form.sell_price).toFixed(2)}</span>
                          <span className="font-bold text-emerald-700 dark:text-emerald-300">
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
                ${parseFloat(margin) >= 0 ? 'bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200' : 'bg-red-50 dark:bg-red-900/30 border-red-200'}`}>
                <span className="text-slate-600 dark:text-slate-300">Fitimi për cope:</span>
                <span className={`font-bold ${parseFloat(margin) >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
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
  const [showExport, setShowExport] = useState(false)
  const [view, setView]             = useState('list')  // grid | list
  const [fromDate, setFromDate]     = useState('')
  const [toDate, setToDate]         = useState('')
  const [bulkApplying, setBulkApplying] = useState(false)
  const [bulkMultiplier, setBulkMultiplier] = useState('')
  // Filter i statusit të stokut — kliko rrëshqitësin te stock strip
  //   'all' = normalja (fshihen pa-stoku), 'out' = vetëm pa stok,
  //   'low' = vetëm stok i ulët, 'ok' = vetëm OK.
  const [stockFilter, setStockFilter] = useState('all')
  // Rreshtat e rinj për shtim inline — si te Fatura Blerje "+ Shto Artikull"
  const [newRows, setNewRows] = useState([])
  const newRowKey = useRef(0)

  const addNewRow = () => {
    newRowKey.current += 1
    setNewRows(prev => [{ __key: newRowKey.current, ...EMPTY, is_promotion: false, promo_discount_pct: '' }, ...prev])
  }
  const updateNewRow = (idx, patch) => {
    setNewRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r))
  }
  const removeNewRow = (idx) => {
    setNewRows(prev => prev.filter((_, i) => i !== idx))
  }
  const saveNewRow = async (idx) => {
    const r = newRows[idx]
    if (!r || !r.name?.trim()) { alert('Vendos emrin e produktit.'); return }
    try {
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...r,
          cost_price: parseFloat(r.cost_price) || 0,
          sell_price: parseFloat(r.sell_price) || 0,
          stock:      parseInt(r.stock)         || 0,
          min_stock:  parseInt(r.min_stock)     || 5,
          vat_rate:   r.vat_rate === '' || r.vat_rate == null ? 0 : parseFloat(r.vat_rate),
          gram:       parseFloat(r.gram) || 0,
          purchase_price_no_vat: parseFloat(r.purchase_price_no_vat) || 0,
          has_gram:     parseFloat(r.has_gram) || 0,
          has_currency: r.has_currency || 'HAS',
          has_rate:     parseFloat(r.has_rate) || 0,
          kodi:         parseFloat(r.kodi) || 0,
          multiplier:   parseFloat(r.multiplier) || 0,
          sell_rate:    parseFloat(r.sell_rate) || 0,
          is_promotion: r.is_promotion ? 1 : 0,
          promo_discount_pct: r.is_promotion ? Math.max(0, Math.min(100, parseFloat(r.promo_discount_pct) || 0)) : 0,
        }),
      })
      if (!res.ok) throw new Error('Gabim në ruajtje')
      removeNewRow(idx)
      await load()
    } catch (e) { alert(e.message || 'Gabim') }
  }

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
    // Filtri i stokut — default 'all' fsheh pa-stoku. User-i mund të klikojë
    // "pa stok" / "stok i ulët" / "OK" te stock strip për të parë vetëm ata.
    const stockN = parseInt(p.stock) || 0
    const minN   = parseInt(p.min_stock) || 0
    if (stockFilter === 'out')      { if (stockN !== 0) return false }
    else if (stockFilter === 'low') { if (!(stockN > 0 && stockN <= minN)) return false }
    else if (stockFilter === 'ok')  { if (!(stockN > minN)) return false }
    else                            { if (stockN <= 0) return false }
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

  // Përmbledhëse e produkteve — bazuar te lista aktuale (filtruar). Vlerat në €
  // llogariten si stock × çmimi (kosto ose shitje). Kategoritë grupohen për
  // një pamje të shpejtë të inventarit.
  const summary = useMemo(() => {
    const s = {
      count: filtered.length,
      totalStock: 0,
      totalGram: 0,
      totalCostValue: 0,
      totalSellValue: 0,
      lowStock: 0,
      outOfStock: 0,
      byCategory: {},
    }
    filtered.forEach(p => {
      const stock = parseFloat(p.stock) || 0
      const gramPer = parseFloat(p.gram) || 0
      const cost = parseFloat(p.cost_price) || 0
      const sell = parseFloat(p.sell_price) || 0
      const gramTotal = gramPer * stock
      const costV = cost * stock
      const sellV = sell * stock
      s.totalStock += stock
      s.totalGram += gramTotal
      s.totalCostValue += costV
      s.totalSellValue += sellV
      if (stock <= 0) s.outOfStock += 1
      else if (p.min_stock != null && stock <= parseFloat(p.min_stock)) s.lowStock += 1
      const cat = p.category || 'Tjeter'
      if (!s.byCategory[cat]) s.byCategory[cat] = { count: 0, stock: 0, gram: 0, cost: 0, sell: 0 }
      s.byCategory[cat].count += 1
      s.byCategory[cat].stock += stock
      s.byCategory[cat].gram += gramTotal
      s.byCategory[cat].cost += costV
      s.byCategory[cat].sell += sellV
    })
    s.profit = s.totalSellValue - s.totalCostValue
    return s
  }, [filtered])
  const isFiltered = !!(search || filterCat !== 'Të gjitha' || fromDate || toDate)
  const fmtEur = (v) => `€${(v || 0).toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  // Kosto ruhet në USD (blerja bëhet me dollar nga furnitori) — Vlera në Kosto
  // shfaqet me simbolin $ që të mos ngatërrohet me monedhën e shitjes (EUR).
  const fmtUsd = (v) => `$${(v || 0).toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const fmtNum = (v) => (v || 0).toLocaleString('sq-AL', { maximumFractionDigits: 3 })

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
      // Ruajmë edhe `multiplier` që të shfaqet te kolona dhe të reflektohet
      // te çmimi i shitjes në formulën HAS (has_gram × multiplier × sell_rate).
      await fetch(`/api/products/${p.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...p, multiplier: m, sell_price: newSell }),
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
    if (!(await showConfirm(msg, {
      title: 'Përditësim masiv i çmimeve', confirmLabel: 'Aplikoji',
    }))) return
    setBulkApplying(true)
    try {
      await Promise.all(eligible.map(p => {
        const newSell = +(parseFloat(p.cost_price) * m).toFixed(2)
        return fetch(`/api/products/${p.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...p, multiplier: m, sell_price: newSell }),
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

  const runExport = async (selectedKeys) => {
    const XLSX = await loadXLSX()
    // Përkufizim i fushave — çelës, etiketa e kolonës, extraktori dhe gjerësia.
    // Renditja këtu është renditja që del në Excel.
    const FIELDS = [
      { key: 'nr',         label: 'Nr',                get: p => productNo(p.id),                       w: 10 },
      { key: 'barcode',    label: 'Barkodi',           get: p => p.barcode || '',                        w: 16 },
      { key: 'name',       label: 'Pershkrimi',        get: p => p.name || '',                           w: 30 },
      { key: 'category',   label: 'Kategoria',         get: p => p.category || '',                       w: 14 },
      { key: 'brand',      label: 'Brendi',            get: p => p.brand || '',                          w: 14 },
      { key: 'sku',        label: 'SKU',               get: p => p.sku || '',                            w: 12 },
      { key: 'stock',      label: 'Sasia',             get: p => p.stock || 0,                           w: 8 },
      { key: 'min_stock',  label: 'Stok Minimal',      get: p => p.min_stock || 5,                       w: 12 },
      { key: 'gram',       label: 'Gram',              get: p => p.gram || 0,                            w: 10 },
      { key: 'kodi',       label: 'Kodi',              get: p => p.kodi || '',                           w: 8 },
      { key: 'has_gram',   label: 'Has (gram)',        get: p => p.has_gram || 0,                        w: 12 },
      { key: 'has_rate',   label: 'Kursi Blerje',      get: p => p.has_rate || 0,                        w: 14 },
      { key: 'sell_rate',  label: 'Kursi Shitje',      get: p => p.sell_rate || 0,                       w: 14 },
      { key: 'multiplier', label: 'Shumëzues',         get: p => p.multiplier || 0,                      w: 12 },
      { key: 'cost_price', label: 'Cmim Blerje (€)',   get: p => p.cost_price || 0,                      w: 16 },
      { key: 'sell_price', label: 'Cmim Shitje (€)',   get: p => p.sell_price || 0,                      w: 16 },
      { key: 'vat_rate',   label: 'TVSH %',            get: p => p.vat_rate ?? 0,                        w: 8 },
      { key: 'promo',      label: 'Në promocion',      get: p => p.is_promotion ? 'Po' : '',             w: 12 },
      { key: 'promo_pct',  label: 'Zbritje Promo %',   get: p => p.is_promotion ? (p.promo_discount_pct || 0) : '', w: 14 },
    ]
    const active = FIELDS.filter(f => selectedKeys.includes(f.key))
    if (active.length === 0) return
    const rows = products.map(p => Object.fromEntries(active.map(f => [f.label, f.get(p)])))
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = active.map(f => ({ wch: f.w }))
    XLSX.utils.book_append_sheet(wb, ws, 'Produktet')
    XLSX.writeFile(wb, `gold_shop_produktet_${new Date().toISOString().split('T')[0]}.xlsx`)
  }

  const usedCats = ['Të gjitha', ...new Set(products.map(p => p.category))]
  const stockOk  = products.filter(p => p.stock > p.min_stock).length
  const stockLow = products.filter(p => p.stock > 0 && p.stock <= p.min_stock).length
  const stockOut = products.filter(p => p.stock === 0).length

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400 dark:text-slate-500">
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
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 text-sm pointer-events-none">🔍</span>
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
        <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5 flex-shrink-0">
          <button onClick={() => setView('grid')} className={`px-3 py-1.5 rounded-md text-sm transition-colors ${view === 'grid' ? 'bg-white dark:bg-slate-800 shadow-sm text-slate-800 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400'}`}>⊞</button>
          <button onClick={() => setView('list')} className={`px-3 py-1.5 rounded-md text-sm transition-colors ${view === 'list' ? 'bg-white dark:bg-slate-800 shadow-sm text-slate-800 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400'}`}>☰</button>
        </div>

        <button onClick={() => setShowExport(true)} className="btn-secondary flex-shrink-0">
          ⬇️ Export
        </button>
        <button onClick={() => setShowImport(true)} className="btn-secondary flex-shrink-0">
          📂 Import
        </button>
        <button onClick={addNewRow} className="btn-primary flex-shrink-0">
          + Shto Produkt
        </button>
      </div>

      {/* ── Date range filter + Bulk multiplier ── */}
      <div className="card flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">📅</span>
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Filtër data (shtimit)</span>
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
          <div className="flex items-center gap-2">
            <input
              type="text"
              inputMode="decimal"
              value={bulkMultiplier}
              onChange={e => setBulkMultiplier(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  const m = parseFloat(String(bulkMultiplier).replace(',', '.'))
                  if (m > 0 && !bulkApplying && filtered.length) applyBulkMultiplier(m)
                }
              }}
              disabled={bulkApplying || filtered.length === 0}
              className="input-field w-28 text-center disabled:opacity-50 disabled:cursor-not-allowed font-bold text-lg text-emerald-700 dark:text-emerald-300"
              placeholder="p.sh. 2.5"
              title="Shkruaj vetë shumëzuesin (p.sh. 2.5 = kosto × 2.5)"
            />
            <button
              onClick={() => {
                const m = parseFloat(String(bulkMultiplier).replace(',', '.'))
                if (!m || m <= 0) { alert('Vendos një shumëzues > 0.'); return }
                applyBulkMultiplier(m)
              }}
              disabled={bulkApplying || filtered.length === 0}
              className="btn-primary text-xs disabled:opacity-50 disabled:cursor-not-allowed"
              title="Apliko Çm. Shitje = Kosto × shumëzues për të gjitha produktet e shfaqura"
            >⚡ {bulkApplying ? 'Duke aplikuar...' : 'Apliko ×'}</button>
          </div>
        </div>
      </div>

      {/* ── Stock strip (klikohet për të filtruar) ── */}
      {products.length > 0 && (
        <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
          <span>{filtered.length} produkte{search || filterCat !== 'Të gjitha' || stockFilter !== 'all' ? ' (filtruar)' : ''}</span>
          <span className="w-px h-3 bg-slate-200 dark:bg-slate-700" />
          <button
            type="button"
            onClick={() => setStockFilter(stockFilter === 'ok' ? 'all' : 'ok')}
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md transition-colors ${stockFilter === 'ok' ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-semibold' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}
            title="Kliko për të filtruar vetëm produktet me stok OK"
          ><span className="w-2 h-2 bg-emerald-500 rounded-full" />{stockOk} OK</button>
          <button
            type="button"
            onClick={() => setStockFilter(stockFilter === 'low' ? 'all' : 'low')}
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md transition-colors ${stockFilter === 'low' ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 font-semibold' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}
            title="Kliko për të filtruar vetëm produktet me stok të ulët"
          ><span className="w-2 h-2 bg-amber-400 rounded-full" />{stockLow} stok i ulët</button>
          <button
            type="button"
            onClick={() => setStockFilter(stockFilter === 'out' ? 'all' : 'out')}
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md transition-colors ${stockFilter === 'out' ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 font-semibold' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}
            title="Kliko për të parë produktet pa stok"
          ><span className="w-2 h-2 bg-red-500 rounded-full" />{stockOut} pa stok</button>
          {stockFilter !== 'all' && (
            <button
              type="button"
              onClick={() => setStockFilter('all')}
              className="text-[10px] px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300"
            >✕ pastro filtrin</button>
          )}
        </div>
      )}

      {/* ── Empty states ── */}
      {filtered.length === 0 && newRows.length === 0 && (
        <div className="card text-center py-16">
          {products.length === 0 ? (
            <>
              <div className="text-6xl mb-4">💍</div>
              <h3 className="text-xl font-bold text-slate-700 dark:text-slate-200 mb-2">Nuk ka produkte akoma</h3>
              <p className="text-slate-400 dark:text-slate-500 mb-6 text-sm">Shtoni artikuj manualisht ose importoni nga Excel</p>
              <div className="flex gap-3 justify-center">
                <button onClick={() => setShowImport(true)} className="btn-secondary">📂 Import Excel</button>
                <button onClick={() => { setView('list'); addNewRow() }} className="btn-primary">+ Shto Manualisht</button>
              </div>
            </>
          ) : (
            <>
              <div className="text-4xl mb-3">🔍</div>
              <p className="text-slate-500 dark:text-slate-400 mb-4">Nuk u gjet asnjë produkt</p>
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
                      className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-sm">🏷️</button>
                    <button onClick={() => setModal(p)} title="Ndrysho"
                      className="w-7 h-7 flex items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 text-blue-600 text-sm">✏️</button>
                    <button onClick={() => setConfirmDel(p)} title="Fshi"
                      className="w-7 h-7 flex items-center justify-center rounded-lg bg-red-50 dark:bg-red-900/30 hover:bg-red-100 text-red-600 text-sm">🗑️</button>
                  </div>
                </div>

                {/* Product number */}
                <p className="text-xs font-mono text-slate-400 dark:text-slate-500 mb-0.5">{productNo(p.id)}</p>

                <h4 className="font-semibold text-slate-800 dark:text-slate-100 text-sm leading-snug mb-0.5 line-clamp-2">{p.name}</h4>
                {p.brand && <p className="text-xs text-slate-400 dark:text-slate-500 mb-2">{p.brand}</p>}
                <span className={`badge text-xs ${CAT_COLORS[p.category] || 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200'}`}>
                  {CAT_ICONS[p.category]} {p.category}
                </span>

                <div className="border-t border-slate-100 dark:border-slate-800 my-3" />

                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mb-0.5">Çmimi shitje</p>
                    <p className="text-xl font-extrabold text-slate-900 dark:text-white">
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
                    {p.sku && <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 font-mono">{p.sku}</p>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── LIST view ── */}
      {(filtered.length > 0 || newRows.length > 0) && view === 'list' && (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1780px]">
            <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Nr.</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase whitespace-nowrap" title="Data e faturës së fundit të blerjes për këtë produkt">Data Blerje</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase min-w-[160px]">Barkodi</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase min-w-[300px]">Pershkrimi</th>
                <th className="px-3 py-2 text-center text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase w-16" title="Kategoria">Kat.</th>
                <th className="px-3 py-2 text-center text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Sasi</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Gram</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" title="Kodi i floririt (585, 750, ...)">Kodi</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" title="Pesha e florit të pastër (gram HAS)">Cmim Blerje Has</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 min-w-[160px]" title="USD / gram HAS në kohën e blerjes">Kursi Blerje</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Cmim Kosto $</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" title="Shumëzuesi për çmim shitjeje">Shumëzues</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" title="Cmim Shitje Has = Cmim Blerje Has × Shumëzues">Cmim Shitje Has</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 min-w-[160px]" title="EUR / gram HAS për çmim shitjeje">Kursi Shitje</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Cmimi PA</th>
                <th className="px-3 py-2 text-center text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">TVSH %</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Cmim Shitje €</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" title="Fitim % = (Cmim Shitje − Cmim Kosto) / Cmim Kosto × 100">Fitim %</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" title="Marzh % = (Cmim Shitje − Cmim Kosto) / Cmim Shitje × 100">Marzh %</th>
                <th className="px-3 py-2 text-center text-xs font-semibold uppercase bg-rose-600 text-white w-24" title="Shënoje si produkt në promocion; jep % ulje">Promo · %</th>
                <th className="px-3 py-2 text-center text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Veprime</th>
              </tr>
            </thead>
            <tbody>
              {/* Rreshtat e rinj për shtim inline — si te Fatura Blerje */}
              {newRows.map((nr, idx) => (
                <NewProductRow key={`new-${nr.__key}`} rowData={nr}
                  onChange={patch => updateNewRow(idx, patch)}
                  onSave={() => saveNewRow(idx)}
                  onCancel={() => removeNewRow(idx)}
                />
              ))}
              {filtered.map(p => (
                <EditableProductRow key={p.id} p={p}
                  onSaved={load}
                  onEdit={() => setModal(p)}
                  onDelete={() => setConfirmDel(p)}
                  onBarcode={() => setBarcodeFor(p)}
                />
              ))}
            </tbody>
          </table>
          </div>
          <div className="p-3 border-t border-slate-100 dark:border-slate-800">
            <button onClick={addNewRow} className="btn-secondary text-xs">+ Shto Produkt</button>
          </div>
        </div>
      )}

      {/* ── Përmbledhëse e Produkteve ── */}
      {filtered.length > 0 && (
        <div className="card space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              📊 Përmbledhëse e Produkteve
              {isFiltered && (
                <span className="text-[10px] font-normal text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/30 px-2 py-0.5 rounded-full">
                  filtruar
                </span>
              )}
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Vlerat në € llogariten si <span className="font-mono">stock × çmim</span>
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
              <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-semibold">Produkte</p>
              <p className="text-lg font-bold text-slate-800 dark:text-slate-100 tabular-nums">{summary.count}</p>
              {(summary.lowStock > 0 || summary.outOfStock > 0) && (
                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                  {summary.lowStock > 0 && <span className="text-amber-600 dark:text-amber-400">{summary.lowStock} të ulët</span>}
                  {summary.lowStock > 0 && summary.outOfStock > 0 && <span> · </span>}
                  {summary.outOfStock > 0 && <span className="text-red-600 dark:text-red-400">{summary.outOfStock} pa stok</span>}
                </p>
              )}
            </div>
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
              <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-semibold">Sasia Totale</p>
              <p className="text-lg font-bold text-slate-800 dark:text-slate-100 tabular-nums">{fmtNum(summary.totalStock)}</p>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
              <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-semibold">Gramatura</p>
              <p className="text-lg font-bold text-slate-800 dark:text-slate-100 tabular-nums">{fmtNum(summary.totalGram)} <span className="text-xs font-normal text-slate-500">gr</span></p>
            </div>
            <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
              <p className="text-[10px] text-blue-700 dark:text-blue-300 uppercase font-semibold">Vlera në Kosto</p>
              <p className="text-lg font-bold text-blue-800 dark:text-blue-200 tabular-nums">{fmtUsd(summary.totalCostValue)}</p>
            </div>
            <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
              <p className="text-[10px] text-emerald-700 dark:text-emerald-300 uppercase font-semibold">Vlera në Shitje</p>
              <p className="text-lg font-bold text-emerald-800 dark:text-emerald-200 tabular-nums">{fmtEur(summary.totalSellValue)}</p>
            </div>
            <div className={`p-3 rounded-xl border ${summary.profit >= 0 ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800' : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'}`}>
              <p className={`text-[10px] uppercase font-semibold ${summary.profit >= 0 ? 'text-amber-700 dark:text-amber-300' : 'text-red-700 dark:text-red-300'}`}>Fitim Potencial</p>
              <p className={`text-lg font-bold tabular-nums ${summary.profit >= 0 ? 'text-amber-800 dark:text-amber-200' : 'text-red-800 dark:text-red-200'}`}>{fmtEur(summary.profit)}</p>
            </div>
          </div>

          {Object.keys(summary.byCategory).length > 1 && (
            <div>
              <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase mb-2">Sipas Kategorisë</p>
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">Kategoria</th>
                      <th className="px-3 py-2 text-right font-semibold">Produkte</th>
                      <th className="px-3 py-2 text-right font-semibold">Sasi</th>
                      <th className="px-3 py-2 text-right font-semibold">Gram</th>
                      <th className="px-3 py-2 text-right font-semibold">Kosto $</th>
                      <th className="px-3 py-2 text-right font-semibold">Shitje €</th>
                      <th className="px-3 py-2 text-right font-semibold">Fitim €</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(summary.byCategory)
                      .sort(([, a], [, b]) => b.sell - a.sell)
                      .map(([cat, v]) => {
                        const profit = v.sell - v.cost
                        return (
                          <tr key={cat} className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                            <td className="px-3 py-1.5">
                              <span className={`badge text-xs ${CAT_COLORS[cat] || 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200'}`}>
                                {CAT_ICONS[cat] || '📦'} {cat}
                              </span>
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-slate-700 dark:text-slate-200">{v.count}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-slate-700 dark:text-slate-200">{fmtNum(v.stock)}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-slate-600 dark:text-slate-300">{v.gram > 0 ? fmtNum(v.gram) : '—'}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-blue-700 dark:text-blue-300">{v.cost > 0 ? fmtUsd(v.cost) : '—'}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-emerald-700 dark:text-emerald-300 font-semibold">{v.sell > 0 ? fmtEur(v.sell) : '—'}</td>
                            <td className={`px-3 py-1.5 text-right tabular-nums font-semibold ${profit >= 0 ? 'text-amber-700 dark:text-amber-300' : 'text-red-600 dark:text-red-400'}`}>{profit !== 0 ? fmtEur(profit) : '—'}</td>
                          </tr>
                        )
                      })}
                  </tbody>
                  <tfoot className="bg-slate-50 dark:bg-slate-900 border-t-2 border-slate-200 dark:border-slate-700">
                    <tr className="font-bold text-xs">
                      <td className="px-3 py-2 text-slate-700 dark:text-slate-200 uppercase">Totali</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-800 dark:text-slate-100">{summary.count}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-800 dark:text-slate-100">{fmtNum(summary.totalStock)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-800 dark:text-slate-100">{fmtNum(summary.totalGram)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-blue-800 dark:text-blue-200">{fmtUsd(summary.totalCostValue)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-800 dark:text-emerald-200">{fmtEur(summary.totalSellValue)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${summary.profit >= 0 ? 'text-amber-800 dark:text-amber-200' : 'text-red-700 dark:text-red-300'}`}>{fmtEur(summary.profit)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Import Modal ── */}
      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onDone={() => { load() }}
        />
      )}

      {/* ── Export Modal ── */}
      {showExport && (
        <ExportFieldsModal
          count={products.length}
          onClose={() => setShowExport(false)}
          onExport={async (keys) => { await runExport(keys); setShowExport(false) }}
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
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-6 w-full max-w-sm">
            <div className="text-center">
              <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-4">🗑️</div>
              <p className="text-xs font-mono text-slate-400 dark:text-slate-500 mb-1">{productNo(confirmDel.id)}</p>
              <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg mb-1">Fshi Produktin?</h3>
              <p className="text-slate-500 dark:text-slate-400 text-sm mb-6">
                A jeni të sigurt që doni të fshini <strong className="text-slate-700 dark:text-slate-200">{confirmDel.name}</strong>?
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
