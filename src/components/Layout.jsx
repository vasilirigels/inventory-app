import { useState } from 'react'

function prevDay(date) {
  const d = new Date(date + 'T12:00:00')
  d.setDate(d.getDate() - 1)
  return d.toISOString().split('T')[0]
}
function nextDay(date) {
  const d = new Date(date + 'T12:00:00')
  d.setDate(d.getDate() + 1)
  return d.toISOString().split('T')[0]
}
function prevMonth(month) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function nextMonth(month) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const ALBANIAN_MONTHS = [
  '', 'Janar', 'Shkurt', 'Mars', 'Prill', 'Maj', 'Qershor',
  'Korrik', 'Gusht', 'Shtator', 'Tetor', 'Nëntor', 'Dhjetor',
]

const NAV_GROUPS = [
  {
    label: 'KRYESORE',
    items: [
      { id: 'dashboard', label: 'Dashboard',    icon: '🏠' },
      { id: 'products',  label: 'Produktet',    icon: '📦' },
      { id: 'customers', label: 'Klientët',     icon: '👥' },
    ],
  },
  {
    label: 'MODULET',
    items: [
      {
        id: 'shitje', label: 'Shitje', icon: '⬆️',
        children: [
          { id: 'shitje-flori',   label: 'Shitje Flori' },
          { id: 'shitje-diamant', label: 'Shitje Diamant' },
          { id: 'shitje-online',  label: 'Shitje Online & Stafi' },
          { id: 'shitje-klering', label: 'Pagesë me Klering' },
          { id: 'kthime-flori',   label: 'Kthime Flori' },
          { id: 'kthime-diamant', label: 'Kthime Diamant' },
          { id: 'kthime-online',  label: 'Kthime Online & Stafi' },
        ],
      },
      {
        id: 'blerje', label: 'Blerje', icon: '⬇️',
        children: [
          { id: 'blerje-flori',     label: 'Hyrje Flori' },
          { id: 'blerje-diamant',   label: 'Hyrje Diamant' },
          { id: 'shlyerje-borxhi',  label: 'Shlyerje Borxhi te Produkteve' },
        ],
      },
      {
        id: 'inventar', label: 'Inventar', icon: '📁',
        children: [
          { id: 'inventar-flori',   label: 'Inventar Flori' },
          { id: 'inventar-diamant', label: 'Inventar Diamant' },
          { id: 'inventar-hyrje',   label: 'Hyrje në Inventar' },
          { id: 'inventar-dalje',   label: 'Dalje nga Inventari' },
          { id: 'inventar-reale',   label: 'Gjendja Reale & Diferenca' },
        ],
      },
      {
        id: 'arka', label: 'Arka', icon: '🧾',
        children: [
          { id: 'arka-kasaforta',    label: 'Gjendje Kasaforta' },
          { id: 'arka-shpenzime',    label: 'Shpenzime' },
          { id: 'arka-konv-valute',  label: 'Konvertim Valute' },
          { id: 'arka-konv-hurda',   label: 'Konvertim Hurda' },
          { id: 'arka-derdhje',      label: 'Derdhje në Kasafortë' },
          { id: 'arka-terheqje',     label: 'Tërheqje nga Kasaforta' },
          { id: 'arka-mbyllje',      label: 'Mbyllje Ditore Kasaforta' },
          { id: 'arka-fund-dite',    label: 'Arka në Fund të Ditës' },
        ],
      },
      {
        id: 'banka', label: 'Banka', icon: '🏦',
        children: [
          { id: 'banka-terheqje',  label: 'Tërheqje nga Banka' },
          { id: 'banka-depozitim', label: 'Depozitim në Bankë' },
          { id: 'banka-levizje',   label: 'Lëvizje në Bankë' },
          { id: 'banka-pb',        label: 'Pagesa me Kartë (PB)' },
        ],
      },
      {
        id: 'kontabilitet', label: 'Kontabilitet', icon: '📑',
        children: [
          { id: 'kont-xhiro',         label: 'Xhiro Neto' },
          { id: 'kont-borxhe',        label: 'Borxhe Klienti' },
          { id: 'kont-kthim-borxhi',  label: 'Kthim Borxhi' },
          { id: 'kont-permbledhese-m',label: 'Përmbledhëse Mujore' },
          { id: 'kont-permbledhese-v',label: 'Përmbledhëse Vjetore' },
        ],
      },
      {
        id: 'celje', label: 'Celje', icon: '📄',
        children: [
          { id: 'celje-mbartur', label: 'Gjendje e Mbartur' },
          { id: 'celje-dites',   label: 'Celja e Ditës' },
        ],
      },
      {
        id: 'asete', label: 'Aktive Afatgjata (Asete)', icon: '🧮',
        children: [
          { id: 'asete-fikse',     label: 'Asete Fikse' },
          { id: 'asete-amortizim', label: 'Amortizim' },
        ],
      },
      {
        id: 'fiskalizimi', label: 'Fiskalizimi', icon: '🧾',
        children: [
          { id: 'fisk-fatura',     label: 'Fatura të Lëshuara' },
          { id: 'fisk-anuluara',   label: 'Fatura të Anuluara' },
          { id: 'fisk-raport',     label: 'Raport Ditor Fiskal' },
        ],
      },
      {
        id: 'burime', label: 'Burime Njerëzore', icon: '👤',
        children: [
          { id: 'bnj-biba',  label: 'Tërheqje BIBA' },
          { id: 'bnj-diana', label: 'Tërheqje DIANA' },
          { id: 'bnj-stafi', label: 'Shitje brenda Stafit' },
          { id: 'bnj-paga',  label: 'Stafi & Pagat' },
        ],
      },
      {
        id: 'prodhim', label: 'Prodhim', icon: '🏭',
        children: [
          { id: 'prodhim-porosi', label: 'Porosi Prodhimi' },
          { id: 'prodhim-hurda',  label: 'Hurda' },
          { id: 'prodhim-proces', label: 'Punët në Proces' },
        ],
      },
      {
        id: 'mjete', label: 'Mjete', icon: '⚙️',
        children: [
          { id: 'mjete-kursi',   label: 'Kursi i Këmbimit' },
          { id: 'mjete-backup',  label: 'Backup' },
          { id: 'mjete-import',  label: 'Importo nga Excel' },
          { id: 'mjete-settings',label: 'Cilësimet' },
        ],
      },
    ],
  },
  {
    label: 'RAPORTE',
    items: [
      { id: 'daily',         label: 'Ditari',                 icon: '📋' },
      { id: 'history',       label: 'Historiku',              icon: '🔍' },
      { id: 'permbledhese',  label: 'Përmbledhëse',           icon: '📊' },
      { id: 'summary',       label: 'Permbledhja (Klasik)',   icon: '🗒️' },
      { id: 'marketing',     label: 'Marketingu',             icon: '📣' },
    ],
  },
]

