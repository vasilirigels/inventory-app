// Helper i përbashkët për të gjitha script-et debug/inspect/find që lidhen me
// Turso PROD. Ka dy qëllime kryesore:
//
//   1. Kursen kod të përsëritur — çdo script i vjetër ka të njëjtin `turso()`
//      inline; tani thjesht `import { turso } from './lib/turso.mjs'`.
//
//   2. GUARD KUNDËR RUN-EVE AKSIDENTALE — pa këtë, çdo `node scripts/foo.mjs`
//      hitte prod-in dhe binte row-reads. Tani script-i ndalet nëse s'ka
//      SCRIPTS_ACK=1 në env, që të mos harrosh që po prek prod-in.
//
// Përdorim:
//   import { turso } from './lib/turso.mjs'
//   const rows = await turso('SELECT * FROM invoices LIMIT 10')
//
// Për ta ekzekutuar një herë:
//   SCRIPTS_ACK=1 node scripts/inspect-foo.mjs

import 'dotenv/config'

const TURSO_URL = process.env.TURSO_URL
const TURSO_TOKEN = process.env.TURSO_TOKEN

if (!TURSO_URL || !TURSO_TOKEN) {
  console.error('❌ Mungon TURSO_URL ose TURSO_TOKEN te .env')
  process.exit(1)
}

if (process.env.SCRIPTS_ACK !== '1') {
  console.error('')
  console.error('⚠️  KUJDES — po lidhesh me Turso PROD:')
  console.error(`    ${TURSO_URL}`)
  console.error('')
  console.error('   Çdo query bren row-reads nga kuota mujore.')
  console.error('   Për ta ekzekutuar, ri-run me:')
  console.error(`      SCRIPTS_ACK=1 node ${process.argv[1] || 'script.mjs'}`)
  console.error('')
  process.exit(2)
}

const host = TURSO_URL.replace(/^(libsql|https?):\/\//, '').split('/')[0]
const httpsUrl = `https://${host}/v2/pipeline`

// Track dhe printo row-reads gjithsej që të kesh vizibilitet mbi koston.
let totalReads = 0
export function totalReadsSoFar() { return totalReads }

export async function turso(sql, args) {
  const res = await fetch(httpsUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TURSO_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      requests: [
        { type: 'execute', stmt: args ? { sql, args } : { sql } },
        { type: 'close' },
      ],
    }),
  })
  const data = await res.json()
  if (data?.results?.[0]?.type === 'error') {
    throw new Error(JSON.stringify(data.results[0].error))
  }
  const r = data.results[0].response.result
  totalReads += (r.rows_read || 0)
  const cols = r.cols.map(c => c.name)
  return r.rows.map(row => Object.fromEntries(row.map((v, i) => [cols[i], v?.value ?? v])))
}

// Printo koston totale kur script-i mbaron.
process.on('beforeExit', () => {
  if (totalReads > 0) {
    console.error(`\n📊 Turso row-reads (script): ${totalReads.toLocaleString()}`)
  }
})
