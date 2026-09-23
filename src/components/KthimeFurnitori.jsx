import { useState, useRef } from 'react'
import { showConfirm } from './ConfirmDialog.jsx'

// Detekton kolonat e Excel-it për kthime nga blerjet. Kërkohen:
//   - purchase_date  (Data e Blerjes së produktit)
//   - barcode        (Barkod)
//   - name           (Përshkrim) — për referencë vizuale, nuk përdoret në ruajtje
//   - qty            (Sasi)
//   - purchase_price (Çmim Blerje) — referencë; ruhet çmimi i faturës origjinale
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
  const purchase_date  = findFirst(['data_bler', 'data_e_bler', 'dt_bler', 'data'])
  const barcode        = findFirst(['barkod', 'barcode'])
  const name           = findFirst(['pershkrim', 'emri', 'name', 'produkt', 'artikull'])
  const qty            = findFirst(['sasia', 'sasi', 'qty', 'quantity', 'cope'])
  const purchase_price = findFirst([
    'cmim_bler', 'cm_bler', 'cmimi_bler', 'blerje', 'kosto', 'cost', 'cmim',
  ])
  return { purchase_date, barcode, name, qty, purchase_price }
}

function normalizeDate(v) {
  if (v == null || v === '') return ''
  // Excel serial number → JS date
  if (typeof v === 'number' && Number.isFinite(v)) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000))
    return d.toISOString().slice(0, 10)
  }
  const s = String(v).trim()
  // dd.MM.yyyy ose dd/MM/yyyy ose dd-MM-yyyy
  const m = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})$/)
  if (m) {
    let [, dd, mm, yy] = m
    if (yy.length === 2) yy = '20' + yy
    return `${yy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
  }
  // yyyy-MM-dd tashmë
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  // Fallback: provoje si Date
  const parsed = new Date(s)
  if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10)
  return s
}

function rowToPayload(row, m) {
  const get = (idx, def = '') => idx >= 0 ? (row[idx] ?? def) : def
  const num = (idx) => parseFloat(String(get(idx, 0)).replace(',', '.')) || 0
  return {
    purchase_date:  normalizeDate(get(m.purchase_date, '')),
    barcode:        String(get(m.barcode, '')).trim(),
    name:           String(get(m.name, '')).trim(),
    qty:            num(m.qty),
    purchase_price: num(m.purchase_price),
  }
}

export default function KthimeFurnitori() {
  const fileRef = useRef()
  const today = new Date().toISOString().slice(0, 10)
  const [date, setDate] = useState(today)
  const [notes, setNotes] = useState('')
  const [step, setStep] = useState('upload') // upload | preview | done
  const [fileName, setFileName] = useState('')
  const [headers, setHeaders] = useState([])
  const [mapping, setMapping] = useState({})
  const [dataRows, setDataRows] = useState([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState(null)

  const handleFile = e => {
    const file = e.target.files[0]
    if (!file) return
    setFileName(file.name)
    setError('')
    const reader = new FileReader()
    reader.onload = async evt => {
      try {
        const XLSX = await import('xlsx')
        const wb  = XLSX.read(evt.target.result, { type: 'array', cellDates: false })
        const ws  = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
        const hdrIdx = raw.findIndex(r => r.filter(c => String(c).trim()).length >= 2)
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

  const rows = dataRows.map(r => rowToPayload(r, mapping))
  const validRows = rows.filter(r => r.barcode && r.qty > 0)

  const setMap = (key, val) => setMapping(m => ({ ...m, [key]: parseInt(val) }))

  const reset = () => {
    setStep('upload'); setFileName(''); setHeaders([]); setMapping({})
    setDataRows([]); setError(''); setResult(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleSubmit = async () => {
    if (validRows.length === 0) { setError('Nuk ka rreshta të vlefshëm për ruajtje.'); return }
    const ok = await showConfirm({
      title: 'Ruaj Kthimet nga Excel?',
      message: `Do të krijohen fatura kthimi për ${validRows.length} rreshta. Produktet do të zbriten nga inventari.`,
      confirmText: 'Po, ruaj', cancelText: 'Anulo',
    })
    if (!ok) return
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/purchase-returns/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, notes: notes.trim(), rows: validRows }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Gabim gjatë ruajtjes')
      setResult(data)
      setStep('done')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const COL_FIELDS = [
    { key: 'purchase_date',  label: 'Data e Blerjes' },
    { key: 'barcode',        label: 'Barkodi *' },
    { key: 'name',           label: 'Përshkrimi' },
    { key: 'qty',            label: 'Sasi *' },
    { key: 'purchase_price', label: 'Çmim Blerje' },
  ]

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow p-4">
        <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-1">
          🔄 Kthime Furnitori (Import nga Excel)
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Ngarko një Excel me produktet që kthehen. Sistemi i heq nga inventari
          dhe krijon një faturë kthimi (me minus) për çdo faturë blerjeje.
        </p>
      </div>

      {/* Headeri: data e faturës së kthimit + shënime */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
            Data e kthimit
          </label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="input-field w-full"
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
            Shënime (opsionale)
          </label>
          <input
            type="text"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="P.sh. Kthim për defekte"
            className="input-field w-full"
          />
        </div>
      </div>

      {step === 'upload' && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow p-8 text-center">
          <div className="text-5xl mb-3">📥</div>
          <p className="text-slate-700 dark:text-slate-200 font-medium mb-1">
            Ngarko skedarin Excel (.xlsx)
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
            Kolonat: <b>Data e Blerjes</b>, <b>Barkod</b>, <b>Përshkrim</b>, <b>Sasi</b>, <b>Çmim Blerje</b>
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={handleFile}
            className="hidden"
            id="kthime-excel-input"
          />
          <label
            htmlFor="kthime-excel-input"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold cursor-pointer"
          >
            📄 Zgjidh Excel
          </label>
          {error && (
            <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>
          )}
        </div>
      )}

      {step === 'preview' && (
        <>
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  📄 {fileName} — {dataRows.length} rreshta të gjetur
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {validRows.length} me barkod + sasi të vlefshme
                </p>
              </div>
              <button onClick={reset} className="text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-200">
                🔄 Ngarko tjetër
              </button>
            </div>

            {/* Mapping kolonash */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-2 mb-4">
              {COL_FIELDS.map(f => (
                <div key={f.key}>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    {f.label}
                  </label>
                  <select
                    value={mapping[f.key] ?? -1}
                    onChange={e => setMap(f.key, e.target.value)}
                    className="input-field w-full text-xs"
                  >
                    <option value={-1}>— pa —</option>
                    {headers.map((h, i) => (
                      <option key={i} value={i}>{h || `Kolona ${i + 1}`}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          {/* Preview rreshtat */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow overflow-hidden">
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-100 dark:bg-slate-700 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 dark:text-slate-300">#</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 dark:text-slate-300">Data Blerjes</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 dark:text-slate-300">Barkod</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 dark:text-slate-300">Përshkrim</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600 dark:text-slate-300">Sasi</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600 dark:text-slate-300">Çmim</th>
                    <th className="px-3 py-2 text-center text-xs font-semibold text-slate-600 dark:text-slate-300">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const valid = r.barcode && r.qty > 0
                    return (
                      <tr key={i} className={valid ? '' : 'bg-red-50 dark:bg-red-900/10'}>
                        <td className="px-3 py-1.5 text-slate-500">{i + 1}</td>
                        <td className="px-3 py-1.5 text-slate-700 dark:text-slate-200">{r.purchase_date}</td>
                        <td className="px-3 py-1.5 font-mono text-slate-700 dark:text-slate-200">{r.barcode}</td>
                        <td className="px-3 py-1.5 text-slate-700 dark:text-slate-200 truncate max-w-xs">{r.name}</td>
                        <td className="px-3 py-1.5 text-right text-slate-700 dark:text-slate-200">{r.qty || ''}</td>
                        <td className="px-3 py-1.5 text-right text-slate-700 dark:text-slate-200">
                          {r.purchase_price ? r.purchase_price.toFixed(2) : ''}
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          {valid
                            ? <span className="text-green-600 dark:text-green-400 text-xs">✓</span>
                            : <span className="text-red-500 text-xs" title="Mungon barkod ose sasi">✕</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              onClick={reset}
              disabled={saving}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              Anulo
            </button>
            <button
              onClick={handleSubmit}
              disabled={saving || validRows.length === 0}
              className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold"
            >
              {saving ? 'Duke ruajtur…' : `💾 Ruaj Kthimet (${validRows.length})`}
            </button>
          </div>
        </>
      )}

      {step === 'done' && result && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow p-4 space-y-4">
          <div className="flex items-center gap-2 text-lg font-bold text-green-700 dark:text-green-400">
            ✅ Kthimet u ruajtën
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <StatCard label="Fatura kthimi të krijuara" value={result.invoices_created?.length || 0} />
            <StatCard label="Rreshta të suksesshëm" value={result.rows_ok || 0} tone="green" />
            <StatCard label="Rreshta me gabime" value={result.rows_failed || 0} tone={result.rows_failed ? 'red' : 'slate'} />
          </div>

          {Array.isArray(result.invoices_created) && result.invoices_created.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">
                Fatura kthimi
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-100 dark:bg-slate-700">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold">Nr. Kthimi</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold">Fatura Origjinale</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold">Furnitor</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold">Artikuj</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold">Total</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold">Zbritje Detyrimi</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold">Cash-back</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.invoices_created.map((inv, i) => (
                      <tr key={inv.id || i} className="border-t border-slate-100 dark:border-slate-700">
                        <td className="px-3 py-1.5 font-mono">{inv.invoice_no}</td>
                        <td className="px-3 py-1.5 font-mono">{inv.original_invoice_no}</td>
                        <td className="px-3 py-1.5">{inv.supplier_name}</td>
                        <td className="px-3 py-1.5 text-right">{inv.items_count}</td>
                        <td className="px-3 py-1.5 text-right">{Number(inv.total_with_vat).toFixed(2)}</td>
                        <td className="px-3 py-1.5 text-right">{Number(inv.debt_reduction).toFixed(2)}</td>
                        <td className="px-3 py-1.5 text-right">{Number(inv.cash_back).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {Array.isArray(result.errors) && result.errors.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-red-700 dark:text-red-400 mb-2">
                Rreshta që u anashkaluan ({result.errors.length})
              </h3>
              <div className="overflow-x-auto max-h-64 overflow-y-auto border border-red-200 dark:border-red-800 rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-red-50 dark:bg-red-900/20 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold">Rreshti</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold">Barkod</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold">Arsyeja</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.errors.map((e, i) => (
                      <tr key={i} className="border-t border-red-100 dark:border-red-900/40">
                        <td className="px-3 py-1.5">{e.row ?? '—'}</td>
                        <td className="px-3 py-1.5 font-mono">{e.barcode ?? '—'}</td>
                        <td className="px-3 py-1.5 text-red-700 dark:text-red-300">{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <button
              onClick={reset}
              className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold"
            >
              Ngarko një Excel tjetër
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, tone = 'slate' }) {
  const toneClass =
    tone === 'green' ? 'text-green-700 dark:text-green-400' :
    tone === 'red'   ? 'text-red-700 dark:text-red-400' :
                       'text-slate-700 dark:text-slate-200'
  return (
    <div className="bg-slate-50 dark:bg-slate-900/40 rounded-lg p-3">
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`text-2xl font-bold ${toneClass}`}>{value}</div>
    </div>
  )
}
