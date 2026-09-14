import 'dotenv/config';
// Përdor variantin `/web` që flet vetëm HTTP/WS me Turso — pa varësi te
// native binding-u `libsql` (@libsql/win32-x64-msvc / darwin-arm64 etj.).
// Entry-pointi default `@libsql/client` ngarkon `libsql` për skenarë `file:`
// lokale; për ne është vetëm Turso remote, kështu që `/web` mjafton dhe evitohet
// crashi "Cannot find module '@libsql/win32-x64-msvc'" te portable Windows.
import { createClient } from '@libsql/client/web';

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

  // Lëvizje Banke — regjistër i transfertave: kesh → bankë, ose bankë → kasafortë.
  // direction 'to_bank'  = depozito kesh në bankë (+ bank balance)
  // direction 'to_safe'  = tërheqje nga bankë për në kasafortë (− bank balance, + safe balance)
  `CREATE TABLE IF NOT EXISTS bank_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    direction TEXT NOT NULL CHECK(direction IN ('to_bank', 'to_safe')),
    amount_lek REAL DEFAULT 0,
    amount_eur REAL DEFAULT 0,
    amount_usd REAL DEFAULT 0,
    amount_gbp REAL DEFAULT 0,
    amount_chf REAL DEFAULT 0,
    person TEXT DEFAULT '',
    note TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

  // Optimistic locking — products can be edited concurrently on two PCs; the
  // PUT handler compares the client's updated_at to the row's current value.
  "ALTER TABLE products ADD COLUMN updated_at TEXT DEFAULT ''",

  // Promocion — flag i thjeshtë që produkti është aktual në promocion.
  "ALTER TABLE products ADD COLUMN is_promotion INTEGER DEFAULT 0",
  // % ulje e promocionit; mban çmimin origjinal (sell_price) të paprekur.
  // 0 kur produkti nuk është në promocion.
  "ALTER TABLE products ADD COLUMN promo_discount_pct REAL DEFAULT 0",

  // Gramatura — për artikuj bizhuterie; prefill-ohet në faturat e shitjes.
  "ALTER TABLE products ADD COLUMN gram REAL DEFAULT 0",
  "ALTER TABLE invoice_items ADD COLUMN gram REAL DEFAULT 0",

  // Nr Serie + Çmim Blerje pa TVSH — sipas kolonave të Excel-it të inventarit.
  "ALTER TABLE products ADD COLUMN serial_no TEXT DEFAULT ''",
  "ALTER TABLE products ADD COLUMN purchase_price_no_vat REAL DEFAULT 0",
  "CREATE INDEX IF NOT EXISTS idx_products_serial_no ON products(serial_no)",

  // Snapshot promocioni te rreshti i faturës — kur produkti pikas si "në promocion",
  // ruajmë flag + % që kur t'i shohim faturat e vjetra të dallohen menjëherë.
  "ALTER TABLE invoice_items ADD COLUMN on_promotion INTEGER DEFAULT 0",
  "ALTER TABLE invoice_items ADD COLUMN promo_discount_pct REAL DEFAULT 0",

  // Pagesa mikse me monedha të ndryshme — çdo split ka metodën (cash|bank),
  // monedhën dhe kursin drejt LEK. Totali i paguar në monedhën e faturës
  // rillogaritet duke konvertuar çdo split → LEK → monedhën e faturës.
  `CREATE TABLE IF NOT EXISTS invoice_payment_splits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL,
    method TEXT NOT NULL CHECK(method IN ('cash', 'bank')),
    currency TEXT NOT NULL DEFAULT 'LEK',
    amount REAL NOT NULL DEFAULT 0,
    exchange_rate REAL NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
  )`,
  "CREATE INDEX IF NOT EXISTS idx_invoice_payment_splits_invoice ON invoice_payment_splits(invoice_id)",

  // Shitje online — fatura që vijnë nga IG/WhatsApp/Website etj., me flow të
  // ndarë statusi (E re → Në përgatitje → Dërguar → Dorëzuar / Anuluar).
  // Fushat janë additive te tabela invoices — një faturë e zakonshme thjesht
  // ka is_online=0 dhe order_status=''.
  "ALTER TABLE invoices ADD COLUMN is_online INTEGER DEFAULT 0",
  "ALTER TABLE invoices ADD COLUMN channel TEXT DEFAULT ''",
  "ALTER TABLE invoices ADD COLUMN shipping_address TEXT DEFAULT ''",
  "ALTER TABLE invoices ADD COLUMN order_status TEXT DEFAULT ''",
  "ALTER TABLE invoices ADD COLUMN tracking_no TEXT DEFAULT ''",
  "CREATE INDEX IF NOT EXISTS idx_invoices_online_status ON invoices(is_online, order_status)",

  // Uniqueness on generated document numbers. Prevents the classic race where
  // two PCs compute the same "next number" between SELECT and INSERT.
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_invoice_no ON invoices(invoice_no)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_invoices_invoice_no ON purchase_invoices(invoice_no)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_hurda_purchases_purchase_no ON hurda_purchases(purchase_no)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_has_purchases_purchase_no ON has_purchases(purchase_no)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_flete_hyrje_ref_no ON flete_hyrje(ref_no)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_flete_dalje_ref_no ON flete_dalje(ref_no)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_magazina_hyrje_ref_no ON magazina_hyrje(ref_no)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_magazina_dalje_ref_no ON magazina_dalje(ref_no)",

  // Lëvizje Banke — tabelë e re, migrim additive për DB-të ekzistuese.
  `CREATE TABLE IF NOT EXISTS bank_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    direction TEXT NOT NULL CHECK(direction IN ('to_bank', 'to_safe')),
    amount_lek REAL DEFAULT 0,
    amount_eur REAL DEFAULT 0,
    amount_usd REAL DEFAULT 0,
    amount_gbp REAL DEFAULT 0,
    amount_chf REAL DEFAULT 0,
    person TEXT DEFAULT '',
    note TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  "CREATE INDEX IF NOT EXISTS idx_bank_movements_date ON bank_movements(date)",

  // Users për autentifikim + kontrollin e rolit.
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'sales')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,

  // Komentet / chat i brendshëm midis përdoruesve. `user_id` mund të bëhet NULL
  // nëse fshihet përdoruesi, por username/role ruhen si snapshot që historiku
  // të mos humbet identitetin.
  `CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username TEXT NOT NULL,
    role TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  "CREATE INDEX IF NOT EXISTS idx_comments_created_at ON comments(created_at)",

  // Riparimet — regjistër i punimeve që klientët sjellin për riparim.
  // `status` ecën: 'pranuar' → 'ne_pune' → 'gati' → 'dorezuar'.
  `CREATE TABLE IF NOT EXISTS repairs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date_received TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    customer_phone TEXT DEFAULT '',
    item_description TEXT NOT NULL,
    issue_description TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    price REAL DEFAULT 0,
    currency TEXT DEFAULT 'LEK',
    status TEXT DEFAULT 'pranuar' CHECK(status IN ('pranuar','ne_pune','gati','dorezuar')),
    date_delivered TEXT DEFAULT '',
    paid INTEGER DEFAULT 0,
    created_by TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  "CREATE INDEX IF NOT EXISTS idx_repairs_status ON repairs(status)",
  "CREATE INDEX IF NOT EXISTS idx_repairs_date ON repairs(date_received)",

  // Nr Serie te rreshti i faturës së shitjes — kopjohet nga produkti kur zgjidhet.
  "ALTER TABLE invoice_items ADD COLUMN serial_no TEXT DEFAULT ''",

  // Kolonat e reja te rreshti i faturës së blerjes — snapshot i produktit.
  "ALTER TABLE purchase_items ADD COLUMN serial_no TEXT DEFAULT ''",
  "ALTER TABLE purchase_items ADD COLUMN category TEXT DEFAULT ''",
  "ALTER TABLE purchase_items ADD COLUMN unit TEXT DEFAULT ''",
  "ALTER TABLE purchase_items ADD COLUMN gram REAL DEFAULT 0",
  "ALTER TABLE purchase_items ADD COLUMN cost_price REAL DEFAULT 0",

  // Marketing — kategoritë dhe ristrukturimi i marketing_expenses që të ndajë
  // të njëjtën logjikë me shpenzimet: zë (category_id) + monedhë + shumë + kurs.
  `CREATE TABLE IF NOT EXISTS marketing_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  "ALTER TABLE marketing_expenses ADD COLUMN category_id INTEGER",
  "ALTER TABLE marketing_expenses ADD COLUMN currency TEXT DEFAULT 'LEK'",
  "ALTER TABLE marketing_expenses ADD COLUMN amount REAL DEFAULT 0",
  "ALTER TABLE marketing_expenses ADD COLUMN exchange_rate REAL DEFAULT 1",
  // Marketing "in kind" — një produkt nga inventari përdoret për marketing
  // (dhuratë, mostër, promovim). Kur product_id është NOT NULL, stoku ulet me
  // product_qty në kohën e krijimit dhe rikthehet në kohën e fshirjes.
  "ALTER TABLE marketing_expenses ADD COLUMN product_id INTEGER",
  "ALTER TABLE marketing_expenses ADD COLUMN product_qty INTEGER DEFAULT 0",

  // Splits pagese për Fatura Blerje — pasqyrim i invoice_payment_splits për
  // shitje. Lejon që një blerje të paguhet me disa metoda (cash + bankë) dhe
  // me monedha të ndryshme. Totali paguar në monedhën e faturës rillogaritet
  // duke konvertuar çdo split → LEK → monedhën e faturës.
  `CREATE TABLE IF NOT EXISTS purchase_invoice_payment_splits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    purchase_id INTEGER NOT NULL,
    method TEXT NOT NULL CHECK(method IN ('cash', 'bank')),
    currency TEXT NOT NULL DEFAULT 'LEK',
    amount REAL NOT NULL DEFAULT 0,
    exchange_rate REAL NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (purchase_id) REFERENCES purchase_invoices(id) ON DELETE CASCADE
  )`,
  "CREATE INDEX IF NOT EXISTS idx_purchase_invoice_payment_splits_purchase ON purchase_invoice_payment_splits(purchase_id)",
  // Indeks kritik për query-në /api/products që kërkon `last_purchase_date` —
  // pa këtë indeks, agregimi mbi purchase_items skanonte tabelën për çdo
  // produkt dhe binte në ~364K row reads për një thirrje të vetme (v1.0.91).
  "CREATE INDEX IF NOT EXISTS idx_purchase_items_product_id ON purchase_items(product_id)",

  // Kategoritë e materialit për Fatura Blerje — më parë hardcoded (flori/
  // diamant/ora). Tani CRUD me tabelë të veçantë. Slug ruhet te
  // products.material dhe label te products.category kur zgjidhet një kategori
  // për të gjithë rreshtat e faturës. Ruhet built_in=1 për 3 defaults që të
  // mos fshihen aksidentalisht (raportet varen nga slugs).
  `CREATE TABLE IF NOT EXISTS material_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    icon TEXT DEFAULT '',
    built_in INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  "INSERT OR IGNORE INTO material_categories (slug, label, icon, built_in, active) VALUES ('flori', 'Flori', '🟡', 1, 1)",
  "INSERT OR IGNORE INTO material_categories (slug, label, icon, built_in, active) VALUES ('diamant', 'Diamant', '💎', 1, 1)",
  "INSERT OR IGNORE INTO material_categories (slug, label, icon, built_in, active) VALUES ('ora', 'Ora', '⌚', 1, 1)",

  // Blerje në gram HAS — për çdo artikull në faturë blerje ruhet grami HAS
  // (pesha e florit të pastër), monedha e njësisë (default 'HAS') dhe kursi
  // aktual EUR/gram HAS në kohën e blerjes (auto nga /api/gold-spot-price).
  // Kopjohen edhe te tabela products që të mbeten historikisht të lidhura me
  // produktin edhe pas kalimit në inventar; te produkti mbajmë kursin e
  // blerjes së fundit (updated on each new purchase).
  "ALTER TABLE purchase_items ADD COLUMN has_gram REAL DEFAULT 0",
  "ALTER TABLE purchase_items ADD COLUMN has_currency TEXT DEFAULT 'HAS'",
  "ALTER TABLE purchase_items ADD COLUMN has_rate REAL DEFAULT 0",
  "ALTER TABLE products ADD COLUMN has_gram REAL DEFAULT 0",
  "ALTER TABLE products ADD COLUMN has_currency TEXT DEFAULT 'HAS'",
  "ALTER TABLE products ADD COLUMN has_rate REAL DEFAULT 0",

  // Kursi i Shitjes për rresht — përdoret në formulën flori për të llogaritur
  // `sell_price` të pavarur nga `has_rate` (kursi i blerjes). Default = has_rate
  // kur rreshti krijohet; user-i mund ta ndryshojë manualisht. Ndodhet edhe te
  // invoice_items — kur user-i ndryshon `sell_rate` në Fatura Shitje, çmimi
  // rillogaritet proporcionalisht (unit_price × new/old).
  "ALTER TABLE purchase_items ADD COLUMN sell_rate REAL DEFAULT 0",
  "ALTER TABLE invoice_items ADD COLUMN sell_rate REAL DEFAULT 0",

  // Fusha flori te produkti: kodi (585/750...), shumëzuesi (p.sh. 1.8), dhe
  // kursi i shitjes (EUR/gram) — që Products modal të llogarisë auto has_gram,
  // cost_price, sell_price. Kopjohen edhe nga Fatura Blerje kur ruhen artikujt.
  "ALTER TABLE products ADD COLUMN kodi REAL DEFAULT 0",
  "ALTER TABLE products ADD COLUMN multiplier REAL DEFAULT 0",
  "ALTER TABLE products ADD COLUMN sell_rate REAL DEFAULT 0",

  // Fatura Shitje flori: has_gram + multiplier per rresht — që formula
  // unit_price = has_gram × multiplier × sell_rate të aplikohet auto (si
  // te Fatura Blerje). Kopjohen nga produkti kur zgjidhet.
  "ALTER TABLE invoice_items ADD COLUMN has_gram REAL DEFAULT 0",
  "ALTER TABLE invoice_items ADD COLUMN multiplier REAL DEFAULT 0",

  // Etiketa valute për kursin e blerjes/shitjes te rreshti i Fatura Blerje —
  // thjesht një marker (EUR/USD) që user-i të dijë në ç'valutë ka futur numrin.
  // Formulat nuk konvertojnë; përdorin vlerën numerike si-është.
  "ALTER TABLE purchase_items ADD COLUMN has_rate_currency TEXT DEFAULT 'EUR'",
  "ALTER TABLE purchase_items ADD COLUMN sell_rate_currency TEXT DEFAULT 'EUR'",

  // Të njëjtat etiketa valute propagohen te produkti pas blerjes së fundit —
  // rreshti i produktit te Inventar shfaq valutën me të cilën u ble/shitur.
  "ALTER TABLE products ADD COLUMN has_rate_currency TEXT DEFAULT 'EUR'",
  "ALTER TABLE products ADD COLUMN sell_rate_currency TEXT DEFAULT 'EUR'",

  // Koeficenti i punës (EUR/gram) për Blerje Flori — përdoret në formulën:
  // has_gram = (kodi/1000 + koeficent_pune) × gram. Ruhet për rresht dhe
  // për produkt (default nga blerja e fundit).
  "ALTER TABLE purchase_items ADD COLUMN koeficent_pune REAL DEFAULT 0",
  "ALTER TABLE products ADD COLUMN koeficent_pune REAL DEFAULT 0",

  // Marketing — Kontratat: një "kontratë" me buxhet EUR mban brenda vetes
  // zëra (product ose cash EUR) që zbriten nga buxheti derisa arrihet totali.
  // Për zëra cash EUR llogariten si shpenzim në Arkën Ditore.
  `CREATE TABLE IF NOT EXISTS marketing_contracts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    total_amount_eur REAL DEFAULT 0,
    notes TEXT DEFAULT '',
    status TEXT DEFAULT 'open',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    closed_at DATETIME
  )`,
  // Dhurata — faturë blerje mund të markohet si "dhurata" (Blerje Artikuj të
  // Tjerë). Të gjithë produktet e krijuara/ushqyera nga ajo faturë markohen
  // si dhurata te products.is_gift = 1. Në Faturë Shitje, admin mund të shtojë
  // "Dhuratë" — një produkt nga inventari me is_gift=1 që zbritet nga stoku
  // pa u shtuar në totalin e faturës (unit_price=0, is_gift=1 te invoice_items).
  "ALTER TABLE purchase_invoices ADD COLUMN is_gift INTEGER DEFAULT 0",
  "ALTER TABLE products ADD COLUMN is_gift INTEGER DEFAULT 0",
  "ALTER TABLE invoice_items ADD COLUMN is_gift INTEGER DEFAULT 0",

  `CREATE TABLE IF NOT EXISTS marketing_contract_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contract_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    type TEXT NOT NULL,
    amount_eur REAL DEFAULT 0,
    product_id INTEGER,
    product_qty INTEGER DEFAULT 0,
    description TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (contract_id) REFERENCES marketing_contracts(id) ON DELETE CASCADE
  )`,
];