const PAGE_TITLES = {
  dashboard:    'Dashboard',
  products:     'Produktet',
  customers:    'Klientët',
  daily:        'Ditari Ditor',
  history:      'Historiku i Shitjeve',
  summary:      'Permbledhja Mujore (Klasik)',
  'kont-permbledhese-m': 'Përmbledhëse Mujore',
  'kont-permbledhese-v': 'Përmbledhëse Vjetore',
  permbledhese:          'Përmbledhëse',
  marketing:    'Shpenzime Marketingu',
  shitje:       'Shitje',
  blerje:       'Blerje',
  inventar:     'Inventar',
  arka:         'Arka',
  banka:        'Banka',
  kontabilitet: 'Kontabilitet',
  celje:        'Celje',
  asete:        'Aktive Afatgjata (Asete)',
  fiskalizimi:  'Fiskalizimi',
  burime:       'Burime Njerëzore',
  prodhim:      'Prodhim',
  mjete:        'Mjete',
}

function getChildTitle(id) {
  for (const g of NAV_GROUPS) {
    for (const it of g.items) {
      if (it.children) {
        const c = it.children.find(c => c.id === id)
        if (c) return `${it.label} — ${c.label}`
      }
    }
  }
  return null
}

function findParentId(childId) {
  for (const g of NAV_GROUPS) {
    for (const it of g.items) {
      if (it.children?.some(c => c.id === childId)) return it.id
    }
  }
  return null
}

