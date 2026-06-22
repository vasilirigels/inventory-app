import { useState } from 'react'
import Layout from './components/Layout.jsx'
import Dashboard from './components/Dashboard.jsx'
import Products from './components/Products.jsx'
import Customers from './components/Customers.jsx'
import CustomersLedger from './components/CustomersLedger.jsx'
import SalesHistory from './components/SalesHistory.jsx'
import DailyLog from './components/DailyLog.jsx'
import MonthlySummary from './components/MonthlySummary.jsx'
import Marketing from './components/Marketing.jsx'
import Inventory from './components/Inventory.jsx'
import CashRegister from './components/CashRegister.jsx'
import SalesSection from './components/SalesSection.jsx'
import DailyFieldsForm from './components/sections/DailyFieldsForm.jsx'
import { SECTION_CONFIGS } from './components/sections/sectionConfigs.js'
import EndOfDay from './components/sections/EndOfDay.jsx'
import XhiroNeto from './components/sections/XhiroNeto.jsx'
import DebtsForm from './components/sections/DebtsForm.jsx'
import BankLevizje from './components/sections/BankLevizje.jsx'
import PBView from './components/sections/PBView.jsx'
import InventoryFlow from './components/sections/InventoryFlow.jsx'
import InventoryReale from './components/sections/InventoryReale.jsx'
import YearlyReport from './components/sections/YearlyReport.jsx'
import MonthlyReport from './components/sections/MonthlyReport.jsx'
import UnifiedReport from './components/sections/UnifiedReport.jsx'

const PARENT_TITLES = {
  shitje:       'Shitje',
  blerje:       'Blerje',
  banka:        'Banka',
  kontabilitet: 'Kontabilitet',
  celje:        'Celje',
  asete:        'Aktive Afatgjata (Asete)',
  fiskalizimi:  'Fiskalizimi',
  burime:       'Burime Njerëzore',
  prodhim:      'Prodhim',
  mjete:        'Mjete',
}

const PLACEHOLDER_TITLES = {
  'shitje-klering': 'Pagesë me Klering',
  'asete-fikse':     'Asete Fikse',
  'asete-amortizim': 'Amortizim',
  'fisk-fatura':   'Fatura të Lëshuara',
  'fisk-anuluara': 'Fatura të Anuluara',
  'fisk-raport':   'Raport Ditor Fiskal',
  'bnj-paga':  'Stafi & Pagat',
  'prodhim-porosi': 'Porosi Prodhimi',
  'prodhim-hurda':  'Hurda',
  'prodhim-proces': 'Punët në Proces',
  'mjete-kursi':    'Kursi i Këmbimit',
  'mjete-settings': 'Cilësimet',
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

function BackupPage() {
  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <h3 className="text-lg font-bold text-slate-800 mb-2">Backup i të dhënave</h3>
        <p className="text-sm text-slate-600 mb-4">Shkarko një kopje të plotë të bazës së të dhënave si skedar .db.</p>
        <a href="/api/backup" download className="inline-block bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-md">
          💾 Shkarko Backup
        </a>
      </div>
    </div>
  )
}

function getToday() {
  return new Date().toISOString().split('T')[0]
}

function App() {
  const [page, setPage] = useState('dashboard')
  const [currentDate, setCurrentDate] = useState(getToday())
  const [currentMonth, setCurrentMonth] = useState(getToday().substring(0, 7))

  const navigateTo = (pg, opts = {}) => {
    setPage(pg)
    if (opts.date)  setCurrentDate(opts.date)
    if (opts.month) setCurrentMonth(opts.month)
  }

  // Centralized renderer
  const renderPage = () => {
    // Core pages
    switch (page) {
      case 'dashboard': return <Dashboard onNavigate={navigateTo} />
      case 'products':  return <Products />
      case 'customers': return <CustomersLedger onNavigate={navigateTo} />
      case 'history':   return <SalesHistory onNavigate={navigateTo} />
      case 'daily':     return <DailyLog date={currentDate} onNavigate={navigateTo} />
      case 'summary':   return <MonthlySummary month={currentMonth} onNavigate={navigateTo} />
      case 'marketing': return <Marketing />
      case 'inventar':  return <Inventory date={currentDate} />
      case 'arka':      return <CashRegister date={currentDate} />

      // Shitje / Kthime — reuse SalesSection
      case 'shitje-flori':
      case 'kthime-flori':   return <SalesSection date={currentDate} type="flori" />
      case 'shitje-diamant':
      case 'kthime-diamant': return <SalesSection date={currentDate} type="diamant" />
      case 'shitje-online':
      case 'kthime-online':
      case 'bnj-stafi':      return <SalesSection date={currentDate} type="online" />

      // Inventar sub-pages
      case 'inventar-flori':   return <Inventory date={currentDate} />
      case 'inventar-diamant': return <Inventory date={currentDate} />
      case 'inventar-reale':   return <InventoryReale date={currentDate} />

      // Blerje
      case 'blerje-flori':   return <InventoryFlow date={currentDate} type="flori"   kind="hyrje" />
      case 'blerje-diamant': return <InventoryFlow date={currentDate} type="diamant" kind="hyrje" />
      case 'inventar-hyrje': return <InventoryFlow date={currentDate} type="flori"   kind="hyrje" />
      case 'inventar-dalje': return <InventoryFlow date={currentDate} type="flori"   kind="dalje" />

      // Arka special
      case 'arka-fund-dite': return <EndOfDay date={currentDate} mode="arka" />
      case 'arka-mbyllje':   return <EndOfDay date={currentDate} mode="mbyllje" />

      // Banka special
      case 'banka-levizje': return <BankLevizje date={currentDate} />
      case 'banka-pb':      return <PBView date={currentDate} />

      // Kontabilitet
      case 'kont-xhiro':         return <XhiroNeto date={currentDate} />
      case 'kont-borxhe':        return <DebtsForm date={currentDate} mode="debt" />
      case 'kont-kthim-borxhi':  return <DebtsForm date={currentDate} mode="repayment" />
      case 'kont-permbledhese-m':return <UnifiedReport initialDate={currentDate} onNavigate={navigateTo} />
      case 'kont-permbledhese-v':return <UnifiedReport initialDate={currentDate} onNavigate={navigateTo} />
      case 'permbledhese':       return <UnifiedReport initialDate={currentDate} onNavigate={navigateTo} />

      // Mjete
      case 'mjete-backup': return <BackupPage />
      case 'mjete-import': return <Marketing />

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
      currentMonth={currentMonth}
      onNavigate={navigateTo}
      onDateChange={setCurrentDate}
      onMonthChange={setCurrentMonth}
    >
      {renderPage()}
    </Layout>
  )
}

export default App
