import { useState, useEffect, useCallback } from 'react'
import * as XLSX from 'xlsx'

function n(v) { return parseFloat(v) || 0 }
function fmt(v) {
  if (!v && v !== 0) return '-'
  const val = parseFloat(v)
  if (val === 0) return '-'
  return val.toLocaleString('sq-AL', { minimumFractionDigits: 0, maximumFractionDigits: 3 })
}

const EMPTY_INVENTORY = {
  gram_start: '', cope_start: '', cost_price: '', sell_price: '',
  gram_in: '', cope_in: '', gram_out: '', cope_out: '',
  gram_sold: '', cope_sold: '', gram_end: '', cope_end: '',
  gram_real: '', cope_real: '',
}

// ── Module-level sub-components (defined OUTSIDE InventoryType to avoid focus loss) ──

function InvRow({ label, gramKey, copeKey, showGram = true, showCope = true, form, handleChange }) {
  return (
    <tr className="border-b border-gray-100">
      <td className="px-3 py-2 text-sm text-gray-700 font-medium">{label}</td>
      <td className="px-2 py-1">
        {showGram ? (
          <input type="number" step="any" placeholder="0"
            value={form[gramKey] ?? ''}
            onChange={e => handleChange(gramKey, e.target.value)}
            className="input-field w-28" />
        ) : <span className="text-gray-300">-</span>}
      </td>
      <td className="px-2 py-1">
        {showCope ? (
          <input type="number" step="any" placeholder="0"
            value={form[copeKey] ?? ''}
            onChange={e => handleChange(copeKey, e.target.value)}
            className="input-field w-24" />
        ) : <span className="text-gray-300">-</span>}
      </td>
    </tr>
  )
}

function CalcRow({ label, gramVal, copeVal, highlight }) {
  return (
    <tr className={`border-b ${highlight ? 'bg-yellow-50 font-semibold' : 'bg-gray-50'}`}>
      <td className="px-3 py-2 text-sm text-gray-700 font-medium">{label}</td>
      <td className="px-3 py-2 text-sm text-right font-mono">{fmt(gramVal)}</td>
      <td className="px-3 py-2 text-sm text-right font-mono">{fmt(copeVal)}</td>
    </tr>
  )
}

// Inventory.xlsx: row indices (0-based) for each metric, cols 9=gram, 10=cope
const INV_ROWS = {
  diamant: { gram_start: 75, cope_start: 75, cost_price: 75, sell_price: 75, gram_in: 76, cope_in: 76, gram_out: 77, cope_out: 77, gram_sold: 78, cope_sold: 78, gram_real: 80, cope_real: 80 },
  flori:   { gram_start: 84, cope_start: 84, gram_in: 85, cope_in: 85, gram_out: 86, cope_out: 86, gram_sold: 87, cope_sold: 87, gram_real: 89, cope_real: 89 },
}
const GRAM_COL = 9, COPE_COL = 10, COST_COL = 11, SELL_COL = 12

