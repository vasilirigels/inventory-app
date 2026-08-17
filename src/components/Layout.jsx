import { useState } from 'react'
import { clearSession } from '../lib/auth.js'
import { useUnreadCommentsCount } from '../lib/unreadComments.js'
import { useTheme } from '../lib/theme.js'
import CommentToast from './CommentToast.jsx'

// Faqet që role='sales' mund të shohë (veprimet ditore + raportet ditore).
const SALES_ALLOWED_PAGES = new Set([
  'dashboard',
  // Shitje
  'fatura-shitje',        // krijim fature shitjeje
  'shitje-online',        // shitje brenda stafit
  'kthime-online',        // kthime (diamante/flori)
  // Produkte
  'produkte-promocion',   // Promocionet (view only)
  // Arka
  'arka-ditore',          // Arka
  'arka-kasaforta',       // Kasaforta
  'arka-shpenzime',       // Shpenzime ditore (input)
  'arka-konv-hurda',      // Konvertim Hurda
  'arka-terheqje',        // Tërheqje nga Kasaforta
  'arka-levizje-banke',   // Lëvizje Banke (depozitim/tërheqje)
  // Raporte ditore
  'raport-shpenzime',     // Shpenzime ditore (raport)
  // Borxhet
  'detyrime',             // Borxhi i klientit
  // Komunikimi mes userave
  'komentet',
  // Riparimet — regjistrimi i punimeve që sjellin klientët
  'riparimet',
])

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
      { id: 'dashboard', label: 'Shitjet',    icon: '🏠' },
      { id: 'products',  label: 'Produktet (Inventar)', icon: '📦' },
      { id: 'produkte-promocion', label: 'Produkte Promocion', icon: '🏷️' },
      { id: 'klienti',   label: 'Klienti',      icon: '👤' },
      { id: 'furnitor',  label: 'Furnitor',     icon: '🏭' },
      { id: 'customers', label: 'Klientët (Borxhe)', icon: '👥' },
      { id: 'komentet',  label: 'Komentet',          icon: '💬' },
      { id: 'riparimet', label: 'Riparimet',         icon: '🛠️' },
    ],
  },
  {
    label: 'MODULET',
    items: [
      {
        id: 'shitje', label: 'Shitje', icon: '⬆️',
        children: [
          { id: 'fatura-shitje',         label: 'FATURA SHITJE' },
          { id: 'shitje-online',         label: '🛒 Shitje Online' },
          { id: 'shitje-klering',        label: 'Pagesë me Klering' },
          { id: 'raport-shitje-artikuj', label: 'Raport Shitje Artikuj' },
        ],
      },
      {
        id: 'blerje', label: 'Blerje', icon: '⬇️',
        children: [
          { id: 'fatura-blerje',         label: 'FATURA BLERJE' },
          { id: 'blerje-flori',          label: '🟡 BLERJE FLORI' },
          { id: 'blerje-diamant',        label: '💎 BLERJE DIAMANT' },
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
          { id: 'arka-konv-hurda',   label: 'Konvertim Hurda' },
          { id: 'arka-terheqje',     label: 'Tërheqje nga Kasaforta' },
          { id: 'arka-levizje-banke', label: 'Lëvizje Banke' },
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
      { id: 'permbledhese',  label: 'Përmbledhëse',           icon: '📊' },
      { id: 'marketing',     label: 'Marketingu',             icon: '📣' },
    ],
  },
]

// Faqet që kanë filter të datës brenda tyre — heqim date nav-in nga header-i
// që të mos ketë dy filtra.
const PAGES_WITH_OWN_DATE_FILTER = new Set([
  'arka-kasaforta',
])

const PAGE_TITLES = {
  dashboard:    'Dashboard',
  products:     'Produktet (Inventar)',
  'produkte-promocion': 'Produkte Promocion',
  klienti:      'Klienti (Regjistri)',
  furnitor:     'Furnitor (Regjistri)',
  customers:    'Klientët (Borxhe)',
  detyrime:     'Detyrime Klienti',
  'analize-veprime': 'ANALIZE VEPRIME KLIENT',
  'detyrime-furnitor': 'Detyrime Furnitor',
  'analize-veprime-furnitor': 'ANALIZE VEPRIME FURNITOR',
  'raport-shitje-artikuj': 'Raport Shitje — Artikuj',
  'raport-blerje-artikuj': 'Raport Blerje — Artikuj',
  'raport-shpenzime':      'Raport Shpenzime Ditore',
  permbledhese: 'Përmbledhëse',
  marketing:    'Shpenzime Marketingu',
  komentet:     'Komentet',
  riparimet:    'Riparimet',
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
  onNavigate, onDateChange, user,
  canGoBack, onGoBack,
}) {
  const isSales = user?.role === 'sales'
  const rawNav = isSales
    ? NAV_GROUPS
        .map(g => ({
          ...g,
          items: g.items
            .map(it => it.children
              ? { ...it, children: it.children.filter(c => SALES_ALLOWED_PAGES.has(c.id)) }
              : it)
            .filter(it => it.children
              ? it.children.length > 0
              : SALES_ALLOWED_PAGES.has(it.id)),
        }))
        .filter(g => g.items.length > 0)
    : NAV_GROUPS
  // Për admin, riemërto "Shitjet" (dashboard) → "Historiku i Shitjeve".
  const NAV = isSales ? rawNav : rawNav.map(g => ({
    ...g,
    items: g.items.map(it => it.id === 'dashboard' ? { ...it, label: 'Historiku i Shitjeve' } : it),
  }))
  const now = new Date()
  const [y, m, d] = currentDate.split('-').map(Number)
  const dateLabel = `${d} ${ALBANIAN_MONTHS[m]} ${y}`

  const parentOfPage = findParentId(page)
  const [openMenus, setOpenMenus] = useState(() => parentOfPage ? { [parentOfPage]: true } : {})
  const toggleMenu = id => setOpenMenus(m => ({ ...m, [id]: !m[id] }))
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const headerTitle = (page === 'dashboard' && !isSales)
    ? 'Historiku i Shitjeve'
    : (PAGE_TITLES[page] ?? getChildTitle(page) ?? 'Faqe')
  const unreadComments = useUnreadCommentsCount()
  const { theme, toggle: toggleTheme } = useTheme()

  // Në mobile, kliku në një zë navigacioni mbyll sidebar-in.
  const handleNavigate = (id) => {
    onNavigate(id)
    setSidebarOpen(false)
  }

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 dark:bg-slate-950">
      <CommentToast onOpenKomentet={() => handleNavigate('komentet')} />

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
          w-60 bg-white border-r border-slate-200 dark:bg-slate-900 dark:border-slate-800
          flex flex-col flex-shrink-0 shadow-xl
          fixed inset-y-0 left-0 z-40 transform transition-transform duration-200
          md:static md:translate-x-0
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        `}
      >

        {/* Logo */}
        <div className="px-5 py-5 border-b border-slate-200 dark:border-slate-700/60">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-yellow-500 rounded-xl flex items-center justify-center shadow-lg shadow-yellow-500/40 flex-shrink-0">
              <span className="text-white text-lg leading-none">💍</span>
            </div>
            <div>
              <h1 className="text-slate-800 dark:text-white font-bold text-base leading-tight tracking-tight">
                Cham Shop
              </h1>
              <p className="text-slate-500 dark:text-slate-400 text-xs">Sistem Inventari</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-4 overflow-y-auto">
          {NAV.map(group => (
            <div key={group.label}>
              <p className="section-title px-3 pb-1 text-slate-500 dark:text-slate-500 text-[10px]">{group.label}</p>
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
                          {item.id === 'komentet' && unreadComments > 0 && (
                            <span className="ml-auto min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold shadow-sm animate-pulse">
                              {unreadComments > 99 ? '99+' : unreadComments}
                            </span>
                          )}
                          {item.id !== 'komentet' && page === item.id && (
                            <span className="ml-auto w-1.5 h-1.5 bg-white/70 rounded-full" />
                          )}
                        </a>
                      )}
                      {hasChildren && isOpen && (
                        <div className="ml-6 mt-0.5 mb-1 space-y-0.5 border-l border-slate-200 dark:border-slate-700/60 pl-2">
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
        <div className="px-5 py-4 border-t border-slate-200 dark:border-slate-700/60 space-y-2">
          {user && (
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs text-slate-700 dark:text-slate-300 font-semibold truncate">
                  {user.role === 'admin' ? '🔐' : '🧾'} {user.username}
                </p>
                <p className="text-[10px] text-slate-500 uppercase">
                  {user.role === 'admin' ? 'Admin' : 'Shitës'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => { clearSession(); window.location.reload() }}
                className="text-[10px] text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-2 py-1 rounded-md font-medium
                           dark:text-slate-400 dark:hover:text-white dark:bg-slate-800 dark:hover:bg-slate-700"
                title="Dil"
              >Dil</button>
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse flex-shrink-0" />
            <span className="text-xs text-slate-500">Online</span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            {now.toLocaleDateString('sq-AL', {
              weekday: 'short', day: 'numeric',
              month: 'short', year: 'numeric',
            })}
          </p>
          {typeof __APP_VERSION__ !== 'undefined' && (
            <p className="text-[10px] text-slate-400 dark:text-slate-500 font-mono">
              v{__APP_VERSION__}
            </p>
          )}
        </div>
      </aside>

      {/* ── Main area ── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Top header */}
        <header className="bg-white border-b border-slate-200 dark:bg-slate-900 dark:border-slate-800 px-3 md:px-6 h-14 flex items-center justify-between flex-shrink-0 gap-2">
          <div className="flex items-center gap-2 md:gap-4 min-w-0 flex-1">
            {/* Hamburger për mobile */}
            <button
              onClick={() => setSidebarOpen(true)}
              className="md:hidden w-9 h-9 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 flex-shrink-0"
              aria-label="Hap menynë"
            >
              <span className="text-xl leading-none">☰</span>
            </button>
            {canGoBack && (
              <button
                type="button"
                onClick={onGoBack}
                className="flex items-center gap-1 px-2 md:px-3 h-9 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 text-xs md:text-sm font-medium flex-shrink-0"
                title="Kthehu te faqja e mëparshme"
                aria-label="Kthehu Mbrapa"
              >
                <span className="text-base leading-none">←</span>
                <span className="hidden sm:inline">Kthehu Mbrapa</span>
              </button>
            )}
            <h2 className="text-sm md:text-base font-bold text-slate-800 dark:text-slate-100 truncate">{headerTitle}</h2>

            {/* Daily date nav — show on any date-driven page */}
            {(parentOfPage || ['arka'].includes(page)) && page !== 'permbledhese' && !PAGES_WITH_OWN_DATE_FILTER.has(page) && (
              <div className="hidden lg:flex items-center gap-1.5">
                <button
                  onClick={() => onDateChange(prevDay(currentDate))}
                  className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 font-bold text-sm"
                >‹</button>
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200 px-1">{dateLabel}</span>
                <input
                  type="date"
                  value={currentDate}
                  onChange={e => onDateChange(e.target.value)}
                  className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100"
                />
                <button
                  onClick={() => onDateChange(nextDay(currentDate))}
                  className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 font-bold text-sm"
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
            <button
              type="button"
              onClick={toggleTheme}
              className="flex items-center justify-center w-9 h-9 rounded-lg transition-colors bg-slate-100 hover:bg-slate-200 text-slate-600 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300"
              title={theme === 'dark' ? 'Kalo në Light mode' : 'Kalo në Dark mode'}
              aria-label="Ndrysho temën"
            >
              <span className="text-lg leading-none">{theme === 'dark' ? '☀️' : '🌙'}</span>
            </button>
            <button
              type="button"
              onClick={() => handleNavigate('komentet')}
              className={`relative flex items-center justify-center w-9 h-9 rounded-lg transition-colors ${
                unreadComments > 0
                  ? 'bg-red-50 hover:bg-red-100 text-red-600 dark:bg-red-900/40 dark:hover:bg-red-900/60 dark:text-red-300'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-600 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300'
              }`}
              title={unreadComments > 0 ? `${unreadComments} komente të palexuara` : 'Komentet'}
              aria-label="Komentet"
            >
              <span className="text-lg leading-none">💬</span>
              {unreadComments > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold shadow-md animate-pulse ring-2 ring-white dark:ring-slate-900">
                  {unreadComments > 99 ? '99+' : unreadComments}
                </span>
              )}
            </button>
            <a
              href="/api/backup"
              download
              className="flex items-center gap-1.5 px-2 md:px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 text-xs font-medium rounded-lg transition-colors"
              title="Shkarko backup të bazës së të dhënave"
            >
              💾 <span className="hidden sm:inline">Backup</span>
            </a>
            <span className="text-xs text-slate-400 dark:text-slate-500 hidden lg:block">
              {now.toLocaleDateString('sq-AL', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
            <div className="w-8 h-8 bg-gradient-to-br from-yellow-400 to-yellow-600 rounded-lg flex items-center justify-center text-white text-sm font-bold shadow-sm">
              G
            </div>
          </div>
        </header>

        {/* Date nav për mobile / tablet — nën header */}
        {(parentOfPage || ['arka'].includes(page)) && page !== 'permbledhese' && !PAGES_WITH_OWN_DATE_FILTER.has(page) && (
          <div className="lg:hidden bg-white border-b border-slate-200 dark:bg-slate-900 dark:border-slate-800 px-3 py-2 flex items-center gap-1.5 flex-wrap flex-shrink-0">
            <button
              onClick={() => onDateChange(prevDay(currentDate))}
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 font-bold text-sm"
            >‹</button>
            <input
              type="date"
              value={currentDate}
              onChange={e => onDateChange(e.target.value)}
              className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100 flex-1 min-w-[130px]"
            />
            <button
              onClick={() => onDateChange(nextDay(currentDate))}
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 font-bold text-sm"
            >›</button>
            <button
              onClick={() => onDateChange(new Date().toISOString().split('T')[0])}
              className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700"
            >Sot</button>
          </div>
        )}

        {/* Page content */}
        <main className={`flex-1 overflow-auto p-3 md:p-6 ${page !== 'dashboard' ? 'thick-inputs' : ''}`}>
          {children}
        </main>
      </div>
    </div>
  )
}
