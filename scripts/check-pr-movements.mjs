import 'dotenv/config';
import { createClient } from '@libsql/client/web';

const client = createClient({
  url: process.env.TURSO_URL,
  authToken: process.env.TURSO_TOKEN,
  intMode: 'number',
});

const BARCODES = process.argv.slice(2);
if (BARCODES.length === 0) {
  BARCODES.push('PR0000369', 'PR0000332');
}

for (const bc of BARCODES) {
  console.log(`\n================= BARKOD: ${bc} =================`);

  // Produkti
  const p = await client.execute({
    sql: `SELECT id, serial_no, barcode, name, category, stock, created_at, last_purchase_date
            FROM products WHERE barcode = ?`,
    args: [bc],
  });
  console.log('\n--- Produkti ---');
  if (p.rows.length === 0) {
    console.log('  (nuk u gjet produkt me kete barkod)');
    continue;
  }
  for (const r of p.rows) {
    console.log(`  id=${r.id}, serial=${r.serial_no}, name="${r.name}", cat=${r.category}`);
    console.log(`  stock=${r.stock}, created_at=${r.created_at}, last_purchase_date=${r.last_purchase_date}`);
  }

  const productId = p.rows[0].id;

  // Blerjet (purchase_invoices + purchase_items)
  console.log('\n--- BLERJE (purchase_invoices) ---');
  const pi = await client.execute({
    sql: `SELECT pi.id AS item_id, pi.purchase_id, pi.barcode, pi.name, pi.qty, pi.product_id,
                 pu.invoice_no, pu.date, pu.supplier_name, pu.created_at, pu.type, pu.original_purchase_id
            FROM purchase_items pi
            JOIN purchase_invoices pu ON pu.id = pi.purchase_id
           WHERE pi.barcode = ? OR pi.product_id = ?
           ORDER BY pu.date, pu.id`,
    args: [bc, productId],
  });
  if (pi.rows.length === 0) console.log('  (asnjë)');
  for (const it of pi.rows) {
    const kind = it.type === 'return' ? 'KTHIM-BLERJE' : 'BLERJE';
    console.log(`  [${kind}] ${it.invoice_no} | date=${it.date} | furnitor="${it.supplier_name}"`);
    console.log(`           qty=${it.qty}, product_id=${it.product_id}, barcode=${it.barcode}`);
    if (it.original_purchase_id) console.log(`           original_purchase_id=${it.original_purchase_id}`);
    console.log(`           created_at=${it.created_at}`);
  }

  // Shitje / Kthime (invoice_items)
  console.log('\n--- SHITJE / KTHIME (invoices) ---');
  const items = await client.execute({
    sql: `SELECT ii.id AS item_id, ii.invoice_id, ii.barcode, ii.name, ii.product_id,
                 ii.qty, ii.total_with_vat,
                 i.invoice_no, i.date, i.customer_name, i.payment_method,
                 i.is_credit_note, i.parent_invoice_id,
                 i.total_with_vat AS inv_total, i.paid_cash, i.paid_bank, i.paid_pos,
                 i.amount_paid, i.amount_due,
                 COALESCE(i.cancelled, 0) AS cancelled,
                 i.created_at
            FROM invoice_items ii
            JOIN invoices i ON i.id = ii.invoice_id
           WHERE ii.barcode = ? OR ii.product_id = ?
           ORDER BY i.date, i.id`,
    args: [bc, productId],
  });
  if (items.rows.length === 0) console.log('  (asnjë)');
  for (const it of items.rows) {
    const kind = it.is_credit_note ? 'KTHIM-SHITJE' : 'SHITJE';
    console.log(`  [${kind}] Fatura ${it.invoice_no} | date=${it.date} | klient="${it.customer_name}"`);
    console.log(`         qty=${it.qty}, item_total=${it.total_with_vat}, pm=${it.payment_method}, product_id=${it.product_id}, barcode=${it.barcode}`);
    console.log(`         inv_total=${it.inv_total}, amount_paid=${it.amount_paid}, amount_due=${it.amount_due}`);
    console.log(`         paid_cash=${it.paid_cash}, paid_bank=${it.paid_bank}, paid_pos=${it.paid_pos}, cancelled=${it.cancelled}`);
    if (it.parent_invoice_id) console.log(`         parent_invoice_id=${it.parent_invoice_id}`);
    console.log(`         created_at=${it.created_at}`);
  }

  // Magazina hyrje
  console.log('\n--- MAGAZINA HYRJE ---');
  const mh = await client.execute({
    sql: `SELECT mhi.id, mhi.magazina_id, mhi.barcode, mhi.name, mhi.qty, mhi.product_id,
                 mh.ref_no, mh.warehouse_code, mh.date, mh.created_at
            FROM magazina_hyrje_items mhi
            JOIN magazina_hyrje mh ON mh.id = mhi.magazina_id
           WHERE mhi.barcode = ? OR mhi.product_id = ?
           ORDER BY mh.date, mh.id`,
    args: [bc, productId],
  });
  if (mh.rows.length === 0) console.log('  (asnjë)');
  for (const it of mh.rows) {
    console.log(`  [MAG-HYRJE] ${it.ref_no} | wh=${it.warehouse_code} | date=${it.date} | qty=${it.qty} | product_id=${it.product_id} | barcode=${it.barcode} | created_at=${it.created_at}`);
  }

  // Magazina dalje
  console.log('\n--- MAGAZINA DALJE ---');
  const md = await client.execute({
    sql: `SELECT mdi.id, mdi.magazina_id, mdi.barcode, mdi.name, mdi.qty, mdi.product_id,
                 md.ref_no, md.warehouse_code, md.date, md.created_at
            FROM magazina_dalje_items mdi
            JOIN magazina_dalje md ON md.id = mdi.magazina_id
           WHERE mdi.barcode = ? OR mdi.product_id = ?
           ORDER BY md.date, md.id`,
    args: [bc, productId],
  });
  if (md.rows.length === 0) console.log('  (asnjë)');
  for (const it of md.rows) {
    console.log(`  [MAG-DALJE] ${it.ref_no} | wh=${it.warehouse_code} | date=${it.date} | qty=${it.qty} | product_id=${it.product_id} | barcode=${it.barcode} | created_at=${it.created_at}`);
  }

  // Flete hyrje
  console.log('\n--- FLETE HYRJE ---');
  const fh = await client.execute({
    sql: `SELECT fhi.id, fhi.flete_id, fhi.barcode, fhi.name, fhi.qty, fhi.product_id,
                 fh.ref_no, fh.date, fh.created_at
            FROM flete_hyrje_items fhi
            JOIN flete_hyrje fh ON fh.id = fhi.flete_id
           WHERE fhi.barcode = ? OR fhi.product_id = ?
           ORDER BY fh.date, fh.id`,
    args: [bc, productId],
  });
  if (fh.rows.length === 0) console.log('  (asnjë)');
  for (const it of fh.rows) {
    console.log(`  [FL-HYRJE] ${it.ref_no} | date=${it.date} | qty=${it.qty} | product_id=${it.product_id} | barcode=${it.barcode} | created_at=${it.created_at}`);
  }

  // Flete dalje
  console.log('\n--- FLETE DALJE ---');
  const fd = await client.execute({
    sql: `SELECT fdi.id, fdi.flete_id, fdi.barcode, fdi.name, fdi.qty, fdi.product_id,
                 fd.ref_no, fd.date, fd.created_at
            FROM flete_dalje_items fdi
            JOIN flete_dalje fd ON fd.id = fdi.flete_id
           WHERE fdi.barcode = ? OR fdi.product_id = ?
           ORDER BY fd.date, fd.id`,
    args: [bc, productId],
  });
  if (fd.rows.length === 0) console.log('  (asnjë)');
  for (const it of fd.rows) {
    console.log(`  [FL-DALJE] ${it.ref_no} | date=${it.date} | qty=${it.qty} | product_id=${it.product_id} | barcode=${it.barcode} | created_at=${it.created_at}`);
  }

  // Bilanci (hyrjet - daljet)
  const inQty = (pi.rows.filter(r => r.type !== 'return').reduce((s, r) => s + (r.qty || 0), 0))
              + mh.rows.reduce((s, r) => s + (r.qty || 0), 0)
              + fh.rows.reduce((s, r) => s + (r.qty || 0), 0)
              + items.rows.filter(r => r.is_credit_note).reduce((s, r) => s + (r.qty || 0), 0);
  const outQty = (pi.rows.filter(r => r.type === 'return').reduce((s, r) => s + (r.qty || 0), 0))
               + md.rows.reduce((s, r) => s + (r.qty || 0), 0)
               + fd.rows.reduce((s, r) => s + (r.qty || 0), 0)
               + items.rows.filter(r => !r.is_credit_note && !r.cancelled).reduce((s, r) => s + (r.qty || 0), 0);
  console.log(`\n--- BILANCI ---`);
  console.log(`  HYRJE total: ${inQty}`);
  console.log(`  DALJE total: ${outQty}`);
  console.log(`  Pritet stock = ${inQty - outQty}`);
  console.log(`  Stock aktual nga products.stock = ${p.rows[0].stock}`);
}

console.log('\n(fund)');