export default function Layout({
  children, page, currentDate, currentMonth,
  onNavigate, onDateChange, onMonthChange,
}) {
  const now = new Date()
  const [y, m, d] = currentDate.split('-').map(Number)
  const dateLabel = `${d} ${ALBANIAN_MONTHS[m]} ${y}`
  const [my, mm] = currentMonth.split('-').map(Number)
  const monthLabel = `${ALBANIAN_MONTHS[mm]} ${my}`

  const parentOfPage = findParentId(page)
  const [openMenus, setOpenMenus] = useState(() => parentOfPage ? { [parentOfPage]: true } : {})
  const toggleMenu = id => setOpenMenus(m => ({ ...m, [id]: !m[id] }))

  const headerTitle = PAGE_TITLES[page] ?? getChildTitle(page) ?? 'Faqe'

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">

      {/* ── Sidebar ── */}
      <aside className="w-60 bg-slate-900 flex flex-col flex-shrink-0 shadow-xl">

        {/* Logo */}
        <div className="px-5 py-5 border-b border-slate-700/60">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-yellow-500 rounded-xl flex items-center justify-center shadow-lg shadow-yellow-500/40 flex-shrink-0">
              <span className="text-white text-lg leading-none">💍</span>
            </div>
            <div>
              <h1 className="text-white font-bold text-base leading-tight tracking-tight">
                Gold Shop
              </h1>
              <p className="text-slate-500 text-xs">Sistem Inventari</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-4 overflow-y-auto">
          {NAV_GROUPS.map(group => (
            <div key={group.label}>
              <p className="section-title px-3 pb-1 text-slate-600 text-[10px]">{group.label}</p>
              <div className="space-y-0.5">
                {group.items.map(item => {
                  const hasChildren = item.children && item.children.length > 0
                  const isOpen = !!openMenus[item.id] || parentOfPage === item.id
                  const isActive = page === item.id || parentOfPage === item.id
                  return (
                    <div key={item.id}>
                      <button
                        onClick={() => hasChildren ? toggleMenu(item.id) : onNavigate(item.id)}
                        className={`nav-item w-full ${isActive ? 'nav-active' : 'nav-inactive'}`}
                      >
                        <span className="text-base w-5 text-center">{item.icon}</span>
                        <span className="flex-1 text-left">{item.label}</span>
                        {hasChildren ? (
                          <span className={`ml-auto text-xs transition-transform ${isOpen ? 'rotate-180' : ''}`}>▾</span>
                        ) : page === item.id ? (
                          <span className="ml-auto w-1.5 h-1.5 bg-white/70 rounded-full" />
                        ) : null}
                      </button>
                      {hasChildren && isOpen && (
                        <div className="ml-6 mt-0.5 mb-1 space-y-0.5 border-l border-slate-700/60 pl-2">
                          {item.children.map(child => (
                            <button
                              key={child.id}
                              onClick={() => onNavigate(child.id)}
                              className={`nav-item text-xs py-1.5 w-full ${page === child.id ? 'nav-active' : 'nav-inactive'}`}
                            >
                              <span className="flex-1 text-left">{child.label}</span>
                              {page === child.id && (
                                <span className="ml-auto w-1.5 h-1.5 bg-white/70 rounded-full" />
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Sidebar footer */}
        <div className="px-5 py-4 border-t border-slate-700/60">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse flex-shrink-0" />
            <span className="text-xs text-slate-500">Online</span>
          </div>
          <p className="text-xs text-slate-600">
            {now.toLocaleDateString('sq-AL', {
              weekday: 'short', day: 'numeric',
              month: 'short', year: 'numeric',
            })}
          </p>
        </div>
      </aside>

      {/* ── Main area ── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Top header */}
        <header className="bg-white border-b border-slate-200 px-6 h-14 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-4">
            <h2 className="text-base font-bold text-slate-800">{headerTitle}</h2>

            {/* Daily date nav — show on any date-driven page */}
            {(page === 'daily' || (parentOfPage && !['kont-permbledhese-m','kont-permbledhese-v'].includes(page)) || ['arka', 'inventar'].includes(page)) && page !== 'permbledhese' && (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => onDateChange(prevDay(currentDate))}
                  className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-sm"
                >‹</button>
                <span className="text-sm font-medium text-slate-700 px-1">{dateLabel}</span>
                <input
                  type="date"
                  value={currentDate}
                  onChange={e => onDateChange(e.target.value)}
                  className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50"
                />
                <button
                  onClick={() => onDateChange(nextDay(currentDate))}
                  className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-sm"
                >›</button>
                <button
                  onClick={() => onDateChange(new Date().toISOString().split('T')[0])}
                  className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700"
                >Sot</button>
              </div>
            )}

            {/* Monthly nav */}
            {page === 'summary' && (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => onMonthChange(prevMonth(currentMonth))}
                  className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-sm"
                >‹</button>
                <span className="text-sm font-medium text-slate-700 px-1">{monthLabel}</span>
                <input
                  type="month"
                  value={currentMonth}
                  onChange={e => onMonthChange(e.target.value)}
                  className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50"
                />
                <button
                  onClick={() => onMonthChange(nextMonth(currentMonth))}
                  className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-sm"
                >›</button>
              </div>
            )}
          </div>

          {/* Right side */}
          <div className="flex items-center gap-2.5">
            <a
              href="/api/backup"
              download
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-medium rounded-lg transition-colors"
              title="Shkarko backup të bazës së të dhënave"
            >
              💾 Backup
            </a>
            <span className="text-xs text-slate-400 hidden sm:block">
              {now.toLocaleDateString('sq-AL', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
            <div className="w-8 h-8 bg-gradient-to-br from-yellow-400 to-yellow-600 rounded-lg flex items-center justify-center text-white text-sm font-bold shadow-sm">
              G
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
