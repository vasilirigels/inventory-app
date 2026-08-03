import { useState, useEffect, lazy, Suspense } from 'react'
import AuthGate from './components/AuthGate.jsx'
import Layout from './components/Layout.jsx'
import ConfirmDialog from './components/ConfirmDialog.jsx'
import { SECTION_CONFIGS } from './components/sections/sectionConfigs.js'
import { initRealtime } from './utils/realtime.js'

// Route code-splitting: çdo ekran ngarkohet vetëm kur user hap atë faqe.
// Rrit shpejtësinë e ngarkimit të parë — Dashboard i vogël nuk paguan
// koston e FaturaShitje/Products që janë modulet më të mëdha.
const Dashboard              = lazy(() => import('./components/Dashboard.jsx'))
const Products               = lazy(() => import('./components/Products.jsx'))
const ProduktePromocion      = lazy(() => import('./components/ProduktePromocion.jsx'))
const Customers              = lazy(() => import('./components/Customers.jsx'))
const CustomersLedger        = lazy(() => import('./components/CustomersLedger.jsx'))
const Marketing              = lazy(() => import('./components/Marketing.jsx'))
const CashRegister           = lazy(() => import('./components/CashRegister.jsx'))
const ArkaDitore             = lazy(() => import('./components/ArkaDitore.jsx'))
const Kasaforta              = lazy(() => import('./components/Kasaforta.jsx'))
const TerheqjaKasaforta      = lazy(() => import('./components/TerheqjaKasaforta.jsx'))
const LevizjeBanke           = lazy(() => import('./components/LevizjeBanke.jsx'))
const KonvertimHurda         = lazy(() => import('./components/KonvertimHurda.jsx'))
const BlerjeHas              = lazy(() => import('./components/BlerjeHas.jsx'))
const SalesSection           = lazy(() => import('./components/SalesSection.jsx'))
const FaturaShitje           = lazy(() => import('./components/FaturaShitje.jsx'))
const FaturaBlerje           = lazy(() => import('./components/FaturaBlerje.jsx'))
const Magazina               = lazy(() => import('./components/Magazina.jsx'))
const Magazinat              = lazy(() => import('./components/Magazinat.jsx'))
const InventarPermbledhese   = lazy(() => import('./components/InventarPermbledhese.jsx'))
const Klienti                = lazy(() => import('./components/Klienti.jsx'))
const Furnitor               = lazy(() => import('./components/Furnitor.jsx'))
const DetyrimetKlienti       = lazy(() => import('./components/DetyrimetKlienti.jsx'))
const AnalizeVeprime         = lazy(() => import('./components/AnalizeVeprime.jsx'))
const DetyrimetFurnitor      = lazy(() => import('./components/DetyrimetFurnitor.jsx'))
const AnalizeVeprimeFurnitor = lazy(() => import('./components/AnalizeVeprimeFurnitor.jsx'))
const RaportShitjeArtikuj    = lazy(() => import('./components/RaportShitjeArtikuj.jsx'))
const RaportBlerjeArtikuj    = lazy(() => import('./components/RaportBlerjeArtikuj.jsx'))
const Shpenzime              = lazy(() => import('./components/Shpenzime.jsx'))
const RaportShpenzime        = lazy(() => import('./components/RaportShpenzime.jsx'))
const DailyFieldsForm        = lazy(() => import('./components/sections/DailyFieldsForm.jsx'))
const UnifiedReport          = lazy(() => import('./components/sections/UnifiedReport.jsx'))
const Komentet               = lazy(() => import('./components/Komentet.jsx'))
const Riparimet              = lazy(() => import('./components/Riparimet.jsx'))
const ShitjeOnline           = lazy(() => import('./components/ShitjeOnline.jsx'))

function PageFallback() {
  return (
    <div className="flex items-center justify-center h-full text-slate-400 dark:text-slate-500 text-sm">
      <div className="animate-pulse">Duke ngarkuar…</div>
    </div>
  )
}

const PARENT_TITLES = {
  shitje:   'Shitje',
  blerje:   'Blerje',
  magazina: 'Magazina',
}

