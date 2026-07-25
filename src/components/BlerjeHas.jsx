import { useState, useEffect, useRef } from 'react'
import MoneyInput from './MoneyInput.jsx'

function n(v) { return parseFloat(v) || 0 }
function fmt(v) {
  return n(v).toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtGram(v) {
  return n(v).toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 3 })
}

function SupplierPicker({ value, onChange }) {
  const [query, setQuery]   = useState(value?.name || '')
  const [results, setResults] = useState([])
  const [open, setOpen]     = useState(false)
  const [loading, setLoading] = useState(false)
  const timerRef = useRef(null)
  const boxRef   = useRef(null)

  useEffect(() => { setQuery(value?.name || '') }, [value?.name])

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
        const data = await fetch(`/api/suppliers/search?q=${encodeURIComponent(q)}`).then(r => r.json())
        setResults(Array.isArray(data) ? data : [])
      } catch { setResults([]) }
      setLoading(false)
    }, 250)
  }

  const pick = (s) => {
    onChange({ name: s.name || '', nipt: s.nipt || '' })
    setQuery(s.name || s.nipt || '')
    setOpen(false)
  }

  return (
    <div ref={boxRef} className="relative">
      <label className="form-label">Furnitori / Personi</label>
      <div className="flex gap-1">
        <input
          type="text" value={query}
          placeholder="Emër, NIPT, telefon..."
          onChange={e => { setQuery(e.target.value); onChange({ name: e.target.value, nipt: value?.nipt || '' }); search(e.target.value); setOpen(true) }}
          onFocus={() => query && setOpen(true)}
          className="input-field flex-1"
        />
        {value?.name && (
          <button type="button" onClick={() => { onChange({ name: '', nipt: '' }); setQuery('') }}
            className="px-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 text-xs">✕</button>
        )}
      </div>
      {open && (results.length > 0 || loading) && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg max-h-64 overflow-y-auto">
          {loading && <div className="p-2 text-xs text-slate-400 dark:text-slate-500">Duke kërkuar...</div>}
          {results.map(s => (
            <button key={s.id} type="button" onClick={() => pick(s)}
              className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-slate-100 dark:border-slate-800 last:border-0">
              <div className="text-sm font-medium text-slate-800 dark:text-slate-100">{s.name || <span className="italic text-slate-400 dark:text-slate-500">— pa emër —</span>}</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">{s.nipt || '—'}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function GoldSpotBadge() {
  const [spot, setSpot] = useState(null)
  const [err, setErr]   = useState('')
  const [refreshing, setRefreshing] = useState(false)

  const load = async (force = false) => {
    setRefreshing(true); setErr('')
    try {
      const d = await fetch(`/api/gold-spot-price${force ? '?force=1' : ''}`)
        .then(r => r.ok ? r.json() : Promise.reject(r))
      setSpot(d)
    } catch { setErr('nuk arritëm çmimin live') }
    finally { setRefreshing(false) }
  }

  useEffect(() => {
    load()
    const t = setInterval(() => load(true), 60 * 1000)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="card bg-gradient-to-r from-yellow-50 to-amber-50 border-amber-200 flex items-center gap-4">
      <div className="text-3xl">🟡</div>
      <div className="flex-1">
        <div className="flex items-center justify-between">
          <div className="text-[10px] uppercase font-bold tracking-wide text-amber-700 dark:text-amber-300">
            Çmimi Aktual i Florit (Spot)
          </div>
          <button
            type="button" onClick={() => load(true)} disabled={refreshing}
            className="text-[10px] px-2 py-0.5 rounded bg-amber-100 hover:bg-amber-200 text-amber-800 dark:text-amber-200 font-semibold disabled:opacity-50"
            title="Rifresko çmimin nga burimi"
          >
            {refreshing ? '⏳' : '🔄 Rifresko'}
          </button>
        </div>
        {spot ? (
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-extrabold text-amber-800 dark:text-amber-200 tabular-nums">
              {n(spot.eur_per_gram).toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-sm font-semibold text-amber-700 dark:text-amber-300">EUR / gram</span>
          </div>
        ) : err ? (
          <div className="text-xs text-red-600">{err}</div>
        ) : (
          <div className="text-xs text-slate-400 dark:text-slate-500">Duke ngarkuar...</div>
        )}
        {spot && (
          <div className="text-[10px] text-amber-700/70 mt-0.5">
            {n(spot.usd_per_oz).toLocaleString('sq-AL')} USD/onc · 1 USD = {spot.eur_per_usd} EUR ·{' '}
            <span className="font-mono">{new Date(spot.updated_at).toLocaleString('sq-AL')}</span>
          </div>
        )}
      </div>
    </div>
  )
}

function HasList({ date, onOpen, onCreate, onDelete, refreshKey }) {
  const [list, setList]       = useState([])
  const [loading, setLoading] = useState(true)
  const [fromDate, setFromDate] = useState(date)
  const [toDate, setToDate]     = useState(date)

  useEffect(() => { setFromDate(date); setToDate(date) }, [date])

  useEffect(() => {
    if (!fromDate || !toDate) return
    setLoading(true)
    const url = fromDate === toDate
      ? `/api/has-purchases/by-date/${fromDate}`
      : `/api/has-purchases/by-range?from=${fromDate}&to=${toDate}`
    fetch(url)
      .then(r => r.json())
      .then(d => { setList(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => { setList([]); setLoading(false) })
  }, [fromDate, toDate, refreshKey])

  const rangeActive = fromDate !== date || toDate !== date

  const totals = list.reduce((acc, p) => {
    const rate = n(p.exchange_rate) || 1
    acc.count += 1
    acc.gram  += n(p.gram)
    acc.amount += n(p.total_amount)
    acc.amountLek += n(p.total_amount) * rate
    return acc
  }, { count: 0, gram: 0, amount: 0, amountLek: 0 })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">🟡 Blerje HAS</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Blerje me shumicë e artikujve prej flori (unaza, varëse, etj.) e llogaritur në gram HAS.
            Shuma paguhet nga arka. Artikujt qëndrojnë si stok grupor derisa të ndahen dhe të peshohen
            veçmas për t'i kaluar te produktet.
          </p>
        </div>
        <button onClick={onCreate} className="btn-primary">+ Blerje HAS e Re</button>
      </div>

      <GoldSpotBadge />

      <div className="card flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">📅</span>
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Filtër data</span>
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
          <div className="p-8 text-center text-slate-400 dark:text-slate-500 text-sm">Duke ngarkuar...</div>
        ) : list.length === 0 ? (
          <div className="p-10 text-center">
            <div className="text-5xl mb-3">🟡</div>
            <p className="text-slate-500 dark:text-slate-400 mb-4">
              {fromDate === toDate
                ? 'Nuk ka blerje HAS për këtë datë.'
                : 'Nuk ka blerje HAS në këtë periudhë.'}
            </p>
            <button onClick={onCreate} className="btn-primary mx-auto">+ Krijo Blerjen e Parë</button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Nr.</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Data</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Furnitori / Personi</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Gram HAS</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Çm./Gram (EUR)</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Totali (EUR)</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Veprime</th>
              </tr>
            </thead>
            <tbody>
              {list.map(p => {
                const rate = n(p.exchange_rate) || 1
                return (
                  <tr key={p.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="px-4 py-3 font-mono text-xs text-slate-700 dark:text-slate-200">
                      <button onClick={() => onOpen(p.id)} className="text-blue-600 hover:underline">{p.purchase_no}</button>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{p.date}</td>
                    <td className="px-4 py-3 text-slate-800 dark:text-slate-100">
                      {p.supplier_name || <span className="text-slate-400 dark:text-slate-500 italic">— pa emër —</span>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold text-amber-700 dark:text-amber-300">{fmtGram(p.gram)} g</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700 dark:text-slate-200">{fmt(p.price_per_gram)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-bold text-slate-900 dark:text-white">
                      {fmt(p.total_amount)}
                      <div className="text-[10px] font-normal text-slate-500 dark:text-slate-400 italic">
                        = {fmt(n(p.total_amount) * rate)} LEK
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1.5">
                        <button onClick={() => onOpen(p.id)} className="px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 text-blue-600 text-xs font-medium">Hap</button>
                        <button onClick={() => onDelete(p.id, p.purchase_no)} className="px-2.5 py-1 rounded-lg bg-red-50 dark:bg-red-900/30 hover:bg-red-100 text-red-600 text-xs font-medium">Fshi</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="bg-amber-50 dark:bg-amber-900/30 border-t-2 border-amber-300">
              <tr>
                <td colSpan={3} className="px-4 py-3 text-xs font-bold text-amber-800 dark:text-amber-200 uppercase tracking-wide">
                  🟡 TOTAL <span className="text-[10px] font-normal text-amber-700 dark:text-amber-300">— {totals.count} blerje</span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-extrabold text-amber-800 dark:text-amber-200 text-base">{fmtGram(totals.gram)} g</td>
                <td></td>
                <td className="px-4 py-3 text-right tabular-nums font-extrabold text-emerald-800 dark:text-emerald-200">
                  {fmt(totals.amount)}
                  <div className="text-[10px] font-normal text-slate-500 dark:text-slate-400 italic">
                    = {fmt(totals.amountLek)} LEK
                  </div>
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  )
}

function HasEditor({ date, purchaseId, onClose, onSaved }) {
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [purchaseNo, setPurchaseNo] = useState('')
  const [purchaseDate, setPurchaseDate] = useState(date)
  const [supplierName, setSupplierName] = useState('')
  const [supplierNipt, setSupplierNipt] = useState('')
  const [gram, setGram]           = useState('')
  const [pricePerGram, setPricePerGram] = useState('')
  const [exchangeRate, setExchangeRate] = useState(1)
  const [rateSource, setRateSource] = useState('')
  const [notes, setNotes]         = useState('')
  const [allRates, setAllRates]   = useState({ LEK: 1 })
  const [spotEurPerGram, setSpotEurPerGram] = useState(null)
  const [spotUpdatedAt, setSpotUpdatedAt]   = useState('')
  const [spotLoading, setSpotLoading]       = useState(false)
  const [spotError, setSpotError]           = useState('')
  const spotAutoApplied = useRef(false)

  const fetchSpot = async (force = false) => {
    setSpotLoading(true); setSpotError('')
    try {
      const url = `/api/gold-spot-price${force ? '?force=1' : ''}`
      const d = await fetch(url).then(r => r.ok ? r.json() : Promise.reject(r))
      setSpotEurPerGram(n(d.eur_per_gram) || null)
      setSpotUpdatedAt(d.updated_at || '')
      return n(d.eur_per_gram) || null
    } catch {
      setSpotError('nuk arritëm çmimin online')
      return null
    } finally { setSpotLoading(false) }
  }

  useEffect(() => {
    let cancel = false
    async function init() {
      try {
        const ratesRes = await fetch(`/api/exchange-rates/${date}`).then(r => r.json())
        if (cancel) return
        setAllRates(ratesRes.rates || { LEK: 1 })
        setRateSource(ratesRes.source || '')
        if (purchaseId) {
          const p = await fetch(`/api/has-purchases/${purchaseId}`).then(r => r.json())
          if (cancel) return
          setPurchaseNo(p.purchase_no || '')
          setPurchaseDate(p.date || date)
          setSupplierName(p.supplier_name || '')
          setSupplierNipt(p.supplier_nipt || '')
          setGram(p.gram != null ? String(p.gram) : '')
          setPricePerGram(p.price_per_gram != null ? String(p.price_per_gram) : '')
          setExchangeRate(p.exchange_rate || 1)
          setNotes(p.notes || '')
        } else {
          setPurchaseDate(date)
          const r = await fetch(`/api/has-purchases/next-no?date=${date}`).then(r => r.json())
          if (cancel) return
          setPurchaseNo(r.purchase_no || '')
        }
      } finally { if (!cancel) setLoading(false) }
    }
    init()
    fetchSpot()
    return () => { cancel = true }
  }, [date, purchaseId])

  useEffect(() => {
    if (loading || !purchaseDate) return
    let cancel = false
    async function syncForDate() {
      try {
        const ratesRes = await fetch(`/api/exchange-rates/${purchaseDate}`).then(r => r.json())
        if (cancel) return
        setAllRates(ratesRes.rates || { LEK: 1 })
        setRateSource(ratesRes.source || '')
        if (!purchaseId) {
          const r = await fetch(`/api/has-purchases/next-no?date=${purchaseDate}`).then(r => r.json())
          if (cancel) return
          setPurchaseNo(r.purchase_no || '')
        }
      } catch { /* ignore */ }
    }
    syncForDate()
    return () => { cancel = true }
  }, [purchaseDate])

  useEffect(() => {
    if (allRates && allRates.EUR != null) setExchangeRate(allRates.EUR)
  }, [allRates])

  const totalEur = +(n(gram) * n(pricePerGram)).toFixed(2)
  const totalLek = +(totalEur * (n(exchangeRate) || 1)).toFixed(2)

  const save = async () => {
    if (saving) return
    if (n(gram) <= 0) { alert('Vendos sasinë në gram HAS.'); return }
    if (n(pricePerGram) <= 0) { alert('Vendos çmimin për gram.'); return }
    setSaving(true)
    try {
      const payload = {
        date: purchaseDate,
        purchase_no: purchaseNo,
        supplier_name: supplierName,
        supplier_nipt: supplierNipt,
        gram: n(gram),
        price_per_gram: n(pricePerGram),
        currency: 'EUR',
        exchange_rate: n(exchangeRate) || 1,
        total_amount: totalEur,
        notes,
      }
      const url = purchaseId ? `/api/has-purchases/${purchaseId}` : '/api/has-purchases'
      const method = purchaseId ? 'PUT' : 'POST'
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
    return <div className="card p-8 text-center text-slate-400 dark:text-slate-500">Duke ngarkuar...</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="btn-secondary">← Mbrapa</button>
          <div>
            <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">
              {purchaseId ? 'Edito Blerjen e HAS' : 'Blerje HAS e Re'}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">Nr. {purchaseNo}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="btn-secondary">Anulo</button>
          <button onClick={save} disabled={saving} className="btn-primary disabled:opacity-50">
            {saving ? '⏳ Duke ruajtur...' : '💾 Ruaj Blerjen'}
          </button>
        </div>
      </div>

      <div className="card grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <label className="form-label">Nr. Blerjeje <span className="text-[10px] text-slate-400 dark:text-slate-500">(auto)</span></label>
          <input type="text" value={purchaseNo} readOnly className="input-field font-mono bg-slate-50 dark:bg-slate-900 cursor-not-allowed" />
        </div>
        <div>
          <label className="form-label">Datë</label>
          <input type="date" value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)} className="input-field" />
        </div>
        <div className="col-span-2">
          <SupplierPicker
            value={{ name: supplierName, nipt: supplierNipt }}
            onChange={(s) => { setSupplierName(s.name || ''); setSupplierNipt(s.nipt || '') }}
          />
        </div>

        <div>
          <label className="form-label">Sasia HAS (Gram)</label>
          <input type="number" step="0.001" min="0"
            value={gram}
            onChange={async e => {
              const v = e.target.value
              setGram(v)
              if (!purchaseId && !spotAutoApplied.current && v && n(v) > 0 && !pricePerGram) {
                spotAutoApplied.current = true
                const cached = spotEurPerGram ?? await fetchSpot()
                if (cached) setPricePerGram(String(cached))
              }
            }}
            className="input-field tabular-nums font-semibold text-amber-700 dark:text-amber-300" placeholder="p.sh. 1000" />
        </div>
        <div>
          <label className="form-label flex items-center justify-between">
            <span>Çmimi për Gram (EUR)</span>
            <button
              type="button"
              onClick={async () => {
                const fresh = await fetchSpot(true)
                if (fresh) setPricePerGram(String(fresh))
              }}
              disabled={spotLoading}
              className="text-[10px] px-2 py-0.5 rounded bg-amber-100 hover:bg-amber-200 text-amber-800 dark:text-amber-200 font-semibold disabled:opacity-50"
              title="Rifresko dhe vendos çmimin aktual spot"
            >
              {spotLoading ? '⏳' : '🔄 Spot'}
            </button>
          </label>
          <MoneyInput
            value={pricePerGram} onChange={v => setPricePerGram(String(v))}
            className="input-field tabular-nums" placeholder="0.00" />
          {spotEurPerGram && (
            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
              Spot aktual: <b className="text-amber-700 dark:text-amber-300">{spotEurPerGram.toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR/g</b>
              {spotUpdatedAt && <span className="ml-1 text-slate-400 dark:text-slate-500">· {new Date(spotUpdatedAt).toLocaleTimeString('sq-AL', { hour: '2-digit', minute: '2-digit' })}</span>}
            </p>
          )}
          {spotError && <p className="text-[10px] text-red-600 mt-0.5">{spotError}</p>}
        </div>
        <div className="col-span-2 md:col-span-4 grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-semibold">Totali për Pagesë (EUR)</label>
            <div className="input-field bg-emerald-50 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-200 border-emerald-200 tabular-nums font-bold text-base">
              {fmt(totalEur)}
            </div>
          </div>
          <div>
            <label className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-semibold">
              Ekuivalent në LEK
              <span className="ml-1 text-slate-400 dark:text-slate-500 normal-case">(1 EUR = {n(exchangeRate).toLocaleString('sq-AL')} LEK · {rateSource || '—'})</span>
            </label>
            <div className="input-field bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-200 tabular-nums font-bold text-base">
              {fmt(totalLek)}
            </div>
          </div>
        </div>

        <div className="col-span-2 md:col-span-4">
          <label className="form-label">Shënime</label>
          <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
            className="input-field" placeholder="opsional (p.sh. lloji i artikujve, numri i copëve, etj.)" />
        </div>
      </div>

      <div className="card bg-amber-50 dark:bg-amber-900/30 border-amber-200">
        <p className="text-xs text-amber-800 dark:text-amber-200">
          <b>💡 Kujdes:</b> Kjo blerje prej <b>{fmt(totalEur)} EUR</b> do zbritet nga arka ditore (monedha EUR).
          Sasia <b>{fmtGram(gram || 0)} gram HAS</b> qëndron si stok grupor — më vonë do të ndahet copë-copë,
          do të peshohet secili artikull dhe do të kalojë te produktet.
        </p>
      </div>
    </div>
  )
}

export default function BlerjeHas({ date }) {
  const [mode, setMode] = useState('list')
  const [editingId, setEditingId] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const openPurchase = (id) => { setEditingId(id); setMode('edit') }
  const createNew    = ()   => { setEditingId(null); setMode('edit') }
  const backToList   = ()   => { setEditingId(null); setMode('list') }
  const onSaved      = ()   => { setRefreshKey(k => k + 1); backToList() }

  const deletePurchase = async (id, no) => {
    if (!confirm(`Fshi blerjen HAS ${no}?`)) return
    await fetch(`/api/has-purchases/${id}`, { method: 'DELETE' })
    setRefreshKey(k => k + 1)
  }

  if (mode === 'edit') {
    return <HasEditor date={date} purchaseId={editingId} onClose={backToList} onSaved={onSaved} />
  }
  return (
    <HasList
      date={date}
      onOpen={openPurchase}
      onCreate={createNew}
      onDelete={deletePurchase}
      refreshKey={refreshKey}
    />
  )
}
