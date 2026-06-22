import { useState, useEffect, useCallback } from 'react'
import CashRegister from './CashRegister.jsx'
import SalesSection from './SalesSection.jsx'
import Inventory from './Inventory.jsx'

const TABS = [
  { id: 'arka', label: 'ARKA' },
  { id: 'flori', label: 'Shitje Flori' },
  { id: 'diamant', label: 'Shitje Diamant' },
  { id: 'online', label: 'Shitje Online/Staff' },
  { id: 'inventar', label: 'Inventar' },
]

export default function DailyLog({ date }) {
  const [activeTab, setActiveTab] = useState('arka')
  const [salesCounts, setSalesCounts] = useState({ flori: 0, diamant: 0, online: 0 })

  const refreshCounts = useCallback(async () => {
    try {
      const res = await fetch(`/api/sales/${date}`)
      const all = await res.json()
      const counts = { flori: 0, diamant: 0, online: 0 }
      all.forEach(s => { if (counts[s.type] !== undefined) counts[s.type]++ })
      setSalesCounts(counts)
    } catch (e) {
      console.error(e)
    }
  }, [date])

  useEffect(() => {
    refreshCounts()
  }, [refreshCounts])

  return (
    <div className="flex flex-col h-full">
      {/* Tab Bar */}
      <div className="bg-white border-b border-slate-200 px-4 flex gap-1 overflow-x-auto">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-3 text-sm whitespace-nowrap transition-colors border-b-2 -mb-px ${
              activeTab === tab.id
                ? 'border-blue-500 text-blue-700 font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.label}
            {(tab.id === 'flori' || tab.id === 'diamant' || tab.id === 'online') && salesCounts[tab.id] > 0 && (
              <span className="ml-1.5 bg-blue-100 text-blue-800 text-xs px-1.5 py-0.5 rounded-full">
                {salesCounts[tab.id]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-auto p-4">
        {activeTab === 'arka' && <CashRegister date={date} />}
        {activeTab === 'flori' && <SalesSection date={date} type="flori" onSaleChange={refreshCounts} />}
        {activeTab === 'diamant' && <SalesSection date={date} type="diamant" onSaleChange={refreshCounts} />}
        {activeTab === 'online' && <SalesSection date={date} type="online" onSaleChange={refreshCounts} />}
        {activeTab === 'inventar' && <Inventory date={date} />}
      </div>
    </div>
  )
}
