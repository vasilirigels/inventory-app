import { useState, useEffect } from 'react'
import Layout from './components/Layout.jsx'
import Dashboard from './components/Dashboard.jsx'
import Products from './components/Products.jsx'
import Customers from './components/Customers.jsx'
import CustomersLedger from './components/CustomersLedger.jsx'
import Marketing from './components/Marketing.jsx'
import CashRegister from './components/CashRegister.jsx'
import ArkaDitore from './components/ArkaDitore.jsx'
import Kasaforta from './components/Kasaforta.jsx'
import TerheqjaKasaforta from './components/TerheqjaKasaforta.jsx'
import KonvertimHurda from './components/KonvertimHurda.jsx'
import BlerjeHas from './components/BlerjeHas.jsx'
import SalesSection from './components/SalesSection.jsx'
import FaturaShitje from './components/FaturaShitje.jsx'
import FaturaBlerje from './components/FaturaBlerje.jsx'
import Magazina from './components/Magazina.jsx'
import Magazinat from './components/Magazinat.jsx'
import InventarPermbledhese from './components/InventarPermbledhese.jsx'
import Klienti from './components/Klienti.jsx'
import Furnitor from './components/Furnitor.jsx'
import DetyrimetKlienti from './components/DetyrimetKlienti.jsx'
import AnalizeVeprime from './components/AnalizeVeprime.jsx'
import DetyrimetFurnitor from './components/DetyrimetFurnitor.jsx'
import AnalizeVeprimeFurnitor from './components/AnalizeVeprimeFurnitor.jsx'
import RaportShitjeArtikuj from './components/RaportShitjeArtikuj.jsx'
import RaportBlerjeArtikuj from './components/RaportBlerjeArtikuj.jsx'
import ZeratShpenzimeve from './components/ZeratShpenzimeve.jsx'
import Shpenzime from './components/Shpenzime.jsx'
import RaportShpenzime from './components/RaportShpenzime.jsx'
import RaportXhiroDitore from './components/RaportXhiroDitore.jsx'
import DailyFieldsForm from './components/sections/DailyFieldsForm.jsx'
import { SECTION_CONFIGS } from './components/sections/sectionConfigs.js'
import YearlyReport from './components/sections/YearlyReport.jsx'
import MonthlyReport from './components/sections/MonthlyReport.jsx'
import UnifiedReport from './components/sections/UnifiedReport.jsx'

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
      <h3 className="text-xl font-semibold text-slate-700">{title}</h3>
      <p className="text-sm text-slate-500 mt-2">Ky modul është në ndërtim.</p>
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

function App() {
  const [page, setPage] = useState(() => getPageFromHash() || 'dashboard')
  const [currentDate, setCurrentDate] = useState(getToday())
  const [openInvoiceId, setOpenInvoiceId] = useState(null)

  const navigateTo = (pg, opts = {}) => {
    setPage(pg)
    if (opts.date)      setCurrentDate(opts.date)
    if (opts.invoiceId !== undefined) setOpenInvoiceId(opts.invoiceId)
    const expected = `#/${pg}`
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
      case 'dashboard': return <Dashboard onNavigate={navigateTo} />
      case 'products':  return <Products />
      case 'customers': return <CustomersLedger onNavigate={navigateTo} />
      case 'klienti':   return <Klienti />
      case 'furnitor':  return <Furnitor />
      case 'detyrime':  return <DetyrimetKlienti onNavigate={navigateTo} />
      case 'analize-veprime': return <AnalizeVeprime onNavigate={navigateTo} />
      case 'detyrime-furnitor':       return <DetyrimetFurnitor onNavigate={navigateTo} />
      case 'analize-veprime-furnitor': return <AnalizeVeprimeFurnitor onNavigate={navigateTo} />
      case 'raport-shitje-artikuj': return <RaportShitjeArtikuj onNavigate={navigateTo} />
      case 'raport-blerje-artikuj': return <RaportBlerjeArtikuj onNavigate={navigateTo} />
      case 'zerat-shpenzimeve': return <ZeratShpenzimeve />
      case 'arka-shpenzime': return <Shpenzime date={currentDate} onNavigate={navigateTo} />
      case 'raport-shpenzime': return <RaportShpenzime />
      case 'raport-xhiro-ditore': return <RaportXhiroDitore onNavigate={navigateTo} />
      case 'marketing': return <Marketing />
      case 'arka':      return <CashRegister date={currentDate} />

      // Fatura Shitje — new invoice-based module
      case 'fatura-shitje': return <FaturaShitje date={currentDate} openInvoiceId={openInvoiceId} onConsumeOpen={() => setOpenInvoiceId(null)} />
      case 'fatura-blerje': return <FaturaBlerje date={currentDate} openInvoiceId={openInvoiceId} onConsumeOpen={() => setOpenInvoiceId(null)} />

      // Magazina — fletë hyrje / dalje me kod magazine + monedhë (pa TVSH)
      case 'magazina-hyrje': return <Magazina date={currentDate} kind="hyrje" />
      case 'magazina-dalje': return <Magazina date={currentDate} kind="dalje" />
      case 'magazinat':      return <Magazinat />
      case 'inventar-permbledhese': return <InventarPermbledhese />

      // Kthime — vetëm Online mbetet (Kthime Flori/Diamant u hoqën nga menyja)
      case 'shitje-online':
      case 'kthime-online':  return <SalesSection date={currentDate} type="online" />

      // Blerje (Hyrje Flori/Diamant u hoqën nga menyja)
      case 'blerje-has':     return <BlerjeHas date={currentDate} />

      // Arka special
      case 'arka-ditore':    return <ArkaDitore date={currentDate} onNavigate={navigateTo} />
      case 'arka-kasaforta': return <Kasaforta />
      case 'arka-terheqje':  return <TerheqjaKasaforta date={currentDate} />
      case 'arka-konv-hurda': return <KonvertimHurda date={currentDate} />

      case 'permbledhese':   return <UnifiedReport initialDate={currentDate} onNavigate={navigateTo} />

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
    >
      {renderPage()}
    </Layout>
  )
}

export default App