const PLACEHOLDER_TITLES = {
  'shitje-klering': 'Pagesë me Klering',
}

function ComingSoon({ title }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center">
      <div className="text-6xl mb-4">🚧</div>
      <h3 className="text-xl font-semibold text-slate-700 dark:text-slate-200">{title}</h3>
      <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">Ky modul është në ndërtim.</p>
    </div>
  )
}

function getToday() {
  return new Date().toISOString().split('T')[0]
}

function getPageFromHash() {
  const h = window.location.hash || ''
  const m = h.match(/^#\/?([\w-]+)$/)
  return m ? m[1] : null
}

// Faqet që mund të hapë 'sales'. Çdo tjetër → devijon te dashboard.
// Mbaje të sinkronizuar me SALES_ALLOWED_PAGES tek Layout.jsx.
const SALES_ALLOWED_PAGES = new Set([
  'dashboard',
  'fatura-shitje',
  'shitje-online',
  'kthime-online',
  'produkte-promocion',
  'arka-ditore',
  'arka-kasaforta',
  'arka-shpenzime',
  'arka-konv-hurda',
  'arka-terheqje',
  'arka-levizje-banke',
  'raport-shpenzime',
  'detyrime',
  'komentet',
  'riparimet',
])

function AppInner({ user }) {
  const [page, setPage] = useState(() => getPageFromHash() || 'dashboard')
  const [currentDate, setCurrentDate] = useState(getToday())
  const [openInvoiceId, setOpenInvoiceId] = useState(null)
  const [openNewInvoice, setOpenNewInvoice] = useState(false)
  const [pageHistory, setPageHistory] = useState([])

  const isSales = user?.role === 'sales'
  // Nëse 'sales' arrin në një faqe që s'duhet, ridrejto te dashboard.
  useEffect(() => {
    if (isSales && !SALES_ALLOWED_PAGES.has(page)) {
      setPage('dashboard')
      window.history.replaceState(null, '', '#/dashboard')
    }
  }, [isSales, page])

  // Kick off the shared realtime WebSocket once — subscribers wire up via
  // useRealtimeSync in individual screens.
  useEffect(() => { initRealtime() }, [])

  const navigateTo = (pg, opts = {}) => {
    // Bllok navigimi për 'sales' nëse faqja s'lejohet.
    if (isSales && !SALES_ALLOWED_PAGES.has(pg)) return
    if (pg !== page) setPageHistory(h => [...h, page])
    setPage(pg)
    if (opts.date)      setCurrentDate(opts.date)
    if (opts.invoiceId !== undefined) setOpenInvoiceId(opts.invoiceId)
    if (opts.newInvoice) setOpenNewInvoice(true)
    const expected = `#/${pg}`
    if (window.location.hash !== expected) {
      window.history.pushState(null, '', expected)
    }
  }

  const goBack = () => {
    if (pageHistory.length === 0) return
    const prev = pageHistory[pageHistory.length - 1]
    setPageHistory(h => h.slice(0, -1))
    setPage(prev)
    const expected = `#/${prev}`
    if (window.location.hash !== expected) {
      window.history.pushState(null, '', expected)
    }
  }

  // Keep `page` in sync with URL hash so back/forward + new-tab links work
  useEffect(() => {
    const sync = () => {
      const p = getPageFromHash()
      if (p) setPage(p)
    }
    window.addEventListener('popstate', sync)
    window.addEventListener('hashchange', sync)
    if (!window.location.hash) {
      window.history.replaceState(null, '', `#/${page}`)
    }
    return () => {
      window.removeEventListener('popstate', sync)
      window.removeEventListener('hashchange', sync)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Centralized renderer
  const renderPage = () => {
    // Core pages
    switch (page) {
      case 'dashboard': return <Dashboard date={currentDate} onNavigate={navigateTo} />
      case 'products':  return <Products />
      case 'produkte-promocion': return <ProduktePromocion onNavigate={navigateTo} />
      case 'customers': return <CustomersLedger onNavigate={navigateTo} />
      case 'klienti':   return <Klienti />
      case 'furnitor':  return <Furnitor />
      case 'detyrime':  return <DetyrimetKlienti onNavigate={navigateTo} />
      case 'analize-veprime': return <AnalizeVeprime onNavigate={navigateTo} />
      case 'detyrime-furnitor':       return <DetyrimetFurnitor onNavigate={navigateTo} />
      case 'analize-veprime-furnitor': return <AnalizeVeprimeFurnitor onNavigate={navigateTo} />
      case 'raport-shitje-artikuj': return <RaportShitjeArtikuj onNavigate={navigateTo} />
      case 'raport-blerje-artikuj': return <RaportBlerjeArtikuj onNavigate={navigateTo} />
      case 'arka-shpenzime': return <Shpenzime date={currentDate} onNavigate={navigateTo} />
      case 'raport-shpenzime': return <RaportShpenzime />
      case 'marketing': return <Marketing date={currentDate} />
      case 'arka':      return <CashRegister date={currentDate} />

      // Fatura Shitje — new invoice-based module
      case 'fatura-shitje': return <FaturaShitje date={currentDate} openInvoiceId={openInvoiceId} onConsumeOpen={() => setOpenInvoiceId(null)} openNew={openNewInvoice} onConsumeNew={() => setOpenNewInvoice(false)} />
      case 'fatura-blerje': return <FaturaBlerje date={currentDate} openInvoiceId={openInvoiceId} onConsumeOpen={() => setOpenInvoiceId(null)} />

      // Magazina — fletë hyrje / dalje me kod magazine + monedhë (pa TVSH)
      case 'magazina-hyrje': return <Magazina date={currentDate} kind="hyrje" />
      case 'magazina-dalje': return <Magazina date={currentDate} kind="dalje" />
      case 'magazinat':      return <Magazinat />
      case 'inventar-permbledhese': return <InventarPermbledhese />

      // Shitje Online — moduli i ri (bazuar te invoices me is_online=1).
      case 'shitje-online': return <ShitjeOnline date={currentDate} openInvoiceId={openInvoiceId} onConsumeOpen={() => setOpenInvoiceId(null)} openNew={openNewInvoice} onConsumeNew={() => setOpenNewInvoice(false)} />
      // Legacy: kthimet online mbeten te SalesSection derisa të migrohen.
      case 'kthime-online':  return <SalesSection date={currentDate} type="online" />

      // Blerje (Hyrje Flori/Diamant u hoqën nga menyja)
      case 'blerje-has':     return <BlerjeHas date={currentDate} />

      // Arka special
      case 'arka-ditore':    return <ArkaDitore date={currentDate} onNavigate={navigateTo} />
      case 'arka-kasaforta': return <Kasaforta />
      case 'arka-terheqje':  return <TerheqjaKasaforta date={currentDate} />
      case 'arka-levizje-banke': return <LevizjeBanke date={currentDate} />
      case 'arka-konv-hurda': return <KonvertimHurda date={currentDate} />

      case 'permbledhese':   return <UnifiedReport initialDate={currentDate} onNavigate={navigateTo} />

      case 'komentet':       return <Komentet />
      case 'riparimet':      return <Riparimet />

      default: break
    }

    // Config-driven daily field forms
    const cfg = SECTION_CONFIGS[page]
    if (cfg) return <DailyFieldsForm date={currentDate} {...cfg} />

    // Placeholder for not-yet-built modules
    if (PLACEHOLDER_TITLES[page]) return <ComingSoon title={PLACEHOLDER_TITLES[page]} />
    if (PARENT_TITLES[page])      return <ComingSoon title={PARENT_TITLES[page]} />

    return null
  }

  return (
    <Layout
      page={page}
      currentDate={currentDate}
      onNavigate={navigateTo}
      onDateChange={setCurrentDate}
      user={user}
      canGoBack={pageHistory.length > 0}
      onGoBack={goBack}
    >
      <Suspense fallback={<PageFallback />}>
        {renderPage()}
      </Suspense>
    </Layout>
  )
}

// Prit derisa server-i i brendshëm të ketë mbaruar DB init-in (Turso remote,
// ~10-30s në portable / lidhje të ngadaltë). Pa këtë, login-i shfaqet menjëherë
// dhe request-i i parë /api/* pezullohet nga middleware-i i server-it derisa
// init të mbarojë — user-i sheh një "hangje" pa feedback. Splash screen këtu
// polls /healthz dhe kalon te login-i vetëm kur `dbReady = true`.
function ServerReadyGate({ children }) {
  const [status, setStatus] = useState('checking') // 'checking' | 'ready' | 'error'
  const [errorDetail, setErrorDetail] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [retryToken, setRetryToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    const startedAt = Date.now()
    const CLIENT_TIMEOUT_S = 90
    const tick = setInterval(() => {
      if (cancelled) return
      const s = Math.floor((Date.now() - startedAt) / 1000)
      setElapsed(s)
      // Nëse server-i s'ka thënë as ready as error brenda 90s, force error —
      // ka të ngjarë Turso i bllokuar nga firewall ose kredenciale të pavlefshme.
      if (s >= CLIENT_TIMEOUT_S) {
        setStatus(cur => cur === 'checking' ? 'error' : cur)
        setErrorDetail(cur => cur || `Server-i s'u përgjigj brenda ${CLIENT_TIMEOUT_S}s. Kontrollo internetin ose kredencialet Turso.`)
      }
    }, 1000)
    const poll = async () => {
      while (!cancelled) {
        try {
          const res = await fetch('/healthz', { cache: 'no-store' })
          const data = await res.json()
          if (cancelled) return
          if (data.dbReady) { setStatus('ready'); return }
          if (data.error)   { setStatus('error'); setErrorDetail(data.error); return }
        } catch (_) { /* server ende s'është arritshëm — riprovo */ }
        await new Promise(r => setTimeout(r, 500))
      }
    }
    poll()
    return () => { cancelled = true; clearInterval(tick) }
  }, [retryToken])

  const doRetry = async () => {
    try { await fetch('/reinit', { method: 'POST' }) } catch (_) {}
    setStatus('checking')
    setErrorDetail('')
    setElapsed(0)
    setRetryToken(t => t + 1)
  }

  if (status === 'ready') return children

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-slate-100 z-50">
      <div className="text-center max-w-md px-6">
        {status === 'checking' && (
          <>
            <div className="text-6xl mb-4 animate-pulse">🔌</div>
            <h1 className="text-2xl font-bold mb-2">Duke u lidhur me serverin...</h1>
            <p className="text-sm text-slate-400 mb-6">Po inicializohet baza e të dhënave Turso</p>
            <div className="w-64 h-1.5 mx-auto bg-slate-700 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 animate-pulse rounded-full" style={{ width: '60%' }} />
            </div>
            {elapsed > 5 && (
              <p className="text-xs text-slate-500 mt-4">
                {elapsed}s · nëse zgjat shumë, kontrollo lidhjen e internetit
              </p>
            )}
          </>
        )}
        {status === 'error' && (
          <>
            <div className="text-6xl mb-4">⚠️</div>
            <h1 className="text-2xl font-bold mb-2 text-red-400">Lidhja me DB dështoi</h1>
            <p className="text-sm text-slate-300 mb-4 bg-slate-800/60 p-3 rounded-lg font-mono text-left break-all">
              {errorDetail || 'Nuk u lidh dot me Turso'}
            </p>
            <p className="text-xs text-slate-400 mb-4">
              Kontrollo internetin dhe provo përsëri. Nëse vazhdon, kontakto administratorin.
            </p>
            <div className="flex gap-2 justify-center">
              <button
                onClick={doRetry}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-semibold"
              >
                🔄 Provo Përsëri
              </button>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-semibold"
              >
                Rifresko Faqen
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function App() {
  return (
    <ServerReadyGate>
      <AuthGate>{user => <AppInner user={user} />}</AuthGate>
      <ConfirmDialog />
    </ServerReadyGate>
  )
}

export default App
