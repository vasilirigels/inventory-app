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
const ALBANIAN_MONTHS = [
  '', 'Janar', 'Shkurt', 'Mars', 'Prill', 'Maj', 'Qershor',
  'Korrik', 'Gusht', 'Shtator', 'Tetor', 'Nëntor', 'Dhjetor',
]

const NAV_GROUPS = [
  {
    label: 'KRYESORE',
    items: [
      { id: 'dashboard', label: 'Dashboard',    icon: '🏠' },
      { id: 'products',  label: 'Produktet (Inventar)', icon: '📦' },
      { id: 'klienti',   label: 'Klienti',      icon: '👤' },
      { id: 'furnitor',  label: 'Furnitor',     icon: '🏭' },
      { id: 'zerat-shpenzimeve', label: 'Zërat e Shpenzimeve', icon: '🧾' },
      { id: 'customers', label: 'Klientët (Borxhe)', icon: '👥' },
    ],
  },
  {
    label: 'MODULET',
    items: [
      {
        id: 'shitje', label: 'Shitje', icon: '⬆️',
        children: [
          { id: 'fatura-shitje',         label: 'FATURA SHITJE' },
          { id: 'shitje-online',         label: 'Shitje Online & Stafi' },
          { id: 'shitje-klering',        label: 'Pagesë me Klering' },
          { id: 'kthime-online',         label: 'Kthime Online & Stafi' },
          { id: 'raport-shitje-artikuj', label: 'Raport Shitje Artikuj' },
        ],
      },
      {
        id: 'blerje', label: 'Blerje', icon: '⬇️',
        children: [
          { id: 'fatura-blerje',         label: 'FATURA BLERJE' },
          { id: 'blerje-has',            label: 'BLERJE HAS' },
          { id: 'raport-blerje-artikuj', label: 'Raport Blerje Artikuj' },
        ],
      },
      {
        id: 'magazina', label: 'Magazina', icon: '🏬',
        children: [
          { id: 'magazinat',             label: 'Regjistri i Magazinave' },
          { id: 'magazina-hyrje',        label: 'Fletë Hyrje' },
          { id: 'magazina-dalje',        label: 'Fletë Dalje' },
          { id: 'inventar-permbledhese', label: 'Përmbledhëse Inventari' },
        ],
      },
      {
        id: 'arka', label: 'Arka', icon: '🧾',
        children: [
          { id: 'arka-ditore',       label: 'Arka Ditore' },
          { id: 'arka-kasaforta',    label: 'Kasaforta' },
          { id: 'arka-shpenzime',    label: 'Shpenzime' },
          { id: 'arka-konv-valute',  label: 'Konvertim Valute' },
          { id: 'arka-konv-hurda',   label: 'Konvertim Hurda' },
          { id: 'arka-terheqje',     label: 'Tërheqje nga Kasaforta' },
        ],
      },
    ],
  },
  {
    label: 'RAPORTE',
    items: [
      { id: 'detyrime',      label: 'Borxhe Klientesh',       icon: '⚠️' },
      { id: 'analize-veprime', label: 'ANALIZE VEPRIME KLIENT', icon: '📈' },
      { id: 'detyrime-furnitor', label: 'Detyrime Furnitor', icon: '🏭' },
      { id: 'analize-veprime-furnitor', label: 'ANALIZE VEPRIME FURNITOR', icon: '📉' },
      { id: 'raport-xhiro-ditore',   label: 'Raport Xhiro Ditore',   icon: '📅' },
      { id: 'raport-shpenzime',      label: 'Raport Shpenzime Ditore',      icon: '💸' },
      { id: 'permbledhese',  label: 'Përmbledhëse',           icon: '📊' },
      { id: 'marketing',     label: 'Marketingu',             icon: '📣' },
    ],
  },
]

