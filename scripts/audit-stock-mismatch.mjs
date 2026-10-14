// Gjej te gjitha produktet qe duhet te kene stock=0 (sepse jane shitur)
// por kane stock>0 ne tabelen `products`. Formula:
//   expected_stock = SUM(blerje qty) + SUM(magazina_hyrje qty) + SUM(flete_hyrje qty)
//                  + SUM(kthim-shitje qty)
//                  - SUM(shitje qty) - SUM(magazina_dalje qty) - SUM(flete_dalje qty)
// Shkruaj listen e produkteve me mismatch (stock > expected).
import 'dotenv/config';
import { createClient } from '@libsql/client/web';

const c = createClient({
  url: process.env.TURSO_URL,
  authToken: process.env.TURSO_TOKEN,
  intMode: 'number',
});

// Pergatit map me shuma per cdo product_id
const buy = new Map();  // purchase_items (exclude 'return' type)
const buyReturn = new Map();  // purchase_invoices.type = 'return'
const sale = new Map(); // invoice_items ku invoice jo credit-note dhe jo cancelled
const saleReturn = new Map(); // invoice_items ku invoice credit-note
const mhIn = new Map(); // magazina_hyrje
const mdOut = new Map(); // magazina_dalje
const fhIn = new Map(); // flete_hyrje
const fdOut = new Map(); // flete_dalje

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
  if (r.canc) continue; // fatura e anuluar — nuk prek stock-un
  if (r.cn) add(saleReturn, r.product_id, r.q);
  else add(sale, r.product_id, r.q);
}

const mhRows = await c.execute(`
  SELECT product_id, SUM(qty) AS q FROM magazina_hyrje_items
   WHERE product_id IS NOT NULL GROUP BY product_id`);
for (const r of mhRows.rows) add(mhIn, r.product_id, r.q);

const mdRows = await c.execute(`
  SELECT product_id, SUM(qty) AS q FROM magazina_dalje_items
   WHERE product_id IS NOT NULL GROUP BY product_id`);
for (const r of mdRows.rows) add(mdOut, r.product_id, r.q);

const fhRows = await c.execute(`
  SELECT product_id, SUM(qty) AS q FROM flete_hyrje_items
   WHERE product_id IS NOT NULL GROUP BY product_id`);
for (const r of fhRows.rows) add(fhIn, r.product_id, r.q);

const fdRows = await c.execute(`
  SELECT product_id, SUM(qty) AS q FROM flete_dalje_items
   WHERE product_id IS NOT NULL GROUP BY product_id`);
for (const r of fdRows.rows) add(fdOut, r.product_id, r.q);

// Marketing in-kind (produkte dhene si marketing) — zbret stock
const mktRows = await c.execute(`
  SELECT product_id, SUM(COALESCE(product_qty,1)) AS q FROM marketing_expenses
   WHERE product_id IS NOT NULL GROUP BY product_id`);
const mktOut = new Map();
for (const r of mktRows.rows) add(mktOut, r.product_id, r.q);

// Marketing contract entries (produkte si marketing kontrate) — zbret stock
const mcRows = await c.execute(`
  SELECT product_id, SUM(COALESCE(product_qty,1)) AS q FROM marketing_contract_entries
   WHERE type='product' AND product_id IS NOT NULL GROUP BY product_id`);
const mcOut = new Map();
for (const r of mcRows.rows) add(mcOut, r.product_id, r.q);

// Lexo produktet
const prods = await c.execute(`SELECT id, barcode, name, stock FROM products`);

const mismatches = [];
for (const p of prods.rows) {
  const pid = p.id;
  const expIn = (buy.get(pid) || 0) + (saleReturn.get(pid) || 0)
              + (mhIn.get(pid) || 0) + (fhIn.get(pid) || 0);
  const expOut = (sale.get(pid) || 0) + (buyReturn.get(pid) || 0)
               + (mdOut.get(pid) || 0) + (fdOut.get(pid) || 0)
               + (mktOut.get(pid) || 0) + (mcOut.get(pid) || 0);
  const expected = expIn - expOut;
  const actual = p.stock || 0;
  if (actual !== expected && (actual > expected)) {
    mismatches.push({ id: pid, barcode: p.barcode, name: p.name, actual, expected, diff: actual - expected });
  }
}

mismatches.sort((a, b) => b.diff - a.diff);
console.log(`U gjeten ${mismatches.length} produkte me stock > expected (shitur por stock>0):`);
console.log('');
console.log('id\tbarcode\tactual\texpected\tdiff\tname');
for (const m of mismatches) {
  console.log(`${m.id}\t${m.barcode}\t${m.actual}\t${m.expected}\t${m.diff}\t${m.name}`);
}

// Shkruaj SQL per rregullim
console.log('\n--- SQL FIX ---');
for (const m of mismatches) {
  console.log(`UPDATE products SET stock = ${m.expected} WHERE id = ${m.id}; -- ${m.barcode} ${m.name}`);
}
