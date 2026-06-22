import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'data', 'inventory.db');

// Ensure data directory exists
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

let db = null;
let SQL = null;

async function initDB() {
  if (db) return db;

  SQL = await initSqlJs();

  // Load existing DB or create new
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // Create schema
  db.run(`
    CREATE TABLE IF NOT EXISTS daily_records (
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
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS sales (
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
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS customer_debts (
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
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS inventory (
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
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS marketing_expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      description TEXT,
      amount_lek REAL DEFAULT 0,
      amount_eur REAL DEFAULT 0,
      amount_usd REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS products (
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
    )
  `);

  // Add image_path to products if it doesn't exist yet
  try { db.run("ALTER TABLE products ADD COLUMN image_path TEXT DEFAULT ''") } catch (_) {}

  saveDB();
  return db;
}

function exportDB() {
  if (!db) return null;
  return db.export();
}

function saveDB() {
  if (db) {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  }
}

function getDB() {
  if (!db) throw new Error('DB not initialized');
  return db;
}

// Helper to run queries and return results as objects
function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function queryOne(sql, params = []) {
  const rows = queryAll(sql, params);
  return rows[0] || null;
}

function run(sql, params = []) {
  db.run(sql, params);
  saveDB();
}

export { initDB, getDB, saveDB, queryAll, queryOne, run, exportDB };