const PAGE_TITLES = {
  dashboard:    'Dashboard',
  products:     'Produktet (Inventar)',
  klienti:      'Klienti (Regjistri)',
  furnitor:     'Furnitor (Regjistri)',
  'zerat-shpenzimeve': 'Zërat e Shpenzimeve (Regjistri)',
  customers:    'Klientët (Borxhe)',
  detyrime:     'Detyrime Klienti',
  'analize-veprime': 'ANALIZE VEPRIME KLIENT',
  'detyrime-furnitor': 'Detyrime Furnitor',
  'analize-veprime-furnitor': 'ANALIZE VEPRIME FURNITOR',
  'raport-xhiro-ditore':   'Raport Xhiro Ditore',
  'raport-shitje-artikuj': 'Raport Shitje — Artikuj',
  'raport-blerje-artikuj': 'Raport Blerje — Artikuj',
  'raport-shpenzime':      'Raport Shpenzime Ditore',
  permbledhese: 'Përmbledhëse',
  marketing:    'Shpenzime Marketingu',
  shitje:       'Shitje',
  blerje:       'Blerje',
  magazina:     'Magazina',
  arka:         'Arka',
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
  children, page, currentDate,
  onNavigate, onDateChange,
}) {
  const now = new Date()
  const [y, m, d] = currentDate.split('-').map(Number)
  const dateLabel = `${d} ${ALBANIAN_MONTHS[m]} ${y}`

  const parentOfPage = findParentId(page)
  const [openMenus, setOpenMenus] = useState(() => parentOfPage ? { [parentOfPage]: true } : {})
  const toggleMenu = id => setOpenMenus(m => ({ ...m, [id]: !m[id] }))
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const headerTitle = PAGE_TITLES[page] ?? getChildTitle(page) ?? 'Faqe'

  // Në mobile, kliku në një zë navigacioni mbyll sidebar-in.
  const handleNavigate = (id) => {
    onNavigate(id)
    setSidebarOpen(false)
  }

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">

      {/* ── Backdrop për mobile (kliku mbyll sidebar-in) ── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Sidebar ── */}
      <aside
        className={`
          w-60 bg-slate-900 flex flex-col flex-shrink-0 shadow-xl
          fixed inset-y-0 left-0 z-40 transform transition-transform duration-200
          md:static md:translate-x-0
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        `}
      >

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
                  // Leaf items render as anchors so cmd/ctrl+click and middle-click open
                  // the page in a new browser tab.
                  const handleLeafClick = (e, id) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey) return
                    e.preventDefault()
                    handleNavigate(id)
                  }
                  return (
                    <div key={item.id}>
                      {hasChildren ? (
                        <button
                          type="button"
                          onClick={() => toggleMenu(item.id)}
                          className={`nav-item w-full ${isActive ? 'nav-active' : 'nav-inactive'}`}
                        >
                          <span className="text-base w-5 text-center">{item.icon}</span>
                          <span className="flex-1 text-left">{item.label}</span>
                          <span className={`ml-auto text-xs transition-transform ${isOpen ? 'rotate-180' : ''}`}>▾</span>
                        </button>
                      ) : (
                        <a
                          href={`#/${item.id}`}
                          onClick={e => handleLeafClick(e, item.id)}
                          className={`nav-item w-full ${isActive ? 'nav-active' : 'nav-inactive'}`}
                        >
                          <span className="text-base w-5 text-center">{item.icon}</span>
                          <span className="flex-1 text-left">{item.label}</span>
                          {page === item.id && (
                            <span className="ml-auto w-1.5 h-1.5 bg-white/70 rounded-full" />
                          )}
                        </a>
                      )}
                      {hasChildren && isOpen && (
                        <div className="ml-6 mt-0.5 mb-1 space-y-0.5 border-l border-slate-700/60 pl-2">
                          {item.children.map(child => (
                            <a
                              key={child.id}
                              href={`#/${child.id}`}
                              onClick={e => handleLeafClick(e, child.id)}
                              className={`nav-item text-xs py-1.5 w-full ${page === child.id ? 'nav-active' : 'nav-inactive'}`}
                            >
                              <span className="flex-1 text-left">{child.label}</span>
                              {page === child.id && (
                                <span className="ml-auto w-1.5 h-1.5 bg-white/70 rounded-full" />
                              )}
                            </a>
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
        <header className="bg-white border-b border-slate-200 px-3 md:px-6 h-14 flex items-center justify-between flex-shrink-0 gap-2">
          <div className="flex items-center gap-2 md:gap-4 min-w-0 flex-1">
            {/* Hamburger për mobile */}
            <button
              onClick={() => setSidebarOpen(true)}
              className="md:hidden w-9 h-9 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 flex-shrink-0"
              aria-label="Hap menynë"
            >
              <span className="text-xl leading-none">☰</span>
            </button>
            <h2 className="text-sm md:text-base font-bold text-slate-800 truncate">{headerTitle}</h2>

            {/* Daily date nav — show on any date-driven page */}
            {(parentOfPage || ['arka'].includes(page)) && page !== 'permbledhese' && (
              <div className="hidden lg:flex items-center gap-1.5">
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

          </div>

          {/* Right side */}
          <div className="flex items-center gap-1.5 md:gap-2.5 flex-shrink-0">
            <a
              href="/api/backup"
              download
              className="flex items-center gap-1.5 px-2 md:px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-medium rounded-lg transition-colors"
              title="Shkarko backup të bazës së të dhënave"
            >
              💾 <span className="hidden sm:inline">Backup</span>
            </a>
            <span className="text-xs text-slate-400 hidden lg:block">
              {now.toLocaleDateString('sq-AL', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
            <div className="w-8 h-8 bg-gradient-to-br from-yellow-400 to-yellow-600 rounded-lg flex items-center justify-center text-white text-sm font-bold shadow-sm">
              G
            </div>
          </div>
        </header>

        {/* Date nav për mobile / tablet — nën header */}
        {(parentOfPage || ['arka'].includes(page)) && page !== 'permbledhese' && (
          <div className="lg:hidden bg-white border-b border-slate-200 px-3 py-2 flex items-center gap-1.5 flex-wrap flex-shrink-0">
            <button
              onClick={() => onDateChange(prevDay(currentDate))}
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-sm"
            >‹</button>
            <input
              type="date"
              value={currentDate}
              onChange={e => onDateChange(e.target.value)}
              className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50 flex-1 min-w-[130px]"
            />
            <button
              onClick={() => onDateChange(nextDay(currentDate))}
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-sm"
            >›</button>
            <button
              onClick={() => onDateChange(new Date().toISOString().split('T')[0])}
              className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700"
            >Sot</button>
          </div>
        )}

        {/* Page content */}
        <main className="flex-1 overflow-auto p-3 md:p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
