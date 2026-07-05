// One-shot: read the local sql.js inventory.db and copy every row to Turso.
// Run once, then delete or archive the local file.
//
//   node server/migrate-to-turso.js
//
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import initSqlJs from 'sql.js';
import { createClient } from '@libsql/client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_DB = path.join(__dirname, '..', 'data', 'inventory.db');

if (!fs.existsSync(LOCAL_DB)) {
  console.error('Local DB not found at', LOCAL_DB);
  process.exit(1);
}

const remote = createClient({
  url: process.env.TURSO_URL,
  authToken: process.env.TURSO_TOKEN,
  intMode: 'number',
});

const SQL = await initSqlJs();
const local = new SQL.Database(fs.readFileSync(LOCAL_DB));

function readAll(sql) {
  const stmt = local.prepare(sql);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

// Get list of user tables in the source DB.
const tables = readAll(
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
).map(r => r.name);

// Order matters for FK: parents before children. Everything else is unrelated.
const PARENT_FIRST = [
  'daily_records', 'sales', 'customer_debts', 'inventory', 'marketing_expenses',
  'products', 'safe_withdrawals', 'safe_conversions',
  'invoices', 'invoice_items', 'invoice_payments',
  'exchange_rates', 'suppliers', 'clients',
  'purchase_invoices', 'purchase_items', 'purchase_payments',
  'hurda_purchases', 'has_purchases',
  'flete_hyrje', 'flete_hyrje_items', 'flete_dalje', 'flete_dalje_items',
  'warehouses', 'expense_categories', 'expense_entries',
  'magazina_hyrje', 'magazina_hyrje_items', 'magazina_dalje', 'magazina_dalje_items',
];
const ordered = [
  ...PARENT_FIRST.filter(t => tables.includes(t)),
  ...tables.filter(t => !PARENT_FIRST.includes(t)),
];

// Disable FK checks so bulk copy can insert child rows even if a parent hasn't
// been copied yet, and re-runs can wipe target tables safely.
await remote.execute('PRAGMA foreign_keys = OFF');

let totalRows = 0;
for (const table of ordered) {
  const rows = readAll(`SELECT * FROM ${table}`);
  if (rows.length === 0) {
    console.log(`  ${table}: 0 rows (skipped)`);
    continue;
  }

  // Wipe target first so re-runs are idempotent.
  await remote.execute(`DELETE FROM ${table}`);

  const cols = Object.keys(rows[0]);
  const placeholders = cols.map(() => '?').join(', ');
  const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`;

  // Batch inserts (chunks of 100) to keep round-trips down.
  const CHUNK = 100;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const stmts = chunk.map(row => ({
      sql,
      args: cols.map(c => row[c] === undefined ? null : row[c]),
    }));
    await remote.batch(stmts, 'write');
  }

  totalRows += rows.length;
  console.log(`  ${table}: ${rows.length} rows`);
}

console.log(`\nDone. Migrated ${totalRows} rows across ${ordered.length} tables.`);
