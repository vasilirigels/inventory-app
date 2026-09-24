import { useCallback, useEffect, useMemo, useState } from 'react'
import { getUser } from '../lib/auth.js'
import { useRealtimeSync } from '../hooks/useRealtimeSync.js'
import { showConfirm } from './ConfirmDialog.jsx'
import MoneyInput from './MoneyInput.jsx'

const MONTH_NAMES = [
  'Janar', 'Shkurt', 'Mars', 'Prill', 'Maj', 'Qershor',
  'Korrik', 'Gusht', 'Shtator', 'Tetor', 'Nëntor', 'Dhjetor'
]

function todayISO() { return new Date().toISOString().slice(0, 10) }
// Muaji i mëparshëm — përdoret si default kur regjistron pagë, sepse
// zakonisht paguhet pas mbylljes së muajit.
function previousMonth() {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1)
  return d.toISOString().slice(0, 7)
}
// Zhvendos një muaj YYYY-MM me ±N muaj. Përdoret nga toggle-i i statusit mujor.
function shiftMonth(m, delta) {
  if (!/^\d{4}-\d{2}$/.test(m)) return m
  const [y, mo] = m.split('-').map(n => parseInt(n, 10))
  const d = new Date(y, mo - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function fmtEUR(n) {
  const v = parseFloat(n) || 0
  return v.toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function monthLabel(m) {
  if (!m || !/^\d{4}-\d{2}$/.test(m)) return m || '—'
  const [y, mo] = m.split('-')
  return `${MONTH_NAMES[parseInt(mo, 10) - 1] || mo} ${y}`
}
function paymentTotal(p) {
  return (parseFloat(p.salary_bank_eur) || 0)
       + (parseFloat(p.salary_cash_eur) || 0)
       + (parseFloat(p.bonus_bank_eur)  || 0)
       + (parseFloat(p.bonus_cash_eur)  || 0)
}

// ── Modal: shto/edito punëtor ─────────────────────────────────────────────
function WorkerModal({ worker, onClose, onSaved }) {
  const [name, setName]     = useState(worker?.name || '')
  const [position, setPos]  = useState(worker?.position || '')
  const [base, setBase]     = useState(worker?.base_salary_eur ?? '')
  const [active, setActive] = useState(worker ? !!worker.active : true)
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState('')

  const submit = async (e) => {
    e.preventDefault()
    if (!name.trim()) { setErr('Emri është i detyrueshëm'); return }
    setSaving(true); setErr('')
    try {
      const payload = {
        name: name.trim(),
        position: position.trim(),
        base_salary_eur: parseFloat(base) || 0,
        active: active ? 1 : 0,
      }
      const url = worker?.id ? `/api/workers/${worker.id}` : '/api/workers'
      const method = worker?.id ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Gabim')
      onSaved?.()
    } catch (ex) {
      setErr(ex.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md">
        <div className="modal-header">
          <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">
            {worker?.id ? `Edito Punëtorin` : '+ Punëtor i Ri'}
          </h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 dark:text-slate-500 text-xl">×</button>
        </div>
        <form onSubmit={submit}>
          <div className="p-6 space-y-3">
            <div>
              <label className="form-label">Emri *</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)}
                className="input-field" placeholder="p.sh. Enea Krasniqi" autoFocus />
            </div>
            <div>
              <label className="form-label">Pozicioni</label>
              <input type="text" value={position} onChange={e => setPos(e.target.value)}
                className="input-field" placeholder="p.sh. Shitëse, Argjendari" />
            </div>
            <div>
              <label className="form-label">Paga Bazë Mujore (EUR)</label>
              <MoneyInput value={base} onChange={setBase}
                className="input-field text-right font-semibold tabular-nums" placeholder="0.00" />
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                Vetëm referencë — shuma e pagesës reale vendoset për çdo muaj.
              </p>
            </div>
            <div>
              <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
                <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)}
                  className="w-4 h-4 accent-emerald-500" />
                <span>Aktiv (punon aktualisht)</span>
              </label>
            </div>
            {err && <p className="text-sm text-red-600">{err}</p>}
          </div>
          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn-secondary">Anulo</button>
            <button type="submit" disabled={saving} className="btn-primary disabled:opacity-50">
              {saving ? 'Duke ruajtur…' : (worker?.id ? '💾 Ruaj' : '+ Shto')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Modal: regjistro/edito pagesë ─────────────────────────────────────────
function PaymentModal({ payment, workers, defaultWorkerId, onClose, onSaved, onEditExisting }) {
  const [workerId, setWorkerId] = useState(payment?.worker_id || defaultWorkerId || (workers[0]?.id ?? ''))
  const [month, setMonth]       = useState(payment?.month || previousMonth())
  const [datePaid, setDatePaid] = useState(payment?.date_paid || todayISO())
  const [sBank, setSBank]       = useState(payment?.salary_bank_eur ?? '')
  const [sCash, setSCash]       = useState(payment?.salary_cash_eur ?? '')
  const [bBank, setBBank]       = useState(payment?.bonus_bank_eur ?? '')
  const [bCash, setBCash]       = useState(payment?.bonus_cash_eur ?? '')
  const [note, setNote]         = useState(payment?.note || '')
  const [saving, setSaving]     = useState(false)
  const [err, setErr]           = useState('')
  // Detektim i pagesave ekzistuese për (worker, muaj) — vetëm në modin krijim,
  // që admini të mos regjistrojë padashje pagesë të dytë kur kishte harruar.
  const [existing, setExisting] = useState([])

  useEffect(() => {
    if (payment?.id) return  // edit mode — asnjë kontroll
    if (!workerId || !/^\d{4}-\d{2}$/.test(month)) { setExisting([]); return }
    let cancelled = false
    const params = new URLSearchParams({ worker_id: String(workerId), month })
    fetch(`/api/worker-payments?${params}`)
      .then(r => r.ok ? r.json() : [])
      .then(data => { if (!cancelled) setExisting(Array.isArray(data) ? data : []) })
      .catch(() => { if (!cancelled) setExisting([]) })
    return () => { cancelled = true }
  }, [workerId, month, payment?.id])

  const worker = workers.find(w => w.id === parseInt(workerId))
  const total = (parseFloat(sBank) || 0) + (parseFloat(sCash) || 0)
              + (parseFloat(bBank) || 0) + (parseFloat(bCash) || 0)

  // Ndihmës: mbush pagën bazë (bank + kesh 0), user rregullon më pas.
  const fillFromBase = () => {
    if (!worker) return
    setSBank(String(worker.base_salary_eur || 0))
    setSCash('')
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!workerId) { setErr('Zgjidh punëtorin'); return }
    if (!/^\d{4}-\d{2}$/.test(month)) { setErr('Formati i muajit: YYYY-MM'); return }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datePaid)) { setErr('Formati i datës: YYYY-MM-DD'); return }
    if (total <= 0) { setErr('Vendos të paktën një shumë > 0'); return }
    setSaving(true); setErr('')
    try {
      const payload = {
        worker_id: parseInt(workerId),
        month,
        date_paid: datePaid,
        salary_bank_eur: parseFloat(sBank) || 0,
        salary_cash_eur: parseFloat(sCash) || 0,
        bonus_bank_eur:  parseFloat(bBank) || 0,
        bonus_cash_eur:  parseFloat(bCash) || 0,
        note: note.trim(),
      }
      const url = payment?.id ? `/api/worker-payments/${payment.id}` : '/api/worker-payments'
      const method = payment?.id ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Gabim')
      onSaved?.()
    } catch (ex) {
      setErr(ex.message)
    } finally {
      setSaving(false)
    }
  }

  const buckets = [
    { key: 'sBank', label: 'Paga · Bankë',   val: sBank, set: setSBank, color: 'text-indigo-700 dark:text-indigo-300' },
    { key: 'sCash', label: 'Paga · Kesh',    val: sCash, set: setSCash, color: 'text-emerald-700 dark:text-emerald-300' },
    { key: 'bBank', label: 'Shpërblim · Bankë', val: bBank, set: setBBank, color: 'text-violet-700 dark:text-violet-300' },
    { key: 'bCash', label: 'Shpërblim · Kesh',  val: bCash, set: setBCash, color: 'text-amber-700 dark:text-amber-300' },
  ]

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="modal-header">
          <div>
            <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">
              {payment?.id ? 'Edito Pagesën' : '+ Regjistro Pagesë'}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Të gjitha shumat në EUR. Pjesa kesh shfaqet te Arka Ditore; pjesa bankë zbritet nga banka.
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 dark:text-slate-500 text-xl">×</button>
        </div>
        <form onSubmit={submit}>
          <div className="p-6 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-1">
                <label className="form-label">Punëtori *</label>
                <select value={workerId} onChange={e => setWorkerId(e.target.value)} className="input-field">
                  <option value="">— zgjidh —</option>
                  {workers.map(w => (
                    <option key={w.id} value={w.id}>
                      {w.name}{w.position ? ` (${w.position})` : ''}{!w.active ? ' [joaktiv]' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label">Muaji i Pagës *</label>
                <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="input-field" />
              </div>
              <div>
                <label className="form-label">Data e Pagesës *</label>
                <input type="date" value={datePaid} onChange={e => setDatePaid(e.target.value)} className="input-field" />
              </div>
            </div>

            {worker && (worker.base_salary_eur || 0) > 0 && !payment?.id && (
              <div className="flex items-center justify-between rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 px-3 py-2">
                <span className="text-xs text-blue-900 dark:text-blue-100">
                  Paga bazë e {worker.name}: <b>{fmtEUR(worker.base_salary_eur)} EUR</b>
                </span>
                <button type="button" onClick={fillFromBase}
                  className="text-xs font-semibold text-blue-700 dark:text-blue-300 hover:underline">
                  Mbush → Bankë
                </button>
              </div>
            )}

            {!payment?.id && existing.length > 0 && (
              <div className="rounded-lg border-2 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-3 py-3">
                <div className="flex items-start gap-2">
                  <span className="text-lg leading-none pt-0.5">⚠️</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-amber-900 dark:text-amber-100">
                      Pagesa ekziston tashmë për {monthLabel(month)}
                    </p>
                    <p className="text-xs text-amber-800 dark:text-amber-200 mt-1">
                      {worker?.name} ka <b>{existing.length}</b> pagesa për këtë muaj — total{' '}
                      <b>{fmtEUR(existing.reduce((s, e) => s + paymentTotal(e), 0))} EUR</b>.
                      Ruajtja e kësaj do të shtohet si <b>pagesë parciale/e dytë</b>.
                    </p>
                    {existing.length === 1 && onEditExisting && (
                      <button
                        type="button"
                        onClick={() => onEditExisting(existing[0])}
                        className="mt-2 text-xs font-semibold text-amber-800 dark:text-amber-200 hover:underline"
                      >
                        ✎ Edito pagesën ekzistuese në vend të kësaj →
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div>
              <label className="form-label">Ndarja e Pagesës (EUR)</label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {buckets.map(b => (
                  <div key={b.key} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                    <label className={`text-[11px] font-bold uppercase ${b.color}`}>{b.label}</label>
                    <MoneyInput value={b.val} onChange={b.set}
                      className="input-field text-right font-semibold tabular-nums mt-1"
                      placeholder="0.00" />
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between rounded-lg bg-slate-100 dark:bg-slate-900 px-3 py-2">
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Total i Pagesës</span>
                <span className="text-lg font-extrabold text-slate-800 dark:text-slate-100 tabular-nums">
                  {fmtEUR(total)} EUR
                </span>
              </div>
            </div>

            <div>
              <label className="form-label">Shënim (opsional)</label>
              <input type="text" value={note} onChange={e => setNote(e.target.value)}
                className="input-field" placeholder="p.sh. sezoni i festave, bonus performance" />
            </div>

            {err && <p className="text-sm text-red-600">{err}</p>}
          </div>
          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn-secondary">Anulo</button>
            <button type="submit" disabled={saving || total <= 0} className="btn-primary disabled:opacity-50">
              {saving ? 'Duke ruajtur…' : (payment?.id ? '💾 Ruaj' : '+ Regjistro')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Faqja kryesore ───────────────────────────────────────────────────────
export default function PagesaPunetoresh() {
  const isAdmin = getUser()?.role === 'admin'
  const [tab, setTab] = useState('payments') // 'payments' | 'workers'
  const [workers, setWorkers]           = useState([])
  const [payments, setPayments]         = useState([])
  const [loading, setLoading]           = useState(true)
  const [workerModal, setWorkerModal]   = useState(null)
  const [paymentModal, setPaymentModal] = useState(null)
  const [historyWorker, setHistoryWorker] = useState(null)
  const [filterWorker, setFilterWorker] = useState('')
  const [filterMonth, setFilterMonth]   = useState('')
  // Muaji për të cilin kontrollohet statusi i pagesave (default: muaji i mëparshëm).
  const [statusMonth, setStatusMonth]   = useState(() => previousMonth())
  const [statusPayments, setStatusPayments] = useState([])

  const loadWorkers = useCallback(async () => {
    try {
      const res = await fetch('/api/workers?all=1')
      const data = await res.json()
      setWorkers(Array.isArray(data) ? data : [])
    } catch (_) { setWorkers([]) }
  }, [])

  const loadPayments = useCallback(async () => {
    const params = new URLSearchParams()
    if (filterWorker) params.set('worker_id', filterWorker)
    if (filterMonth)  params.set('month', filterMonth)
    try {
      const res = await fetch(`/api/worker-payments${params.toString() ? `?${params}` : ''}`)
      const data = await res.json()
      setPayments(Array.isArray(data) ? data : [])
    } catch (_) { setPayments([]) }
  }, [filterWorker, filterMonth])

  // Ngarko pagesat për muajin e statusit — pavarësisht nga filtrat e listës,
  // që matrica lart të tregojë gjithmonë të plotë atë muaj.
  const loadStatusPayments = useCallback(async () => {
    if (!/^\d{4}-\d{2}$/.test(statusMonth)) { setStatusPayments([]); return }
    try {
      const res = await fetch(`/api/worker-payments?month=${statusMonth}`)
      const data = await res.json()
      setStatusPayments(Array.isArray(data) ? data : [])
    } catch (_) { setStatusPayments([]) }
  }, [statusMonth])

  const reload = useCallback(async () => {
    setLoading(true)
    await Promise.all([loadWorkers(), loadPayments(), loadStatusPayments()])
    setLoading(false)
  }, [loadWorkers, loadPayments, loadStatusPayments])

  useEffect(() => { reload() }, [reload])
  useRealtimeSync(['workers', 'worker_payments'], reload)

  const activeWorkers = useMemo(() => workers.filter(w => w.active), [workers])

  const deleteWorker = async (w) => {
    const ok = await showConfirm(
      `Do të fshihet "${w.name}". Nëse ka pagesa të regjistruara, do t'ju bllokohet — përdor "Çaktivizo" në vend të fshirjes.`,
      { title: 'Fshi punëtorin?', confirmLabel: 'Fshi', danger: true },
    )
    if (!ok) return
    const res = await fetch(`/api/workers/${w.id}`, { method: 'DELETE' })
    if (!res.ok) {
      const e = await res.json().catch(() => ({}))
      alert(e.error || 'Gabim')
      return
    }
    reload()
  }

  const toggleActive = async (w) => {
    const res = await fetch(`/api/workers/${w.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...w, active: w.active ? 0 : 1 }),
    })
    if (!res.ok) {
      const e = await res.json().catch(() => ({}))
      alert(e.error || 'Gabim')
      return
    }
    reload()
  }

  const deletePayment = async (p) => {
    const ok = await showConfirm(
      `Pagesa e ${p.worker_name} për ${monthLabel(p.month)} — ${fmtEUR(paymentTotal(p))} EUR.`,
      { title: 'Fshi pagesën?', confirmLabel: 'Fshi', danger: true },
    )
    if (!ok) return
    const res = await fetch(`/api/worker-payments/${p.id}`, { method: 'DELETE' })
    if (!res.ok) {
      const e = await res.json().catch(() => ({}))
      alert(e.error || 'Gabim')
      return
    }
    reload()
  }

  // Përmbledhje totale për setin aktual të pagesave (respekton filtrat).
  const summary = useMemo(() => {
    const s = { salary_bank: 0, salary_cash: 0, bonus_bank: 0, bonus_cash: 0, total: 0, count: payments.length }
    for (const p of payments) {
      s.salary_bank += parseFloat(p.salary_bank_eur) || 0
      s.salary_cash += parseFloat(p.salary_cash_eur) || 0
      s.bonus_bank  += parseFloat(p.bonus_bank_eur)  || 0
      s.bonus_cash  += parseFloat(p.bonus_cash_eur)  || 0
    }
    s.total = s.salary_bank + s.salary_cash + s.bonus_bank + s.bonus_cash
    return s
  }, [payments])

  // Statusi për muajin e zgjedhur — një rresht për çdo punëtor aktiv, me
  // pagesat e agregara (nëse ka) ose flag "s'është paguar".
  const statusRows = useMemo(() => {
    const byWorker = new Map()
    for (const p of statusPayments) {
      if (!byWorker.has(p.worker_id)) byWorker.set(p.worker_id, [])
      byWorker.get(p.worker_id).push(p)
    }
    return activeWorkers.map(w => {
      const list = byWorker.get(w.id) || []
      const total = list.reduce((s, p) => s + paymentTotal(p), 0)
      return { worker: w, payments: list, total, paid: list.length > 0 }
    })
  }, [activeWorkers, statusPayments])

  const statusSummary = useMemo(() => {
    const paidCount = statusRows.filter(r => r.paid).length
    const totalEUR  = statusRows.reduce((s, r) => s + r.total, 0)
    return { paidCount, unpaidCount: statusRows.length - paidCount, totalEUR }
  }, [statusRows])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">👷 Pagesa Punëtorësh</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Regjistër i punëtorëve dhe pagesave mujore (paga + shpërblime, kesh + bankë).
          </p>
        </div>
        <div className="flex items-center gap-2">
          {tab === 'workers' && (
            <button onClick={() => setWorkerModal({})} className="btn-primary">+ Punëtor i Ri</button>
          )}
          {tab === 'payments' && (
            <button
              onClick={() => setPaymentModal({})}
              disabled={activeWorkers.length === 0}
              className="btn-primary disabled:opacity-50"
              title={activeWorkers.length === 0 ? 'Shto një punëtor së pari' : ''}
            >+ Regjistro Pagesë</button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-700">
        {[
          { id: 'payments', label: '💶 Pagesat', count: payments.length },
          { id: 'workers',  label: '👥 Punëtorët', count: workers.length },
        ].map(t => {
          const active = tab === t.id
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition ${
                active
                  ? 'border-amber-500 text-amber-700 dark:text-amber-300'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}>
              {t.label} <span className="text-[10px] opacity-70">({t.count})</span>
            </button>
          )
        })}
      </div>

      {loading ? (
        <div className="card p-8 text-center text-slate-400 dark:text-slate-500 text-sm">Duke ngarkuar…</div>
      ) : tab === 'workers' ? (
        <div className="card p-0 overflow-hidden">
          {workers.length === 0 ? (
            <div className="p-10 text-center">
              <div className="text-5xl mb-3">👷</div>
              <p className="text-slate-500 dark:text-slate-400 mb-4">Nuk ka punëtorë të regjistruar.</p>
              <button onClick={() => setWorkerModal({})} className="btn-primary mx-auto">+ Punëtori i Parë</button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Emri</th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Pozicioni</th>
                    <th className="px-3 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Paga Bazë (EUR)</th>
                    <th className="px-3 py-3 text-center text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Statusi</th>
                    <th className="px-3 py-3 text-center text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Veprime</th>
                  </tr>
                </thead>
                <tbody>
                  {workers.map(w => (
                    <tr key={w.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="px-3 py-3 font-semibold text-slate-800 dark:text-slate-100">{w.name}</td>
                      <td className="px-3 py-3 text-slate-600 dark:text-slate-300">
                        {w.position || <span className="italic text-slate-400 dark:text-slate-500">—</span>}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums font-semibold text-slate-800 dark:text-slate-100">
                        {fmtEUR(w.base_salary_eur)}
                      </td>
                      <td className="px-3 py-3 text-center">
                        {w.active
                          ? <span className="badge bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200">● Aktiv</span>
                          : <span className="badge bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">○ Joaktiv</span>}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-center gap-1 flex-wrap">
                          <button onClick={() => setHistoryWorker(w)}
                            className="px-2 py-1 rounded-lg bg-violet-50 dark:bg-violet-900/30 hover:bg-violet-100 text-violet-700 dark:text-violet-300 text-[10px] font-semibold"
                            title="Historiku i pagave">📊 Historia</button>
                          <button onClick={() => { setPaymentModal({}); setFilterWorker(String(w.id)) }}
                            className="px-2 py-1 rounded-lg bg-amber-50 dark:bg-amber-900/30 hover:bg-amber-100 text-amber-700 dark:text-amber-300 text-[10px] font-semibold"
                            title="Regjistro pagesë për këtë punëtor">💶 Paguaj</button>
                          <button onClick={() => setWorkerModal(w)}
                            className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-[10px] font-semibold">Edito</button>
                          <button onClick={() => toggleActive(w)}
                            className="px-2 py-1 rounded-lg bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 text-blue-700 dark:text-blue-300 text-[10px] font-semibold">
                            {w.active ? 'Çaktivizo' : 'Aktivizo'}
                          </button>
                          {isAdmin && (
                            <button onClick={() => deleteWorker(w)}
                              className="px-2 py-1 rounded-lg bg-red-50 dark:bg-red-900/30 hover:bg-red-100 text-red-600 text-[10px] font-semibold">Fshi</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Matrica: statusi i pagesave për muajin e zgjedhur */}
          {activeWorkers.length > 0 && (
            <div className="card">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                    📅 Statusi për {monthLabel(statusMonth)}
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {statusSummary.paidCount}/{statusRows.length} të paguar · Total{' '}
                    <b className="text-slate-700 dark:text-slate-200">{fmtEUR(statusSummary.totalEUR)} EUR</b>
                    {statusSummary.unpaidCount > 0 && (
                      <span className="ml-2 text-red-600 dark:text-red-400 font-semibold">
                        · {statusSummary.unpaidCount} pa paguar
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setStatusMonth(m => shiftMonth(m, -1))}
                    className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-sm font-bold"
                    title="Muaji i mëparshëm">‹</button>
                  <input type="month" value={statusMonth}
                    onChange={e => setStatusMonth(e.target.value || previousMonth())}
                    className="input-field !py-1 !text-xs w-auto" />
                  <button onClick={() => setStatusMonth(m => shiftMonth(m, +1))}
                    className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-sm font-bold"
                    title="Muaji tjetër">›</button>
                  <button onClick={() => setStatusMonth(previousMonth())}
                    className="ml-1 px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-[10px] font-semibold uppercase"
                    title="Kthehu te muaji i mëparshëm">↺</button>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {statusRows.map(({ worker: w, payments: ps, total, paid }) => (
                  <div key={w.id}
                    className={`rounded-lg border-2 px-3 py-2 flex items-center justify-between gap-2 ${
                      paid
                        ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/20'
                        : 'border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/20'
                    }`}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-xs ${paid ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
                          {paid ? '✓' : '✗'}
                        </span>
                        <span className="font-semibold text-sm text-slate-800 dark:text-slate-100 truncate">{w.name}</span>
                      </div>
                      {paid ? (
                        <div className="text-[11px] text-slate-600 dark:text-slate-300 tabular-nums">
                          <b>{fmtEUR(total)} EUR</b>
                          {ps.length > 1 && <span className="opacity-70"> · {ps.length} pagesa</span>}
                          {(w.base_salary_eur || 0) > 0 && total !== w.base_salary_eur && (
                            <span className={`ml-1 text-[10px] ${total > w.base_salary_eur ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                              ({total > w.base_salary_eur ? '+' : ''}{fmtEUR(total - w.base_salary_eur)})
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="text-[11px] text-red-700 dark:text-red-300 font-semibold">S'është paguar</div>
                      )}
                    </div>
                    {!paid && (
                      <button
                        onClick={() => { setPaymentModal({}); setFilterWorker(String(w.id)) }}
                        className="px-2 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-white text-[10px] font-bold whitespace-nowrap"
                        title={`Regjistro pagesë për ${w.name}`}
                      >💶 Paguaj</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Filtra për pagesat */}
          <div className="card">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="form-label">Filtro sipas Punëtorit</label>
                <select value={filterWorker} onChange={e => setFilterWorker(e.target.value)} className="input-field">
                  <option value="">— të gjithë —</option>
                  {workers.map(w => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label">Filtro sipas Muajit</label>
                <input type="month" value={filterMonth} onChange={e => setFilterMonth(e.target.value)} className="input-field" />
              </div>
              <div className="flex items-end">
                <button onClick={() => { setFilterWorker(''); setFilterMonth('') }}
                  className="btn-secondary w-full">↺ Pastro filtrat</button>
              </div>
            </div>
          </div>

          {/* Përmbledhje */}
          {payments.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              <SummaryTile label="Paga · Bankë" value={summary.salary_bank} color="text-indigo-700 dark:text-indigo-300" />
              <SummaryTile label="Paga · Kesh"  value={summary.salary_cash} color="text-emerald-700 dark:text-emerald-300" />
              <SummaryTile label="Shpërblim · Bankë" value={summary.bonus_bank} color="text-violet-700 dark:text-violet-300" />
              <SummaryTile label="Shpërblim · Kesh"  value={summary.bonus_cash} color="text-amber-700 dark:text-amber-300" />
              <SummaryTile label={`Total (${summary.count})`} value={summary.total} bold />
            </div>
          )}

          {/* Lista e pagesave */}
          <div className="card p-0 overflow-hidden">
            {payments.length === 0 ? (
              <div className="p-10 text-center">
                <div className="text-5xl mb-3">💶</div>
                <p className="text-slate-500 dark:text-slate-400 mb-4">
                  {filterWorker || filterMonth ? 'Asnjë pagesë s\'përputhet me filtrin.' : 'Nuk ka pagesa të regjistruara.'}
                </p>
                {activeWorkers.length > 0 && !filterWorker && !filterMonth && (
                  <button onClick={() => setPaymentModal({})} className="btn-primary mx-auto">+ Pagesa e Parë</button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
                    <tr>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Data</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Punëtori</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Muaji</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Paga (B)</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Paga (K)</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Bonus (B)</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Bonus (K)</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Total EUR</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Shënim</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Veprime</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map(p => {
                      const tot = paymentTotal(p)
                      return (
                        <tr key={p.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <td className="px-3 py-3 text-slate-600 dark:text-slate-300 text-xs whitespace-nowrap">{p.date_paid}</td>
                          <td className="px-3 py-3">
                            <div className="font-semibold text-slate-800 dark:text-slate-100">{p.worker_name}</div>
                            {p.worker_position && <div className="text-[11px] text-slate-500 dark:text-slate-400">{p.worker_position}</div>}
                          </td>
                          <td className="px-3 py-3 text-slate-700 dark:text-slate-200 text-xs whitespace-nowrap">{monthLabel(p.month)}</td>
                          <Cell v={p.salary_bank_eur} color="text-indigo-700 dark:text-indigo-300" />
                          <Cell v={p.salary_cash_eur} color="text-emerald-700 dark:text-emerald-300" />
                          <Cell v={p.bonus_bank_eur}  color="text-violet-700 dark:text-violet-300" />
                          <Cell v={p.bonus_cash_eur}  color="text-amber-700 dark:text-amber-300" />
                          <td className="px-3 py-3 text-right tabular-nums font-extrabold text-slate-800 dark:text-slate-100 whitespace-nowrap">
                            {fmtEUR(tot)}
                          </td>
                          <td className="px-3 py-3 text-slate-600 dark:text-slate-300 text-xs max-w-xs">
                            {p.note || <span className="italic text-slate-400 dark:text-slate-500">—</span>}
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex items-center justify-center gap-1">
                              <button onClick={() => setPaymentModal(p)}
                                className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-[10px] font-semibold">Edito</button>
                              {isAdmin && (
                                <button onClick={() => deletePayment(p)}
                                  className="px-2 py-1 rounded-lg bg-red-50 dark:bg-red-900/30 hover:bg-red-100 text-red-600 text-[10px] font-semibold">Fshi</button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {workerModal && (
        <WorkerModal
          worker={workerModal.id ? workerModal : null}
          onClose={() => setWorkerModal(null)}
          onSaved={() => { setWorkerModal(null); reload() }}
        />
      )}

      {paymentModal && (
        <PaymentModal
          key={paymentModal.id || 'new'}
          payment={paymentModal.id ? paymentModal : null}
          workers={workers}
          defaultWorkerId={filterWorker || null}
          onClose={() => setPaymentModal(null)}
          onSaved={() => { setPaymentModal(null); reload() }}
          onEditExisting={(p) => setPaymentModal(p)}
        />
      )}

      {historyWorker && (
        <WorkerHistoryModal
          worker={historyWorker}
          onClose={() => setHistoryWorker(null)}
          onEditPayment={(p) => { setHistoryWorker(null); setPaymentModal(p) }}
        />
      )}
    </div>
  )
}

// ── Modal: Historia e pagesave për një punëtor ────────────────────────────
function WorkerHistoryModal({ worker, onClose, onEditPayment }) {
  const [payments, setPayments] = useState([])
  const [loading, setLoading]   = useState(true)
  const [year, setYear]         = useState(new Date().getFullYear())

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/worker-payments?worker_id=${worker.id}&limit=2000`)
      .then(r => r.ok ? r.json() : [])
      .then(d => { if (!cancelled) setPayments(Array.isArray(d) ? d : []) })
      .catch(() => { if (!cancelled) setPayments([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [worker.id])

  const years = useMemo(() => {
    const s = new Set(payments.map(p => (p.month || '').slice(0, 4)).filter(Boolean))
    s.add(String(new Date().getFullYear()))
    return [...s].sort().reverse()
  }, [payments])

  const yearPayments = useMemo(
    () => payments.filter(p => (p.month || '').startsWith(String(year))),
    [payments, year]
  )

  // Për vitin e zgjedhur, grupoj sipas muajit. Rreshtat për të 12 muajt që
  // të duket qartë cilët muaj s'kanë pagesë (rreshta bosh).
  const monthlyRows = useMemo(() => {
    const byMonth = new Map()
    for (const p of yearPayments) {
      const m = p.month
      if (!byMonth.has(m)) byMonth.set(m, [])
      byMonth.get(m).push(p)
    }
    const rows = []
    for (let mo = 1; mo <= 12; mo++) {
      const key = `${year}-${String(mo).padStart(2, '0')}`
      const list = byMonth.get(key) || []
      const salary = list.reduce((s, p) => s + (parseFloat(p.salary_bank_eur) || 0) + (parseFloat(p.salary_cash_eur) || 0), 0)
      const bonus  = list.reduce((s, p) => s + (parseFloat(p.bonus_bank_eur)  || 0) + (parseFloat(p.bonus_cash_eur)  || 0), 0)
      rows.push({ month: key, monthName: MONTH_NAMES[mo - 1], list, salary, bonus, total: salary + bonus })
    }
    return rows
  }, [yearPayments, year])

  const yearTotals = useMemo(() => {
    const t = { salary_bank: 0, salary_cash: 0, bonus_bank: 0, bonus_cash: 0 }
    for (const p of yearPayments) {
      t.salary_bank += parseFloat(p.salary_bank_eur) || 0
      t.salary_cash += parseFloat(p.salary_cash_eur) || 0
      t.bonus_bank  += parseFloat(p.bonus_bank_eur)  || 0
      t.bonus_cash  += parseFloat(p.bonus_cash_eur)  || 0
    }
    const total = t.salary_bank + t.salary_cash + t.bonus_bank + t.bonus_cash
    const paidMonths = monthlyRows.filter(r => r.total > 0).length
    const avg = paidMonths > 0 ? total / paidMonths : 0
    return { ...t, total, paidMonths, avg }
  }, [yearPayments, monthlyRows])

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="modal-header">
          <div className="min-w-0">
            <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg truncate">
              📊 Historia — {worker.name}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {worker.position || 'Pa pozicion'}
              {(worker.base_salary_eur || 0) > 0 && (
                <> · Paga bazë <b className="text-slate-700 dark:text-slate-200">{fmtEUR(worker.base_salary_eur)} EUR/muaj</b></>
              )}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 dark:text-slate-500 text-xl">×</button>
        </div>

        <div className="p-6 space-y-4">
          {/* Selektim viti */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Viti:</span>
            {years.map(y => (
              <button key={y} onClick={() => setYear(parseInt(y))}
                className={`px-3 py-1 rounded-lg text-xs font-semibold border transition ${
                  parseInt(y) === year
                    ? 'bg-violet-500 text-white border-violet-500'
                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
                }`}>{y}</button>
            ))}
          </div>

          {/* Totale vjetore */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <SummaryTile label="Paga · Bankë" value={yearTotals.salary_bank} color="text-indigo-700 dark:text-indigo-300" />
            <SummaryTile label="Paga · Kesh"  value={yearTotals.salary_cash} color="text-emerald-700 dark:text-emerald-300" />
            <SummaryTile label="Shpërblim · Bankë" value={yearTotals.bonus_bank} color="text-violet-700 dark:text-violet-300" />
            <SummaryTile label="Shpërblim · Kesh"  value={yearTotals.bonus_cash} color="text-amber-700 dark:text-amber-300" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            <div className="rounded-lg border-2 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3">
              <div className="text-[10px] font-bold uppercase text-amber-800 dark:text-amber-200">Total {year}</div>
              <div className="text-lg font-extrabold text-amber-900 dark:text-amber-100 tabular-nums">
                {fmtEUR(yearTotals.total)} <span className="text-[10px] opacity-60">EUR</span>
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
              <div className="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400">Muaj të paguar</div>
              <div className="text-lg font-bold text-slate-800 dark:text-slate-100 tabular-nums">{yearTotals.paidMonths} / 12</div>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
              <div className="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400">Mesatare / muaj i paguar</div>
              <div className="text-lg font-bold text-slate-800 dark:text-slate-100 tabular-nums">
                {fmtEUR(yearTotals.avg)} <span className="text-[10px] opacity-60">EUR</span>
              </div>
            </div>
          </div>

          {/* Ndarje mujore */}
          {loading ? (
            <p className="text-center text-slate-400 dark:text-slate-500 text-sm py-6">Duke ngarkuar…</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900">
                  <tr>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase">Muaji</th>
                    <th className="px-3 py-2 text-right text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase">Paga</th>
                    <th className="px-3 py-2 text-right text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase">Shpërblim</th>
                    <th className="px-3 py-2 text-right text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase">Total</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase">Detaje</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyRows.map(r => (
                    <tr key={r.month} className={`border-t border-slate-100 dark:border-slate-800 ${r.total === 0 ? 'opacity-50' : ''}`}>
                      <td className="px-3 py-2 font-semibold text-slate-800 dark:text-slate-100 text-xs whitespace-nowrap">
                        {r.monthName}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200 text-xs">
                        {r.salary > 0 ? fmtEUR(r.salary) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-amber-700 dark:text-amber-300 text-xs">
                        {r.bonus > 0 ? fmtEUR(r.bonus) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-bold text-slate-900 dark:text-slate-100 text-xs whitespace-nowrap">
                        {r.total > 0 ? `${fmtEUR(r.total)} EUR` : <span className="text-slate-400 dark:text-slate-600 font-normal">S'ka</span>}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                        {r.list.length === 0 ? (
                          <span className="italic">—</span>
                        ) : (
                          <div className="flex flex-wrap items-center gap-1">
                            {r.list.map(p => (
                              <button
                                key={p.id}
                                onClick={() => onEditPayment?.(p)}
                                className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-[10px] font-medium"
                                title="Klik për të edituar këtë pagesë"
                              >
                                {p.date_paid} · {fmtEUR(paymentTotal(p))}
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="btn-primary">Mbylle</button>
        </div>
      </div>
    </div>
  )
}

function Cell({ v, color }) {
  const n = parseFloat(v) || 0
  return (
    <td className={`px-3 py-3 text-right tabular-nums font-semibold whitespace-nowrap ${n > 0 ? color : 'text-slate-400 dark:text-slate-600'}`}>
      {n > 0 ? fmtEUR(n) : '—'}
    </td>
  )
}

function SummaryTile({ label, value, color = '', bold = false }) {
  return (
    <div className={`rounded-lg border p-3 ${bold ? 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20' : 'border-slate-200 dark:border-slate-700'}`}>
      <div className={`text-[10px] font-bold uppercase tracking-wide ${bold ? 'text-amber-800 dark:text-amber-200' : 'text-slate-500 dark:text-slate-400'}`}>{label}</div>
      <div className={`text-lg tabular-nums ${bold ? 'font-extrabold text-amber-900 dark:text-amber-100' : `font-bold ${color || 'text-slate-800 dark:text-slate-100'}`}`}>
        {fmtEUR(value)} <span className="text-[10px] font-semibold opacity-60">EUR</span>
      </div>
    </div>
  )
}