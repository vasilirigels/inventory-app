import { useEffect, useState } from 'react'

const TYPES = [
  { key: 'flori',   label: 'FLORI'   },
  { key: 'diamant', label: 'DIAMANT' },
  { key: 'online',  label: 'ONLINE & STAFI' },
]
const CUR = ['lek', 'eur', 'usd', 'gbp', 'chf']

function n(v) { return parseFloat(v) || 0 }
function fmt(v) {
  const val = n(v)
  if (val === 0) return '-'
  return val.toLocaleString('sq-AL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

function sumByType(sales, type, isReturn) {
  const f = sales.filter(s => s.type === type && !!s.is_return === isReturn)
  return {
    cope:    f.reduce((a, s) => a + n(s.cope), 0),
    gram:    f.reduce((a, s) => a + n(s.gram), 0),
    lek:     f.reduce((a, s) => a + n(s.lek_cash) + n(s.lek_pb), 0),
    eur:     f.reduce((a, s) => a + n(s.eur_cash) + n(s.eur_pb), 0),
    usd:     f.reduce((a, s) => a + n(s.usd_cash), 0),
    gbp:     f.reduce((a, s) => a + n(s.gbp_cash), 0),
    chf:     f.reduce((a, s) => a + n(s.chf_cash), 0),
  }
}

export default function XhiroNeto({ date }) {
  const [sales, setSales] = useState([])
  useEffect(() => {
    fetch(`/api/sales/${date}`).then(r => r.json()).then(setSales).catch(() => setSales([]))
  }, [date])

  const rows = TYPES.map(t => {
    const sale = sumByType(sales, t.key, false)
    const ret  = sumByType(sales, t.key, true)
    const net = {}
    Object.keys(sale).forEach(k => { net[k] = sale[k] - ret[k] })
    return { ...t, sale, ret, net }
  })

  const grand = { cope: 0, gram: 0, lek: 0, eur: 0, usd: 0, gbp: 0, chf: 0 }
  rows.forEach(r => Object.keys(grand).forEach(k => { grand[k] += r.net[k] }))

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <h3 className="text-lg font-bold text-slate-800">Xhiro Neto</h3>
        <p className="text-xs text-slate-500 mt-1 mb-4">Shitje totale minus kthimet, ndarë sipas kategorisë.</p>

        {rows.map(r => (
          <div key={r.key} className="mb-5">
            <h4 className="font-semibold text-slate-700 mb-2 text-sm">{r.label}</h4>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="text-left px-3 py-1.5 text-xs text-slate-600">Sek.</th>
                  <th className="text-right px-3 py-1.5 text-xs text-slate-600">Copë</th>
                  <th className="text-right px-3 py-1.5 text-xs text-slate-600">Gram</th>
                  {CUR.map(c => <th key={c} className="text-right px-3 py-1.5 text-xs text-slate-600">{c.toUpperCase()}</th>)}
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-slate-100">
                  <td className="px-3 py-1.5 text-slate-600">Shitje</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmt(r.sale.cope)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmt(r.sale.gram)}</td>
                  {CUR.map(c => <td key={c} className="px-3 py-1.5 text-right tabular-nums">{fmt(r.sale[c])}</td>)}
                </tr>
                <tr className="border-b border-slate-100">
                  <td className="px-3 py-1.5 text-slate-600">Kthime</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-rose-600">{fmt(r.ret.cope)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-rose-600">{fmt(r.ret.gram)}</td>
                  {CUR.map(c => <td key={c} className="px-3 py-1.5 text-right tabular-nums text-rose-600">{fmt(r.ret[c])}</td>)}
                </tr>
                <tr className="bg-emerald-50 font-semibold">
                  <td className="px-3 py-1.5 text-slate-800">Neto</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-emerald-700">{fmt(r.net.cope)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-emerald-700">{fmt(r.net.gram)}</td>
                  {CUR.map(c => <td key={c} className="px-3 py-1.5 text-right tabular-nums text-emerald-700">{fmt(r.net[c])}</td>)}
                </tr>
              </tbody>
            </table>
          </div>
        ))}

        <div className="pt-3 border-t-2 border-slate-300">
          <h4 className="font-bold text-slate-800 mb-2 text-sm">Totali Ditor (neto)</h4>
          <div className="grid grid-cols-2 md:grid-cols-7 gap-2">
            <Tot label="Copë"  value={grand.cope} />
            <Tot label="Gram"  value={grand.gram} />
            {CUR.map(c => <Tot key={c} label={c.toUpperCase()} value={grand[c]} />)}
          </div>
        </div>
      </div>
    </div>
  )
}

function Tot({ label, value }) {
  return (
    <div className="bg-slate-50 rounded-md px-3 py-2 text-center">
      <p className="text-[10px] text-slate-500 uppercase">{label}</p>
      <p className="text-sm font-bold text-slate-800 tabular-nums mt-0.5">{fmt(value)}</p>
    </div>
  )
}