function InventoryType({ date, type, label, color }) {
  const [form, setForm] = useState({ ...EMPTY_INVENTORY })
  const [savedMsg, setSavedMsg] = useState('')
  const [isDirty, setIsDirty] = useState(false)

  // Import state
  const [showImport, setShowImport]     = useState(false)
  const [importPreview, setImportPreview] = useState({})
  const [importDoing, setImportDoing]   = useState(false)
  const [importDone, setImportDone]     = useState(false)

  const loadData = useCallback(async () => {
    try {
      const res = await fetch(`/api/inventory/${date}`)
      const rows = await res.json()
      const row = rows.find(r => r.type === type)
      if (row) {
        const newForm = { ...EMPTY_INVENTORY }
        Object.keys(EMPTY_INVENTORY).forEach(k => {
          if (row[k] !== undefined && row[k] !== null) {
            newForm[k] = row[k] === 0 ? '' : String(row[k])
          }
        })
        setForm(newForm)
      } else {
        setForm({ ...EMPTY_INVENTORY })
      }
      setIsDirty(false)
    } catch (e) { console.error(e) }
  }, [date, type])

  useEffect(() => { loadData() }, [loadData])

  const handleChange = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }))
    setIsDirty(true)
  }

  const handleSave = async () => {
    try {
      const payload = { date, type }
      Object.keys(form).forEach(k => { payload[k] = n(form[k]) })

      // Auto-calculate end if not set
      if (!form.gram_end) {
        payload.gram_end = n(form.gram_start) + n(form.gram_in) - n(form.gram_out) - n(form.gram_sold)
      }
      if (!form.cope_end) {
        payload.cope_end = n(form.cope_start) + n(form.cope_in) - n(form.cope_out) - n(form.cope_sold)
      }

      await fetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      setIsDirty(false)
      setSavedMsg('Ruajtur ✓')
      setTimeout(() => setSavedMsg(''), 2000)
    } catch (e) { console.error(e) }
  }

  // ── Import functions ──────────────────────────────────────────────────────

  const downloadTemplate = () => {
    const wb = XLSX.utils.book_new()
    const headers = ['Lloji', 'Gram Fillim', 'Cope Fillim', 'Cmim Kosto', 'Cmim Shitje',
      'Gram Hyrje', 'Cope Hyrje', 'Gram Dalje', 'Cope Dalje',
      'Gram Shitje', 'Cope Shitje', 'Gram Reale', 'Cope Reale']
    const sample = [type, '', '', '', '', '', '', '', '', '', '', '', '']
    const ws = XLSX.utils.aoa_to_sheet([headers, sample])
    ws['!cols'] = headers.map((_, i) => ({ wch: i === 0 ? 10 : 12 }))
    XLSX.utils.book_append_sheet(wb, ws, 'Inventar')
    XLSX.writeFile(wb, `template_inventar_${type}_${date}.xlsx`)
  }

  const isInvFormat = (wb) => wb.SheetNames.some(s => /^(0?[1-9]|[12]\d|3[01])$/.test(s.trim()))

  const handleImportFile = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const wb = XLSX.read(ev.target.result, { type: 'array' })
      const preview = {}
      if (isInvFormat(wb)) {
        // Inventory.xlsx format
        const dayNum = parseInt(date.split('-')[2], 10)
        const sheetName = wb.SheetNames.find(s => parseInt(s.trim(), 10) === dayNum) || wb.SheetNames[0]
        const ws = wb.Sheets[sheetName]
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
        const rowMap = INV_ROWS[type]
        if (rowMap) {
          const get = (rowIdx, col) => { const v = (rows[rowIdx] || [])[col]; return (v === '' || v == null) ? '' : v }
          preview.gram_start = get(rowMap.gram_start, GRAM_COL)
          preview.cope_start = get(rowMap.cope_start, COPE_COL)
          if (type === 'diamant') {
            preview.cost_price = get(rowMap.cost_price, COST_COL)
            preview.sell_price = get(rowMap.sell_price, SELL_COL)
          }
          preview.gram_in  = get(rowMap.gram_in, GRAM_COL)
          preview.cope_in  = get(rowMap.cope_in, COPE_COL)
          preview.gram_out = get(rowMap.gram_out, GRAM_COL)
          preview.cope_out = get(rowMap.cope_out, COPE_COL)
          preview.gram_sold = get(rowMap.gram_sold, GRAM_COL)
          preview.cope_sold = get(rowMap.cope_sold, COPE_COL)
          preview.gram_real = get(rowMap.gram_real, GRAM_COL)
          preview.cope_real = get(rowMap.cope_real, COPE_COL)
          // Remove empty entries
          Object.keys(preview).forEach(k => { if (preview[k] === '') delete preview[k] })
        }
      } else {
        // Flat format
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
        if (rows.length >= 2) {
          const headers = rows[0]
          // Find row matching this type
          const dataRow = rows.slice(1).find(r => String(r[0]).toLowerCase() === type) || rows[1]
          const fieldMap = {
            'gram fillim': 'gram_start', 'cope fillim': 'cope_start',
            'cmim kosto': 'cost_price', 'cmim shitje': 'sell_price',
            'gram hyrje': 'gram_in', 'cope hyrje': 'cope_in',
            'gram dalje': 'gram_out', 'cope dalje': 'cope_out',
            'gram shitje': 'gram_sold', 'cope shitje': 'cope_sold',
            'gram reale': 'gram_real', 'cope reale': 'cope_real',
          }
          headers.forEach((h, i) => {
            const norm = String(h).toLowerCase().trim()
            if (fieldMap[norm]) preview[fieldMap[norm]] = dataRow[i]
          })
          Object.keys(preview).forEach(k => { if (preview[k] === '' || preview[k] == null) delete preview[k] })
        }
      }
      setImportPreview(preview)
    }
    reader.readAsArrayBuffer(file)
  }

  const doImport = async () => {
    if (Object.keys(importPreview).length === 0) return
    setImportDoing(true)
    const newForm = { ...form }
    Object.entries(importPreview).forEach(([k, v]) => {
      if (k in newForm) newForm[k] = String(v)
    })
    setForm(newForm)
    setIsDirty(true)
    // Auto-save
    const payload = { date, type }
    Object.keys(newForm).forEach(k => { payload[k] = n(newForm[k]) })
    if (!newForm.gram_end) payload.gram_end = n(newForm.gram_start) + n(newForm.gram_in) - n(newForm.gram_out) - n(newForm.gram_sold)
    if (!newForm.cope_end) payload.cope_end = n(newForm.cope_start) + n(newForm.cope_in) - n(newForm.cope_out) - n(newForm.cope_sold)
    await fetch('/api/inventory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setIsDirty(false)
    setImportDoing(false)
    setImportDone(true)
  }

  const closeImport = () => {
    setShowImport(false); setImportPreview({}); setImportDoing(false); setImportDone(false)
  }

  // ─────────────────────────────────────────────────────────────────────────

  const calcEnd = {
    gram: n(form.gram_start) + n(form.gram_in) - n(form.gram_out) - n(form.gram_sold),
    cope: n(form.cope_start) + n(form.cope_in) - n(form.cope_out) - n(form.cope_sold),
  }

  const diff = {
    gram: n(form.gram_real) - calcEnd.gram,
    cope: n(form.cope_real) - calcEnd.cope,
  }

  const headerColor = color === 'yellow' ? 'bg-yellow-600' : 'bg-blue-700'
  const borderColor = color === 'yellow' ? 'border-yellow-300' : 'border-blue-300'

  const Row = ({ label, gramKey, copeKey, showGram = true, showCope = true }) => (
    <tr className="border-b border-gray-100">
      <td className="px-3 py-2 text-sm text-gray-700 font-medium">{label}</td>
      <td className="px-2 py-1">
        {showGram ? (
          <input type="number" step="any" placeholder="0"
            value={form[gramKey] ?? ''}
            onChange={e => handleChange(gramKey, e.target.value)}
            className="input-field w-28" />
        ) : <span className="text-gray-300">-</span>}
      </td>
      <td className="px-2 py-1">
        {showCope ? (
          <input type="number" step="any" placeholder="0"
            value={form[copeKey] ?? ''}
            onChange={e => handleChange(copeKey, e.target.value)}
            className="input-field w-24" />
        ) : <span className="text-gray-300">-</span>}
      </td>
    </tr>
  )

  const CalcRow = ({ label, gramVal, copeVal, highlight }) => (
    <tr className={`border-b ${highlight ? 'bg-yellow-50 font-semibold' : 'bg-gray-50'}`}>
      <td className="px-3 py-2 text-sm text-gray-700 font-medium">{label}</td>
      <td className="px-3 py-2 text-sm text-right font-mono">{fmt(gramVal)}</td>
      <td className="px-3 py-2 text-sm text-right font-mono">{fmt(copeVal)}</td>
    </tr>
  )

  return (
    <div className={`card border-2 ${borderColor}`}>
      <div className={`${headerColor} text-white px-4 py-2 -m-4 mb-4 rounded-t-lg flex items-center justify-between`}>
        <h3 className="font-bold text-lg">{label}</h3>
        <div className="flex items-center gap-2">
          {savedMsg && <span className="text-green-200 text-sm">{savedMsg}</span>}
          {isDirty && !savedMsg && <span className="text-yellow-200 text-sm">• Pa ruajtur</span>}
          <button
            onClick={() => setShowImport(true)}
            className="bg-white/20 hover:bg-white/30 text-white text-xs px-2.5 py-1 rounded-lg font-medium"
          >
            📂 Import
          </button>
          <button onClick={handleSave} className="bg-white text-gray-800 px-3 py-1 rounded text-sm font-medium hover:bg-gray-100">
            Ruaj
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Left: Input table */}
        <div>
          <table className="w-full">
            <thead>
              <tr className="bg-gray-100">
                <th className="px-3 py-1.5 text-left text-xs text-gray-600">Seksioni</th>
                <th className="px-3 py-1.5 text-left text-xs text-gray-600">Gram</th>
                <th className="px-3 py-1.5 text-left text-xs text-gray-600">Copë</th>
              </tr>
            </thead>
            <tbody>
              <Row label="Gjendje Fillim" gramKey="gram_start" copeKey="cope_start" />
              <Row label="Cmim Kosto (€)" gramKey="cost_price" copeKey="cost_price" showCope={false} />
              <Row label="Cmim Shitje (€)" gramKey="sell_price" copeKey="sell_price" showCope={false} />
              <tr className="bg-green-50 border-b border-gray-100">
                <td className="px-3 py-1 text-sm text-gray-700 font-medium">Hyrje (+)</td>
                <td className="px-2 py-1">
                  <input type="number" step="any" placeholder="0"
                    value={form.gram_in}
                    onChange={e => handleChange('gram_in', e.target.value)}
                    className="input-field w-28 bg-green-50 border-green-300" />
                </td>
                <td className="px-2 py-1">
                  <input type="number" step="any" placeholder="0"
                    value={form.cope_in}
                    onChange={e => handleChange('cope_in', e.target.value)}
                    className="input-field w-24 bg-green-50 border-green-300" />
                </td>
              </tr>
              <tr className="bg-red-50 border-b border-gray-100">
                <td className="px-3 py-1 text-sm text-gray-700 font-medium">Dalje (-)</td>
                <td className="px-2 py-1">
                  <input type="number" step="any" placeholder="0"
                    value={form.gram_out}
                    onChange={e => handleChange('gram_out', e.target.value)}
                    className="input-field w-28 bg-red-50 border-red-300" />
                </td>
                <td className="px-2 py-1">
                  <input type="number" step="any" placeholder="0"
                    value={form.cope_out}
                    onChange={e => handleChange('cope_out', e.target.value)}
                    className="input-field w-24 bg-red-50 border-red-300" />
                </td>
              </tr>
              <tr className="bg-orange-50 border-b border-gray-100">
                <td className="px-3 py-1 text-sm text-gray-700 font-medium">Shitje</td>
                <td className="px-2 py-1">
                  <input type="number" step="any" placeholder="0"
                    value={form.gram_sold}
                    onChange={e => handleChange('gram_sold', e.target.value)}
                    className="input-field w-28 bg-orange-50 border-orange-300" />
                </td>
                <td className="px-2 py-1">
                  <input type="number" step="any" placeholder="0"
                    value={form.cope_sold}
                    onChange={e => handleChange('cope_sold', e.target.value)}
                    className="input-field w-24 bg-orange-50 border-orange-300" />
                </td>
              </tr>
              <Row label="Gjendja Reale" gramKey="gram_real" copeKey="cope_real" />
            </tbody>
          </table>
        </div>

        {/* Right: Calculated values */}
        <div>
          <table className="w-full">
            <thead>
              <tr className="bg-gray-100">
                <th className="px-3 py-1.5 text-left text-xs text-gray-600">Llogaritje</th>
                <th className="px-3 py-1.5 text-right text-xs text-gray-600">Gram</th>
                <th className="px-3 py-1.5 text-right text-xs text-gray-600">Copë</th>
              </tr>
            </thead>
            <tbody>
              <CalcRow label="Gjendja Fillim" gramVal={n(form.gram_start)} copeVal={n(form.cope_start)} />
              <CalcRow label="+ Hyrje" gramVal={n(form.gram_in)} copeVal={n(form.cope_in)} />
              <CalcRow label="- Dalje" gramVal={n(form.gram_out)} copeVal={n(form.cope_out)} />
              <CalcRow label="- Shitje" gramVal={n(form.gram_sold)} copeVal={n(form.cope_sold)} />
              <CalcRow label="= Gjendja Fundit (llog.)" gramVal={calcEnd.gram} copeVal={calcEnd.cope} highlight />
              <CalcRow label="Gjendja Reale" gramVal={n(form.gram_real)} copeVal={n(form.cope_real)} />
              <tr className={`border-b ${Math.abs(diff.gram) > 0.01 || Math.abs(diff.cope) > 0 ? 'bg-red-50' : 'bg-green-50'}`}>
                <td className="px-3 py-2 text-sm font-medium">Diferenca</td>
                <td className={`px-3 py-2 text-sm text-right font-mono font-bold ${Math.abs(diff.gram) > 0.01 ? 'text-red-600' : 'text-green-600'}`}>
                  {diff.gram !== 0 ? (diff.gram > 0 ? '+' : '') + fmt(diff.gram) : '0'}
                </td>
                <td className={`px-3 py-2 text-sm text-right font-mono font-bold ${Math.abs(diff.cope) > 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {diff.cope !== 0 ? (diff.cope > 0 ? '+' : '') + diff.cope : '0'}
                </td>
              </tr>
            </tbody>
          </table>

          {/* Price info */}
          {(form.cost_price || form.sell_price) && (
            <div className="mt-3 p-2 bg-gray-100 rounded text-xs text-gray-600 grid grid-cols-2 gap-2">
              <div>Cmim Kosto: <span className="font-bold text-gray-800">€{fmt(form.cost_price)}</span></div>
              <div>Cmim Shitje: <span className="font-bold text-gray-800">€{fmt(form.sell_price)}</span></div>
            </div>
          )}
        </div>
      </div>

      {/* ── Import Modal ── */}
      {showImport && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <div>
                <h3 className="text-base font-bold text-slate-800">📂 Import Excel — {label}</h3>
                <p className="text-xs text-slate-400 mt-0.5">Data: {date}</p>
              </div>
              <button onClick={closeImport} className="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {!importDone ? (
                <>
                  <div className="flex gap-3">
                    <label className="flex-1 cursor-pointer">
                      <div className="border-2 border-dashed border-slate-300 rounded-xl p-4 text-center hover:border-blue-400 hover:bg-blue-50 transition-colors">
                        <div className="text-2xl mb-1">📁</div>
                        <p className="text-sm font-medium text-slate-700">Zgjidh file Excel (.xlsx)</p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {Object.keys(importPreview).length > 0
                            ? `✓ ${Object.keys(importPreview).length} fusha u detektuan`
                            : 'Inventory.xlsx ose template'}
                        </p>
                      </div>
                      <input type="file" accept=".xlsx,.xls" onChange={handleImportFile} className="sr-only" />
                    </label>
                    <button onClick={downloadTemplate} className="btn-secondary flex-shrink-0 self-center" title="Shkarko template">
                      ⬇ Template
                    </button>
                  </div>

                  {Object.keys(importPreview).length > 0 && (
                    <div>
                      <p className="text-sm font-semibold text-slate-700 mb-2">Vlerat e detektuara:</p>
                      <div className="rounded-xl border border-slate-200 overflow-hidden">
                        <table className="w-full text-xs">
                          <thead className="bg-slate-50 border-b border-slate-200">
                            <tr>
                              <th className="px-3 py-2 text-left font-medium text-slate-500">Fusha</th>
                              <th className="px-3 py-2 text-right font-medium text-slate-500">Vlera</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(importPreview).map(([k, v]) => (
                              <tr key={k} className="border-t border-slate-100">
                                <td className="px-3 py-1.5 text-slate-500">{k}</td>
                                <td className="px-3 py-1.5 text-right font-medium font-mono text-slate-800">{String(v)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {Object.keys(importPreview).length === 0 && (
                    <div className="text-center py-4 text-slate-400 text-sm">
                      Ngarko nje file Excel per te pare pamjen paraprake
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-10">
                  <div className="text-5xl mb-4">✅</div>
                  <p className="text-xl font-bold text-slate-800">{label} u importua</p>
                  <p className="text-sm text-slate-400 mt-1">{Object.keys(importPreview).length} fusha u vendosën</p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200">
              <button onClick={closeImport} className="btn-secondary">
                {importDone ? 'Mbyll' : 'Anulo'}
              </button>
              {!importDone && Object.keys(importPreview).length > 0 && (
                <button onClick={doImport} disabled={importDoing} className="btn-primary">
                  {importDoing ? '⏳ Duke importuar...' : `✓ Apliko të dhënat`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Inventory({ date }) {
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold text-gray-800">Inventar — {date}</h2>
      <InventoryType date={date} type="diamant" label="DIAMANT" color="blue" />
      <InventoryType date={date} type="flori" label="FLORI" color="yellow" />
    </div>
  )
}
