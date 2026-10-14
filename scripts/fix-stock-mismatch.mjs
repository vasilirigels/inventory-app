// Rregullon stock-un e produkteve me mismatch nga audit.
// Logjika: expected = SUM(hyrje) - SUM(dalje); vendos stock = MAX(0, expected).
// Edhe produktet me expected<0 (orfane) vendosin stock=0 (jane fizikisht jashte).
// DRY RUN si default — kalo --apply për të ekzekutuar.
import 'dotenv/config';
import { createClient } from '@libsql/client/web';

const APPLY = process.argv.includes('--apply');

const c = createClient({
  url: process.env.TURSO_URL,
  authToken: process.env.TURSO_TOKEN,
  intMode: 'number',
});

const buy = new Map();
const buyReturn = new Map();
const sale = new Map();
const saleReturn = new Map();
const mhIn = new Map();
const mdOut = new Map();
const fhIn = new Map();
const fdOut = new Map();
const mktOut = new Map();
const mcOut = new Map();

const add = (m, k, v) => m.set(k, (m.get(k) || 0) + v);

const buyRows = await c.execute(`
  SELECT pi.product_id, SUM(pi.qty) AS q, pu.type
    FROM purchase_items pi
    JOIN purchase_invoices pu ON pu.id = pi.purchase_id
   WHERE pi.product_id IS NOT NULL
   GROUP BY pi.product_id, pu.type`);
for (const r of buyRows.rows) {
  if (r.type === 'return') add(buyReturn, r.product_id, r.q);
  else add(buy, r.product_id, r.q);
}

const invRows = await c.execute(`
  SELECT ii.product_id, SUM(ii.qty) AS q,
         COALESCE(i.is_credit_note,0) AS cn,
         COALESCE(i.cancelled,0) AS canc
    FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id
   WHERE ii.product_id IS NOT NULL
   GROUP BY ii.product_id, cn, canc`);
for (const r of invRows.rows) {
  if (r.canc) continue;
  if (r.cn) add(saleReturn, r.product_id, r.q);
  else add(sale, r.product_id, r.q);
}

for (const [table, m] of [
  ['magazina_hyrje_items', mhIn],
  ['magazina_dalje_items', mdOut],
  ['flete_hyrje_items', fhIn],
  ['flete_dalje_items', fdOut],
]) {
  const rows = await c.execute(`
    SELECT product_id, SUM(qty) AS q FROM ${table}
     WHERE product_id IS NOT NULL GROUP BY product_id`);
  for (const r of rows.rows) add(m, r.product_id, r.q);
}

const mktRows = await c.execute(`
  SELECT product_id, SUM(COALESCE(product_qty,1)) AS q FROM marketing_expenses
   WHERE product_id IS NOT NULL GROUP BY product_id`);
for (const r of mktRows.rows) add(mktOut, r.product_id, r.q);

const mcRows = await c.execute(`
  SELECT product_id, SUM(COALESCE(product_qty,1)) AS q FROM marketing_contract_entries
   WHERE type='product' AND product_id IS NOT NULL GROUP BY product_id`);
for (const r of mcRows.rows) add(mcOut, r.product_id, r.q);

const prods = await c.execute(`SELECT id, barcode, name, stock FROM products`);

const fixes = [];
for (const p of prods.rows) {
  const pid = p.id;
  const expIn = (buy.get(pid) || 0) + (saleReturn.get(pid) || 0)
              + (mhIn.get(pid) || 0) + (fhIn.get(pid) || 0);
  const expOut = (sale.get(pid) || 0) + (buyReturn.get(pid) || 0)
               + (mdOut.get(pid) || 0) + (fdOut.get(pid) || 0)
               + (mktOut.get(pid) || 0) + (mcOut.get(pid) || 0);
  const expected = Math.max(0, expIn - expOut);
  const actual = p.stock || 0;
  if (actual > expected) {
    fixes.push({ id: pid, barcode: p.barcode, name: p.name, actual, expected });
  }
}

console.log(`U gjeten ${fixes.length} produkte per rregullim.`);
console.log(`Mode: ${APPLY ? 'APPLY (do te shkruaj)' : 'DRY RUN (asgje nuk ndryshon)'}`);
console.log('');

if (!APPLY) {
  for (const f of fixes.slice(0, 20)) {
    console.log(`  #${f.id} ${f.barcode} stock: ${f.actual} -> ${f.expected} (${f.name})`);
  }
  if (fixes.length > 20) console.log(`  ... +${fixes.length - 20} te tjera`);
  console.log('\nPer te ekzekutuar: node scripts/fix-stock-mismatch.mjs --apply');
  process.exit(0);
}

// Apliko ne batch-e nga 50 (Turso ka limit ne batch size)
const BATCH = 50;
let done = 0;
for (let i = 0; i < fixes.length; i += BATCH) {
  const chunk = fixes.slice(i, i + BATCH);
  const stmts = chunk.map(f => ({
    sql: 'UPDATE products SET stock = ? WHERE id = ?',
    args: [f.expected, f.id],
  }));
  await c.batch(stmts, 'write');
  done += chunk.length;
  console.log(`  ${done}/${fixes.length} rregulluar...`);
}

console.log(`\n✅ ${fixes.length} produkte u rregulluan.`);
