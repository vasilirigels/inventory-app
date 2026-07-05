import 'dotenv/config';
import { createClient } from '@libsql/client';

const TURSO_URL = process.env.TURSO_URL;
const TURSO_TOKEN = process.env.TURSO_TOKEN;

if (!TURSO_URL || !TURSO_TOKEN) {
  throw new Error('Missing TURSO_URL / TURSO_TOKEN in .env');
}

const client = createClient({
  url: TURSO_URL,
  authToken: TURSO_TOKEN,
  intMode: 'number',
});

let initialized = false;

// DDL that is safe to run every startup. Each entry runs individually so a
// failing ALTER (e.g. column already exists) doesn't abort the rest.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS daily_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL UNIQUE,
    opening_lek REAL DEFAULT 0,
    opening_eur REAL DEFAULT 0,
    opening_usd REAL DEFAULT 0,
    opening_gbp REAL DEFAULT 0,
    opening_chf REAL DEFAULT 0,
    expenses_lek REAL DEFAULT 0,
    expenses_eur REAL DEFAULT 0,
    expenses_usd REAL DEFAULT 0,
    biba_lek REAL DEFAULT 0,
    biba_eur REAL DEFAULT 0,
    biba_usd REAL DEFAULT 0,
    biba_gbp REAL DEFAULT 0,
    biba_chf REAL DEFAULT 0,
    biba_gram REAL DEFAULT 0,
    diana_lek REAL DEFAULT 0,
    diana_eur REAL DEFAULT 0,
    diana_usd REAL DEFAULT 0,
    diana_gbp REAL DEFAULT 0,
    diana_chf REAL DEFAULT 0,
    diana_hurda REAL DEFAULT 0,
    bank_withdraw_lek REAL DEFAULT 0,
    bank_withdraw_eur REAL DEFAULT 0,
    bank_withdraw_usd REAL DEFAULT 0,
    bank_deposit_lek REAL DEFAULT 0,
    bank_deposit_eur REAL DEFAULT 0,
    bank_deposit_usd REAL DEFAULT 0,
    conv_lek REAL DEFAULT 0,
    conv_eur REAL DEFAULT 0,
    conv_usd REAL DEFAULT 0,
    conv_gbp REAL DEFAULT 0,
    conv_chf REAL DEFAULT 0,
    hurda_lek REAL DEFAULT 0,
    hurda_eur REAL DEFAULT 0,
    hurda_usd REAL DEFAULT 0,
    hurda_gbp REAL DEFAULT 0,
    hurda_chf REAL DEFAULT 0,
    hurda_gram REAL DEFAULT 0,
    safe_deposit_lek REAL DEFAULT 0,
    safe_deposit_eur REAL DEFAULT 0,
    safe_withdraw_lek REAL DEFAULT 0,
    safe_withdraw_eur REAL DEFAULT 0,
    debt_settlement_eur REAL DEFAULT 0,
    debt_settlement_usd REAL DEFAULT 0,
    debt_settlement_gbp REAL DEFAULT 0,
    debt_settlement_chf REAL DEFAULT 0,
    debt_settlement_has REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('flori', 'diamant', 'online')),
    barcode TEXT,
    cope INTEGER DEFAULT 0,
    gram REAL DEFAULT 0,
    lek_cash REAL DEFAULT 0,
    lek_pb REAL DEFAULT 0,
    eur_cash REAL DEFAULT 0,
    eur_pb REAL DEFAULT 0,
    usd_cash REAL DEFAULT 0,
    gbp_cash REAL DEFAULT 0,
    chf_cash REAL DEFAULT 0,
    skonto_percent REAL DEFAULT 0,
    cm_etikete_usd REAL DEFAULT 0,
    cm_etikete_eur REAL DEFAULT 0,
    is_return INTEGER DEFAULT 0,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS customer_debts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('debt', 'repayment')),
    lek REAL DEFAULT 0,
    eur REAL DEFAULT 0,
    usd REAL DEFAULT 0,
    gbp REAL DEFAULT 0,
    chf REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('flori', 'diamant')),
    gram_start REAL DEFAULT 0,
    cope_start INTEGER DEFAULT 0,
    cost_price REAL DEFAULT 0,
    sell_price REAL DEFAULT 0,
    gram_in REAL DEFAULT 0,
    cope_in INTEGER DEFAULT 0,
    gram_out REAL DEFAULT 0,
    cope_out INTEGER DEFAULT 0,
    gram_sold REAL DEFAULT 0,
    cope_sold INTEGER DEFAULT 0,
    gram_end REAL DEFAULT 0,
    cope_end INTEGER DEFAULT 0,
    gram_real REAL DEFAULT 0,
    cope_real INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS marketing_expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    description TEXT,
    amount_lek REAL DEFAULT 0,
    amount_eur REAL DEFAULT 0,
    amount_usd REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    sku TEXT DEFAULT '',
    barcode TEXT DEFAULT '',
    category TEXT DEFAULT 'Tjeter',
    brand TEXT DEFAULT '',
    description TEXT DEFAULT '',
    cost_price REAL DEFAULT 0,
    sell_price REAL DEFAULT 0,
    stock INTEGER DEFAULT 0,
    min_stock INTEGER DEFAULT 5,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS safe_withdrawals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    amount_lek REAL DEFAULT 0,
    amount_eur REAL DEFAULT 0,
    amount_usd REAL DEFAULT 0,
    amount_gbp REAL DEFAULT 0,
    amount_chf REAL DEFAULT 0,
    person TEXT DEFAULT '',
    note TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS safe_conversions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    from_currency TEXT NOT NULL,
    from_amount REAL NOT NULL,
    to_currency TEXT NOT NULL,
    to_amount REAL NOT NULL,
    exchange_rate REAL DEFAULT 1,
    note TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    invoice_no TEXT NOT NULL,
    customer_name TEXT DEFAULT '',
    customer_nipt TEXT DEFAULT '',
    currency TEXT DEFAULT 'LEK',
    exchange_rate REAL DEFAULT 1,
    subtotal_no_vat REAL DEFAULT 0,
    total_discount REAL DEFAULT 0,
    total_vat REAL DEFAULT 0,
    total_with_vat REAL DEFAULT 0,
    payment_method TEXT DEFAULT 'cash',
    notes TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS invoice_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL,
    product_id INTEGER,
    barcode TEXT DEFAULT '',
    name TEXT DEFAULT '',
    qty REAL DEFAULT 0,
    unit_price_no_vat REAL DEFAULT 0,
    discount_percent REAL DEFAULT 0,
    subtotal_no_vat REAL DEFAULT 0,
    vat_rate REAL DEFAULT 20,
    vat_amount REAL DEFAULT 0,
    total_with_vat REAL DEFAULT 0,
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS invoice_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    amount REAL NOT NULL,
    payment_method TEXT DEFAULT 'cash',
    notes TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS exchange_rates (
    date TEXT NOT NULL,
    currency TEXT NOT NULL,
    rate REAL NOT NULL,
    source TEXT DEFAULT 'BSH',
    fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (date, currency)
  )`,

  `CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nipt TEXT DEFAULT '',
    name TEXT DEFAULT '',
    address TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nipt TEXT DEFAULT '',
    first_name TEXT DEFAULT '',
    last_name TEXT DEFAULT '',
    address TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS purchase_invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    invoice_no TEXT NOT NULL,
    supplier_name TEXT DEFAULT '',
    supplier_nipt TEXT DEFAULT '',
    currency TEXT DEFAULT 'LEK',
    exchange_rate REAL DEFAULT 1,
    subtotal_no_vat REAL DEFAULT 0,
    total_discount REAL DEFAULT 0,
    total_vat REAL DEFAULT 0,
    total_with_vat REAL DEFAULT 0,
    notes TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS purchase_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    purchase_id INTEGER NOT NULL,
    product_id INTEGER,
    barcode TEXT DEFAULT '',
    name TEXT DEFAULT '',
    qty REAL DEFAULT 0,
    purchase_price_no_vat REAL DEFAULT 0,
    discount_percent REAL DEFAULT 0,
    subtotal_no_vat REAL DEFAULT 0,
    vat_rate REAL DEFAULT 20,
    vat_amount REAL DEFAULT 0,
    total_with_vat REAL DEFAULT 0,
    sell_price REAL DEFAULT 0,
    FOREIGN KEY (purchase_id) REFERENCES purchase_invoices(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS purchase_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    purchase_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    amount REAL NOT NULL,
    payment_method TEXT DEFAULT 'cash',
    notes TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (purchase_id) REFERENCES purchase_invoices(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS hurda_purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    purchase_no TEXT NOT NULL,
    supplier_name TEXT DEFAULT '',
    supplier_nipt TEXT DEFAULT '',
    gram REAL DEFAULT 0,
    price_per_gram REAL DEFAULT 0,
    currency TEXT DEFAULT 'LEK',
    exchange_rate REAL DEFAULT 1,
    total_amount REAL DEFAULT 0,
    notes TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS has_purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    purchase_no TEXT NOT NULL,
    supplier_name TEXT DEFAULT '',
    supplier_nipt TEXT DEFAULT '',
    gram REAL DEFAULT 0,
    price_per_gram REAL DEFAULT 0,
    currency TEXT DEFAULT 'EUR',
    exchange_rate REAL DEFAULT 1,
    total_amount REAL DEFAULT 0,
    notes TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS flete_hyrje (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    ref_no TEXT NOT NULL,
    notes TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS flete_hyrje_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    flete_id INTEGER NOT NULL,
    product_id INTEGER,
    barcode TEXT DEFAULT '',
    name TEXT DEFAULT '',
    qty REAL DEFAULT 0,
    FOREIGN KEY (flete_id) REFERENCES flete_hyrje(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS flete_dalje (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    ref_no TEXT NOT NULL,
    notes TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS flete_dalje_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    flete_id INTEGER NOT NULL,
    product_id INTEGER,
    barcode TEXT DEFAULT '',
    name TEXT DEFAULT '',
    qty REAL DEFAULT 0,
    FOREIGN KEY (flete_id) REFERENCES flete_dalje(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS warehouses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT DEFAULT '',
    address TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS expense_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS expense_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    category_id INTEGER,
    description TEXT DEFAULT '',
    amount_lek REAL DEFAULT 0,
    amount_eur REAL DEFAULT 0,
    amount_usd REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES expense_categories(id) ON DELETE SET NULL
  )`,

  `CREATE TABLE IF NOT EXISTS magazina_hyrje (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    warehouse_code TEXT DEFAULT '',
    ref_no TEXT NOT NULL,
    currency TEXT DEFAULT 'LEK',
    exchange_rate REAL DEFAULT 1,
    subtotal REAL DEFAULT 0,
    total_discount REAL DEFAULT 0,
    total REAL DEFAULT 0,
    notes TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS magazina_hyrje_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    magazina_id INTEGER NOT NULL,
    product_id INTEGER,
    barcode TEXT DEFAULT '',
    name TEXT DEFAULT '',
    qty REAL DEFAULT 0,
    unit_price REAL DEFAULT 0,
    discount_percent REAL DEFAULT 0,
    subtotal REAL DEFAULT 0,
    FOREIGN KEY (magazina_id) REFERENCES magazina_hyrje(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS magazina_dalje (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    warehouse_code TEXT DEFAULT '',
    ref_no TEXT NOT NULL,
    currency TEXT DEFAULT 'LEK',
    exchange_rate REAL DEFAULT 1,
    subtotal REAL DEFAULT 0,
    total_discount REAL DEFAULT 0,
    total REAL DEFAULT 0,
    notes TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS magazina_dalje_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    magazina_id INTEGER NOT NULL,
    product_id INTEGER,
    barcode TEXT DEFAULT '',
    name TEXT DEFAULT '',
    qty REAL DEFAULT 0,
    unit_price REAL DEFAULT 0,
    discount_percent REAL DEFAULT 0,
    subtotal REAL DEFAULT 0,
    FOREIGN KEY (magazina_id) REFERENCES magazina_dalje(id) ON DELETE CASCADE
  )`,
];

// Additive ALTERs — each may fail if column already exists, that's fine.
const MIGRATIONS = [
  "ALTER TABLE products ADD COLUMN image_path TEXT DEFAULT ''",
  "ALTER TABLE products ADD COLUMN vat_rate REAL DEFAULT 20",
  "ALTER TABLE products ADD COLUMN unit TEXT DEFAULT 'copë'",
  "ALTER TABLE products ADD COLUMN material TEXT DEFAULT ''",
  "ALTER TABLE daily_records ADD COLUMN physical_cash_lek REAL DEFAULT 0",
  "ALTER TABLE daily_records ADD COLUMN physical_cash_eur REAL DEFAULT 0",
  "ALTER TABLE daily_records ADD COLUMN physical_cash_usd REAL DEFAULT 0",
  "ALTER TABLE daily_records ADD COLUMN physical_cash_gbp REAL DEFAULT 0",
  "ALTER TABLE daily_records ADD COLUMN physical_cash_chf REAL DEFAULT 0",
  "ALTER TABLE daily_records ADD COLUMN closeout_to_safe_lek REAL DEFAULT 0",
  "ALTER TABLE daily_records ADD COLUMN closeout_to_safe_eur REAL DEFAULT 0",
  "ALTER TABLE daily_records ADD COLUMN closeout_to_safe_usd REAL DEFAULT 0",
  "ALTER TABLE daily_records ADD COLUMN closeout_to_safe_gbp REAL DEFAULT 0",
  "ALTER TABLE daily_records ADD COLUMN closeout_to_safe_chf REAL DEFAULT 0",
  "ALTER TABLE daily_records ADD COLUMN safe_deposit_usd REAL DEFAULT 0",
  "ALTER TABLE daily_records ADD COLUMN safe_deposit_gbp REAL DEFAULT 0",
  "ALTER TABLE daily_records ADD COLUMN safe_deposit_chf REAL DEFAULT 0",
  "ALTER TABLE daily_records ADD COLUMN safe_withdraw_usd REAL DEFAULT 0",
  "ALTER TABLE daily_records ADD COLUMN safe_withdraw_gbp REAL DEFAULT 0",
  "ALTER TABLE daily_records ADD COLUMN safe_withdraw_chf REAL DEFAULT 0",
  "ALTER TABLE safe_withdrawals ADD COLUMN amount_usd REAL DEFAULT 0",
  "ALTER TABLE safe_withdrawals ADD COLUMN amount_gbp REAL DEFAULT 0",
  "ALTER TABLE safe_withdrawals ADD COLUMN amount_chf REAL DEFAULT 0",
  "ALTER TABLE invoices ADD COLUMN payment_method TEXT DEFAULT 'cash'",
  "ALTER TABLE invoices ADD COLUMN amount_paid REAL DEFAULT 0",
  "ALTER TABLE invoices ADD COLUMN amount_due REAL DEFAULT 0",
  "ALTER TABLE invoices ADD COLUMN cancelled INTEGER DEFAULT 0",
  "ALTER TABLE invoices ADD COLUMN is_credit_note INTEGER DEFAULT 0",
  "ALTER TABLE invoices ADD COLUMN parent_invoice_id INTEGER",
  "ALTER TABLE invoices ADD COLUMN paid_cash REAL DEFAULT 0",
  "ALTER TABLE invoices ADD COLUMN paid_pos  REAL DEFAULT 0",
  "ALTER TABLE invoices ADD COLUMN paid_bank REAL DEFAULT 0",
  "ALTER TABLE purchase_invoices ADD COLUMN payment_method TEXT DEFAULT 'cash'",
  "ALTER TABLE purchase_invoices ADD COLUMN amount_paid REAL DEFAULT 0",
  "ALTER TABLE purchase_invoices ADD COLUMN amount_due REAL DEFAULT 0",
  "ALTER TABLE expense_entries ADD COLUMN currency TEXT DEFAULT 'LEK'",
  "ALTER TABLE expense_entries ADD COLUMN amount REAL DEFAULT 0",
  "ALTER TABLE expense_entries ADD COLUMN exchange_rate REAL DEFAULT 1",
];

async function initDB() {
  if (initialized) return client;

  for (const sql of SCHEMA) {
    await client.execute(sql);
  }
  for (const sql of MIGRATIONS) {
    try { await client.execute(sql); } catch (_) { /* column already exists */ }
  }

  // One-shot data migration: normalize old credit notes and expense currency.
  try {
    await client.execute(`UPDATE invoices SET amount_paid = 0, amount_due = total_with_vat
                          WHERE is_credit_note = 1 AND (amount_due IS NULL OR amount_due = 0)`);
  } catch (_) {}
  try {
    await client.execute(`
      UPDATE expense_entries
      SET currency = CASE
            WHEN amount_lek > 0 THEN 'LEK'
            WHEN amount_eur > 0 THEN 'EUR'
            WHEN amount_usd > 0 THEN 'USD'
            ELSE 'LEK'
          END,
          amount = CASE
            WHEN amount_lek > 0 THEN amount_lek
            WHEN amount_eur > 0 THEN amount_eur
            WHEN amount_usd > 0 THEN amount_usd
            ELSE 0
          END,
          exchange_rate = 1
      WHERE COALESCE(currency, '') = '' OR amount IS NULL OR amount = 0
    `);
  } catch (_) {}

  initialized = true;
  return client;
}

function getDB() {
  if (!initialized) throw new Error('DB not initialized');
  return client;
}

async function queryAll(sql, params = []) {
  const result = await client.execute({ sql, args: params });
  return result.rows.map(r => ({ ...r }));
}

async function queryOne(sql, params = []) {
  const rows = await queryAll(sql, params);
  return rows[0] || null;
}

async function run(sql, params = []) {
  return await client.execute({ sql, args: params });
}

// Turso has its own backup mechanism; the on-demand /api/backup export used to
// dump the local sqlite file. Now we dump table rows as JSON instead.
async function exportDB() {
  const tables = await queryAll(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_litestream%'"
  );
  const dump = {};
  for (const { name } of tables) {
    dump[name] = await queryAll(`SELECT * FROM ${name}`);
  }
  return Buffer.from(JSON.stringify(dump, null, 2));
}

export { initDB, getDB, queryAll, queryOne, run, exportDB };
