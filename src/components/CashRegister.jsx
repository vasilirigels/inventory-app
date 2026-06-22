import { useState, useEffect, useCallback, useRef } from 'react'
import * as XLSX from 'xlsx'

const CURRENCIES = ['lek', 'eur', 'usd', 'gbp', 'chf']
const CUR_LABELS = { lek: 'LEK', eur: 'EUR', usd: 'USD', gbp: 'GBP', chf: 'CHF' }

function n(v) { return parseFloat(v) || 0 }
function fmt(v) {
  if (!v) return '-'
  return n(v).toLocaleString('sq-AL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

const EMPTY_FORM = {
  opening_lek: '', opening_eur: '', opening_usd: '', opening_gbp: '', opening_chf: '',
  expenses_lek: '', expenses_eur: '', expenses_usd: '',
  biba_lek: '', biba_eur: '', biba_usd: '', biba_gbp: '', biba_chf: '', biba_gram: '',
  diana_lek: '', diana_eur: '', diana_usd: '', diana_gbp: '', diana_chf: '', diana_hurda: '',
  bank_withdraw_lek: '', bank_withdraw_eur: '', bank_withdraw_usd: '',
  bank_deposit_lek: '', bank_deposit_eur: '', bank_deposit_usd: '',
  conv_lek: '', conv_eur: '', conv_usd: '', conv_gbp: '', conv_chf: '',
  hurda_lek: '', hurda_eur: '', hurda_usd: '', hurda_gbp: '', hurda_chf: '', hurda_gram: '',
  safe_deposit_lek: '', safe_deposit_eur: '', safe_withdraw_lek: '', safe_withdraw_eur: '',
  debt_settlement_eur: '', debt_settlement_usd: '', debt_settlement_gbp: '',
  debt_settlement_chf: '', debt_settlement_has: '',
}

// Template field labels (Albanian → form key)
const ARKA_FIELD_LABELS = {
  'Gjendja Fillestare LEK': 'opening_lek', 'Gjendja Fillestare EUR': 'opening_eur',
  'Gjendja Fillestare USD': 'opening_usd', 'Gjendja Fillestare GBP': 'opening_gbp',
  'Gjendja Fillestare CHF': 'opening_chf',
  'Shpenzime LEK': 'expenses_lek', 'Shpenzime EUR': 'expenses_eur', 'Shpenzime USD': 'expenses_usd',
  'BIBA LEK': 'biba_lek', 'BIBA EUR': 'biba_eur', 'BIBA USD': 'biba_usd',
  'BIBA GBP': 'biba_gbp', 'BIBA CHF': 'biba_chf', 'BIBA Gram': 'biba_gram',
  'DIANA LEK': 'diana_lek', 'DIANA EUR': 'diana_eur', 'DIANA USD': 'diana_usd',
  'DIANA GBP': 'diana_gbp', 'DIANA CHF': 'diana_chf', 'DIANA Hurda': 'diana_hurda',
  'Terheqje Banke LEK': 'bank_withdraw_lek', 'Terheqje Banke EUR': 'bank_withdraw_eur', 'Terheqje Banke USD': 'bank_withdraw_usd',
  'Depozitim Banke LEK': 'bank_deposit_lek', 'Depozitim Banke EUR': 'bank_deposit_eur', 'Depozitim Banke USD': 'bank_deposit_usd',
  'Konvertim LEK': 'conv_lek', 'Konvertim EUR': 'conv_eur', 'Konvertim USD': 'conv_usd', 'Konvertim GBP': 'conv_gbp', 'Konvertim CHF': 'conv_chf',
  'Hurda LEK': 'hurda_lek', 'Hurda EUR': 'hurda_eur', 'Hurda USD': 'hurda_usd', 'Hurda GBP': 'hurda_gbp', 'Hurda CHF': 'hurda_chf', 'Hurda Gram': 'hurda_gram',
  'Kasaforte Depozitim LEK': 'safe_deposit_lek', 'Kasaforte Depozitim EUR': 'safe_deposit_eur',
  'Kasaforte Terheqje LEK': 'safe_withdraw_lek', 'Kasaforte Terheqje EUR': 'safe_withdraw_eur',
  'Shlyerje Borxhi EUR': 'debt_settlement_eur', 'Shlyerje Borxhi USD': 'debt_settlement_usd',
  'Shlyerje Borxhi GBP': 'debt_settlement_gbp', 'Shlyerje Borxhi CHF': 'debt_settlement_chf',
  'Shlyerje Borxhi HAS': 'debt_settlement_has',
}

export default function CashRegister({ date }) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [sales, setSales] = useState([])
  const [returns, setReturns] = useState([])
  const [debts, setDebts] = useState([])

  // ── Import state ──
  const [showImport, setShowImport]     = useState(false)
  const [importPreview, setImportPreview] = useState({})
  const [importDoing, setImportDoing]   = useState(false)
  const [importDone, setImportDone]     = useState(false)
  const [savedMsg, setSavedMsg] = useState('')
  const [isDirty, setIsDirty] = useState(false)

  // Customer debts form
  const [debtForm, setDebtForm] = useState({ name: '', type: 'debt', lek: '', eur: '', usd: '', gbp: '', chf: '' })

  const saveTimeout = useRef(null)

  // Keep latest form/date in refs so the debounced timer always saves
  // the user's current values, not stale closure-captured ones.
  const formRef = useRef(form)
  const dateRef = useRef(date)
  const isDirtyRef = useRef(false)
  useEffect(() => { formRef.current = form }, [form])
  useEffect(() => { dateRef.current = date }, [date])
  useEffect(() => { isDirtyRef.current = isDirty }, [isDirty])

  const flushSave = useCallback(async () => {
    if (!isDirtyRef.current) return
    clearTimeout(saveTimeout.current)
    saveTimeout.current = null
    try {
      const payload = {}
      Object.keys(formRef.current).forEach(k => { payload[k] = n(formRef.current[k]) })
      const targetDate = dateRef.current
      const res = await fetch(`/api/daily/${targetDate}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok && dateRef.current === targetDate) {
        setIsDirty(false)
        setSavedMsg('Ruajtur ✓')
        setTimeout(() => setSavedMsg(''), 2000)
      }
    } catch (e) { console.error(e) }
  }, [])

  const loadData = useCallback(async () => {
    // Flush any pending edits before swapping to a new date
    await flushSave()
    try {
      const [recRes, salesRes, debtsRes] = await Promise.all([
        fetch(`/api/daily/${date}`),
        fetch(`/api/sales/${date}`),
        fetch(`/api/debts/${date}`)
      ])
      const rec = await recRes.json()
      const allSales = await salesRes.json()
      const allDebts = await debtsRes.json()

      const newForm = { ...EMPTY_FORM }
      Object.keys(EMPTY_FORM).forEach(k => {
        if (rec[k] !== undefined && rec[k] !== null) {
          newForm[k] = rec[k] === 0 ? '' : String(rec[k])
        }
      })
      setForm(newForm)
      setSales(allSales.filter(s => !s.is_return))
      setReturns(allSales.filter(s => s.is_return))
      setDebts(allDebts)
      setIsDirty(false)
    } catch (e) {
      console.error(e)
    }
  }, [date, flushSave])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Cleanup pending save timer on unmount (and flush if dirty)
  useEffect(() => {
    return () => {
      if (saveTimeout.current) {
        clearTimeout(saveTimeout.current)
        // Best-effort flush — fire-and-forget
        if (isDirtyRef.current) {
          const payload = {}
          Object.keys(formRef.current).forEach(k => { payload[k] = n(formRef.current[k]) })
          fetch(`/api/daily/${dateRef.current}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            keepalive: true,
          }).catch(() => {})
        }
      }
    }
  }, [])

  const handleChange = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }))
    setIsDirty(true)
  }

  const handleSave = () => { flushSave() }

  const handleBlur = () => {
    if (isDirty) {
      clearTimeout(saveTimeout.current)
      saveTimeout.current = setTimeout(flushSave, 500)
    }
  }

  // ── Import functions ──────────────────────────────────────────────────────

  const downloadTemplate = () => {
    const wb = XLSX.utils.book_new()
    const rows = Object.keys(ARKA_FIELD_LABELS).map(label => [label, ''])
    const ws = XLSX.utils.aoa_to_sheet([['Fusha', 'Vlera'], ...rows])
    ws['!cols'] = [{ wch: 30 }, { wch: 14 }]
    XLSX.utils.book_append_sheet(wb, ws, 'ARKA')
    XLSX.writeFile(wb, `template_arka_${date}.xlsx`)
  }

  const handleImportFile = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const wb = XLSX.read(ev.target.result, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
      const preview = {}
      // Support key-value format (col A = field name, col B = value)
      for (const row of rows) {
        const label = String(row[0] || '').trim()
        const val = row[1]
        if (!label || val === '' || val === null) continue
        // Try direct match
        if (ARKA_FIELD_LABELS[label]) {
          preview[ARKA_FIELD_LABELS[label]] = val
          continue
        }
        // Try fuzzy match (lowercase)
        const normLabel = label.toLowerCase()
        for (const [key, fieldKey] of Object.entries(ARKA_FIELD_LABELS)) {
          if (key.toLowerCase() === normLabel || fieldKey === normLabel) {
            preview[fieldKey] = val; break
          }
        }
      }
      // Also try horizontal format (row 0 = headers, row 1 = values)
      if (Object.keys(preview).length === 0 && rows.length >= 2) {
        const headers = rows[0]
        const values = rows[1]
        headers.forEach((h, i) => {
          const label = String(h || '').trim()
          const val = values[i]
          if (!label || val === '' || val == null) return
          if (ARKA_FIELD_LABELS[label]) preview[ARKA_FIELD_LABELS[label]] = val
        })
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
    const payload = {}
    Object.keys(newForm).forEach(k => { payload[k] = n(newForm[k]) })
    await fetch(`/api/daily/${date}`, {
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

  const addDebt = async () => {
    if (!debtForm.name.trim()) {
      setSavedMsg('⚠ Vendos emrin e klientit')
      setTimeout(() => setSavedMsg(''), 2500)
      return
    }
    const hasAmount = ['lek','eur','usd','gbp','chf'].some(c => n(debtForm[c]) !== 0)
    if (!hasAmount) {
      setSavedMsg('⚠ Vendos të paktën një vlerë')
      setTimeout(() => setSavedMsg(''), 2500)
      return
    }
    try {
      const res = await fetch('/api/debts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...debtForm, date })
      })
      if (!res.ok) throw new Error('Gabim në ruajtje')
      setDebtForm({ name: '', type: 'debt', lek: '', eur: '', usd: '', gbp: '', chf: '' })
      const r2 = await fetch(`/api/debts/${date}`)
      setDebts(await r2.json())
      setSavedMsg('Shtuar ✓'); setTimeout(() => setSavedMsg(''), 1500)
    } catch (e) {
      console.error(e)
      setSavedMsg('⚠ ' + (e.message || 'Gabim në rrjet'))
      setTimeout(() => setSavedMsg(''), 2500)
    }
  }

  const deleteDebt = async (id) => {
    await fetch(`/api/debts/${id}`, { method: 'DELETE' })
    setDebts(prev => prev.filter(d => d.id !== id))
  }

  // Calculate totals from sales
  const sumSales = (arr, field) => arr.reduce((s, r) => s + n(r[field]), 0)
  const totalSalesLek = sumSales(sales, 'lek_cash') + sumSales(sales, 'lek_pb')
  const totalSalesEur = sumSales(sales, 'eur_cash') + sumSales(sales, 'eur_pb')
  const totalSalesUsd = sumSales(sales, 'usd_cash')
  const totalSalesGbp = sumSales(sales, 'gbp_cash')
  const totalSalesChf = sumSales(sales, 'chf_cash')
  const totalRetLek = sumSales(returns, 'lek_cash') + sumSales(returns, 'lek_pb')
  const totalRetEur = sumSales(returns, 'eur_cash') + sumSales(returns, 'eur_pb')
  const totalRetUsd = sumSales(returns, 'usd_cash')
  const totalRetGbp = sumSales(returns, 'gbp_cash')
  const totalRetChf = sumSales(returns, 'chf_cash')

  // Calculate closing balance
  const closing = {
    lek: n(form.opening_lek) + (totalSalesLek - totalRetLek) + n(form.conv_lek) + n(form.hurda_lek) + n(form.bank_withdraw_lek)
      - n(form.expenses_lek) - n(form.biba_lek) - n(form.diana_lek) - n(form.bank_deposit_lek)
      - n(form.safe_deposit_lek) + n(form.safe_withdraw_lek),
    eur: n(form.opening_eur) + (totalSalesEur - totalRetEur) + n(form.conv_eur) + n(form.hurda_eur) + n(form.bank_withdraw_eur)
      + n(form.debt_settlement_eur)
      - n(form.expenses_eur) - n(form.biba_eur) - n(form.diana_eur) - n(form.bank_deposit_eur)
      - n(form.safe_deposit_eur) + n(form.safe_withdraw_eur),
    usd: n(form.opening_usd) + (totalSalesUsd - totalRetUsd) + n(form.conv_usd) + n(form.hurda_usd) + n(form.bank_withdraw_usd)
      + n(form.debt_settlement_usd)
      - n(form.expenses_usd) - n(form.biba_usd) - n(form.diana_usd) - n(form.bank_deposit_usd),
    gbp: n(form.opening_gbp) + (totalSalesGbp - totalRetGbp) + n(form.conv_gbp) + n(form.hurda_gbp)
      + n(form.debt_settlement_gbp)
      - n(form.biba_gbp) - n(form.diana_gbp),
    chf: n(form.opening_chf) + (totalSalesChf - totalRetChf) + n(form.conv_chf) + n(form.hurda_chf)
      + n(form.debt_settlement_chf)
      - n(form.biba_chf) - n(form.diana_chf),
  }

  return (
    <>
    <div className="max-w-5xl mx-auto">
      {/* Save indicator */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-gray-800">ARKA — {date}</h2>
        <div className="flex items-center gap-3">
          {savedMsg && <span className="text-green-600 text-sm font-medium">{savedMsg}</span>}
          {isDirty && !savedMsg && <span className="text-orange-500 text-sm">• Pa ruajtur</span>}
          <button onClick={() => setShowImport(true)} className="btn-secondary flex items-center gap-1.5">
            📂 <span>Import Excel</span>
          </button>
          <button onClick={handleSave} className="btn-primary">
            Ruaj
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* LEFT COLUMN */}
        <div className="space-y-4">
          {/* Opening Balance */}
          <div className="card">
            <div className="section-title">Gjendja Fillestare (Hapje)</div>
            <div className="space-y-2">
              {CURRENCIES.map(cur => (
                <div key={cur} className="grid grid-cols-2 gap-1 items-center">
                  <label className="text-xs text-gray-600">{CUR_LABELS[cur]}</label>
                  <input
                    type="number" step="any" placeholder="0"
                    value={form[`opening_${cur}`]}
                    onChange={e => handleChange(`opening_${cur}`, e.target.value)}
                    onBlur={handleBlur}
                    className="input-field"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Sales Summary (read-only) */}
          <div className="card bg-blue-50">
            <div className="section-title text-blue-700">Shitje të Ditës (nga tab Shitjet)</div>
            <div className="space-y-1 text-sm">
              {[
                ['LEK', totalSalesLek, totalRetLek],
                ['EUR', totalSalesEur, totalRetEur],
                ['USD', totalSalesUsd, totalRetUsd],
                ['GBP', totalSalesGbp, totalRetGbp],
                ['CHF', totalSalesChf, totalRetChf],
              ].map(([cur, sale, ret]) => (
                <div key={cur} className="flex justify-between items-center text-xs">
                  <span className="text-gray-600">{cur}</span>
                  <span className="text-green-700">+{fmt(sale)}</span>
                  {ret > 0 && <span className="text-red-500">-{fmt(ret)}</span>}
                  <span className="font-medium">{fmt(sale - ret)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Expenses */}
          <div className="card">
            <div className="section-title">Shpenzime</div>
            <div className="space-y-2">
              {['lek', 'eur', 'usd'].map(cur => (
                <div key={cur} className="grid grid-cols-2 gap-1 items-center">
                  <label className="text-xs text-gray-600">{CUR_LABELS[cur]}</label>
                  <input type="number" step="any" placeholder="0"
                    value={form[`expenses_${cur}`]}
                    onChange={e => handleChange(`expenses_${cur}`, e.target.value)}
                    onBlur={handleBlur}
                    className="input-field" />
                </div>
              ))}
            </div>
          </div>

          {/* BIBA */}
          <div className="card">
            <div className="section-title">Tërheqje BIBA</div>
            <div className="space-y-2">
              {CURRENCIES.map(cur => (
                <div key={cur} className="grid grid-cols-2 gap-1 items-center">
                  <label className="text-xs text-gray-600">{CUR_LABELS[cur]}</label>
                  <input type="number" step="any" placeholder="0"
                    value={form[`biba_${cur}`]}
                    onChange={e => handleChange(`biba_${cur}`, e.target.value)}
                    onBlur={handleBlur}
                    className="input-field" />
                </div>
              ))}
              <div className="grid grid-cols-2 gap-1 items-center">
                <label className="text-xs text-gray-600">Gram</label>
                <input type="number" step="any" placeholder="0"
                  value={form.biba_gram}
                  onChange={e => handleChange('biba_gram', e.target.value)}
                  onBlur={handleBlur}
                  className="input-field" />
              </div>
            </div>
          </div>

          {/* DIANA */}
          <div className="card">
            <div className="section-title">Tërheqje DIANA</div>
            <div className="space-y-2">
              {CURRENCIES.map(cur => (
                <div key={cur} className="grid grid-cols-2 gap-1 items-center">
                  <label className="text-xs text-gray-600">{CUR_LABELS[cur]}</label>
                  <input type="number" step="any" placeholder="0"
                    value={form[`diana_${cur}`]}
                    onChange={e => handleChange(`diana_${cur}`, e.target.value)}
                    onBlur={handleBlur}
                    className="input-field" />
                </div>
              ))}
              <div className="grid grid-cols-2 gap-1 items-center">
                <label className="text-xs text-gray-600">Hurda</label>
                <input type="number" step="any" placeholder="0"
                  value={form.diana_hurda}
                  onChange={e => handleChange('diana_hurda', e.target.value)}
                  onBlur={handleBlur}
                  className="input-field" />
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div className="space-y-4">
          {/* Debt Settlement */}
          <div className="card">
            <div className="section-title">Shlyerje Borxhi të Produkteve</div>
            <div className="space-y-2">
              {['eur', 'usd', 'gbp', 'chf'].map(cur => (
                <div key={cur} className="grid grid-cols-2 gap-1 items-center">
                  <label className="text-xs text-gray-600">{CUR_LABELS[cur]}</label>
                  <input type="number" step="any" placeholder="0"
                    value={form[`debt_settlement_${cur}`]}
                    onChange={e => handleChange(`debt_settlement_${cur}`, e.target.value)}
                    onBlur={handleBlur}
                    className="input-field" />
                </div>
              ))}
              <div className="grid grid-cols-2 gap-1 items-center">
                <label className="text-xs text-gray-600">HAS</label>
                <input type="number" step="any" placeholder="0"
                  value={form.debt_settlement_has}
                  onChange={e => handleChange('debt_settlement_has', e.target.value)}
                  onBlur={handleBlur}
                  className="input-field" />
              </div>
            </div>
          </div>

          {/* Currency Conversion */}
          <div className="card">
            <div className="section-title">Konvertim Valute</div>
            <div className="space-y-2">
              {CURRENCIES.map(cur => (
                <div key={cur} className="grid grid-cols-2 gap-1 items-center">
                  <label className="text-xs text-gray-600">{CUR_LABELS[cur]}</label>
                  <input type="number" step="any" placeholder="0"
                    value={form[`conv_${cur}`]}
                    onChange={e => handleChange(`conv_${cur}`, e.target.value)}
                    onBlur={handleBlur}
                    className="input-field" />
                </div>
              ))}
            </div>
          </div>

          {/* Hurda Conversion */}
          <div className="card">
            <div className="section-title">Konvertim Hurda</div>
            <div className="space-y-2">
              {CURRENCIES.map(cur => (
                <div key={cur} className="grid grid-cols-2 gap-1 items-center">
                  <label className="text-xs text-gray-600">{CUR_LABELS[cur]}</label>
                  <input type="number" step="any" placeholder="0"
                    value={form[`hurda_${cur}`]}
                    onChange={e => handleChange(`hurda_${cur}`, e.target.value)}
                    onBlur={handleBlur}
                    className="input-field" />
                </div>
              ))}
              <div className="grid grid-cols-2 gap-1 items-center">
                <label className="text-xs text-gray-600">Gram</label>
                <input type="number" step="any" placeholder="0"
                  value={form.hurda_gram}
                  onChange={e => handleChange('hurda_gram', e.target.value)}
                  onBlur={handleBlur}
                  className="input-field" />
              </div>
            </div>
          </div>

          {/* Bank Operations */}
          <div className="card">
            <div className="section-title">Operacione Bankare</div>
            <div className="text-xs font-medium text-gray-500 mb-1">Tërheqje nga Banka</div>
            <div className="space-y-1 mb-3">
              {['lek', 'eur', 'usd'].map(cur => (
                <div key={cur} className="grid grid-cols-2 gap-1 items-center">
                  <label className="text-xs text-gray-600">{CUR_LABELS[cur]}</label>
                  <input type="number" step="any" placeholder="0"
                    value={form[`bank_withdraw_${cur}`]}
                    onChange={e => handleChange(`bank_withdraw_${cur}`, e.target.value)}
                    onBlur={handleBlur}
                    className="input-field" />
                </div>
              ))}
            </div>
            <div className="text-xs font-medium text-gray-500 mb-1">Depozitim në Bankë</div>
            <div className="space-y-1">
              {['lek', 'eur', 'usd'].map(cur => (
                <div key={cur} className="grid grid-cols-2 gap-1 items-center">
                  <label className="text-xs text-gray-600">{CUR_LABELS[cur]}</label>
                  <input type="number" step="any" placeholder="0"
                    value={form[`bank_deposit_${cur}`]}
                    onChange={e => handleChange(`bank_deposit_${cur}`, e.target.value)}
                    onBlur={handleBlur}
                    className="input-field" />
                </div>
              ))}
            </div>
          </div>

          {/* Safe */}
          <div className="card">
            <div className="section-title">Gjendje Kasaforta</div>
            <div className="text-xs font-medium text-gray-500 mb-1">Depozitim</div>
            <div className="space-y-1 mb-2">
              {['lek', 'eur'].map(cur => (
                <div key={cur} className="grid grid-cols-2 gap-1 items-center">
                  <label className="text-xs text-gray-600">{CUR_LABELS[cur]}</label>
                  <input type="number" step="any" placeholder="0"
                    value={form[`safe_deposit_${cur}`]}
                    onChange={e => handleChange(`safe_deposit_${cur}`, e.target.value)}
                    onBlur={handleBlur}
                    className="input-field" />
                </div>
              ))}
            </div>
            <div className="text-xs font-medium text-gray-500 mb-1">Tërheqje</div>
            <div className="space-y-1">
              {['lek', 'eur'].map(cur => (
                <div key={cur} className="grid grid-cols-2 gap-1 items-center">
                  <label className="text-xs text-gray-600">{CUR_LABELS[cur]}</label>
                  <input type="number" step="any" placeholder="0"
                    value={form[`safe_withdraw_${cur}`]}
                    onChange={e => handleChange(`safe_withdraw_${cur}`, e.target.value)}
                    onBlur={handleBlur}
                    className="input-field" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* CLOSING BALANCE — full width */}
      <div className="card mt-4 bg-gray-900 text-white">
        <div className="text-sm font-bold text-yellow-400 mb-3">ARKA NE FUND TË DITËS</div>
        <div className="grid grid-cols-5 gap-4">
          {[
            ['LEK', closing.lek],
            ['EUR', closing.eur],
            ['USD', closing.usd],
            ['GBP', closing.gbp],
            ['CHF', closing.chf],
          ].map(([cur, val]) => (
            <div key={cur} className="text-center">
              <div className="text-xs text-gray-400 mb-1">{cur}</div>
              <div className={`text-lg font-bold ${val < 0 ? 'text-red-400' : 'text-yellow-300'}`}>
                {fmt(val)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* CUSTOMER DEBTS */}
      <div className="card mt-4">
        <div className="section-title">Borxhe Klienti</div>
        {/* Add form */}
        <div className="grid grid-cols-8 gap-1 mb-3 items-end">
          <div className="col-span-2">
            <label className="text-xs text-gray-500 block mb-0.5">Emri</label>
            <input type="text" placeholder="Emri i klientit" value={debtForm.name}
              onChange={e => setDebtForm(p => ({ ...p, name: e.target.value }))}
              className="input-field" />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-0.5">Lloji</label>
            <select value={debtForm.type}
              onChange={e => setDebtForm(p => ({ ...p, type: e.target.value }))}
              className="input-field">
              <option value="debt">Borxh</option>
              <option value="repayment">Kthim</option>
            </select>
          </div>
          {['lek', 'eur', 'usd', 'gbp', 'chf'].map(cur => (
            <div key={cur}>
              <label className="text-xs text-gray-500 block mb-0.5">{CUR_LABELS[cur]}</label>
              <input type="number" step="any" placeholder="0" value={debtForm[cur]}
                onChange={e => setDebtForm(p => ({ ...p, [cur]: e.target.value }))}
                className="input-field" />
            </div>
          ))}
          <button onClick={addDebt} className="btn-primary text-xs">+ Shto</button>
        </div>

        {/* Debt list */}
        {debts.length > 0 && (
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-100">
                <th className="text-left p-1">Emri</th>
                <th className="text-left p-1">Lloji</th>
                <th className="text-right p-1">LEK</th>
                <th className="text-right p-1">EUR</th>
                <th className="text-right p-1">USD</th>
                <th className="text-right p-1">GBP</th>
                <th className="text-right p-1">CHF</th>
                <th className="p-1"></th>
              </tr>
            </thead>
            <tbody>
              {debts.map(d => (
                <tr key={d.id} className={`border-b ${d.type === 'repayment' ? 'bg-green-50' : 'bg-red-50'}`}>
                  <td className="p-1 font-medium">{d.name}</td>
                  <td className="p-1">
                    <span className={`px-1 py-0.5 rounded text-xs ${d.type === 'repayment' ? 'bg-green-200 text-green-800' : 'bg-red-200 text-red-800'}`}>
                      {d.type === 'repayment' ? 'Kthim' : 'Borxh'}
                    </span>
                  </td>
                  {['lek', 'eur', 'usd', 'gbp', 'chf'].map(cur => (
                    <td key={cur} className="p-1 text-right">{d[cur] ? fmt(d[cur]) : '-'}</td>
                  ))}
                  <td className="p-1">
                    <button onClick={() => deleteDebt(d.id)} className="text-red-500 hover:text-red-700">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>

    {/* ── Import Modal (rendered outside scroll container) ── */}
    {showImport && (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
            <div>
              <h3 className="text-base font-bold text-slate-800">📂 Import Excel — ARKA</h3>
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
                          : 'Format: Fusha | Vlera'}
                      </p>
                    </div>
                    <input type="file" accept=".xlsx,.xls" onChange={handleImportFile} className="sr-only" />
                  </label>
                  <button onClick={downloadTemplate} className="btn-secondary flex-shrink-0 self-center" title="Shkarko template bosh">
                    ⬇ Template
                  </button>
                </div>

                {Object.keys(importPreview).length > 0 && (
                  <div>
                    <p className="text-sm font-semibold text-slate-700 mb-2">
                      Vlerat e detektuara ({Object.keys(importPreview).length} fusha):
                    </p>
                    <div className="rounded-xl border border-slate-200 overflow-hidden max-h-64 overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
                          <tr>
                            <th className="px-3 py-2 text-left font-medium text-slate-500">Fusha</th>
                            <th className="px-3 py-2 text-right font-medium text-slate-500">Vlera</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(importPreview).map(([k, v]) => (
                            <tr key={k} className="border-t border-slate-100">
                              <td className="px-3 py-1.5 text-slate-500">{k}</td>
                              <td className="px-3 py-1.5 text-right font-medium text-slate-800">{String(v)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-10">
                <div className="text-5xl mb-4">✅</div>
                <p className="text-xl font-bold text-slate-800">ARKA u importua</p>
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
                {importDoing ? '⏳ Duke importuar...' : `✓ Apliko ${Object.keys(importPreview).length} fusha`}
              </button>
            )}
          </div>
        </div>
      </div>
    )}
    </>
  )
}