async function initDB() {
  if (initialized) return client;

  // Batch SCHEMA në 1 request Turso (mode 'write' e trajton si transaksion, por
  // secili CREATE TABLE IF NOT EXISTS është idempotent). Kjo redukton ~50 HTTP
  // calls në 1 → init nga 30-60s → 1-2s.
  await client.batch(SCHEMA.map(sql => ({ sql })), 'write');

  // MIGRATIONS janë ALTER TABLE që dështojnë me "column already exists" në
  // çdo restart pas të parit. `batch` do të abort-onte të gjithë transaksionin
  // te dështimi i parë, ndaj i ekzekutojmë veç, POR paralel me Promise.allSettled
  // që të gjitha HTTP round-trips të bëhen njëkohësisht (~1 RTT në total, jo N).
  await Promise.allSettled(MIGRATIONS.map(sql => client.execute(sql)));

  // One-shot data migration: normalize old credit notes and expense currency.
  // Këto janë të pavarura nga njëra-tjetra → paralelizohen.
  await Promise.allSettled([
    client.execute(`UPDATE invoices SET amount_paid = 0, amount_due = total_with_vat
                    WHERE is_credit_note = 1 AND (amount_due IS NULL OR amount_due = 0)`),
    client.execute(`
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
    `),
    client.execute(`
      UPDATE marketing_expenses
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
    `),
  ]);

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

// Detect UNIQUE constraint violations across libSQL error shapes. libSQL surfaces
// them as SQLITE_CONSTRAINT with the phrase "UNIQUE constraint failed" in the
// message; matching on the message keeps this working across driver versions.
function isUniqueViolation(err) {
  const msg = String(err?.message || err || '');
  return /UNIQUE constraint failed/i.test(msg);
}

// Retry helper for "generate a unique document number, then insert it" flows.
// getNo() computes the next candidate (from a COUNT+increment or similar);
// doInsert(no) performs the INSERT that may collide. On UNIQUE failure we ask
// getNo() for a fresh number and try again, up to `maxRetries`.
//
// `initialNo` lets the caller propose a first number (e.g. the auto number the
// client pre-fetched from `/next-no`). If that collides — a real race we've
// hit when a slow save on one PC lets another PC take the same number — we
// silently fall back to getNo() for a fresh candidate instead of failing the
// user's save. Users never customise invoice numbers in the UI, so it's always
// safer to auto-recover than to surface SQLITE_CONSTRAINT.
async function retryOnUniqueNo(getNo, doInsert, maxRetries = 5, initialNo = null) {
  let lastErr;
  let no = initialNo || await getNo();
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await doInsert(no);
      return no;
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries - 1 && isUniqueViolation(err)) {
        no = await getNo();
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

// Batch write helper: executes multiple statements in a single Turso HTTP call
// as a transaction. Massively reduces round-trips for handlers that write many
// related rows (e.g. a purchase invoice with 20+ items). Statements can be
// plain SQL strings or `{ sql, args }` objects.
async function batchWrite(statements) {
  if (!statements || statements.length === 0) return [];
  const norm = statements.map(s => typeof s === 'string' ? { sql: s } : s);
  return await client.batch(norm, 'write');
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

export {
  initDB, getDB, queryAll, queryOne, run, batchWrite, exportDB,
  isUniqueViolation, retryOnUniqueNo,
};
