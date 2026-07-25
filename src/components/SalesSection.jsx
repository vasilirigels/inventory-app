import { useState, useEffect, useCallback, useRef } from 'react'
import { loadXLSX } from '../lib/xlsx.js'

function n(v) { return parseFloat(v) || 0 }
function fmt(v) {
  if (!v && v !== 0) return ''
  const val = parseFloat(v)
  if (val === 0) return ''
  return val.toLocaleString('sq-AL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

const EMPTY_ROW = {
  barcode: '', cope: '', gram: '',
  lek_cash: '', lek_pb: '', eur_cash: '', eur_pb: '',
  usd_cash: '', gbp_cash: '', chf_cash: '',
  skonto_percent: '', cm_etikete_usd: '', cm_etikete_eur: '',
  is_return: false, notes: '',
}

const TYPE_LABELS = {
  flori:   { title: 'Shitje Flori',       color: 'yellow' },
  diamant: { title: 'Shitje Diamant',     color: 'blue'   },
  online:  { title: 'Shitje Online/Staff', color: 'purple' },
}

// ── Inventory.xlsx column map (0-indexed) ──────────────────────────────────
const INV_COLS = {
  flori: {
    sales:   { start: 4,  end: 53, barcode: 16, cope: 17, gram: 18, lek_cash: 19, lek_pb: 20, eur_cash: 22, eur_pb: 23, usd_cash: 24, gbp_cash: 25, chf_cash: 26, skonto_percent: 27 },
    returns: { start: 59, end: 67, barcode: 16, cope: 17, gram: 18, lek_cash: 19, eur_cash: 20, usd_cash: 21, gbp_cash: 22, chf_cash: 23 },
  },
  diamant: {
    sales:   { start: 4,  end: 53, barcode: 28, cope: 29, gram: 30, lek_cash: 31, lek_pb: 32, eur_cash: 34, eur_pb: 35, usd_cash: 36, gbp_cash: 37, chf_cash: 38, skonto_percent: 39, cm_etikete_usd: 40, cm_etikete_eur: 41 },
    returns: { start: 59, end: 67, barcode: 28, cope: 29, gram: 30, lek_cash: 31, eur_cash: 32, usd_cash: 33, gbp_cash: 34, chf_cash: 35, cm_etikete_usd: 36, cm_etikete_eur: 37 },
  },
  online: {
    sales:   { start: 4,  end: 53, barcode: 42, cope: 43, gram: null, lek_cash: 44, lek_pb: 45, eur_cash: 47, eur_pb: 48, usd_cash: 49, gbp_cash: 50, chf_cash: 51, skonto_percent: 52, cm_etikete_eur: 53 },
    returns: { start: 59, end: 67, barcode: 42, cope: 43, gram: null, lek_cash: 44, eur_cash: 45, usd_cash: 46, gbp_cash: 47, chf_cash: 48, cm_etikete_eur: 50 },
  },
}

// Flat format auto-detection aliases
const FLAT_ALIASES = {
  barcode: ['barkodi', 'barcode', 'kod'],
  cope: ['copë', 'cope', 'qty', 'sasia'],
  gram: ['gram', 'gr', 'grami'],
  lek_cash: ['lek cash', 'lek_cash', 'cash lek'],
  lek_pb: ['lek pb', 'lek_pb', 'pb lek'],
  eur_cash: ['eur cash', 'eur_cash', 'euro cash', '€ cash'],
  eur_pb: ['eur pb', 'eur_pb', 'pb eur', '€ pb'],
  usd_cash: ['usd', 'dollar', 'dolar'],
  gbp_cash: ['gbp', 'pound', 'paund'],
  chf_cash: ['chf', 'franc', 'frank'],
  skonto_percent: ['skonto', 'sk%', 'skonto%'],
  cm_etikete_usd: ['cm etikete $', 'cm etik $', 'cm $'],
  cm_etikete_eur: ['cm etikete €', 'cm etik €', 'cm €'],
  is_return: ['kthim', 'return'],
  notes: ['shenime', 'notes'],
}

function detectFlatMapping(headers) {
  const mapping = {}
  headers.forEach((h, i) => {
    if (h == null || h === '') return
    const norm = String(h).toLowerCase().trim()
    for (const [field, aliases] of Object.entries(FLAT_ALIASES)) {
      if (mapping[field] != null) continue
      if (aliases.some(a => norm === a || norm.includes(a))) mapping[field] = i
    }
  })
  return mapping
}

// ── Module-level sub-components (defined OUTSIDE parent to avoid focus loss) ──

function InputCell({ field, obj, setObj, type: t = 'number', className = '' }) {
  return (
    <td className={`px-1 py-0.5 ${className}`}>
      <input
        type={t}
        step={t === 'number' ? 'any' : undefined}
        value={obj[field] ?? ''}
        onChange={e => setObj(prev => ({ ...prev, [field]: e.target.value }))}
        className="input-field-sm"
      />
    </td>
  )
}

function DisplayCell({ value }) {
  const v = n(value)
  if (v === 0) return <td className="px-2 py-1.5 text-right text-gray-300 text-xs">-</td>
  return <td className="px-2 py-1.5 text-right text-xs font-medium text-gray-800">{v.toLocaleString('sq-AL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</td>
}

function TableHeader({ showDiamondCols }) {
  return (
    <thead>
      <tr className="bg-gray-100 text-xs text-gray-600">
        <th className="px-2 py-1.5 text-left w-36">Barkodi</th>
        <th className="px-2 py-1.5 text-right w-14">Copë</th>
        <th className="px-2 py-1.5 text-right w-16">Gram</th>
        <th className="px-2 py-1.5 text-right w-20">LEK Cash</th>
        <th className="px-2 py-1.5 text-right w-20">LEK PB</th>
        <th className="px-2 py-1.5 text-right w-20">EUR Cash</th>
        <th className="px-2 py-1.5 text-right w-20">EUR PB</th>
        <th className="px-2 py-1.5 text-right w-20">USD</th>
        <th className="px-2 py-1.5 text-right w-20">GBP</th>
        <th className="px-2 py-1.5 text-right w-20">CHF</th>
        <th className="px-2 py-1.5 text-right w-16">Skonto%</th>
        {showDiamondCols && <th className="px-2 py-1.5 text-right w-20">Cm Etik $</th>}
        {showDiamondCols && <th className="px-2 py-1.5 text-right w-20">Cm Etik €</th>}
        <th className="px-2 py-1.5 w-16">Vep.</th>
      </tr>
    </thead>
  )
}

function SaleRow({ sale, editingId, editRow, setEditRow, saveEdit, cancelEdit, showDiamondCols, startEdit, deleteSale }) {
  const isEditing = editingId === sale.id
  if (isEditing) {
    return (
      <tr className="bg-blue-50 dark:bg-blue-900/30">
        <InputCell field="barcode" obj={editRow} setObj={setEditRow} type="text" />
        <InputCell field="cope" obj={editRow} setObj={setEditRow} />
        <InputCell field="gram" obj={editRow} setObj={setEditRow} />
        <InputCell field="lek_cash" obj={editRow} setObj={setEditRow} />
        <InputCell field="lek_pb" obj={editRow} setObj={setEditRow} />
        <InputCell field="eur_cash" obj={editRow} setObj={setEditRow} />
        <InputCell field="eur_pb" obj={editRow} setObj={setEditRow} />
        <InputCell field="usd_cash" obj={editRow} setObj={setEditRow} />
        <InputCell field="gbp_cash" obj={editRow} setObj={setEditRow} />
        <InputCell field="chf_cash" obj={editRow} setObj={setEditRow} />
        <InputCell field="skonto_percent" obj={editRow} setObj={setEditRow} />
        {showDiamondCols && <InputCell field="cm_etikete_usd" obj={editRow} setObj={setEditRow} />}
        {showDiamondCols && <InputCell field="cm_etikete_eur" obj={editRow} setObj={setEditRow} />}
        <td className="px-1 py-0.5">
          <div className="flex gap-1">
            <button onClick={saveEdit} className="text-green-600 hover:text-green-800 text-xs font-bold">✓</button>
            <button onClick={cancelEdit} className="text-gray-500 hover:text-gray-700 text-xs">✕</button>
          </div>
        </td>
      </tr>
    )
  }
  return (
    <tr className={`border-b hover:bg-gray-50 ${sale.is_return ? 'bg-red-50 dark:bg-red-900/30' : ''}`}>
      <td className="px-2 py-1.5 text-xs text-gray-600 max-w-[140px]">
        <div className="truncate">{sale.barcode || '-'}</div>
      </td>
      <td className="px-2 py-1.5 text-right text-xs">{sale.cope || '-'}</td>
      <td className="px-2 py-1.5 text-right text-xs">{sale.gram ? n(sale.gram).toFixed(2) : '-'}</td>
      <DisplayCell value={sale.lek_cash} />
      <DisplayCell value={sale.lek_pb} />
      <DisplayCell value={sale.eur_cash} />
      <DisplayCell value={sale.eur_pb} />
      <DisplayCell value={sale.usd_cash} />
      <DisplayCell value={sale.gbp_cash} />
      <DisplayCell value={sale.chf_cash} />
      <td className="px-2 py-1.5 text-right text-xs text-gray-500">
        {sale.skonto_percent ? `${sale.skonto_percent}%` : '-'}
      </td>
      {showDiamondCols && <DisplayCell value={sale.cm_etikete_usd} />}
      {showDiamondCols && <DisplayCell value={sale.cm_etikete_eur} />}
      <td className="px-2 py-1.5">
        <div className="flex gap-1">
          <button onClick={() => startEdit(sale)} className="text-blue-500 hover:text-blue-700 text-xs" title="Edito">✎</button>
          <button onClick={() => deleteSale(sale.id)} className="text-red-500 hover:text-red-700 text-xs" title="Fshij">✕</button>
        </div>
      </td>
    </tr>
  )
}

function isInvFormat(wb) {
  return wb.SheetNames.some(s => /^(0?[1-9]|[12]\d|3[01])$/.test(s.trim()))
}

function extractInvRows(rows, config, isReturn) {
  const { start, end, ...colMap } = config
  const result = []
  for (let r = start; r <= end; r++) {
    const row = rows[r] || []
    const barcodeVal = colMap.barcode != null ? String(row[colMap.barcode] || '').trim() : ''
    if (barcodeVal.toLowerCase() === 'total:') continue
    const hasNum = Object.entries(colMap).some(([, ci]) => ci != null && parseFloat(row[ci]) > 0)
    const hasBarcode = barcodeVal !== ''
    if (!hasNum && !hasBarcode) continue
    const mapped = { is_return: isReturn }
    for (const [field, ci] of Object.entries(colMap)) {
      if (ci == null) continue
      const v = row[ci]
      mapped[field] = (v === '' || v == null) ? '' : v
    }
    result.push(mapped)
  }
  return result
}

export default function SalesSection({ date, type, onSaleChange }) {
  const [sales, setSales]           = useState([])
  const [showAddForm, setShowAddForm] = useState(false)
  const [newRow, setNewRow]         = useState({ ...EMPTY_ROW })
  const [editingId, setEditingId]   = useState(null)
  const [editRow, setEditRow]       = useState({})
  const [showReturns, setShowReturns] = useState(false)
  const [savedMsg, setSavedMsg]     = useState('')

  // Barcode lookup state
  const [foundProduct, setFoundProduct] = useState(null)
  const [lookupState, setLookupState]   = useState('idle')
  const barcodeTimer = useRef(null)

  // ── Import state ──
  const [showImport, setShowImport]         = useState(false)
  const [importWb, setImportWb]             = useState(null)
  const [importIsInv, setImportIsInv]       = useState(false)
  const [importSheetName, setImportSheetName] = useState('')
  const [importFlatHeaders, setImportFlatHeaders] = useState([])
  const [importFlatMapping, setImportFlatMapping] = useState({})
  const [importPreview, setImportPreview]   = useState([])
  const [importAllRows, setImportAllRows]   = useState([])
  const [importDoing, setImportDoing]       = useState(false)
  const [importDone, setImportDone]         = useState(null)

  const { title } = TYPE_LABELS[type] || {}

  const loadSales = useCallback(async () => {
    try {
      const res = await fetch(`/api/sales/${date}?type=${type}`)
      setSales(await res.json())
    } catch (e) { console.error(e) }
  }, [date, type])

  useEffect(() => { loadSales() }, [loadSales])

  useEffect(() => {
    if (!showAddForm) { setFoundProduct(null); setLookupState('idle') }
  }, [showAddForm])

  // Cleanup barcode lookup timer on unmount
  useEffect(() => {
    return () => clearTimeout(barcodeTimer.current)
  }, [])

  const lookupBarcode = async (barcode) => {
    const q = (barcode || '').trim()
    if (!q) { setFoundProduct(null); setLookupState('idle'); return }
    setLookupState('loading')
    try {
      const res = await fetch(`/api/products/lookup?q=${encodeURIComponent(q)}`)
      const data = await res.json()
      setFoundProduct(data)
      setLookupState(data ? 'found' : 'notfound')
    } catch { setFoundProduct(null); setLookupState('idle') }
  }

  const handleBarcodeChange = (value) => {
    setNewRow(p => ({ ...p, barcode: value }))
    clearTimeout(barcodeTimer.current)
    if (value.trim()) {
      barcodeTimer.current = setTimeout(() => lookupBarcode(value), 400)
    } else {
      setFoundProduct(null); setLookupState('idle')
    }
  }

  const handleBarcodeKeyDown = (e) => {
    if (e.key === 'Enter') { clearTimeout(barcodeTimer.current); lookupBarcode(newRow.barcode) }
  }

  const updateStock = async (product, cope, isReturn) => {
    if (!product) return
    const delta = isReturn ? (parseInt(cope) || 1) : -(parseInt(cope) || 1)
    try {
      await fetch(`/api/products/${product.id}/stock`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delta }),
      })
    } catch (e) { console.error('Stock update failed:', e) }
  }

  const addSale = async (isReturn = false) => {
    const row = { ...newRow, date, type, is_return: isReturn }
    try {
      const res = await fetch('/api/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(row),
      })
      if (!res.ok) {
        setSavedMsg('⚠ Gabim ne ruajtje')
        setTimeout(() => setSavedMsg(''), 2500)
        return
      }
      // Only deduct stock when sale was successfully saved
      await updateStock(foundProduct, newRow.cope, isReturn)
      setNewRow({ ...EMPTY_ROW }); setFoundProduct(null); setLookupState('idle')
      setShowAddForm(false)
      await loadSales(); onSaleChange?.()
      setSavedMsg('Shtuar ✓'); setTimeout(() => setSavedMsg(''), 1500)
    } catch (e) {
      console.error(e)
      setSavedMsg('⚠ Gabim ne rrjet')
      setTimeout(() => setSavedMsg(''), 2500)
    }
  }

  const deleteSale = async (id) => {
    if (!confirm('Fshij këtë rresht?')) return
    await fetch(`/api/sales/${id}`, { method: 'DELETE' })
    await loadSales(); onSaleChange?.()
  }

  const startEdit = (sale) => { setEditingId(sale.id); setEditRow({ ...sale }) }
  const cancelEdit = () => setEditingId(null)
  const saveEdit = async () => {
    await fetch(`/api/sales/${editingId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editRow),
    })
    setEditingId(null); await loadSales(); onSaleChange?.()
  }

  // ── Import functions ──────────────────────────────────────────────────────

  const closeImport = () => {
    setShowImport(false); setImportWb(null); setImportIsInv(false)
    setImportSheetName(''); setImportFlatHeaders([]); setImportFlatMapping({})
    setImportPreview([]); setImportAllRows([]); setImportDoing(false); setImportDone(null)
  }

  const processInvSheet = async (wb, sheetName) => {
    const ws = wb.Sheets[sheetName]
    if (!ws) return
    const XLSX = await loadXLSX()
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
    const config = INV_COLS[type]
    if (!config) return
    const salesRows = extractInvRows(rows, config.sales, false)
    const returnRows = extractInvRows(rows, config.returns, true)
    const all = [...salesRows, ...returnRows]
    setImportAllRows(all); setImportPreview(all.slice(0, 10))
  }

  const processFlatSheet = async (wb, sheetName) => {
    const ws = wb.Sheets[sheetName]
    const XLSX = await loadXLSX()
    const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
    let headerIdx = 0
    for (let i = 0; i < Math.min(rawRows.length, 5); i++) {
      if (rawRows[i].some(c => typeof c === 'string' && c.trim() !== '' && isNaN(c))) {
        headerIdx = i; break
      }
    }
    const headers = rawRows[headerIdx] || []
    const mapping = detectFlatMapping(headers)
    setImportFlatHeaders(headers); setImportFlatMapping(mapping)
    const dataRows = rawRows.slice(headerIdx + 1).filter(r => r.some(c => c !== '' && c !== null))
    const all = dataRows.map(row => {
      const mapped = { is_return: false }
      for (const [field, ci] of Object.entries(mapping)) {
        if (ci == null) continue
        const v = row[ci]
        mapped[field] = (v === '' || v == null) ? '' : v
      }
      if (mapped.is_return) mapped.is_return = parseFloat(mapped.is_return) > 0
      return mapped
    }).filter(r => Object.entries(r).some(([k, v]) => k !== 'is_return' && v !== ''))
    setImportAllRows(all); setImportPreview(all.slice(0, 10))
  }

  const handleImportFile = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async (ev) => {
      const XLSX = await loadXLSX()
      const wb = XLSX.read(ev.target.result, { type: 'array' })
      const isInv = isInvFormat(wb)
      setImportWb(wb); setImportIsInv(isInv)
      if (isInv) {
        const dayNum = parseInt(date.split('-')[2], 10)
        const match = wb.SheetNames.find(s => parseInt(s.trim(), 10) === dayNum) || wb.SheetNames[0]
        setImportSheetName(match)
        processInvSheet(wb, match)
      } else {
        processFlatSheet(wb, wb.SheetNames[0])
      }
    }
    reader.readAsArrayBuffer(file)
  }

  const handleInvSheetChange = (sheetName) => {
    setImportSheetName(sheetName)
    if (importWb) processInvSheet(importWb, sheetName)
  }

  const downloadTemplate = async () => {
    const XLSX = await loadXLSX()
    const wb = XLSX.utils.book_new()
    let headers
    if (type === 'online') {
      headers = ['Barkodi', 'Copë', 'LEK Cash', 'LEK PB', 'EUR Cash', 'EUR PB', 'USD', 'GBP', 'CHF', 'Skonto%', 'Cm Etik €', 'Kthim (0/1)', 'Shenime']
    } else if (type === 'diamant') {
      headers = ['Barkodi', 'Copë', 'Gram', 'LEK Cash', 'LEK PB', 'EUR Cash', 'EUR PB', 'USD', 'GBP', 'CHF', 'Skonto%', 'Cm Etik $', 'Cm Etik €', 'Kthim (0/1)', 'Shenime']
    } else {
      headers = ['Barkodi', 'Copë', 'Gram', 'LEK Cash', 'LEK PB', 'EUR Cash', 'EUR PB', 'USD', 'GBP', 'CHF', 'Skonto%', 'Kthim (0/1)', 'Shenime']
    }
    const ws = XLSX.utils.aoa_to_sheet([headers, []])
    ws['!cols'] = headers.map((_, i) => ({ wch: i === 0 ? 14 : 10 }))
    XLSX.utils.book_append_sheet(wb, ws, 'Shitjet')
    XLSX.writeFile(wb, `template_${type}_${date}.xlsx`)
  }

  const doImport = async () => {
    if (importAllRows.length === 0 || importDoing) return
    setImportDoing(true)
    let ok = 0, skip = 0
    for (const row of importAllRows) {
      const payload = { ...row, date, type }
      if (!payload.barcode && !n(payload.cope) && !n(payload.gram) &&
          !n(payload.lek_cash) && !n(payload.eur_cash) && !n(payload.usd_cash)) {
        skip++; continue
      }
      try {
        const res = await fetch('/api/sales', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (res.ok) ok++; else skip++
      } catch { skip++ }
    }
    setImportDone({ ok, skip }); setImportDoing(false)
    await loadSales(); onSaleChange?.()
  }

  // ── Table helpers ─────────────────────────────────────────────────────────

  const normalSales = sales.filter(s => !s.is_return)
  const returnSales = sales.filter(s => s.is_return)
  const sum = (arr, field) => arr.reduce((s, r) => s + n(r[field]), 0)
  const totals = {
    cope: sum(normalSales, 'cope'), gram: sum(normalSales, 'gram'),
    lek_cash: sum(normalSales, 'lek_cash'), lek_pb: sum(normalSales, 'lek_pb'),
    eur_cash: sum(normalSales, 'eur_cash'), eur_pb: sum(normalSales, 'eur_pb'),
    usd_cash: sum(normalSales, 'usd_cash'), gbp_cash: sum(normalSales, 'gbp_cash'),
    chf_cash: sum(normalSales, 'chf_cash'),
  }
  const showDiamondCols = type === 'diamant' || type === 'online'

  // Helper to render SaleRow with all needed props
  const renderSaleRow = (sale) => (
    <SaleRow
      key={sale.id}
      sale={sale}
      editingId={editingId}
      editRow={editRow}
      setEditRow={setEditRow}
      saveEdit={saveEdit}
      cancelEdit={cancelEdit}
      showDiamondCols={showDiamondCols}
      startEdit={startEdit}
      deleteSale={deleteSale}
    />
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-gray-800">{title}</h2>
        <div className="flex items-center gap-2">
          {savedMsg && <span className="text-green-600 text-sm font-medium">{savedMsg}</span>}
          <button
            onClick={() => setShowImport(true)}
            className="btn-secondary flex items-center gap-1.5"
          >
            📂 <span>Import Excel</span>
          </button>
          <button onClick={() => { setShowAddForm(!showAddForm); setNewRow({ ...EMPTY_ROW }) }} className="btn-primary">
            + Shto Shitje
          </button>
          <button onClick={() => { setShowAddForm(true); setNewRow({ ...EMPTY_ROW, is_return: true }) }} className="btn-secondary">
            + Kthim
          </button>
        </div>
      </div>

      {/* ── Add Form ── */}
      {showAddForm && (
        <div className={`card mb-4 border-2 ${newRow.is_return ? 'bg-red-50 dark:bg-red-900/30 border-red-200' : 'bg-blue-50 dark:bg-blue-900/30 border-blue-200'}`}>
          <div className="section-title text-blue-700 dark:text-blue-300 mb-3">
            {newRow.is_return ? '↩ Shto Kthim' : '+ Shto Shitje të Re'}
          </div>
          <div className="flex items-center gap-2 mb-3 text-xs text-slate-500 dark:text-slate-400">
            <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse flex-shrink-0"></span>
            Skanues i gatshëm — vendosni barkodin ose skanoni
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <TableHeader showDiamondCols={showDiamondCols} />
              <tbody>
                <tr>
                  <td className="px-1 py-0.5 min-w-[140px]">
                    <input
                      type="text"
                      value={newRow.barcode}
                      onChange={e => handleBarcodeChange(e.target.value)}
                      onKeyDown={handleBarcodeKeyDown}
                      className="input-field-sm"
                      placeholder="Barcode..."
                      autoFocus
                    />
                    {lookupState === 'loading' && <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">🔍 Duke kërkuar...</div>}
                    {lookupState === 'found' && foundProduct && (
                      <div className="text-xs text-emerald-700 dark:text-emerald-300 mt-0.5 font-medium truncate" title={foundProduct.name}>
                        ✓ {foundProduct.name}{foundProduct.sell_price ? ` · €${foundProduct.sell_price}` : ''}
                      </div>
                    )}
                    {lookupState === 'notfound' && <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Produkt i pagjetur</div>}
                  </td>
                  <InputCell field="cope" obj={newRow} setObj={setNewRow} />
                  <InputCell field="gram" obj={newRow} setObj={setNewRow} />
                  <InputCell field="lek_cash" obj={newRow} setObj={setNewRow} />
                  <InputCell field="lek_pb" obj={newRow} setObj={setNewRow} />
                  <InputCell field="eur_cash" obj={newRow} setObj={setNewRow} />
                  <InputCell field="eur_pb" obj={newRow} setObj={setNewRow} />
                  <InputCell field="usd_cash" obj={newRow} setObj={setNewRow} />
                  <InputCell field="gbp_cash" obj={newRow} setObj={setNewRow} />
                  <InputCell field="chf_cash" obj={newRow} setObj={setNewRow} />
                  <InputCell field="skonto_percent" obj={newRow} setObj={setNewRow} />
                  {showDiamondCols && <InputCell field="cm_etikete_usd" obj={newRow} setObj={setNewRow} />}
                  {showDiamondCols && <InputCell field="cm_etikete_eur" obj={newRow} setObj={setNewRow} />}
                  <td className="px-1 py-0.5">
                    <div className="flex gap-1">
                      <button onClick={() => addSale(newRow.is_return)}
                        className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-2 py-1 rounded-lg">
                        Ruaj
                      </button>
                      <button onClick={() => setShowAddForm(false)} className="text-gray-500 text-xs">✕</button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          {foundProduct && (
            <div className="mt-3 flex items-center gap-3 p-2.5 bg-emerald-50 dark:bg-emerald-900/30 rounded-xl border border-emerald-200 text-xs">
              <span className="text-2xl">
                {{'Unazë':'💍','Vathë':'✨','Byzylyk':'📿','Diamant':'💎','Ora':'⌚'}[foundProduct.category] || '📦'}
              </span>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-emerald-800 dark:text-emerald-200 truncate">{foundProduct.name}</p>
                <p className="text-emerald-600">{foundProduct.category}{foundProduct.brand ? ` · ${foundProduct.brand}` : ''}</p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="font-bold text-emerald-800 dark:text-emerald-200">€{foundProduct.sell_price}</p>
                <p className="text-emerald-600">Stok: {foundProduct.stock}</p>
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800 px-2 py-1 rounded-lg border">
                {newRow.is_return ? '+' : '−'}{parseInt(newRow.cope) || 1} cope pas ruajtjes
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Sales Table ── */}
      <div className="card">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <TableHeader showDiamondCols={showDiamondCols} />
            <tbody>
              {normalSales.length === 0 ? (
                <tr>
                  <td colSpan={showDiamondCols ? 14 : 12} className="text-center text-gray-400 py-6 italic">
                    Nuk ka shitje për këtë ditë
                  </td>
                </tr>
              ) : (
                normalSales.map(s => renderSaleRow(s))
              )}
            </tbody>
            {normalSales.length > 0 && (
              <tfoot>
                <tr className="bg-blue-50 dark:bg-blue-900/30 font-semibold text-xs border-t-2 border-blue-200">
                  <td className="px-2 py-1.5 text-gray-600">TOTAL</td>
                  <td className="px-2 py-1.5 text-right">{totals.cope || '-'}</td>
                  <td className="px-2 py-1.5 text-right">{totals.gram ? totals.gram.toFixed(2) : '-'}</td>
                  <td className="px-2 py-1.5 text-right text-blue-700 dark:text-blue-300">{fmt(totals.lek_cash)}</td>
                  <td className="px-2 py-1.5 text-right text-blue-700 dark:text-blue-300">{fmt(totals.lek_pb)}</td>
                  <td className="px-2 py-1.5 text-right text-blue-700 dark:text-blue-300">{fmt(totals.eur_cash)}</td>
                  <td className="px-2 py-1.5 text-right text-blue-700 dark:text-blue-300">{fmt(totals.eur_pb)}</td>
                  <td className="px-2 py-1.5 text-right text-blue-700 dark:text-blue-300">{fmt(totals.usd_cash)}</td>
                  <td className="px-2 py-1.5 text-right text-blue-700 dark:text-blue-300">{fmt(totals.gbp_cash)}</td>
                  <td className="px-2 py-1.5 text-right text-blue-700 dark:text-blue-300">{fmt(totals.chf_cash)}</td>
                  <td></td>
                  {showDiamondCols && <td></td>}
                  {showDiamondCols && <td></td>}
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* ── Returns ── */}
      <div className="mt-4">
        <button onClick={() => setShowReturns(!showReturns)}
          className="text-sm text-red-600 hover:text-red-800 font-medium flex items-center gap-1">
          <span>{showReturns ? '▼' : '▶'}</span>
          Kthime ({returnSales.length})
        </button>
        {showReturns && returnSales.length > 0 && (
          <div className="card mt-2 border-red-200">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <TableHeader showDiamondCols={showDiamondCols} />
                <tbody>{returnSales.map(s => renderSaleRow(s))}</tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── Summary Bar ── */}
      {normalSales.length > 0 && (
        <div className="mt-4 p-3 bg-slate-900 dark:bg-slate-950 text-white rounded-xl">
          <div className="text-xs text-blue-400 mb-2 font-semibold uppercase tracking-wide">Permbledhje Shitjet</div>
          <div className="grid grid-cols-5 gap-3">
            {[['LEK', totals.lek_cash + totals.lek_pb],['EUR', totals.eur_cash + totals.eur_pb],['USD', totals.usd_cash],['GBP', totals.gbp_cash],['CHF', totals.chf_cash]].map(([cur, val]) => (
              <div key={cur} className="text-center">
                <div className="text-xs text-gray-400">{cur}</div>
                <div className="text-sm font-bold text-blue-300">
                  {val ? val.toLocaleString('sq-AL', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : '-'}
                </div>
              </div>
            ))}
          </div>
          <div className="text-xs text-gray-500 mt-2">
            {normalSales.length} shitje · {totals.cope} copë · {totals.gram ? totals.gram.toFixed(2) : '0'} gram
          </div>
        </div>
      )}

      {/* ── Import Modal ── */}
      {showImport && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
              <div>
                <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">📂 Import Excel — {title}</h3>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Data: {date}</p>
              </div>
              <button onClick={closeImport} className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 text-xl leading-none">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {!importDone ? (
                <>
                  {/* File input row */}
                  <div className="flex gap-3">
                    <label className="flex-1 cursor-pointer">
                      <div className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl p-4 text-center hover:border-blue-400 hover:bg-blue-50 transition-colors">
                        <div className="text-2xl mb-1">📁</div>
                        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Zgjidh file Excel (.xlsx)</p>
                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                          {importWb ? `✓ File u ngjark (${importAllRows.length} rreshta)` : 'Inventory.xlsx ose template'}
                        </p>
                      </div>
                      <input type="file" accept=".xlsx,.xls" onChange={handleImportFile} className="sr-only" />
                    </label>
                    <button
                      onClick={downloadTemplate}
                      className="btn-secondary flex-shrink-0 self-center"
                      title="Shkarko template bosh"
                    >
                      ⬇ Template
                    </button>
                  </div>

                  {/* Inventory.xlsx format detected */}
                  {importWb && importIsInv && (
                    <div className="bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 rounded-xl p-4">
                      <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300 mb-3">✓ Formati Inventar Excel u detektua</p>
                      <div className="flex items-center gap-3 flex-wrap">
                        <div className="flex items-center gap-2">
                          <label className="text-sm text-slate-600 dark:text-slate-300 font-medium">Dita (sheet):</label>
                          <select
                            value={importSheetName}
                            onChange={e => handleInvSheetChange(e.target.value)}
                            className="input-field text-sm w-20"
                          >
                            {importWb.SheetNames
                              .filter(s => /^(0?[1-9]|[12]\d|3[01])$/.test(s.trim()))
                              .map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                        <span className="text-xs text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800 px-2 py-1 rounded-lg border">
                          Seksioni: <strong>{title}</strong>
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Flat format mapping info */}
                  {importWb && !importIsInv && Object.keys(importFlatMapping).length > 0 && (
                    <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 rounded-xl p-4">
                      <p className="text-sm font-medium text-blue-700 dark:text-blue-300 mb-2">Kolonat e detektuara automatikisht:</p>
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(importFlatMapping).map(([field, ci]) => (
                          <span key={field} className="text-xs bg-white dark:bg-slate-800 px-2 py-1 rounded-lg border border-blue-200 text-slate-600 dark:text-slate-300">
                            <span className="text-slate-400 dark:text-slate-500">{field}</span> → <span className="font-medium text-blue-700 dark:text-blue-300">{importFlatHeaders[ci]}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Preview table */}
                  {importPreview.length > 0 && (
                    <div>
                      <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">
                        Parapamje — {importAllRows.length} rreshta ({importAllRows.filter(r => r.is_return).length} kthime)
                      </p>
                      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                        <table className="w-full text-xs">
                          <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
                            <tr>
                              <th className="px-3 py-2 text-left font-medium text-slate-500 dark:text-slate-400">Barkodi</th>
                              <th className="px-2 py-2 text-right font-medium text-slate-500 dark:text-slate-400">Copë</th>
                              <th className="px-2 py-2 text-right font-medium text-slate-500 dark:text-slate-400">Gram</th>
                              <th className="px-2 py-2 text-right font-medium text-slate-500 dark:text-slate-400">LEK</th>
                              <th className="px-2 py-2 text-right font-medium text-slate-500 dark:text-slate-400">EUR</th>
                              <th className="px-2 py-2 text-right font-medium text-slate-500 dark:text-slate-400">USD</th>
                              <th className="px-2 py-2 text-center font-medium text-slate-500 dark:text-slate-400">Lloji</th>
                            </tr>
                          </thead>
                          <tbody>
                            {importPreview.map((row, i) => (
                              <tr key={i} className={`border-t border-slate-100 dark:border-slate-800 ${row.is_return ? 'bg-red-50 dark:bg-red-900/30' : ''}`}>
                                <td className="px-3 py-1.5 text-slate-600 dark:text-slate-300 font-mono">{row.barcode || '—'}</td>
                                <td className="px-2 py-1.5 text-right">{row.cope || '—'}</td>
                                <td className="px-2 py-1.5 text-right">{row.gram ? parseFloat(row.gram).toFixed(2) : '—'}</td>
                                <td className="px-2 py-1.5 text-right">
                                  {(n(row.lek_cash) + n(row.lek_pb)) > 0
                                    ? (n(row.lek_cash) + n(row.lek_pb)).toLocaleString('sq-AL') : '—'}
                                </td>
                                <td className="px-2 py-1.5 text-right text-blue-700 dark:text-blue-300">
                                  {(n(row.eur_cash) + n(row.eur_pb)) > 0
                                    ? `€${(n(row.eur_cash) + n(row.eur_pb)).toFixed(2)}` : '—'}
                                </td>
                                <td className="px-2 py-1.5 text-right">
                                  {n(row.usd_cash) > 0 ? `$${row.usd_cash}` : '—'}
                                </td>
                                <td className="px-2 py-1.5 text-center">
                                  {row.is_return
                                    ? <span className="badge badge-red text-xs">Kthim</span>
                                    : <span className="text-xs bg-green-100 text-green-700 dark:text-green-300 px-1.5 py-0.5 rounded-full">Shitje</span>}
                                </td>
                              </tr>
                            ))}
                            {importAllRows.length > 10 && (
                              <tr className="border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900">
                                <td colSpan={7} className="px-3 py-2 text-center text-xs text-slate-400 dark:text-slate-500">
                                  + {importAllRows.length - 10} rreshta të tjerë
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {importWb && importAllRows.length === 0 && (
                    <div className="text-center py-8 text-slate-400 dark:text-slate-500">
                      <div className="text-3xl mb-2">📭</div>
                      <p className="text-sm">Nuk u gjetën të dhëna në këtë sheet</p>
                      <p className="text-xs mt-1">Provoni sheet tjetër ose shkarkoni template</p>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-10">
                  <div className="text-5xl mb-4">✅</div>
                  <p className="text-2xl font-bold text-slate-800 dark:text-slate-100">{importDone.ok} rreshta u importuan</p>
                  {importDone.skip > 0 && (
                    <p className="text-sm text-slate-400 dark:text-slate-500 mt-2">{importDone.skip} u kaluan (bosh ose gabim)</p>
                  )}
                </div>
              )}
            </div>

            {/* Modal footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-700">
              <button onClick={closeImport} className="btn-secondary">
                {importDone ? 'Mbyll' : 'Anulo'}
              </button>
              {!importDone && importAllRows.length > 0 && (
                <button
                  onClick={doImport}
                  disabled={importDoing}
                  className="btn-primary"
                >
                  {importDoing
                    ? '⏳ Duke importuar...'
                    : `✓ Importo ${importAllRows.length} rreshta`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
