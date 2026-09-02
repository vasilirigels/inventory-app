import 'dotenv/config';
import { createClient } from '@libsql/client/web';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const client = createClient({
  url: process.env.TURSO_URL,
  authToken: process.env.TURSO_TOKEN,
  intMode: 'number',
});

// Tabela që MBAHEN — llogaritë e login-it.
const KEEP = new Set(['users']);

// Radha e fshirjes: fëmijët përpara prindërve (për FK).
// Tabelat pa varësi mund të vijnë kudo.
const DELETE_ORDER = [
  // Shitje
  'invoice_payments',
  'invoice_payment_splits',
  'invoice_items',
  'invoices',
  // Blerje
  'purchase_payments',
  'purchase_invoice_payment_splits',
  'purchase_items',
  'purchase_invoices',
  // Blerje flori/hurda/has
  'hurda_purchases',
  'has_purchases',
  // Arka + lëvizje monetare
  'safe_withdrawals',
  'safe_conversions',
  'bank_movements',
  'daily_records',
  // Fletë hyrje/dalje
  'flete_hyrje_items',
  'flete_hyrje',
  'flete_dalje_items',
  'flete_dalje',
  // Magazina
  'magazina_hyrje_items',
  'magazina_hyrje',
  'magazina_dalje_items',
  'magazina_dalje',
  // Master data
  'products',
  'clients',
  'suppliers',
  'warehouses',
  // Shpenzime + marketing
  'expense_entries',
  'expense_categories',
  'marketing_expenses',
  'marketing_categories',
  // Të tjera
  'customer_debts',
  'sales',
  'inventory',
  'repairs',
  'comments',
  'exchange_rates',
  'material_categories',
];

// Merr të gjitha tabelat aktuale nga DB dhe verifiko që s'kemi harruar asnjë.
const allTablesRes = await client.execute(
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_litestream%'"
);
const allTables = allTablesRes.rows.map(r => r.name);
const declared = new Set([...DELETE_ORDER, ...KEEP]);
const missing = allTables.filter(t => !declared.has(t));
if (missing.length) {
  console.error('KUJDES — këto tabela ekzistojnë por s\'janë deklaruar:', missing);
  console.error('Duhen shtuar te DELETE_ORDER ose KEEP para se të vazhdojmë.');
  process.exit(1);
}

console.log('Tabela që MBAHEN:', [...KEEP].join(', '));
console.log(`Tabela që FSHIHEN: ${DELETE_ORDER.length}`);

// 1. BACKUP i plotë (edhe users, që të kemi snapshot komplet)
console.log('\n=== 1. BACKUP ===');
const backupDir = join(process.cwd(), 'data', 'backups');
mkdirSync(backupDir, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const file = join(backupDir, `full-reset-backup-${ts}.json`);
const out = {};
for (const t of allTables) {
  const r = await client.execute(`SELECT * FROM ${t}`);
  out[t] = r.rows.map(x => ({ ...x }));
  console.log(`  ${t}: ${out[t].length} rreshta`);
}
writeFileSync(file, JSON.stringify(out, null, 2));
console.log(`\nBackup: ${file}`);

// 2. WIPE
console.log('\n=== 2. WIPE ===');
for (const t of DELETE_ORDER) {
  const before = await client.execute(`SELECT COUNT(*) AS n FROM ${t}`);
  await client.execute(`DELETE FROM ${t}`);
  const after = await client.execute(`SELECT COUNT(*) AS n FROM ${t}`);
  console.log(`  ${t}: ${before.rows[0].n} → ${after.rows[0].n}`);
}

// 3. Konfirmo që users mbeti i paprekur
const uCnt = await client.execute(`SELECT COUNT(*) AS n FROM users`);
console.log(`\n[users] ${uCnt.rows[0].n} llogari të ruajtura (të paprekura)`);

console.log('\nU krye.');
process.exit(0);
