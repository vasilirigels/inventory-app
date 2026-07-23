import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import http from 'http';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import {
  initDB, queryAll, queryOne, run, exportDB,
  isUniqueViolation, retryOnUniqueNo,
} from './db.js';

// ── Auth: JWT + helper middleware ─────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET
  || 'gold-shop-dev-secret-change-in-prod-2026';
const TOKEN_TTL = '30d';

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET, { expiresIn: TOKEN_TTL },
  );
}

// Middleware: verifikon JWT nga headeri Authorization: Bearer <token>
function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: 'unauthorized' });
  try {
    const payload = jwt.verify(m[1], JWT_SECRET);
    req.user = payload;
    next();
  } catch (_) {
    return res.status(401).json({ error: 'invalid_token' });
  }
}

// Middleware: kërkon rol admin
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'forbidden' });
  }
  next();
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const uploadDir = path.join(__dirname, 'uploads', 'products');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `product_${req.params.id}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, ['.jpg', '.jpeg', '.png', '.webp'].includes(
      path.extname(file.originalname).toLowerCase()
    ));
  },
});

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ─── Realtime change broadcast ────────────────────────────────────────────────
// When any mutation route succeeds, we broadcast { table, action } to every
// connected client so open windows (on other PCs) can re-fetch. A single
// middleware wraps res.json so we don't have to touch each route.
const wsClients = new Set();
function broadcast(payload) {
  const data = JSON.stringify(payload);
  for (const ws of wsClients) {
    try { if (ws.readyState === 1) ws.send(data); } catch (_) {}
  }
}
// Map URL path → logical table name. Missing entry = no broadcast.
function tableFromPath(p) {
  if (!p.startsWith('/api/')) return null;
  const seg = p.slice(5).split('?')[0].split('/')[0];
  const map = {
    'products': 'products',
    'invoices': 'invoices',
    'purchase-invoices': 'purchase_invoices',
    'hurda-purchases': 'hurda_purchases',
    'has-purchases': 'has_purchases',
    'sales': 'sales',
    'client-debts': 'customer_debts',
    'customer-debts': 'customer_debts',
    'clients': 'clients',
    'suppliers': 'suppliers',
    'daily': 'daily_records',
    'marketing-expenses': 'marketing_expenses',
    'expense-categories': 'expense_categories',
    'expense-entries': 'expense_entries',
    'safe-withdrawals': 'safe_withdrawals',
    'safe-conversions': 'safe_conversions',
    'bank-movements': 'bank_movements',
    'kasaforta': 'daily_records',
    'flete-hyrje': 'flete_hyrje',
    'flete-dalje': 'flete_dalje',
    'magazina-hyrje': 'magazina_hyrje',
    'magazina-dalje': 'magazina_dalje',
    'invoice-payments': 'invoice_payments',
    'purchase-payments': 'purchase_payments',
    'comments': 'comments',
    'repairs': 'repairs',
  };
  return map[seg] || null;
}
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const origJson = res.json.bind(res);
  res.json = (data) => {
    const ret = origJson(data);
    if (res.statusCode < 300) {
      const table = tableFromPath(req.path);
      if (table) broadcast({ type: 'change', table, action: req.method, at: Date.now() });
    }
    return ret;
  };
  next();
});

// Initialize DB before starting server
await initDB();

// ============================================================
// AUTH ENDPOINTS
// ============================================================

// Statusi i auth: nëse tabela users është bosh, klienti duhet të shfaqë setup-in.
app.get('/api/auth/status', async (req, res) => {
  try {
    const row = await queryOne('SELECT COUNT(*) AS cnt FROM users');
    res.json({ needsSetup: (row?.cnt || 0) === 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Setup i parë — pranon vetëm nëse s'ka asnjë user të regjistruar.
// Krijon dy përdorues: admin + sales.
app.post('/api/auth/setup', async (req, res) => {
  try {
    const existing = await queryOne('SELECT COUNT(*) AS cnt FROM users');
    if ((existing?.cnt || 0) > 0) {
      return res.status(409).json({ error: 'setup_already_done' });
    }
    const d = req.body || {};
    const adminU = String(d.admin_username || '').trim();
    const adminP = String(d.admin_password || '');
    const salesU = String(d.sales_username || '').trim();
    const salesP = String(d.sales_password || '');
    if (!adminU || !adminP || !salesU || !salesP) {
      return res.status(400).json({ error: 'missing_fields' });
    }
    if (adminP.length < 4 || salesP.length < 4) {
      return res.status(400).json({ error: 'password_too_short' });
    }
    if (adminU === salesU) {
      return res.status(400).json({ error: 'usernames_must_differ' });
    }
    const adminHash = await bcrypt.hash(adminP, 10);
    const salesHash = await bcrypt.hash(salesP, 10);
    await run(
      `INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)`,
      [adminU, adminHash, 'admin'],
    );
    await run(
      `INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)`,
      [salesU, salesHash, 'sales'],
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Login: verifikon username + password, kthen JWT.
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'missing_credentials' });
    const user = await queryOne(
      'SELECT id, username, password_hash, role FROM users WHERE username = ?',
      [String(username).trim()],
    );
    if (!user) return res.status(401).json({ error: 'invalid_credentials' });
    const ok = await bcrypt.compare(String(password), user.password_hash);
    if (!ok) return res.status(401).json({ error: 'invalid_credentials' });
    const token = signToken(user);
    res.json({
      token,
      user: { id: user.id, username: user.username, role: user.role },
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Kthen detajet e user-it aktual (validon token-in).
app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: { id: req.user.id, username: req.user.username, role: req.user.role } });
});

// ── Nga këtu e tutje: çdo endpoint /api/... kërkon auth.
// Endpoint-et e mësipërme (/api/auth/*) mbeten publike.
app.use('/api', requireAuth);

// Rregullat për rolin 'sales':
// - GET lejohet për shumicën e endpoint-eve, përveç atyre admin-only më poshtë.
// - POST lejohet vetëm për fatura shitje dhe shpenzime (të cilat janë pjesë e
//   punës ditore).
// - PUT/DELETE nuk lejohen për 'sales'.
// - Endpoint-et admin-only (raporte financiare, kasaforta, bankë, blerje, etj.)
//   bllokohen tërësisht për 'sales'.
const ADMIN_ONLY_PATH_REGEX = [
  // Blerje / Furnitor / Magazina — pjesë e administrimit
  /^\/api\/purchase-invoices/,
  /^\/api\/purchase-payments/,
  /^\/api\/has-purchases/,
  /^\/api\/flete-/,
  /^\/api\/magazina-/,
  /^\/api\/warehouses/,
  /^\/api\/suppliers/,
  /^\/api\/supplier-debts/,
  // Përmbledhëse inventari (përfshin fitim/marzh)
  /^\/api\/inventory-summary/,
  // Raporte të blerjes
  /^\/api\/reports\/purchase-items/,
  // Backup / export / import
  /^\/api\/export/,
  /^\/api\/import/,
  /^\/api\/backup/,
  // Pagesa mbi faturat ekzistuese (rregullim borxhi) — vetëm admin
  /^\/api\/invoice-payments/,
  // Marketing — admin
  /^\/api\/marketing-expenses/,
];

const SALES_WRITE_ALLOW = [
  // Fatura shitje (edhe porosi online — të dyja shkojnë te /api/invoices)
  { method: 'POST', pattern: /^\/api\/invoices$/ },
  // Kthim / kreditore (i plotë ose i pjesshëm) — shitësi ka të drejtë ta bëjë
  // pa duhur admin, sepse është veprim ditor i klientit në dyqan.
  { method: 'POST', pattern: /^\/api\/invoices\/\d+\/credit-note$/ },
  // Pagesa borxhi klienti — regjistrim i pagesës mbi faturën ekzistuese.
  { method: 'POST', pattern: /^\/api\/invoices\/\d+\/payments$/ },
  // Update i statusit të porosisë online — quick-action nga lista
  { method: 'PATCH', pattern: /^\/api\/invoices\/\d+\/order-status$/ },
  // Shpenzime ditore
  { method: 'POST', pattern: /^\/api\/expense-entries$/ },
  // Zër i ri shpenzimi — krijohet inline gjatë shtimit të shpenzimit
  { method: 'POST', pattern: /^\/api\/expense-categories$/ },
  // Shpenzime Marketingu — të njëjtin flow si shpenzimet
  { method: 'POST', pattern: /^\/api\/marketing-entries$/ },
  { method: 'POST', pattern: /^\/api\/marketing-categories$/ },
  // Klientë të rinj gjatë faturës
  { method: 'POST', pattern: /^\/api\/clients$/ },
  // Lëvizje bankë (depozitim/tërheqje) + tërheqje kasafortë + konvertime
  { method: 'POST', pattern: /^\/api\/bank-movements$/ },
  { method: 'POST', pattern: /^\/api\/safe-withdrawals$/ },
  { method: 'POST', pattern: /^\/api\/safe-conversions$/ },
  // Hurda (konvertim / blerje hurda)
  { method: 'POST', pattern: /^\/api\/hurda-purchases$/ },
];

// Komentet / chat — të gjithë userat (admin & sales) mund të shkruajnë,
// lexojnë, dhe të fshijnë komentin e vet (admin fshin çdo koment). Regjistrohen
// KETU, para gate-it të mëposhtëm të shitësit, kështu që përgjigja del pa u
// futur në atë gate (i cili pret POST/DELETE vetëm nga një allowlist strikt).

app.get('/api/comments', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    const rows = await queryAll(
      `SELECT id, user_id, username, role, body, created_at
       FROM comments ORDER BY id ASC LIMIT ?`,
      [limit],
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/comments', async (req, res) => {
  try {
    const body = String(req.body?.body || '').trim();
    if (!body) return res.status(400).json({ error: 'empty_body' });
    if (body.length > 2000) return res.status(400).json({ error: 'body_too_long' });
    const result = await run(
      `INSERT INTO comments (user_id, username, role, body) VALUES (?, ?, ?, ?)`,
      [req.user.id, req.user.username, req.user.role, body],
    );
    const id = Number(result.lastInsertRowid);
    const row = await queryOne(
      `SELECT id, user_id, username, role, body, created_at FROM comments WHERE id = ?`,
      [id],
    );
    res.json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/comments/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const row = await queryOne('SELECT user_id FROM comments WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'not_found' });
    if (req.user.role !== 'admin' && row.user_id !== req.user.id) {
      return res.status(403).json({ error: 'forbidden' });
    }
    await run('DELETE FROM comments WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// RIPARIMET — regjistër i punimeve për klientët
// ============================================================
// I regjistruar këtu (para gate-it të shitësit) që të dy rolet të mund të
// krijojnë dhe editojnë. Fshirja lejohet vetëm për admin.

app.get('/api/repairs', async (req, res) => {
  try {
    const { status, q } = req.query;
    const args = []; const where = [];
    if (status && status !== 'all') { where.push('status = ?'); args.push(status); }
    if (q) {
      where.push(`(customer_name LIKE ? OR customer_phone LIKE ? OR item_description LIKE ?)`);
      const like = `%${q}%`;
      args.push(like, like, like);
    }
    const sql = `SELECT * FROM repairs
                 ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY id DESC LIMIT 500`;
    const rows = await queryAll(sql, args);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/repairs', async (req, res) => {
  try {
    const d = req.body || {};
    const date_received = String(d.date_received || '').trim();
    const customer_name = String(d.customer_name || '').trim();
    const item_description = String(d.item_description || '').trim();
    if (!date_received || !customer_name || !item_description) {
      return res.status(400).json({ error: 'missing_fields' });
    }
    const result = await run(
      `INSERT INTO repairs
       (date_received, customer_name, customer_phone, item_description,
        issue_description, notes, price, currency, status, paid, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        date_received,
        customer_name,
        String(d.customer_phone || ''),
        item_description,
        String(d.issue_description || ''),
        String(d.notes || ''),
        Number(d.price) || 0,
        String(d.currency || 'LEK'),
        d.status && ['pranuar','ne_pune','gati','dorezuar'].includes(d.status) ? d.status : 'pranuar',
        d.paid ? 1 : 0,
        req.user.username,
      ],
    );
    const row = await queryOne('SELECT * FROM repairs WHERE id = ?', [Number(result.lastInsertRowid)]);
    res.json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/repairs/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = await queryOne('SELECT id FROM repairs WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'not_found' });
    const d = req.body || {};
    const status = d.status && ['pranuar','ne_pune','gati','dorezuar'].includes(d.status) ? d.status : 'pranuar';
    await run(
      `UPDATE repairs SET
         date_received = ?, customer_name = ?, customer_phone = ?,
         item_description = ?, issue_description = ?, notes = ?,
         price = ?, currency = ?, status = ?, date_delivered = ?, paid = ?,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        String(d.date_received || ''),
        String(d.customer_name || ''),
        String(d.customer_phone || ''),
        String(d.item_description || ''),
        String(d.issue_description || ''),
        String(d.notes || ''),
        Number(d.price) || 0,
        String(d.currency || 'LEK'),
        status,
        String(d.date_delivered || ''),
        d.paid ? 1 : 0,
        id,
      ],
    );
    const row = await queryOne('SELECT * FROM repairs WHERE id = ?', [id]);
    res.json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/repairs/:id', async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
    const id = Number(req.params.id);
    await run('DELETE FROM repairs WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.use('/api', (req, res, next) => {
  const role = req.user?.role;
  if (role === 'admin') return next();
  if (role !== 'sales') return res.status(403).json({ error: 'forbidden' });

  // Skip preflight and auth status/login/me (këto s'kalojnë kurrë nga këtu)
  if (req.method === 'OPTIONS') return next();

  // app.use('/api', …) e heq prefiksin nga req.path (bëhet '/expense-entries'),
  // ndërsa regex-et janë shkruar për path-in e plotë '/api/...'. Rikonstruktojmë
  // atë me baseUrl + path që matching-u të bëhet siç pritet.
  const fullPath = (req.baseUrl || '') + req.path;

  // Admin-only paths për sales
  if (ADMIN_ONLY_PATH_REGEX.some(re => re.test(fullPath))) {
    return res.status(403).json({ error: 'forbidden' });
  }

  // Vetëm GET + shkrime specifikisht të lejuara për sales
  if (req.method !== 'GET') {
    const allowed = SALES_WRITE_ALLOW.some(a => a.method === req.method && a.pattern.test(fullPath));
    if (!allowed) return res.status(403).json({ error: 'forbidden' });
  }
  next();
});

// ============================================================
// DAILY RECORDS
// ============================================================
app.get('/api/daily/:date', async (req, res) => {
  try {
    const { date } = req.params;
    let record = await queryOne('SELECT * FROM daily_records WHERE date = ?', [date]);

    if (!record) {
      // Try to carry forward opening balance from previous day
      const prevRecord = await queryOne(
        `SELECT * FROM daily_records WHERE date < ? ORDER BY date DESC LIMIT 1`,
        [date]
      );

      if (prevRecord) {
        // Calculate closing balance of previous day to use as opening
        const prevSales = await queryAll(
          'SELECT * FROM sales WHERE date = ? AND is_return = 0',
          [prevRecord.date]
        );
        const prevReturns = await queryAll(
          'SELECT * FROM sales WHERE date = ? AND is_return = 1',
          [prevRecord.date]
        );

        // Sum up sales
        const sumSales = (arr, field) => arr.reduce((s, r) => s + (r[field] || 0), 0);
        const saleLek = sumSales(prevSales, 'lek_cash') + sumSales(prevSales, 'lek_pb');
        const saleEur = sumSales(prevSales, 'eur_cash') + sumSales(prevSales, 'eur_pb');
        const saleUsd = sumSales(prevSales, 'usd_cash');
        const saleGbp = sumSales(prevSales, 'gbp_cash');
        const saleChf = sumSales(prevSales, 'chf_cash');
        const retLek = sumSales(prevReturns, 'lek_cash') + sumSales(prevReturns, 'lek_pb');
        const retEur = sumSales(prevReturns, 'eur_cash') + sumSales(prevReturns, 'eur_pb');
        const retUsd = sumSales(prevReturns, 'usd_cash');
        const retGbp = sumSales(prevReturns, 'gbp_cash');
        const retChf = sumSales(prevReturns, 'chf_cash');

        const p = prevRecord;
        const closingLek = (p.opening_lek || 0)
          + (saleLek - retLek)
          + (p.conv_lek || 0) + (p.hurda_lek || 0) + (p.bank_withdraw_lek || 0)
          + (p.debt_settlement_eur ? 0 : 0)
          - (p.expenses_lek || 0) - (p.biba_lek || 0) - (p.diana_lek || 0)
          - (p.bank_deposit_lek || 0) - (p.safe_deposit_lek || 0) + (p.safe_withdraw_lek || 0);
        const closingEur = (p.opening_eur || 0)
          + (saleEur - retEur)
          + (p.conv_eur || 0) + (p.hurda_eur || 0) + (p.bank_withdraw_eur || 0)
          + (p.debt_settlement_eur || 0)
          - (p.expenses_eur || 0) - (p.biba_eur || 0) - (p.diana_eur || 0)
          - (p.bank_deposit_eur || 0) - (p.safe_deposit_eur || 0) + (p.safe_withdraw_eur || 0);
        const closingUsd = (p.opening_usd || 0)
          + (saleUsd - retUsd)
          + (p.conv_usd || 0) + (p.hurda_usd || 0) + (p.bank_withdraw_usd || 0)
          + (p.debt_settlement_usd || 0)
          - (p.expenses_usd || 0) - (p.biba_usd || 0) - (p.diana_usd || 0)
          - (p.bank_deposit_usd || 0);
        const closingGbp = (p.opening_gbp || 0)
          + (saleGbp - retGbp)
          + (p.conv_gbp || 0) + (p.hurda_gbp || 0)
          + (p.debt_settlement_gbp || 0)
          - (p.biba_gbp || 0) - (p.diana_gbp || 0);
        const closingChf = (p.opening_chf || 0)
          + (saleChf - retChf)
          + (p.conv_chf || 0) + (p.hurda_chf || 0)
          + (p.debt_settlement_chf || 0)
          - (p.biba_chf || 0) - (p.diana_chf || 0);

        record = {
          date,
          opening_lek: Math.round(closingLek * 100) / 100,
          opening_eur: Math.round(closingEur * 100) / 100,
          opening_usd: Math.round(closingUsd * 100) / 100,
          opening_gbp: Math.round(closingGbp * 100) / 100,
          opening_chf: Math.round(closingChf * 100) / 100,
        };
      } else {
        record = { date };
      }
    }

    res.json(record);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/daily/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const data = req.body;

    const existing = await queryOne('SELECT id FROM daily_records WHERE date = ?', [date]);

    const fields = [
      'opening_lek', 'opening_eur', 'opening_usd', 'opening_gbp', 'opening_chf',
      'expenses_lek', 'expenses_eur', 'expenses_usd',
      'biba_lek', 'biba_eur', 'biba_usd', 'biba_gbp', 'biba_chf', 'biba_gram',
      'diana_lek', 'diana_eur', 'diana_usd', 'diana_gbp', 'diana_chf', 'diana_hurda',
      'bank_withdraw_lek', 'bank_withdraw_eur', 'bank_withdraw_usd',
      'bank_deposit_lek', 'bank_deposit_eur', 'bank_deposit_usd',
      'conv_lek', 'conv_eur', 'conv_usd', 'conv_gbp', 'conv_chf',
      'hurda_lek', 'hurda_eur', 'hurda_usd', 'hurda_gbp', 'hurda_chf', 'hurda_gram',
      'safe_deposit_lek', 'safe_deposit_eur', 'safe_withdraw_lek', 'safe_withdraw_eur',
      'debt_settlement_eur', 'debt_settlement_usd', 'debt_settlement_gbp',
      'debt_settlement_chf', 'debt_settlement_has'
    ];

    if (existing) {
      // Përditëso VETËM fushat që janë dërguar në body — mos i rivendos zero
      // fushat e tjera, sepse nën-faqet e sidebar-it dërgojnë vetëm rreshtat
      // e vet (p.sh. Konvertim Valute dërgon vetëm conv_*).
      const providedFields = fields.filter(f => Object.prototype.hasOwnProperty.call(data, f));
      if (providedFields.length === 0) return res.json({ success: true, updated: 0 });
      const setClause = providedFields.map(f => `${f} = ?`).join(', ');
      const values    = providedFields.map(f => parseFloat(data[f]) || 0);
      await run(`UPDATE daily_records SET ${setClause} WHERE date = ?`, [...values, date]);
    } else {
      // Insert i ri — fushat që s'janë në body marrin default 0
      const values = fields.map(f => parseFloat(data[f]) || 0);
      const cols   = fields.join(', ');
      const placeholders = fields.map(() => '?').join(', ');
      await run(
        `INSERT INTO daily_records (date, ${cols}) VALUES (?, ${placeholders})`,
        [date, ...values]
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// SALES — history + recent (must be BEFORE /api/sales/:date)
// ============================================================
app.get('/api/sales/history', async (req, res) => {
  try {
    const { q, type, from, to } = req.query;
    let sql = 'SELECT * FROM sales WHERE 1=1';
    const params = [];
    if (type)  { sql += ' AND type = ?';            params.push(type); }
    if (from)  { sql += ' AND date >= ?';           params.push(from); }
    if (to)    { sql += ' AND date <= ?';           params.push(to); }
    if (q)     { sql += ' AND (barcode LIKE ? OR notes LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
    sql += ' ORDER BY date DESC, created_at DESC LIMIT 300';
    res.json(await queryAll(sql, params));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/sales/recent', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 30, 90);
    const rows = await queryAll(`
      SELECT date,
             SUM(eur_cash + eur_pb) AS eur_total,
             SUM(lek_cash + lek_pb) AS lek_total,
             SUM(usd_cash)          AS usd_total,
             COUNT(*) AS count
      FROM sales
      WHERE is_return = 0
        AND date >= date('now', '-' || ? || ' days')
      GROUP BY date
      ORDER BY date ASC
    `, [days]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// SALES
// ============================================================
app.get('/api/sales/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const { type } = req.query;
    let sql = 'SELECT * FROM sales WHERE date = ?';
    const params = [date];
    if (type) {
      sql += ' AND type = ?';
      params.push(type);
    }
    sql += ' ORDER BY created_at ASC';
    const rows = await queryAll(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sales', async (req, res) => {
  try {
    const d = req.body;
    await run(
      `INSERT INTO sales (date, type, barcode, cope, gram, lek_cash, lek_pb, eur_cash, eur_pb,
        usd_cash, gbp_cash, chf_cash, skonto_percent, cm_etikete_usd, cm_etikete_eur, is_return, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        d.date, d.type, d.barcode || '', d.cope || 0, d.gram || 0,
        d.lek_cash || 0, d.lek_pb || 0, d.eur_cash || 0, d.eur_pb || 0,
        d.usd_cash || 0, d.gbp_cash || 0, d.chf_cash || 0,
        d.skonto_percent || 0, d.cm_etikete_usd || 0, d.cm_etikete_eur || 0,
        d.is_return ? 1 : 0, d.notes || ''
      ]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/sales/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const d = req.body;
    await run(
      `UPDATE sales SET barcode=?, cope=?, gram=?, lek_cash=?, lek_pb=?, eur_cash=?, eur_pb=?,
        usd_cash=?, gbp_cash=?, chf_cash=?, skonto_percent=?, cm_etikete_usd=?, cm_etikete_eur=?,
        is_return=?, notes=? WHERE id=?`,
      [
        d.barcode || '', d.cope || 0, d.gram || 0,
        d.lek_cash || 0, d.lek_pb || 0, d.eur_cash || 0, d.eur_pb || 0,
        d.usd_cash || 0, d.gbp_cash || 0, d.chf_cash || 0,
        d.skonto_percent || 0, d.cm_etikete_usd || 0, d.cm_etikete_eur || 0,
        d.is_return ? 1 : 0, d.notes || '', id
      ]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/sales/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await run('DELETE FROM sales WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// CUSTOMERS SUMMARY (must be BEFORE /api/debts/:date)
// ============================================================
app.get('/api/customers/summary', async (req, res) => {
  try {
    const rows = await queryAll(`
      SELECT
        name,
        SUM(CASE WHEN type='debt'      THEN lek ELSE 0 END) AS debt_lek,
        SUM(CASE WHEN type='repayment' THEN lek ELSE 0 END) AS paid_lek,
        SUM(CASE WHEN type='debt'      THEN eur ELSE 0 END) AS debt_eur,
        SUM(CASE WHEN type='repayment' THEN eur ELSE 0 END) AS paid_eur,
        SUM(CASE WHEN type='debt'      THEN usd ELSE 0 END) AS debt_usd,
        SUM(CASE WHEN type='repayment' THEN usd ELSE 0 END) AS paid_usd,
        SUM(CASE WHEN type='debt'      THEN gbp ELSE 0 END) AS debt_gbp,
        SUM(CASE WHEN type='repayment' THEN gbp ELSE 0 END) AS paid_gbp,
        SUM(CASE WHEN type='debt'      THEN chf ELSE 0 END) AS debt_chf,
        SUM(CASE WHEN type='repayment' THEN chf ELSE 0 END) AS paid_chf,
        MIN(date) AS first_date,
        MAX(date) AS last_date,
        COUNT(*)  AS entries
      FROM customer_debts
      GROUP BY name
      ORDER BY (SUM(CASE WHEN type='debt' THEN eur ELSE -eur END)) DESC
    `, []);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/customers/:name/transactions', async (req, res) => {
  try {
    const { name } = req.params;
    const rows = await queryAll(
      'SELECT * FROM customer_debts WHERE name = ? ORDER BY date ASC, id ASC',
      [name]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// CUSTOMER DEBTS
// ============================================================
app.get('/api/debts/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const rows = await queryAll(
      'SELECT * FROM customer_debts WHERE date = ? ORDER BY created_at ASC',
      [date]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/debts', async (req, res) => {
  try {
    const d = req.body;
    await run(
      `INSERT INTO customer_debts (date, name, type, lek, eur, usd, gbp, chf)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [d.date, d.name, d.type, d.lek || 0, d.eur || 0, d.usd || 0, d.gbp || 0, d.chf || 0]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/debts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await run('DELETE FROM customer_debts WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// INVENTORY
// ============================================================
app.get('/api/inventory/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const rows = await queryAll(
      'SELECT * FROM inventory WHERE date = ? ORDER BY type',
      [date]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/inventory', async (req, res) => {
  try {
    const d = req.body;
    const existing = await queryOne(
      'SELECT id FROM inventory WHERE date = ? AND type = ?',
      [d.date, d.type]
    );

    const fields = [
      'gram_start', 'cope_start', 'cost_price', 'sell_price',
      'gram_in', 'cope_in', 'gram_out', 'cope_out',
      'gram_sold', 'cope_sold', 'gram_end', 'cope_end',
      'gram_real', 'cope_real'
    ];
    const values = fields.map(f => d[f] || 0);

    if (existing) {
      const setClause = fields.map(f => `${f} = ?`).join(', ');
      await run(
        `UPDATE inventory SET ${setClause} WHERE date = ? AND type = ?`,
        [...values, d.date, d.type]
      );
    } else {
      const cols = fields.join(', ');
      const placeholders = fields.map(() => '?').join(', ');
      await run(
        `INSERT INTO inventory (date, type, ${cols}) VALUES (?, ?, ${placeholders})`,
        [d.date, d.type, ...values]
      );
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// MARKETING EXPENSES
// ============================================================
app.get('/api/marketing/:date', async (req, res) => {
  try {
    const { date } = req.params;
    // Support YYYY-MM for monthly view
    let rows;
    if (date.length === 7) {
      rows = await queryAll(
        "SELECT * FROM marketing_expenses WHERE date LIKE ? ORDER BY date ASC",
        [date + '%']
      );
    } else {
      rows = await queryAll(
        'SELECT * FROM marketing_expenses WHERE date = ? ORDER BY created_at ASC',
        [date]
      );
    }
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/marketing', async (req, res) => {
  try {
    const d = req.body;
    await run(
      `INSERT INTO marketing_expenses (date, description, amount_lek, amount_eur, amount_usd)
       VALUES (?, ?, ?, ?, ?)`,
      [d.date, d.description || '', d.amount_lek || 0, d.amount_eur || 0, d.amount_usd || 0]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/marketing/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await run('DELETE FROM marketing_expenses WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// MONTHLY SUMMARY
// ============================================================
app.get('/api/summary/:year/:month', async (req, res) => {
  try {
    const { year, month } = req.params;
    const prefix = `${year}-${month.padStart(2, '0')}`;

    const records = await queryAll(
      'SELECT * FROM daily_records WHERE date LIKE ? ORDER BY date',
      [prefix + '%']
    );

    const result = [];
    for (const rec of records) {
      const sales = await queryAll('SELECT * FROM sales WHERE date = ? AND is_return = 0', [rec.date]);
      const returns = await queryAll('SELECT * FROM sales WHERE date = ? AND is_return = 1', [rec.date]);
      const debts = await queryAll('SELECT * FROM customer_debts WHERE date = ?', [rec.date]);
      const marketing = await queryAll('SELECT * FROM marketing_expenses WHERE date = ?', [rec.date]);

      const sumField = (arr, field) => arr.reduce((s, r) => s + (r[field] || 0), 0);

      const totalSalesLek = sumField(sales, 'lek_cash') + sumField(sales, 'lek_pb');
      const totalSalesEur = sumField(sales, 'eur_cash') + sumField(sales, 'eur_pb');
      const totalSalesUsd = sumField(sales, 'usd_cash');
      const totalSalesGbp = sumField(sales, 'gbp_cash');
      const totalSalesChf = sumField(sales, 'chf_cash');
      const totalRetLek = sumField(returns, 'lek_cash') + sumField(returns, 'lek_pb');
      const totalRetEur = sumField(returns, 'eur_cash') + sumField(returns, 'eur_pb');

      result.push({
        ...rec,
        total_sales_lek: totalSalesLek,
        total_sales_eur: totalSalesEur,
        total_sales_usd: totalSalesUsd,
        total_sales_gbp: totalSalesGbp,
        total_sales_chf: totalSalesChf,
        total_returns_lek: totalRetLek,
        total_returns_eur: totalRetEur,
        sales_count: sales.length,
        marketing_total: sumField(marketing, 'amount_eur'),
      });
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// UNIFIED REPORT — aggregate across any date range
// ============================================================
app.get('/api/report', async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to required (YYYY-MM-DD)' });

    const recs   = await queryAll('SELECT * FROM daily_records WHERE date BETWEEN ? AND ?', [from, to]);
    const sales  = await queryAll('SELECT * FROM sales WHERE date BETWEEN ? AND ?', [from, to]);
    const debts  = await queryAll('SELECT * FROM customer_debts WHERE date BETWEEN ? AND ?', [from, to]);

    const sumD = field => recs.reduce((s, r) => s + (r[field] || 0), 0);

    // Sales totals & per-type breakdown (net = sale − return)
    const blankType = () => ({ cope: 0, gram: 0, lek_cash: 0, lek_pb: 0, eur_cash: 0, eur_pb: 0, usd: 0, gbp: 0, chf: 0 });
    const byType = { flori: blankType(), diamant: blankType(), online: blankType() };
    sales.forEach(s => {
      const sign = s.is_return ? -1 : 1;
      const t = byType[s.type]; if (!t) return;
      t.cope     += sign * (s.cope || 0);
      t.gram     += sign * (s.gram || 0);
      t.lek_cash += sign * (s.lek_cash || 0);
      t.lek_pb   += sign * (s.lek_pb   || 0);
      t.eur_cash += sign * (s.eur_cash || 0);
      t.eur_pb   += sign * (s.eur_pb   || 0);
      t.usd      += sign * (s.usd_cash || 0);
      t.gbp      += sign * (s.gbp_cash || 0);
      t.chf      += sign * (s.chf_cash || 0);
    });

    const xhiro = {
      lek: byType.flori.lek_cash + byType.flori.lek_pb + byType.diamant.lek_cash + byType.diamant.lek_pb + byType.online.lek_cash + byType.online.lek_pb,
      eur: byType.flori.eur_cash + byType.flori.eur_pb + byType.diamant.eur_cash + byType.diamant.eur_pb + byType.online.eur_cash + byType.online.eur_pb,
      usd: byType.flori.usd + byType.diamant.usd + byType.online.usd,
      gbp: byType.flori.gbp + byType.diamant.gbp + byType.online.gbp,
      chf: byType.flori.chf + byType.diamant.chf + byType.online.chf,
    };

    const debtsByType = type => {
      const f = debts.filter(d => d.type === type);
      return {
        lek: f.reduce((s, d) => s + (d.lek || 0), 0),
        eur: f.reduce((s, d) => s + (d.eur || 0), 0),
        usd: f.reduce((s, d) => s + (d.usd || 0), 0),
        gbp: f.reduce((s, d) => s + (d.gbp || 0), 0),
        chf: f.reduce((s, d) => s + (d.chf || 0), 0),
      };
    };
    const borxhe       = debtsByType('debt');
    const kthimBorxhi  = debtsByType('repayment');

    // Per-day buckets
    const byDay = {};
    const ensure = d => { if (!byDay[d]) byDay[d] = { date: d, xhiro_lek: 0, xhiro_eur: 0, xhiro_usd: 0, xhiro_gbp: 0, xhiro_chf: 0, shpenzime_lek: 0, shpenzime_eur: 0, biba_lek: 0, biba_eur: 0, diana_lek: 0, diana_eur: 0, bank_withdraw_lek: 0, bank_deposit_lek: 0, flori_cope: 0, flori_gram: 0, diamant_cope: 0, diamant_gram: 0, online_cope: 0 }; return byDay[d] };
    recs.forEach(r => {
      const b = ensure(r.date);
      b.shpenzime_lek    += r.expenses_lek    || 0;
      b.shpenzime_eur    += r.expenses_eur    || 0;
      b.biba_lek         += r.biba_lek        || 0;
      b.biba_eur         += r.biba_eur        || 0;
      b.diana_lek        += r.diana_lek       || 0;
      b.diana_eur        += r.diana_eur       || 0;
      b.bank_withdraw_lek+= r.bank_withdraw_lek || 0;
      b.bank_deposit_lek += r.bank_deposit_lek  || 0;
    });
    sales.forEach(s => {
      const sign = s.is_return ? -1 : 1;
      const b = ensure(s.date);
      b.xhiro_lek += sign * ((s.lek_cash||0) + (s.lek_pb||0));
      b.xhiro_eur += sign * ((s.eur_cash||0) + (s.eur_pb||0));
      b.xhiro_usd += sign * (s.usd_cash||0);
      b.xhiro_gbp += sign * (s.gbp_cash||0);
      b.xhiro_chf += sign * (s.chf_cash||0);
      if (s.type === 'flori')   { b.flori_cope   += sign * (s.cope||0); b.flori_gram   += sign * (s.gram||0); }
      if (s.type === 'diamant') { b.diamant_cope += sign * (s.cope||0); b.diamant_gram += sign * (s.gram||0); }
      if (s.type === 'online')  { b.online_cope  += sign * (s.cope||0); }
    });
    const buckets = Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date));

    res.json({
      from, to,
      days_with_data: recs.length,
      xhiro,
      byType,
      totals: {
        shpenzime_lek: sumD('expenses_lek'), shpenzime_eur: sumD('expenses_eur'), shpenzime_usd: sumD('expenses_usd'),
        biba_lek:  sumD('biba_lek'),  biba_eur:  sumD('biba_eur'),  biba_usd:  sumD('biba_usd'),  biba_gbp:  sumD('biba_gbp'),  biba_chf:  sumD('biba_chf'),  biba_gram:  sumD('biba_gram'),
        diana_lek: sumD('diana_lek'), diana_eur: sumD('diana_eur'), diana_usd: sumD('diana_usd'), diana_gbp: sumD('diana_gbp'), diana_chf: sumD('diana_chf'), diana_hurda: sumD('diana_hurda'),
        bank_withdraw_lek: sumD('bank_withdraw_lek'), bank_withdraw_eur: sumD('bank_withdraw_eur'), bank_withdraw_usd: sumD('bank_withdraw_usd'),
        bank_deposit_lek:  sumD('bank_deposit_lek'),  bank_deposit_eur:  sumD('bank_deposit_eur'),  bank_deposit_usd:  sumD('bank_deposit_usd'),
        conv_lek:  sumD('conv_lek'),  conv_eur:  sumD('conv_eur'),  conv_usd:  sumD('conv_usd'),  conv_gbp:  sumD('conv_gbp'),  conv_chf:  sumD('conv_chf'),
        hurda_lek: sumD('hurda_lek'), hurda_eur: sumD('hurda_eur'), hurda_usd: sumD('hurda_usd'), hurda_gbp: sumD('hurda_gbp'), hurda_chf: sumD('hurda_chf'), hurda_gram: sumD('hurda_gram'),
        safe_deposit_lek:  sumD('safe_deposit_lek'),  safe_deposit_eur:  sumD('safe_deposit_eur'),
        safe_withdraw_lek: sumD('safe_withdraw_lek'), safe_withdraw_eur: sumD('safe_withdraw_eur'),
        shlyerje_eur: sumD('debt_settlement_eur'), shlyerje_usd: sumD('debt_settlement_usd'), shlyerje_gbp: sumD('debt_settlement_gbp'), shlyerje_chf: sumD('debt_settlement_chf'), shlyerje_has: sumD('debt_settlement_has'),
        borxhe_lek: borxhe.lek, borxhe_eur: borxhe.eur, borxhe_usd: borxhe.usd, borxhe_gbp: borxhe.gbp, borxhe_chf: borxhe.chf,
        kthim_borxhi_lek: kthimBorxhi.lek, kthim_borxhi_eur: kthimBorxhi.eur, kthim_borxhi_usd: kthimBorxhi.usd, kthim_borxhi_gbp: kthimBorxhi.gbp, kthim_borxhi_chf: kthimBorxhi.chf,
      },
      buckets,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// YEARLY REPORT — one row per month aggregating all daily data
// ============================================================
app.get('/api/yearly/:year', async (req, res) => {
  try {
    const { year } = req.params;
    const months = [];
    for (let m = 1; m <= 12; m++) {
      const prefix = `${year}-${String(m).padStart(2, '0')}`;
      const recs = await queryAll('SELECT * FROM daily_records WHERE date LIKE ?', [prefix + '%']);
      const sales = await queryAll('SELECT * FROM sales WHERE date LIKE ?', [prefix + '%']);
      const debts = await queryAll('SELECT * FROM customer_debts WHERE date LIKE ?', [prefix + '%']);

      const sumD = field => recs.reduce((s, r) => s + (r[field] || 0), 0);
      const sumS = (arr, field) => arr.reduce((s, r) => s + (r[field] || 0), 0);

      // Xhiro neto per currency = sales (cash+pb) − returns (cash+pb)
      const salesNet = sales.reduce((acc, s) => {
        const sign = s.is_return ? -1 : 1;
        acc.lek += sign * ((s.lek_cash || 0) + (s.lek_pb || 0));
        acc.eur += sign * ((s.eur_cash || 0) + (s.eur_pb || 0));
        acc.usd += sign * (s.usd_cash || 0);
        acc.gbp += sign * (s.gbp_cash || 0);
        acc.chf += sign * (s.chf_cash || 0);
        return acc;
      }, { lek: 0, eur: 0, usd: 0, gbp: 0, chf: 0 });

      const debtsByType = type => {
        const f = debts.filter(d => d.type === type);
        return {
          lek: sumS(f, 'lek'), eur: sumS(f, 'eur'),
          usd: sumS(f, 'usd'), gbp: sumS(f, 'gbp'), chf: sumS(f, 'chf'),
        };
      };
      const borxhe = debtsByType('debt');
      const kthimBorxhi = debtsByType('repayment');

      months.push({
        year: parseInt(year),
        month: m,
        days_with_data: recs.length,
        // Sales (xhiro neto)
        xhiro_lek: salesNet.lek,
        xhiro_eur: salesNet.eur,
        xhiro_usd: salesNet.usd,
        xhiro_gbp: salesNet.gbp,
        xhiro_chf: salesNet.chf,
        // Expenses
        shpenzime_lek: sumD('expenses_lek'),
        shpenzime_eur: sumD('expenses_eur'),
        shpenzime_usd: sumD('expenses_usd'),
        // Customer debts
        borxhe_lek: borxhe.lek, borxhe_eur: borxhe.eur, borxhe_usd: borxhe.usd, borxhe_gbp: borxhe.gbp, borxhe_chf: borxhe.chf,
        kthim_borxhi_lek: kthimBorxhi.lek, kthim_borxhi_eur: kthimBorxhi.eur, kthim_borxhi_usd: kthimBorxhi.usd, kthim_borxhi_gbp: kthimBorxhi.gbp, kthim_borxhi_chf: kthimBorxhi.chf,
        // BIBA / DIANA
        biba_lek: sumD('biba_lek'), biba_eur: sumD('biba_eur'), biba_usd: sumD('biba_usd'), biba_gbp: sumD('biba_gbp'), biba_chf: sumD('biba_chf'), biba_gram: sumD('biba_gram'),
        diana_lek: sumD('diana_lek'), diana_eur: sumD('diana_eur'), diana_usd: sumD('diana_usd'), diana_gbp: sumD('diana_gbp'), diana_chf: sumD('diana_chf'), diana_hurda: sumD('diana_hurda'),
        // Shlyerje borxhi te produkteve
        shlyerje_eur: sumD('debt_settlement_eur'),
        shlyerje_usd: sumD('debt_settlement_usd'),
        shlyerje_gbp: sumD('debt_settlement_gbp'),
        shlyerje_chf: sumD('debt_settlement_chf'),
        shlyerje_has: sumD('debt_settlement_has'),
        // Conversion
        konv_lek: sumD('conv_lek'), konv_eur: sumD('conv_eur'), konv_usd: sumD('conv_usd'), konv_gbp: sumD('conv_gbp'), konv_chf: sumD('conv_chf'),
        hurda_lek: sumD('hurda_lek'), hurda_eur: sumD('hurda_eur'), hurda_usd: sumD('hurda_usd'), hurda_gbp: sumD('hurda_gbp'), hurda_chf: sumD('hurda_chf'), hurda_gram: sumD('hurda_gram'),
        // Bank movements
        bank_withdraw_lek: sumD('bank_withdraw_lek'), bank_withdraw_eur: sumD('bank_withdraw_eur'), bank_withdraw_usd: sumD('bank_withdraw_usd'),
        bank_deposit_lek: sumD('bank_deposit_lek'), bank_deposit_eur: sumD('bank_deposit_eur'), bank_deposit_usd: sumD('bank_deposit_usd'),
        // Safe
        safe_deposit_lek: sumD('safe_deposit_lek'), safe_deposit_eur: sumD('safe_deposit_eur'),
        safe_withdraw_lek: sumD('safe_withdraw_lek'), safe_withdraw_eur: sumD('safe_withdraw_eur'),
      });
    }
    res.json(months);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// PRODUCTS — lookup + stock + image + backup (before /:id routes)
// ============================================================
app.get('/api/products/lookup', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json(null);
    const product = await queryOne(
      'SELECT * FROM products WHERE active = 1 AND (barcode = ? OR sku = ?) LIMIT 1',
      [q, q]
    );
    res.json(product || null);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/products/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json([]);
    const like = `%${q}%`;
    const rows = await queryAll(
      `SELECT id, name, sku, barcode, category, sell_price, vat_rate, stock, image_path, gram,
              is_promotion, promo_discount_pct, serial_no, purchase_price_no_vat
         FROM products
        WHERE active = 1
          AND (barcode LIKE ? OR sku LIKE ? OR name LIKE ? OR serial_no LIKE ?)
        ORDER BY (CASE WHEN barcode = ? THEN 0 WHEN sku = ? THEN 1 WHEN serial_no = ? THEN 2 ELSE 3 END), name
        LIMIT 12`,
      [like, like, like, like, q, q, q]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/products/:id/stock', async (req, res) => {
  try {
    const { id } = req.params;
    const { delta } = req.body;
    if (typeof delta !== 'number') return res.status(400).json({ error: 'delta required' });
    await run('UPDATE products SET stock = MAX(0, stock + ?) WHERE id = ?', [delta, id]);
    const p = await queryOne('SELECT stock FROM products WHERE id = ?', [id]);
    res.json({ success: true, stock: p?.stock ?? 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/products/:id/image', upload.single('image'), async (req, res) => {
  try {
    const { id } = req.params;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const image_path = req.file.filename;
    await run('UPDATE products SET image_path = ? WHERE id = ?', [image_path, id]);
    res.json({ success: true, image_path });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/products/:id/image', async (req, res) => {
  try {
    const { id } = req.params;
    const p = await queryOne('SELECT image_path FROM products WHERE id = ?', [id]);
    if (p?.image_path) {
      const fp = path.join(uploadDir, p.image_path);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
    await run("UPDATE products SET image_path = '' WHERE id = ?", [id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/backup', async (req, res) => {
  try {
    const data = await exportDB();
    if (!data) return res.status(500).json({ error: 'DB not ready' });
    const buf = Buffer.from(data);
    const date = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="gold_shop_backup_${date}.db"`);
    res.send(buf);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// PRODUCTS
// ============================================================
app.get('/api/products', async (req, res) => {
  try {
    const rows = await queryAll(
      'SELECT * FROM products WHERE active = 1 ORDER BY category, name',
      []
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// updated_at is a millisecond timestamp used for optimistic locking on
// concurrent product edits. INSERT and UPDATE both stamp `now`, so a client
// that PUTs with a stale value gets a 409 and can re-fetch.
const NOW_TS_SQL = "strftime('%Y-%m-%d %H:%M:%f','now')";

app.post('/api/products', async (req, res) => {
  try {
    const d = req.body;
    const promoPct = d.is_promotion
      ? Math.max(0, Math.min(100, parseFloat(d.promo_discount_pct) || 0))
      : 0;
    await run(
      `INSERT INTO products (name, sku, barcode, category, brand, description, cost_price, sell_price, stock, min_stock, vat_rate, unit, is_promotion, promo_discount_pct, gram, serial_no, purchase_price_no_vat, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${NOW_TS_SQL})`,
      [
        d.name, d.sku || '', d.barcode || '',
        d.category || 'Tjeter', d.brand || '', d.description || '',
        d.cost_price || 0, d.sell_price || 0,
        d.stock || 0, d.min_stock !== undefined ? d.min_stock : 5,
        d.vat_rate !== undefined && d.vat_rate !== '' ? parseFloat(d.vat_rate) : 20,
        d.unit || 'copë',
        d.is_promotion ? 1 : 0,
        promoPct,
        parseFloat(d.gram) || 0,
        d.serial_no || '',
        parseFloat(d.purchase_price_no_vat) || 0,
      ]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const d = req.body;
    // Optimistic lock: if client sends `updated_at`, require it to still match
    // what's in the DB. Missing/empty means the client opts out (legacy calls).
    const clientTs = (d.updated_at ?? '').toString();
    const current = await queryOne('SELECT updated_at FROM products WHERE id = ?', [id]);
    if (!current) return res.status(404).json({ error: 'not found' });
    if (clientTs && (current.updated_at || '') && clientTs !== current.updated_at) {
      const fresh = await queryOne('SELECT * FROM products WHERE id = ?', [id]);
      return res.status(409).json({
        error: 'conflict',
        message: 'Ky produkt u ndryshua nga një PC tjetër. Rifresko dhe provo përsëri.',
        current: fresh,
      });
    }
    const promoPct = d.is_promotion
      ? Math.max(0, Math.min(100, parseFloat(d.promo_discount_pct) || 0))
      : 0;
    await run(
      `UPDATE products
       SET name=?, sku=?, barcode=?, category=?, brand=?, description=?,
           cost_price=?, sell_price=?, stock=?, min_stock=?, vat_rate=?, unit=?,
           is_promotion=?, promo_discount_pct=?, gram=?,
           serial_no=?, purchase_price_no_vat=?,
           updated_at=${NOW_TS_SQL}
       WHERE id=?`,
      [
        d.name, d.sku || '', d.barcode || '',
        d.category || 'Tjeter', d.brand || '', d.description || '',
        d.cost_price || 0, d.sell_price || 0,
        d.stock || 0, d.min_stock !== undefined ? d.min_stock : 5,
        d.vat_rate !== undefined && d.vat_rate !== '' ? parseFloat(d.vat_rate) : 20,
        d.unit || 'copë',
        d.is_promotion ? 1 : 0,
        promoPct,
        parseFloat(d.gram) || 0,
        d.serial_no || '',
        parseFloat(d.purchase_price_no_vat) || 0,
        id,
      ]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Toggle vetëm flag-un e promocionit, pa cenuar fushat e tjera. Përdoret nga
// Fatura Blerje kur admin-i shënon një produkt si "në promocion" direkt nga
// rreshti i faturës, dhe nga faqja Produkte Promocion për ta hequr.
// Update i shpejtë vetëm i barkodit — përdoret nga FaturaBlerje kur admin
// gjeneron një barkod të ri direkt në rresht dhe do ta ruajë menjëherë
// (që skaneri të funksionojë para se të ruhet fatura).
app.put('/api/products/:id/barcode', async (req, res) => {
  try {
    const { id } = req.params;
    const barcode = String(req.body?.barcode ?? '').trim();
    const exists = await queryOne('SELECT id FROM products WHERE id = ?', [id]);
    if (!exists) return res.status(404).json({ error: 'not found' });
    await run(
      `UPDATE products SET barcode=?, updated_at=${NOW_TS_SQL} WHERE id=?`,
      [barcode, id],
    );
    res.json({ success: true, barcode });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/products/:id/promotion', async (req, res) => {
  try {
    const { id } = req.params;
    const on = !!(req.body && req.body.on);
    const pct = on
      ? Math.max(0, Math.min(100, parseFloat(req.body?.discount_pct) || 0))
      : 0;
    const exists = await queryOne('SELECT id FROM products WHERE id = ?', [id]);
    if (!exists) return res.status(404).json({ error: 'not found' });
    await run(
      `UPDATE products SET is_promotion=?, promo_discount_pct=?, updated_at=${NOW_TS_SQL} WHERE id=?`,
      [on ? 1 : 0, pct, id],
    );
    res.json({ success: true, is_promotion: on ? 1 : 0, promo_discount_pct: pct });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/products/import', async (req, res) => {
  try {
    const { products } = req.body;
    if (!Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ error: 'Lista e produkteve është bosh' });
    }
    // Returns one id per input row in the same order; null for skipped rows.
    // Callers (e.g. FaturaBlerje import) need these ids to attach the freshly
    // created products as line items.
    const ids = [];
    let imported = 0;
    let matched = 0;
    for (const d of products) {
      if (!d.name || !String(d.name).trim()) { ids.push(null); continue; }
      const barcode   = String(d.barcode || '').trim();
      const sku       = String(d.sku || '').trim();
      const serial_no = String(d.serial_no || '').trim();
      // Reuse existing product if barcode / serial / SKU matches — otherwise
      // repeat imports create duplicate rows. Stock/cost nuk mbishkruhen këtu;
      // për invoice-based updates ekziston flow-i i faturës që i menaxhon.
      let existing = null;
      if (barcode)              existing = await queryOne('SELECT id FROM products WHERE barcode = ? LIMIT 1', [barcode]);
      if (!existing && serial_no) existing = await queryOne('SELECT id FROM products WHERE serial_no = ? LIMIT 1', [serial_no]);
      if (!existing && sku)     existing = await queryOne('SELECT id FROM products WHERE sku = ? LIMIT 1', [sku]);
      if (existing) {
        await run('UPDATE products SET active = 1 WHERE id = ?', [existing.id]);
        ids.push(existing.id);
        matched++;
        continue;
      }
      await run(
        `INSERT INTO products (name, sku, barcode, category, brand, description,
           cost_price, sell_price, stock, min_stock,
           serial_no, purchase_price_no_vat, vat_rate, unit, gram)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          String(d.name).trim(),
          sku, barcode,
          d.category || 'Tjeter', d.brand || '', d.description || '',
          parseFloat(d.cost_price) || 0, parseFloat(d.sell_price) || 0,
          parseInt(d.stock) || 0, parseInt(d.min_stock) || 5,
          serial_no,
          parseFloat(d.purchase_price_no_vat) || 0,
          d.vat_rate != null && d.vat_rate !== '' ? parseFloat(d.vat_rate) : 20,
          d.unit || 'copë',
          parseFloat(d.gram) || 0,
        ]
      );
      const row = await queryOne('SELECT last_insert_rowid() AS id');
      ids.push(row?.id || null);
      imported++;
    }
    res.json({ success: true, imported, matched, ids });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await run('UPDATE products SET active = 0 WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// EXCHANGE RATES (Banka e Shqipërisë, cached per date in DB)
// ============================================================
const SUPPORTED_CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF'];
const FALLBACK_RATES = { EUR: 99.50, USD: 92.00, GBP: 117.00, CHF: 103.50 };

// Parse Bank of Albania (BSH) daily exchange rate HTML page.
// Returns { EUR: 99.5, USD: 92.0, ... } meaning 1 unit foreign currency = N LEK.
function parseBSHHtml(html) {
  const rates = {};
  for (const cur of SUPPORTED_CURRENCIES) {
    // Look for the currency code anywhere followed by a number (typical BSH table cells)
    const patterns = [
      new RegExp(`${cur}[\\s\\S]{0,200}?([0-9]{1,4}[.,][0-9]{1,4})`, 'i'),
      new RegExp(`>\\s*${cur}\\s*<[\\s\\S]{0,400}?>\\s*([0-9]{1,4}[.,][0-9]{1,4})\\s*<`, 'i'),
    ];
    for (const re of patterns) {
      const m = html.match(re);
      if (m) {
        const v = parseFloat(m[1].replace(',', '.'));
        if (v > 1 && v < 1000) { rates[cur] = +v.toFixed(4); break; }
      }
    }
  }
  return rates;
}

async function fetchBSHRates() {
  // 1) Try the official Bank of Albania daily exchange rate page (HTML scrape)
  const bshUrls = [
    'https://www.bankofalbania.org/Markets/Daily_exchange_rate.html',
    'https://www.bankofalbania.org/Markets/Daily_exchange_rate/',
  ];
  for (const url of bshUrls) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(8000),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GoldShopApp/1.0)' },
      });
      if (!res.ok) continue;
      const html = await res.text();
      const rates = parseBSHHtml(html);
      if (Object.keys(rates).length >= 2) return { rates, source: 'BSH' };
    } catch (_) { /* try next */ }
  }
  // 2) Fallback: open exchange rates API (rates derived, not BSH-official)
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/ALL', { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const j = await res.json();
      if (j && j.rates) {
        const out = {};
        for (const c of SUPPORTED_CURRENCIES) {
          const r = j.rates[c];
          if (r && r > 0) out[c] = +(1 / r).toFixed(4);
        }
        if (Object.keys(out).length === SUPPORTED_CURRENCIES.length) return { rates: out, source: 'open.er-api.com' };
      }
    }
  } catch (_) { /* fall through */ }
  // 3) Last resort: hardcoded approximate
  return { rates: { ...FALLBACK_RATES }, source: 'fallback' };
}

app.get('/api/exchange-rates/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const cached = await queryAll('SELECT currency, rate, source FROM exchange_rates WHERE date = ?', [date]);
    let rates = {};
    let source = 'cache';
    if (cached.length >= SUPPORTED_CURRENCIES.length) {
      for (const r of cached) rates[r.currency] = r.rate;
      source = cached[0].source || 'cache';
    } else {
      const fetched = await fetchBSHRates();
      rates = fetched.rates;
      source = fetched.source;
      for (const [cur, rate] of Object.entries(rates)) {
        await run(
          'INSERT OR REPLACE INTO exchange_rates (date, currency, rate, source) VALUES (?, ?, ?, ?)',
          [date, cur, rate, source]
        );
      }
    }
    rates.LEK = 1;
    res.json({ date, rates, source });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/exchange-rates/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const { rates } = req.body || {};
    if (!rates || typeof rates !== 'object') return res.status(400).json({ error: 'rates required' });
    for (const [cur, rate] of Object.entries(rates)) {
      if (cur === 'LEK') continue;
      await run(
        'INSERT OR REPLACE INTO exchange_rates (date, currency, rate, source) VALUES (?, ?, ?, ?)',
        [date, cur, parseFloat(rate) || 0, 'manual']
      );
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// INVOICES (Fatura Shitje)
// ============================================================
function computeLineTotals(it) {
  const qty   = parseFloat(it.qty) || 0;
  const price = parseFloat(it.unit_price_no_vat) || 0;
  const disc  = parseFloat(it.discount_percent) || 0;
  const vatR  = parseFloat(it.vat_rate) || 0;
  const gross = qty * price;
  const subtotal_no_vat = +(gross * (1 - disc / 100)).toFixed(2);
  const vat_amount     = +(subtotal_no_vat * (vatR / 100)).toFixed(2);
  const total_with_vat = +(subtotal_no_vat + vat_amount).toFixed(2);
  return { qty, unit_price_no_vat: price, discount_percent: disc, vat_rate: vatR, subtotal_no_vat, vat_amount, total_with_vat };
}

async function nextInvoiceNo(date) {
  const year = (date || '').slice(0, 4) || new Date().getFullYear().toString();
  const row = await queryOne(
    "SELECT COUNT(*) AS c FROM invoices WHERE date LIKE ?",
    [year + '%']
  );
  const next = (row?.c || 0) + 1;
  return `${year}-${String(next).padStart(5, '0')}`;
}

app.get('/api/invoices/next-no', async (req, res) => {
  try {
    const { date } = req.query;
    res.json({ invoice_no: await nextInvoiceNo(date) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Filtra sipas produkteve — nëse jepen `material` ose `category`, kthen vetëm
// faturat që kanë të paktën një artikull me atë material/kategori.
function buildItemFilterSQL(material, category) {
  const conds = [];
  const params = [];
  if (material === 'flori' || material === 'diamant') {
    conds.push('COALESCE(p.material, \'\') = ?');
    params.push(material);
  }
  if (category && category.trim()) {
    conds.push('COALESCE(p.category, \'\') = ?');
    params.push(category.trim());
  }
  if (conds.length === 0) return { sql: '', params: [] };
  const clause = `AND EXISTS (
    SELECT 1 FROM invoice_items ii
    LEFT JOIN products p ON p.id = ii.product_id
    WHERE ii.invoice_id = i.id AND ${conds.join(' AND ')}
  )`;
  return { sql: clause, params };
}

// Filtër opsional për online: pa parametër → të gjitha; online=0 → vetëm në dyqan;
// online=1 → vetëm porosi online. status= filtron sipas order_status.
function buildOnlineFilter(online, status) {
  const conds = [];
  const params = [];
  if (online === '0' || online === '1') {
    conds.push('COALESCE(i.is_online, 0) = ?');
    params.push(parseInt(online));
  }
  if (status && String(status).trim()) {
    conds.push('COALESCE(i.order_status, \'\') = ?');
    params.push(String(status).trim());
  }
  return {
    sql: conds.length ? ' AND ' + conds.join(' AND ') : '',
    params,
  };
}

app.get('/api/invoices/by-date/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const { material, category, online, status } = req.query;
    const filter = buildItemFilterSQL(material, category);
    const onl = buildOnlineFilter(online, status);
    const rows = await queryAll(
      `SELECT i.*,
         (i.amount_paid - COALESCE((SELECT SUM(amount) FROM invoice_payments WHERE invoice_id = i.id), 0)) AS initial_amount_paid,
         (SELECT GROUP_CONCAT(barcode, '|') FROM invoice_items WHERE invoice_id = i.id AND barcode IS NOT NULL AND barcode <> '') AS barcodes,
         (SELECT GROUP_CONCAT(method || ':' || COALESCE(currency,'') || ':' || COALESCE(amount,0), '|')
            FROM invoice_payment_splits WHERE invoice_id = i.id) AS splits_summary
       FROM invoices i WHERE i.date = ? ${filter.sql} ${onl.sql} ORDER BY i.id ASC`,
      [date, ...filter.params, ...onl.params]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/invoices/by-range', async (req, res) => {
  try {
    const { from, to, material, category, online, status } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to required' });
    const filter = buildItemFilterSQL(material, category);
    const onl = buildOnlineFilter(online, status);
    const rows = await queryAll(
      `SELECT i.*,
         (i.amount_paid - COALESCE((SELECT SUM(amount) FROM invoice_payments WHERE invoice_id = i.id), 0)) AS initial_amount_paid,
         (SELECT GROUP_CONCAT(barcode, '|') FROM invoice_items WHERE invoice_id = i.id AND barcode IS NOT NULL AND barcode <> '') AS barcodes,
         (SELECT GROUP_CONCAT(method || ':' || COALESCE(currency,'') || ':' || COALESCE(amount,0), '|')
            FROM invoice_payment_splits WHERE invoice_id = i.id) AS splits_summary
       FROM invoices i WHERE i.date BETWEEN ? AND ? ${filter.sql} ${onl.sql} ORDER BY i.date ASC, i.id ASC`,
      [from, to, ...filter.params, ...onl.params]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/invoices/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const invoice = await queryOne('SELECT * FROM invoices WHERE id = ?', [id]);
    if (!invoice) return res.status(404).json({ error: 'not found' });
    const items = await queryAll('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id ASC', [id]);
    const payment_splits = await queryAll(
      'SELECT id, method, currency, amount, exchange_rate FROM invoice_payment_splits WHERE invoice_id = ? ORDER BY id ASC',
      [id]
    );
    const paySum = await queryOne('SELECT COALESCE(SUM(amount), 0) AS s FROM invoice_payments WHERE invoice_id = ?', [id])?.s || 0;
    const raw = (invoice.amount_paid || 0) - paySum;
    const initial_amount_paid = +(invoice.is_credit_note ? raw : Math.max(0, raw)).toFixed(2);
    res.json({ ...invoice, items, payment_splits, initial_amount_paid });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

function recomputeInvoiceTotals(items) {
  let sub = 0, vat = 0, tot = 0;
  for (const it of items) {
    sub += it.subtotal_no_vat || 0;
    vat += it.vat_amount     || 0;
    tot += it.total_with_vat || 0;
  }
  return {
    subtotal_no_vat: +sub.toFixed(2),
    total_vat: +vat.toFixed(2),
    total_with_vat: +tot.toFixed(2),
  };
}

// Normalizon splits nga klienti — heq rreshtat bosh, siguron numra të vlefshëm.
function normalizeSplits(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(s => ({
      method: s?.method === 'bank' ? 'bank' : 'cash',
      currency: (s?.currency || 'LEK').toUpperCase(),
      amount: parseFloat(s?.amount) || 0,
      exchange_rate: parseFloat(s?.exchange_rate) || 1,
    }))
    .filter(s => s.amount !== 0);
}

// Konverton çdo split → LEK me kursin e vet, pastaj → monedhën e faturës me
// kursin e faturës. Kthen paid_cash / paid_bank / amount_paid në monedhën e
// faturës që raportet ekzistuese të funksionojnë pa u prishur.
function aggregateSplits(splits, invoiceRate) {
  const invR = parseFloat(invoiceRate) || 1;
  let lekCash = 0, lekBank = 0;
  for (const s of splits) {
    const lek = s.amount * s.exchange_rate;
    if (s.method === 'cash') lekCash += lek;
    else lekBank += lek;
  }
  return {
    paidCash: +(lekCash / invR).toFixed(2),
    paidBank: +(lekBank / invR).toFixed(2),
    amountPaid: +((lekCash + lekBank) / invR).toFixed(2),
  };
}

async function adjustStock(items, sign) {
  for (const it of items) {
    if (it.product_id && it.qty) {
      const delta = sign * (parseInt(it.qty) || 0);
      if (delta !== 0) {
        await run('UPDATE products SET stock = MAX(0, stock + ?) WHERE id = ?', [delta, it.product_id]);
      }
    }
  }
}

// Auto-register a client when an invoice references one that's not in the
// `clients` table yet. Match by NIPT first (strongest key), then by exact
// normalized full name. Returns silently — failure must never block the sale.
async function ensureClientExists(name, nipt) {
  try {
    const cleanName = (name || '').trim();
    const cleanNipt = (nipt || '').trim();
    if (!cleanName && !cleanNipt) return;

    if (cleanNipt) {
      const byNipt = await queryOne('SELECT id FROM clients WHERE nipt = ?', [cleanNipt]);
      if (byNipt) return;
    } else {
      const byName = await queryOne(
        `SELECT id FROM clients
          WHERE LOWER(TRIM(first_name || ' ' || last_name)) = LOWER(?)`,
        [cleanName]
      );
      if (byName) return;
    }

    const parts = cleanName.split(/\s+/);
    const firstName = parts[0] || '';
    const lastName  = parts.slice(1).join(' ');
    await run(
      `INSERT INTO clients (nipt, first_name, last_name, address, phone, notes)
       VALUES (?, ?, ?, '', '', '')`,
      [cleanNipt, firstName, lastName]
    );
  } catch { /* ignore — auto-register is best-effort */ }
}

app.post('/api/invoices', async (req, res) => {
  try {
    const d = req.body || {};
    const date = d.date;
    if (!date) return res.status(400).json({ error: 'date required' });
    const userProvidedNo = (d.invoice_no || '').trim();

    const items = (d.items || []).map(it => ({ ...it, ...computeLineTotals(it) }));
    const totals = recomputeInvoiceTotals(items);

    const pm = ['cash', 'bank', 'debt', 'pos', 'mikse'].includes(d.payment_method) ? d.payment_method : 'cash';
    // Splits janë burimi i së vërtetës kur jepen — cilado qoftë payment_method.
    // Kjo lejon frontend-in të infererrë 'cash'/'bank'/'mikse' nga një split i
    // vetëm ndërsa backend-i llogarit gjithnjë të njëjtat aggregate.
    const splits = normalizeSplits(d.payment_splits);
    let paidCash, paidPos, paidBank, amountPaid;
    if (splits.length > 0) {
      const agg = aggregateSplits(splits, d.exchange_rate);
      paidCash = agg.paidCash;
      paidBank = agg.paidBank;
      paidPos = 0;
      amountPaid = agg.amountPaid;
    } else if (pm === 'mikse') {
      paidCash = parseFloat(d.paid_cash) || 0;
      paidPos  = parseFloat(d.paid_pos)  || 0;
      paidBank = parseFloat(d.paid_bank) || 0;
      amountPaid = +(paidCash + paidPos + paidBank).toFixed(2);
    } else {
      paidCash = 0; paidPos = 0; paidBank = 0;
      if (d.amount_paid != null && d.amount_paid !== '') {
        amountPaid = parseFloat(d.amount_paid) || 0;
      } else {
        amountPaid = (pm === 'cash' || pm === 'pos') ? totals.total_with_vat : 0;
      }
    }
    const amountDue = Math.max(0, +(totals.total_with_vat - amountPaid).toFixed(2));
    const totalDiscount = +items.reduce((s, it) => {
      const gross = (parseFloat(it.qty) || 0) * (parseFloat(it.unit_price_no_vat) || 0);
      return s + gross * ((parseFloat(it.discount_percent) || 0) / 100);
    }, 0).toFixed(2);
    await ensureClientExists(d.customer_name, d.customer_nipt);
    const isOnline = d.is_online ? 1 : 0;
    // Për porosi online statusi fillestar është 'e_re' nëse nuk është specifikuar.
    const orderStatus = isOnline
      ? (['e_re','ne_pergatitje','derguar','dorezuar','anuluar'].includes(d.order_status) ? d.order_status : 'e_re')
      : '';
    const doInsertInvoice = (invNo) => run(
      `INSERT INTO invoices (date, invoice_no, customer_name, customer_nipt, currency, exchange_rate,
        subtotal_no_vat, total_discount, total_vat, total_with_vat, payment_method, amount_paid, amount_due,
        paid_cash, paid_pos, paid_bank, notes,
        is_online, channel, shipping_address, order_status, tracking_no)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        date, invNo, d.customer_name || '', d.customer_nipt || '',
        d.currency || 'LEK', parseFloat(d.exchange_rate) || 1,
        totals.subtotal_no_vat, totalDiscount,
        totals.total_vat, totals.total_with_vat,
        pm, amountPaid, amountDue,
        paidCash, paidPos, paidBank,
        d.notes || '',
        isOnline, d.channel || '', d.shipping_address || '', orderStatus, d.tracking_no || '',
      ]
    );
    // If two PCs race, the UNIQUE index on invoice_no makes one INSERT fail;
    // retryOnUniqueNo asks for a fresh number and tries again. User-provided
    // numbers are inserted as-is so a collision surfaces to the caller.
    const invoice_no = userProvidedNo
      ? (await doInsertInvoice(userProvidedNo), userProvidedNo)
      : await retryOnUniqueNo(() => nextInvoiceNo(date), doInsertInvoice);
    const invoice = await queryOne('SELECT id FROM invoices WHERE date = ? AND invoice_no = ?', [date, invoice_no]);
    const invoiceId = invoice?.id;
    for (const it of items) {
      await run(
        `INSERT INTO invoice_items (invoice_id, product_id, serial_no, barcode, name, qty, gram, unit_price_no_vat,
          discount_percent, subtotal_no_vat, vat_rate, vat_amount, total_with_vat,
          on_promotion, promo_discount_pct)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          invoiceId, it.product_id || null, it.serial_no || '', it.barcode || '', it.name || '',
          it.qty, parseFloat(it.gram) || 0, it.unit_price_no_vat, it.discount_percent,
          it.subtotal_no_vat, it.vat_rate, it.vat_amount, it.total_with_vat,
          it.on_promotion ? 1 : 0, parseFloat(it.promo_discount_pct) || 0,
        ]
      );
    }
    for (const s of splits) {
      await run(
        `INSERT INTO invoice_payment_splits (invoice_id, method, currency, amount, exchange_rate)
         VALUES (?, ?, ?, ?, ?)`,
        [invoiceId, s.method, s.currency, s.amount, s.exchange_rate]
      );
    }
    await adjustStock(items, -1);
    res.json({ success: true, id: invoiceId, invoice_no });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/invoices/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const d = req.body || {};
    const existing = await queryOne('SELECT * FROM invoices WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'not found' });
    const oldItems = await queryAll('SELECT * FROM invoice_items WHERE invoice_id = ?', [id]);

    const items = (d.items || []).map(it => ({ ...it, ...computeLineTotals(it) }));
    const totals = recomputeInvoiceTotals(items);

    const pmU = ['cash', 'bank', 'debt', 'pos', 'mikse'].includes(d.payment_method) ? d.payment_method : 'cash';
    const splitsU = normalizeSplits(d.payment_splits);
    // The form value represents the INITIAL portion paid at sale time. Any subsequent
    // payments registered via the Detyrime Klienti modal live in invoice_payments and
    // must be preserved when the user re-saves the invoice from the editor.
    let paidCashU, paidPosU, paidBankU, formInitialPaid;
    if (splitsU.length > 0) {
      const agg = aggregateSplits(splitsU, d.exchange_rate);
      paidCashU = agg.paidCash;
      paidBankU = agg.paidBank;
      paidPosU  = 0;
      formInitialPaid = agg.amountPaid;
    } else if (pmU === 'mikse') {
      paidCashU = parseFloat(d.paid_cash) || 0;
      paidPosU  = parseFloat(d.paid_pos)  || 0;
      paidBankU = parseFloat(d.paid_bank) || 0;
      formInitialPaid = +(paidCashU + paidPosU + paidBankU).toFixed(2);
    } else {
      paidCashU = 0; paidPosU = 0; paidBankU = 0;
      if (d.amount_paid != null && d.amount_paid !== '') {
        formInitialPaid = parseFloat(d.amount_paid) || 0;
      } else {
        formInitialPaid = (pmU === 'cash' || pmU === 'pos') ? totals.total_with_vat : 0;
      }
    }
    const existingPaySum = await queryOne(
      'SELECT COALESCE(SUM(amount), 0) AS s FROM invoice_payments WHERE invoice_id = ?',
      [id]
    )?.s || 0;
    const amountPaidU = +(formInitialPaid + existingPaySum).toFixed(2);
    // Për fatura kreditore lejo `amount_due` negativ (shop i detyrohet klientit
    // ose po redukton borxhin origjinal). Për fatura të zakonshme mbaje ≥ 0.
    const rawDue = +(totals.total_with_vat - amountPaidU).toFixed(2);
    const amountDueU = existing.is_credit_note ? rawDue : Math.max(0, rawDue);
    const totalDiscountU = +items.reduce((s, it) => {
      const gross = (parseFloat(it.qty) || 0) * (parseFloat(it.unit_price_no_vat) || 0);
      return s + gross * ((parseFloat(it.discount_percent) || 0) / 100);
    }, 0).toFixed(2);
    await ensureClientExists(d.customer_name, d.customer_nipt);
    // Fushat online: ruaji vetëm nëse fatura është online (ose po e shndërrojmë)
    // — për fatura klasike të dyqanit lëri të pandryshuara.
    const isOnlineU = existing.is_online ? 1 : (d.is_online ? 1 : 0);
    const orderStatusU = isOnlineU
      ? (['e_re','ne_pergatitje','derguar','dorezuar','anuluar'].includes(d.order_status)
          ? d.order_status
          : (existing.order_status || 'e_re'))
      : '';
    const channelU = isOnlineU ? (d.channel != null ? d.channel : (existing.channel || '')) : '';
    const shippingAddressU = isOnlineU ? (d.shipping_address != null ? d.shipping_address : (existing.shipping_address || '')) : '';
    const trackingNoU = isOnlineU ? (d.tracking_no != null ? d.tracking_no : (existing.tracking_no || '')) : '';
    await run(
      `UPDATE invoices SET date=?, customer_name=?, customer_nipt=?, currency=?, exchange_rate=?,
        subtotal_no_vat=?, total_discount=?, total_vat=?, total_with_vat=?, payment_method=?, amount_paid=?, amount_due=?,
        paid_cash=?, paid_pos=?, paid_bank=?, notes=?,
        is_online=?, channel=?, shipping_address=?, order_status=?, tracking_no=?
       WHERE id=?`,
      [
        d.date || existing.date,
        d.customer_name || '', d.customer_nipt || '',
        d.currency || 'LEK', parseFloat(d.exchange_rate) || 1,
        totals.subtotal_no_vat, totalDiscountU,
        totals.total_vat, totals.total_with_vat,
        pmU, amountPaidU, amountDueU,
        paidCashU, paidPosU, paidBankU, d.notes || '',
        isOnlineU, channelU, shippingAddressU, orderStatusU, trackingNoU,
        id,
      ]
    );
    // Restore stock from previous items, then re-deduct
    await adjustStock(oldItems, +1);
    await run('DELETE FROM invoice_items WHERE invoice_id = ?', [id]);
    for (const it of items) {
      await run(
        `INSERT INTO invoice_items (invoice_id, product_id, serial_no, barcode, name, qty, gram, unit_price_no_vat,
          discount_percent, subtotal_no_vat, vat_rate, vat_amount, total_with_vat,
          on_promotion, promo_discount_pct)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, it.product_id || null, it.serial_no || '', it.barcode || '', it.name || '',
          it.qty, parseFloat(it.gram) || 0, it.unit_price_no_vat, it.discount_percent,
          it.subtotal_no_vat, it.vat_rate, it.vat_amount, it.total_with_vat,
          it.on_promotion ? 1 : 0, parseFloat(it.promo_discount_pct) || 0,
        ]
      );
    }
    await run('DELETE FROM invoice_payment_splits WHERE invoice_id = ?', [id]);
    for (const s of splitsU) {
      await run(
        `INSERT INTO invoice_payment_splits (invoice_id, method, currency, amount, exchange_rate)
         VALUES (?, ?, ?, ?, ?)`,
        [id, s.method, s.currency, s.amount, s.exchange_rate]
      );
    }
    await adjustStock(items, -1);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Quick update i statusit të porosisë online — pa ndryshuar asnjë të dhënë
// tjetër të faturës (items, pagesa, klient etj.).
app.patch('/api/invoices/:id/order-status', async (req, res) => {
  try {
    const { id } = req.params;
    const status = String(req.body?.order_status || '').trim();
    const allowed = ['e_re', 'ne_pergatitje', 'derguar', 'dorezuar', 'anuluar'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'invalid_status' });
    const tracking = req.body?.tracking_no != null ? String(req.body.tracking_no) : null;
    const inv = await queryOne('SELECT id, is_online FROM invoices WHERE id = ?', [id]);
    if (!inv) return res.status(404).json({ error: 'not_found' });
    if (!inv.is_online) return res.status(400).json({ error: 'not_online' });
    if (tracking != null) {
      await run('UPDATE invoices SET order_status = ?, tracking_no = ? WHERE id = ?', [status, tracking, id]);
    } else {
      await run('UPDATE invoices SET order_status = ? WHERE id = ?', [status, id]);
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/invoices/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const items = await queryAll('SELECT * FROM invoice_items WHERE invoice_id = ?', [id]);
    await adjustStock(items, +1);
    await run('DELETE FROM invoice_items WHERE invoice_id = ?', [id]);
    await run('DELETE FROM invoice_payments WHERE invoice_id = ?', [id]);
    await run('DELETE FROM invoice_payment_splits WHERE invoice_id = ?', [id]);
    await run('DELETE FROM invoices WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Anulim — mark invoice as cancelled, restore stock, void payments
app.post('/api/invoices/:id/cancel', async (req, res) => {
  try {
    const { id } = req.params;
    const inv = await queryOne('SELECT * FROM invoices WHERE id = ?', [id]);
    if (!inv) return res.status(404).json({ error: 'not found' });
    if (inv.cancelled) return res.status(400).json({ error: 'Fatura është anuluar tashmë' });
    const items = await queryAll('SELECT * FROM invoice_items WHERE invoice_id = ?', [id]);
    await adjustStock(items, +1);
    await run('DELETE FROM invoice_payments WHERE invoice_id = ?', [id]);
    await run('UPDATE invoices SET cancelled = 1, amount_paid = 0, amount_due = 0 WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Krijo Faturë Kreditore (me minus). Suporton dy modalitete:
//  - Kthim i plotë (default): mirror i të gjithë artikujve me sasi negative
//  - Kthim i pjesshëm: në body dërgohet `items: [{ item_id, qty }]` — kreditorja
//    krijohet vetëm me ato rreshta të zgjedhur (me sasinë e specifikuar).
//    Refund i pagesave (paid_cash/bank + splits) shkallëzohet proporcionalisht
//    sipas raportit total_i_kthyer / total_origjinal.
app.post('/api/invoices/:id/credit-note', async (req, res) => {
  try {
    const { id } = req.params;
    const inv = await queryOne('SELECT * FROM invoices WHERE id = ?', [id]);
    if (!inv) return res.status(404).json({ error: 'not found' });
    if (inv.cancelled) return res.status(400).json({ error: 'Nuk lëshohet kreditore për faturë të anuluar' });
    if (inv.is_credit_note) return res.status(400).json({ error: 'Kjo është tashmë një kreditore' });
    const allItems = await queryAll('SELECT * FROM invoice_items WHERE invoice_id = ?', [id]);
    const date = (req.body && req.body.date) || new Date().toISOString().slice(0, 10);

    // Përcakto artikujt që do të mirror-ohen. `partial` = user-i zgjodhi një
    // nënbashkësi. Skalimi i sasive: qty e re nuk mund të kalojë origjinalen.
    const requested = Array.isArray(req.body?.items) ? req.body.items : null;
    let itemsToMirror;
    let isPartial = false;
    if (requested && requested.length > 0) {
      isPartial = true;
      const byId = new Map(allItems.map(it => [it.id, it]));
      itemsToMirror = requested
        .map(r => {
          const orig = byId.get(parseInt(r.item_id));
          if (!orig) return null;
          const origQty = Math.abs(parseFloat(orig.qty) || 0);
          let retQty = parseFloat(r.qty) || 0;
          if (retQty <= 0) return null;
          if (retQty > origQty) retQty = origQty;
          // Ratio për të shkallëzuar vlerat monetare të rreshtit.
          const ratio = origQty > 0 ? retQty / origQty : 1;
          const gramNew = (parseFloat(orig.gram) || 0) * ratio;
          const subNew = (parseFloat(orig.subtotal_no_vat) || 0) * ratio;
          const vatNew = (parseFloat(orig.vat_amount) || 0) * ratio;
          const totNew = (parseFloat(orig.total_with_vat) || 0) * ratio;
          return {
            ...orig,
            qty: retQty,
            gram: gramNew,
            subtotal_no_vat: subNew,
            vat_amount: vatNew,
            total_with_vat: totNew,
          };
        })
        .filter(Boolean);
      if (itemsToMirror.length === 0) {
        return res.status(400).json({ error: 'Asnjë artikull i vlefshëm për kthim' });
      }
    } else {
      itemsToMirror = allItems;
    }

    // Ratio globale për shkallëzimin e refund-it (paid_cash/bank + splits).
    // Për kthim të plotë ratio = 1 (mirror i plotë). Për të pjesshëm përdorim
    // raportin total_i_kthyer / total_origjinal.
    const origInvTotal = parseFloat(inv.total_with_vat) || 0;
    const retTotal = itemsToMirror.reduce((s, it) => s + (parseFloat(it.total_with_vat) || 0), 0);

    // Rekalkulo totalet e faturës kreditore nga artikujt që u zgjodhën.
    const cnSub = itemsToMirror.reduce((s, it) => s + (parseFloat(it.subtotal_no_vat) || 0), 0);
    const cnVat = itemsToMirror.reduce((s, it) => s + (parseFloat(it.vat_amount) || 0), 0);
    const cnTot = itemsToMirror.reduce((s, it) => s + (parseFloat(it.total_with_vat) || 0), 0);
    const negTotal = -cnTot;

    // Rimbursim manual — user mund të japë më pak sesa vlera e artikujve
    // (p.sh. amortizim / restocking fee). Klamp: [0, retTotal].
    const rawRefundOverride = req.body?.refund_amount;
    const hasOverride = rawRefundOverride != null && rawRefundOverride !== '';
    const refundAmount = hasOverride
      ? Math.max(0, Math.min(retTotal, parseFloat(rawRefundOverride) || 0))
      : retTotal;

    // Ratio për shkallëzimin e pagesave — bazohet në ç'ka u rimbursua realisht.
    const refundRatio = (isPartial || hasOverride) && origInvTotal > 0
      ? Math.min(1, refundAmount / origInvTotal)
      : 1;

    // Zbritje totale — mbaj proporcionale me atë çfarë u kthye (jo me refund-in).
    const itemsRatio = origInvTotal > 0 ? Math.min(1, retTotal / origInvTotal) : 1;
    const cnDiscount = (parseFloat(inv.total_discount) || 0) * itemsRatio;

    const baseNo = await nextInvoiceNo(date);
    const invoice_no = `${baseNo}-K`;

    // Stornim: trashëgon metodën e pagesës nga fatura origjinale që arka të mos
    // shënojë levizje kesh të rrejshme. Për kthime të pjesshme dhe refund të
    // reduktuar, cash/POS shkallëzohen me refundRatio (bazuar në refundAmount).
    // Diferenca artikuj_totali − refund shfaqet si `amount_due` negativ
    // (klienti mbetet me kredit të pashfrytëzuar në sh op, nëse admin dëshiron).
    const parentPm = inv.payment_method || 'cash';
    let creditPm, creditPaid, creditDue, creditPaidCash = 0, creditPaidPos = 0, creditPaidBank = 0;
    const negRefund = -refundAmount; // sasia e vërtetë që doli nga arka
    // Kur user zvogëlon rimbursimin, diferenca (cnTot - refundAmount) NUK
    // ruhet si borxh — konsiderohet fee/amortizim që shopi mban. amount_due
    // mbetet 0 që të mos aktivizojë raportet e detyrimeve. Për fatura që ishin
    // 'debt' origjinali, kreditorja redukton borxhin e klientit me refundAmount
    // (jo me totalin e artikujve).
    if (parentPm === 'debt') {
      creditPm = 'debt';
      creditPaid = 0;
      creditDue = negRefund;
    } else if (parentPm === 'mikse') {
      creditPm = 'mikse';
      creditPaid = negRefund;
      creditDue = 0;
      creditPaidCash = -(inv.paid_cash || 0) * refundRatio;
      creditPaidPos  = -(inv.paid_pos  || 0) * refundRatio;
      creditPaidBank = -(inv.paid_bank || 0) * refundRatio;
    } else {
      // cash / pos / bank
      creditPm = parentPm;
      creditPaid = negRefund;
      creditDue = 0;
    }
    const feeKept = +(retTotal - refundAmount).toFixed(2);
    const notesTxt = feeKept > 0.005
      ? `Kthim me fee ${feeKept.toFixed(2)} ${inv.currency || 'LEK'} nga fatura ${inv.invoice_no}`
      : (isPartial
        ? `Kthim i pjesshëm nga fatura ${inv.invoice_no}`
        : `Stornim për faturën ${inv.invoice_no}`);
    await run(
      `INSERT INTO invoices (date, invoice_no, customer_name, customer_nipt, currency, exchange_rate,
        subtotal_no_vat, total_discount, total_vat, total_with_vat, payment_method,
        paid_cash, paid_pos, paid_bank,
        amount_paid, amount_due,
        notes, is_credit_note, parent_invoice_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        date, invoice_no, inv.customer_name || '', inv.customer_nipt || '',
        inv.currency || 'LEK', inv.exchange_rate || 1,
        -cnSub, -cnDiscount,
        -cnVat, negTotal,
        creditPm,
        creditPaidCash, creditPaidPos, creditPaidBank,
        creditPaid, creditDue,
        notesTxt,
        1, parseInt(id),
      ]
    );
    const created = await queryOne('SELECT id FROM invoices WHERE date = ? AND invoice_no = ?', [date, invoice_no]);
    const newId = created?.id;
    for (const it of itemsToMirror) {
      await run(
        `INSERT INTO invoice_items (invoice_id, product_id, serial_no, barcode, name, qty, gram, unit_price_no_vat,
          discount_percent, subtotal_no_vat, vat_rate, vat_amount, total_with_vat,
          on_promotion, promo_discount_pct)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newId, it.product_id || null, it.serial_no || '', it.barcode || '', it.name || '',
          -(it.qty || 0), -(parseFloat(it.gram) || 0), it.unit_price_no_vat || 0, it.discount_percent || 0,
          -(it.subtotal_no_vat || 0), it.vat_rate || 0,
          -(it.vat_amount || 0), -(it.total_with_vat || 0),
          it.on_promotion ? 1 : 0, parseFloat(it.promo_discount_pct) || 0,
        ]
      );
    }
    // Mirror payment splits me shuma negative dhe të shkallëzuara.
    if (parentPm === 'mikse') {
      const parentSplits = await queryAll(
        'SELECT method, currency, amount, exchange_rate FROM invoice_payment_splits WHERE invoice_id = ?',
        [id]
      );
      for (const s of parentSplits) {
        await run(
          `INSERT INTO invoice_payment_splits (invoice_id, method, currency, amount, exchange_rate)
           VALUES (?, ?, ?, ?, ?)`,
          [newId, s.method, s.currency, -s.amount * refundRatio, s.exchange_rate]
        );
      }
    }
    // Kthe stokun për vetëm ato copë që u kthyen.
    // `qty` te itemsToMirror është pozitiv (sasia që u kthye); adjustStock
    // përdor sign (+1) → stoku shtohet me qty pozitiv.
    await adjustStock(itemsToMirror, +1);
    res.json({ success: true, id: newId, invoice_no, partial: isPartial });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// INVOICE PAYMENTS — partial payment history per invoice
// ============================================================
async function recalcInvoicePayments(invoiceId) {
  // Sum extra payments and rebuild invoice's amount_paid / amount_due
  const inv = await queryOne('SELECT total_with_vat, amount_paid FROM invoices WHERE id = ?', [invoiceId]);
  if (!inv) return null;
  const extra = await queryOne('SELECT COALESCE(SUM(amount), 0) AS s FROM invoice_payments WHERE invoice_id = ?', [invoiceId]);
  // amount_paid in invoice = initial_paid + sum(extra payments)
  // We rely on a stored "initial_paid" snapshot — track via a column or compute from history.
  // For simplicity: total_paid = initial registration paid + extras. We store the running total.
  // Strategy: when adding a payment, increment amount_paid; when deleting, decrement.
  // recalcInvoicePayments isn't strictly needed here, but keep for safety.
  return inv;
}

app.get('/api/invoices/:id/payments', async (req, res) => {
  try {
    const { id } = req.params;
    const inv = await queryOne('SELECT * FROM invoices WHERE id = ?', [id]);
    if (!inv) return res.status(404).json({ error: 'not found' });
    const payments = await queryAll('SELECT * FROM invoice_payments WHERE invoice_id = ? ORDER BY date ASC, id ASC', [id]);
    // The "initial registration" payment is the portion already in invoice.amount_paid before any extras.
    const extrasSum = payments.reduce((s, p) => s + (p.amount || 0), 0);
    const initialPaid = +(Math.max(0, (inv.amount_paid || 0) - extrasSum)).toFixed(2);
    res.json({
      invoice: inv,
      initial_paid: initialPaid,
      initial_date: inv.date,
      payments,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/invoices/:id/payments', async (req, res) => {
  try {
    const { id } = req.params;
    const d = req.body || {};
    const amount = parseFloat(d.amount);
    if (!amount || amount <= 0) return res.status(400).json({ error: 'amount must be > 0' });
    const date = d.date || new Date().toISOString().slice(0, 10);
    const pm = ['cash', 'bank', 'debt', 'pos'].includes(d.payment_method) ? d.payment_method : 'cash';

    const inv = await queryOne('SELECT * FROM invoices WHERE id = ?', [id]);
    if (!inv) return res.status(404).json({ error: 'invoice not found' });

    const currentDue = Math.max(0, (inv.total_with_vat || 0) - (inv.amount_paid || 0));
    if (amount > currentDue + 0.005) {
      return res.status(400).json({ error: `Shuma e tepruar — borxhi i mbetur është ${currentDue.toFixed(2)}` });
    }

    await run(
      `INSERT INTO invoice_payments (invoice_id, date, amount, payment_method, notes)
       VALUES (?, ?, ?, ?, ?)`,
      [id, date, amount, pm, d.notes || '']
    );

    const newPaid = +((inv.amount_paid || 0) + amount).toFixed(2);
    const newDue  = +Math.max(0, (inv.total_with_vat || 0) - newPaid).toFixed(2);
    await run('UPDATE invoices SET amount_paid = ?, amount_due = ? WHERE id = ?', [newPaid, newDue, id]);

    res.json({ success: true, amount_paid: newPaid, amount_due: newDue });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/invoice-payments/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const pay = await queryOne('SELECT * FROM invoice_payments WHERE id = ?', [id]);
    if (!pay) return res.status(404).json({ error: 'not found' });
    const inv = await queryOne('SELECT * FROM invoices WHERE id = ?', [pay.invoice_id]);
    if (!inv) return res.status(404).json({ error: 'invoice missing' });

    await run('DELETE FROM invoice_payments WHERE id = ?', [id]);
    const newPaid = +Math.max(0, (inv.amount_paid || 0) - (pay.amount || 0)).toFixed(2);
    const newDue  = +Math.max(0, (inv.total_with_vat || 0) - newPaid).toFixed(2);
    await run('UPDATE invoices SET amount_paid = ?, amount_due = ? WHERE id = ?', [newPaid, newDue, pay.invoice_id]);
    res.json({ success: true, amount_paid: newPaid, amount_due: newDue });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// CLIENT DEBT REPORT — outstanding invoices per client
// ============================================================
app.get('/api/client-debts', async (req, res) => {
  try {
    const { q, nipt, name, from, to } = req.query;
    // Any invoice with unpaid balance counts as debt — pavarësisht payment_method.
    // Tolerance 0.005 to guard against float residuals leaving 0.00... amount_due behind.
    let sql = `
      SELECT i.*,
        (SELECT date   FROM invoice_payments WHERE invoice_id = i.id ORDER BY date DESC, id DESC LIMIT 1) AS last_payment_date,
        (SELECT amount FROM invoice_payments WHERE invoice_id = i.id ORDER BY date DESC, id DESC LIMIT 1) AS last_payment_amount,
        (SELECT COUNT(*) FROM invoice_payments WHERE invoice_id = i.id) AS payment_count
      FROM invoices i
      WHERE COALESCE(i.cancelled, 0) = 0
        AND COALESCE(i.amount_due, i.total_with_vat - i.amount_paid) > 0.005`;
    const params = [];
    if (nipt) {
      sql += ' AND i.customer_nipt = ?';
      params.push(nipt);
    } else if (name) {
      sql += ' AND i.customer_name = ?';
      params.push(name);
    } else if (q && q.trim()) {
      sql += ' AND (i.customer_name LIKE ? OR i.customer_nipt LIKE ?)';
      params.push(`%${q}%`, `%${q}%`);
    }
    if (from) { sql += ' AND i.date >= ?'; params.push(from); }
    if (to)   { sql += ' AND i.date <= ?'; params.push(to); }
    sql += ' ORDER BY i.date DESC, i.id DESC';
    res.json(await queryAll(sql, params));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/client-activity', async (req, res) => {
  try {
    const { q, nipt, name, from, to } = req.query;
    const conds = [];
    const params = [];
    if (nipt) {
      conds.push('customer_nipt = ?');
      params.push(nipt);
    } else if (name) {
      conds.push('customer_name = ?');
      params.push(name);
    } else if (q && q.trim()) {
      conds.push('(customer_name LIKE ? OR customer_nipt LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    } else {
      return res.json({ client: null, invoices: [], payments: [], totals: { invoiced: 0, paid: 0, due: 0 } });
    }
    if (from) { conds.push('date >= ?'); params.push(from); }
    if (to)   { conds.push('date <= ?'); params.push(to); }
    // Exclude cancelled invoices; credit notes are included
    conds.push('COALESCE(cancelled, 0) = 0');
    const invoices = await queryAll(
      `SELECT * FROM invoices WHERE ${conds.join(' AND ')} ORDER BY date ASC, id ASC`,
      params
    );
    if (invoices.length === 0) {
      return res.json({ client: null, invoices: [], payments: [], totals: { invoiced: 0, paid: 0, due: 0 } });
    }
    const ids = invoices.map(i => i.id);
    const placeholders = ids.map(() => '?').join(',');
    const payParams = [...ids];
    let payWhere = `p.invoice_id IN (${placeholders})`;
    if (from) { payWhere += ' AND p.date >= ?'; payParams.push(from); }
    if (to)   { payWhere += ' AND p.date <= ?'; payParams.push(to); }
    const payments = await queryAll(
      `SELECT p.*, i.invoice_no, i.date AS invoice_date, i.total_with_vat AS invoice_total
         FROM invoice_payments p
         JOIN invoices i ON i.id = p.invoice_id
        WHERE ${payWhere}
        ORDER BY p.date ASC, p.id ASC`,
      payParams
    );
    // Use the first invoice to determine the client identity for the header
    const client = {
      name: invoices[0].customer_name || '',
      nipt: invoices[0].customer_nipt || '',
    };
    // When filtered by date, paid = sum of payments within range; otherwise use stored amount_paid
    const invoiced = invoices.reduce((s, i) => s + (i.total_with_vat || 0), 0);
    let paid;
    if (from || to) {
      paid = payments.reduce((s, p) => s + (p.amount || 0), 0);
    } else {
      paid = invoices.reduce((s, i) => s + (i.amount_paid || 0), 0);
    }
    const due = +(invoiced - paid).toFixed(2);
    const totals = { invoiced: +invoiced.toFixed(2), paid: +paid.toFixed(2), due };
    res.json({ client, invoices, payments, totals });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/client-debts/summary', async (req, res) => {
  try {
    const onlyDebt = req.query.onlyDebt === '1' || req.query.onlyDebt === 'true';
    const { from, to } = req.query;
    // Any invoice with an unpaid balance counts as debt — pavarësisht payment_method.
    // Filtri i vërtetë është amount_due > 0 (aplikuar në HAVING kur onlyDebt).
    const conds = [
      "COALESCE(cancelled, 0) = 0",
    ];
    const params = [];
    if (from) { conds.push('date >= ?'); params.push(from); }
    if (to)   { conds.push('date <= ?'); params.push(to); }
    const where = `WHERE ${conds.join(' AND ')}`;
    const sql = `
      SELECT
        COALESCE(NULLIF(customer_nipt, ''), customer_name) AS client_key,
        customer_name,
        customer_nipt,
        currency,
        COUNT(*) AS invoice_count,
        SUM(total_with_vat) AS total,
        SUM(amount_paid) AS paid,
        SUM(COALESCE(amount_due, total_with_vat - amount_paid)) AS due
      FROM invoices
      ${where}
      GROUP BY client_key, customer_name, customer_nipt, currency
      ${onlyDebt ? 'HAVING SUM(COALESCE(amount_due, total_with_vat - amount_paid)) > 0.005' : ''}
      ORDER BY
        CASE WHEN customer_name IS NULL OR customer_name = '' THEN 1 ELSE 0 END,
        customer_name COLLATE NOCASE ASC,
        customer_nipt ASC
    `;
    res.json(await queryAll(sql, params));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// SUPPLIERS (FURNITOR)
// ============================================================
app.get('/api/suppliers', async (req, res) => {
  try {
    res.json(await queryAll('SELECT * FROM suppliers ORDER BY name COLLATE NOCASE ASC', []));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/suppliers/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json([]);
    const like = `%${q}%`;
    res.json(await queryAll(
      `SELECT * FROM suppliers
        WHERE nipt LIKE ? OR name LIKE ? OR phone LIKE ?
        ORDER BY name COLLATE NOCASE ASC LIMIT 12`,
      [like, like, like]
    ));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/suppliers', async (req, res) => {
  try {
    const d = req.body || {};
    await run(
      `INSERT INTO suppliers (nipt, name, address, phone, notes) VALUES (?, ?, ?, ?, ?)`,
      [d.nipt || '', d.name || '', d.address || '', d.phone || '', d.notes || '']
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/suppliers/:id', async (req, res) => {
  try {
    const d = req.body || {};
    await run(
      `UPDATE suppliers SET nipt=?, name=?, address=?, phone=?, notes=? WHERE id=?`,
      [d.nipt || '', d.name || '', d.address || '', d.phone || '', d.notes || '', req.params.id]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/suppliers/:id', async (req, res) => {
  try {
    await run('DELETE FROM suppliers WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// WAREHOUSES (Magazinat) — regjistër i kodeve të magazinave
// ============================================================
app.get('/api/warehouses', async (req, res) => {
  try {
    res.json(await queryAll('SELECT * FROM warehouses ORDER BY code COLLATE NOCASE ASC', []));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/warehouses/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json(await queryAll('SELECT * FROM warehouses ORDER BY code COLLATE NOCASE ASC LIMIT 12', []));
    const like = `%${q}%`;
    res.json(await queryAll(
      `SELECT * FROM warehouses
        WHERE code LIKE ? OR name LIKE ?
        ORDER BY code COLLATE NOCASE ASC LIMIT 12`,
      [like, like]
    ));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/warehouses', async (req, res) => {
  try {
    const d = req.body || {};
    const code = (d.code || '').trim();
    if (!code) return res.status(400).json({ error: 'Kodi është i detyrueshëm' });
    const dup = await queryOne('SELECT id FROM warehouses WHERE code = ?', [code]);
    if (dup) return res.status(400).json({ error: `Kodi "${code}" ekziston tashmë` });
    await run(
      `INSERT INTO warehouses (code, name, address, notes) VALUES (?, ?, ?, ?)`,
      [code, d.name || '', d.address || '', d.notes || '']
    );
    const created = await queryOne('SELECT * FROM warehouses WHERE code = ?', [code]);
    res.json({ success: true, warehouse: created });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/warehouses/:id', async (req, res) => {
  try {
    const d = req.body || {};
    const code = (d.code || '').trim();
    if (!code) return res.status(400).json({ error: 'Kodi është i detyrueshëm' });
    const dup = await queryOne('SELECT id FROM warehouses WHERE code = ? AND id != ?', [code, req.params.id]);
    if (dup) return res.status(400).json({ error: `Kodi "${code}" ekziston tashmë` });
    await run(
      `UPDATE warehouses SET code=?, name=?, address=?, notes=? WHERE id=?`,
      [code, d.name || '', d.address || '', d.notes || '', req.params.id]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/warehouses/:id', async (req, res) => {
  try {
    await run('DELETE FROM warehouses WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// PURCHASE INVOICES (Fatura Blerje)
// ============================================================
function computePurchaseLineTotals(it) {
  const qty   = parseFloat(it.qty) || 0;
  const price = parseFloat(it.purchase_price_no_vat) || 0;
  const disc  = parseFloat(it.discount_percent) || 0;
  const vatR  = parseFloat(it.vat_rate) || 0;
  const gross = qty * price;
  const subtotal_no_vat = +(gross * (1 - disc / 100)).toFixed(2);
  const vat_amount     = +(subtotal_no_vat * (vatR / 100)).toFixed(2);
  const total_with_vat = +(subtotal_no_vat + vat_amount).toFixed(2);
  return { qty, purchase_price_no_vat: price, discount_percent: disc, vat_rate: vatR, subtotal_no_vat, vat_amount, total_with_vat };
}

async function nextPurchaseNo(date) {
  const year = (date || '').slice(0, 4) || new Date().getFullYear().toString();
  const row = await queryOne("SELECT COUNT(*) AS c FROM purchase_invoices WHERE date LIKE ?", [year + '%']);
  const next = (row?.c || 0) + 1;
  return `B${year}-${String(next).padStart(5, '0')}`;
}

async function adjustPurchaseStock(items, sign) {
  // sign=+1 when applying purchase (stock up); sign=-1 when reverting
  for (const it of items) {
    if (it.product_id && it.qty) {
      const delta = sign * (parseInt(it.qty) || 0);
      if (delta !== 0) {
        await run('UPDATE products SET stock = MAX(0, stock + ?) WHERE id = ?', [delta, it.product_id]);
      }
    }
  }
}

async function applyProductPrices(items) {
  // Update each product's cost_price + sell_price from the purchase line
  for (const it of items) {
    if (!it.product_id) continue;
    const updates = [];
    const params = [];
    if (it.purchase_price_no_vat != null && it.purchase_price_no_vat !== '') {
      updates.push('cost_price = ?');
      params.push(parseFloat(it.purchase_price_no_vat) || 0);
    }
    if (it.sell_price != null && it.sell_price !== '' && parseFloat(it.sell_price) > 0) {
      updates.push('sell_price = ?');
      params.push(parseFloat(it.sell_price) || 0);
    }
    // Barkodi mund të gjenerohet nga FaturaBlerje për një produkt ekzistues;
    // ruajmë vetëm nëse rreshti ka një vlerë jo-bosh (mos e fshi rastësisht).
    if (it.barcode != null && String(it.barcode).trim() !== '') {
      updates.push('barcode = ?');
      params.push(String(it.barcode).trim());
    }
    if (it.vat_rate != null && it.vat_rate !== '') {
      updates.push('vat_rate = ?');
      params.push(parseFloat(it.vat_rate) || 0);
    }
    if (it.material === 'flori' || it.material === 'diamant' || it.material === 'ora') {
      updates.push('material = ?');
      params.push(it.material);
      const CATEGORY_BY_MATERIAL = { flori: 'Flori', diamant: 'Diamant', ora: 'Ora' };
      updates.push('category = ?');
      params.push(CATEGORY_BY_MATERIAL[it.material]);
    }
    // Nga fatura e blerjes, promocioni vetëm shtohet — heqja bëhet nga faqja
    // Produkte Promocion ose Products (për të mos rrëzuar padashur promocionet
    // ekzistuese kur admin ripërdor një produkt në një faturë të re).
    if (it.is_promotion) {
      updates.push('is_promotion = ?');
      params.push(1);
      const pct = Math.max(0, Math.min(100, parseFloat(it.promo_discount_pct) || 0));
      updates.push('promo_discount_pct = ?');
      params.push(pct);
    }
    if (updates.length === 0) continue;
    params.push(it.product_id);
    await run(`UPDATE products SET ${updates.join(', ')} WHERE id = ?`, params);
  }
}

app.get('/api/purchase-invoices/next-no', async (req, res) => {
  try {
    const { date } = req.query;
    res.json({ invoice_no: await nextPurchaseNo(date) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/purchase-invoices/by-date/:date', async (req, res) => {
  try {
    const { date } = req.params;
    res.json(await queryAll(
      `SELECT pi.*,
         (pi.amount_paid - COALESCE((SELECT SUM(amount) FROM purchase_payments WHERE purchase_id = pi.id), 0)) AS initial_amount_paid
       FROM purchase_invoices pi WHERE pi.date = ? ORDER BY pi.id ASC`,
      [date]
    ));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/purchase-invoices/by-range', async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to required' });
    res.json(await queryAll(
      `SELECT pi.*,
         (pi.amount_paid - COALESCE((SELECT SUM(amount) FROM purchase_payments WHERE purchase_id = pi.id), 0)) AS initial_amount_paid
       FROM purchase_invoices pi WHERE pi.date BETWEEN ? AND ? ORDER BY pi.date ASC, pi.id ASC`,
      [from, to]
    ));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/purchase-invoices/:id', async (req, res) => {
  try {
    const inv = await queryOne('SELECT * FROM purchase_invoices WHERE id = ?', [req.params.id]);
    if (!inv) return res.status(404).json({ error: 'not found' });
    const items = await queryAll(
      `SELECT pi.*, COALESCE(p.material, '') AS material,
              COALESCE(p.is_promotion, 0) AS is_promotion,
              COALESCE(p.promo_discount_pct, 0) AS promo_discount_pct
         FROM purchase_items pi
         LEFT JOIN products p ON p.id = pi.product_id
        WHERE pi.purchase_id = ?
        ORDER BY pi.id ASC`,
      [req.params.id]
    );
    const paySum = await queryOne('SELECT COALESCE(SUM(amount), 0) AS s FROM purchase_payments WHERE purchase_id = ?', [req.params.id])?.s || 0;
    const initial_amount_paid = +Math.max(0, (inv.amount_paid || 0) - paySum).toFixed(2);
    res.json({ ...inv, items, initial_amount_paid });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/purchase-invoices', async (req, res) => {
  try {
    const d = req.body || {};
    if (!d.date) return res.status(400).json({ error: 'date required' });
    const userProvidedNo = (d.invoice_no || '').trim();
    const items = (d.items || []).map(it => ({ ...it, ...computePurchaseLineTotals(it) }));
    const sub = +items.reduce((s, it) => s + it.subtotal_no_vat, 0).toFixed(2);
    const vat = +items.reduce((s, it) => s + it.vat_amount,     0).toFixed(2);
    const tot = +items.reduce((s, it) => s + it.total_with_vat, 0).toFixed(2);
    const totalDiscount = +items.reduce((s, it) => {
      const gross = (parseFloat(it.qty) || 0) * (parseFloat(it.purchase_price_no_vat) || 0);
      return s + gross * ((parseFloat(it.discount_percent) || 0) / 100);
    }, 0).toFixed(2);

    const pmI = ['cash','bank','debt','pos'].includes(d.payment_method) ? d.payment_method : 'cash';
    let amountPaidI;
    if (d.amount_paid != null && d.amount_paid !== '') {
      amountPaidI = parseFloat(d.amount_paid) || 0;
    } else {
      amountPaidI = (pmI === 'cash' || pmI === 'pos') ? tot : 0;
    }
    const amountDueI = Math.max(0, +(tot - amountPaidI).toFixed(2));

    const doInsertPurchase = (invNo) => run(
      `INSERT INTO purchase_invoices (date, invoice_no, supplier_name, supplier_nipt, currency, exchange_rate,
        subtotal_no_vat, total_discount, total_vat, total_with_vat, payment_method, amount_paid, amount_due, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        d.date, invNo, d.supplier_name || '', d.supplier_nipt || '',
        d.currency || 'LEK', parseFloat(d.exchange_rate) || 1,
        sub, totalDiscount, vat, tot,
        pmI, amountPaidI, amountDueI,
        d.notes || '',
      ]
    );
    const invoice_no = userProvidedNo
      ? (await doInsertPurchase(userProvidedNo), userProvidedNo)
      : await retryOnUniqueNo(() => nextPurchaseNo(d.date), doInsertPurchase);
    const created = await queryOne('SELECT id FROM purchase_invoices WHERE date = ? AND invoice_no = ?', [d.date, invoice_no]);
    const newId = created?.id;
    for (const it of items) {
      await run(
        `INSERT INTO purchase_items (purchase_id, product_id, serial_no, barcode, name, category, unit, gram, qty,
          purchase_price_no_vat, cost_price, discount_percent, subtotal_no_vat, vat_rate, vat_amount, total_with_vat, sell_price)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newId, it.product_id || null, it.serial_no || '', it.barcode || '', it.name || '',
          it.category || '', it.unit || '', parseFloat(it.gram) || 0,
          it.qty, it.purchase_price_no_vat, parseFloat(it.cost_price) || 0, it.discount_percent,
          it.subtotal_no_vat, it.vat_rate, it.vat_amount, it.total_with_vat,
          parseFloat(it.sell_price) || 0,
        ]
      );
    }
    await adjustPurchaseStock(items, +1);
    await applyProductPrices(items);
    res.json({ success: true, id: newId, invoice_no });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/purchase-invoices/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const d = req.body || {};
    const existing = await queryOne('SELECT * FROM purchase_invoices WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'not found' });
    const oldItems = await queryAll('SELECT * FROM purchase_items WHERE purchase_id = ?', [id]);
    const items = (d.items || []).map(it => ({ ...it, ...computePurchaseLineTotals(it) }));
    const sub = +items.reduce((s, it) => s + it.subtotal_no_vat, 0).toFixed(2);
    const vat = +items.reduce((s, it) => s + it.vat_amount,     0).toFixed(2);
    const tot = +items.reduce((s, it) => s + it.total_with_vat, 0).toFixed(2);
    const totalDiscount = +items.reduce((s, it) => {
      const gross = (parseFloat(it.qty) || 0) * (parseFloat(it.purchase_price_no_vat) || 0);
      return s + gross * ((parseFloat(it.discount_percent) || 0) / 100);
    }, 0).toFixed(2);

    const pmU = ['cash','bank','debt','pos'].includes(d.payment_method) ? d.payment_method : 'cash';
    // The form value represents the INITIAL portion paid at purchase time. Any subsequent
    // payments registered via the Detyrime Furnitor modal live in purchase_payments and
    // must be preserved when the user re-saves the invoice from the editor.
    let formInitialPaid;
    if (d.amount_paid != null && d.amount_paid !== '') {
      formInitialPaid = parseFloat(d.amount_paid) || 0;
    } else {
      formInitialPaid = (pmU === 'cash' || pmU === 'pos') ? tot : 0;
    }
    const existingPaySum = await queryOne(
      'SELECT COALESCE(SUM(amount), 0) AS s FROM purchase_payments WHERE purchase_id = ?',
      [id]
    )?.s || 0;
    const amountPaidU = +(formInitialPaid + existingPaySum).toFixed(2);
    const amountDueU = Math.max(0, +(tot - amountPaidU).toFixed(2));

    await run(
      `UPDATE purchase_invoices SET date=?, supplier_name=?, supplier_nipt=?, currency=?, exchange_rate=?,
        subtotal_no_vat=?, total_discount=?, total_vat=?, total_with_vat=?, payment_method=?, amount_paid=?, amount_due=?, notes=?
       WHERE id=?`,
      [
        d.date || existing.date,
        d.supplier_name || '', d.supplier_nipt || '',
        d.currency || 'LEK', parseFloat(d.exchange_rate) || 1,
        sub, totalDiscount, vat, tot,
        pmU, amountPaidU, amountDueU,
        d.notes || '',
        id,
      ]
    );
    await adjustPurchaseStock(oldItems, -1);
    await run('DELETE FROM purchase_items WHERE purchase_id = ?', [id]);
    for (const it of items) {
      await run(
        `INSERT INTO purchase_items (purchase_id, product_id, serial_no, barcode, name, category, unit, gram, qty,
          purchase_price_no_vat, cost_price, discount_percent, subtotal_no_vat, vat_rate, vat_amount, total_with_vat, sell_price)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, it.product_id || null, it.serial_no || '', it.barcode || '', it.name || '',
          it.category || '', it.unit || '', parseFloat(it.gram) || 0,
          it.qty, it.purchase_price_no_vat, parseFloat(it.cost_price) || 0, it.discount_percent,
          it.subtotal_no_vat, it.vat_rate, it.vat_amount, it.total_with_vat,
          parseFloat(it.sell_price) || 0,
        ]
      );
    }
    await adjustPurchaseStock(items, +1);
    await applyProductPrices(items);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/purchase-invoices/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const items = await queryAll('SELECT * FROM purchase_items WHERE purchase_id = ?', [id]);
    await adjustPurchaseStock(items, -1);
    await run('DELETE FROM purchase_items WHERE purchase_id = ?', [id]);
    await run('DELETE FROM purchase_payments WHERE purchase_id = ?', [id]);
    await run('DELETE FROM purchase_invoices WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// GOLD SPOT PRICE — EUR / gram (cached ~5 min)
// Sources: gold-api.com (USD/oz) + frankfurter.dev (EUR/USD)
// ============================================================
const GRAM_PER_TROY_OZ = 31.1034768;
const GOLD_CACHE_TTL_MS = 30 * 1000;
let goldPriceCache = { value: null, at: 0 };

async function fetchGoldSpotEurPerGram(force = false) {
  const now = Date.now();
  if (!force && goldPriceCache.value && (now - goldPriceCache.at) < GOLD_CACHE_TTL_MS) {
    return goldPriceCache.value;
  }
  const [goldRes, fxRes] = await Promise.all([
    fetch('https://api.gold-api.com/price/XAU'),
    fetch('https://api.frankfurter.dev/v1/latest?from=USD&to=EUR'),
  ]);
  if (!goldRes.ok) throw new Error(`gold-api ${goldRes.status}`);
  if (!fxRes.ok)   throw new Error(`fx-api ${fxRes.status}`);
  const gold = await goldRes.json();
  const fx   = await fxRes.json();
  const usdPerOz  = parseFloat(gold.price);
  const eurPerUsd = parseFloat(fx?.rates?.EUR);
  if (!usdPerOz || !eurPerUsd) throw new Error('missing price data');
  const eurPerOz   = usdPerOz * eurPerUsd;
  const eurPerGram = eurPerOz / GRAM_PER_TROY_OZ;
  const payload = {
    eur_per_gram: +eurPerGram.toFixed(2),
    eur_per_oz:   +eurPerOz.toFixed(2),
    usd_per_oz:   +usdPerOz.toFixed(2),
    eur_per_usd:  +eurPerUsd.toFixed(6),
    updated_at:   gold.updatedAt || new Date().toISOString(),
    source:       'gold-api.com + frankfurter.dev',
  };
  goldPriceCache = { value: payload, at: now };
  return payload;
}

app.get('/api/gold-spot-price', async (req, res) => {
  try {
    const force = req.query.force === '1' || req.query.force === 'true';
    const data = await fetchGoldSpotEurPerGram(force);
    res.json(data);
  } catch (err) { res.status(502).json({ error: err.message }); }
});

// ============================================================
// KONVERTIM HURDA — scrap gold purchases (paid in cash)
// Does NOT touch product inventory. Grams accumulate in this table.
// Deducted from arka via the arka-ditore endpoint.
// ============================================================
async function nextHurdaNo(date) {
  const year = (date || '').slice(0, 4) || new Date().getFullYear().toString();
  const row = await queryOne("SELECT COUNT(*) AS c FROM hurda_purchases WHERE date LIKE ?", [year + '%']);
  const next = (row?.c || 0) + 1;
  return `KH${year}-${String(next).padStart(5, '0')}`;
}

function computeHurdaTotal(d) {
  // Klienti dërgon total_amount të llogaritur në monedhën e pagesës (sepse
  // price_per_gram tashmë është gjithmonë në EUR, ndërsa pagesa mund të jetë
  // në LEK/EUR/USD/GBP/CHF — konvertimi bëhet klientit me kurset e datës).
  if (d.total_amount != null && d.total_amount !== '') {
    return +parseFloat(d.total_amount).toFixed(2) || 0;
  }
  const g = parseFloat(d.gram) || 0;
  const p = parseFloat(d.price_per_gram) || 0;
  return +(g * p).toFixed(2);
}

app.get('/api/hurda-purchases/next-no', async (req, res) => {
  try {
    const { date } = req.query;
    res.json({ purchase_no: await nextHurdaNo(date) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/hurda-purchases/by-date/:date', async (req, res) => {
  try {
    res.json(await queryAll(
      'SELECT * FROM hurda_purchases WHERE date = ? ORDER BY id ASC',
      [req.params.date]
    ));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/hurda-purchases/by-range', async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to required' });
    res.json(await queryAll(
      'SELECT * FROM hurda_purchases WHERE date BETWEEN ? AND ? ORDER BY date ASC, id ASC',
      [from, to]
    ));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/hurda-purchases/:id', async (req, res) => {
  try {
    const row = await queryOne('SELECT * FROM hurda_purchases WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'not found' });
    res.json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/hurda-purchases', async (req, res) => {
  try {
    const d = req.body || {};
    if (!d.date) return res.status(400).json({ error: 'date required' });
    const userProvidedNo = (d.purchase_no || '').trim();
    const total_amount = computeHurdaTotal(d);
    const doInsertHurda = (no) => run(
      `INSERT INTO hurda_purchases (date, purchase_no, supplier_name, supplier_nipt,
        gram, price_per_gram, currency, exchange_rate, total_amount, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        d.date, no,
        d.supplier_name || '', d.supplier_nipt || '',
        parseFloat(d.gram) || 0, parseFloat(d.price_per_gram) || 0,
        d.currency || 'LEK', parseFloat(d.exchange_rate) || 1,
        total_amount, d.notes || '',
      ]
    );
    const purchase_no = userProvidedNo
      ? (await doInsertHurda(userProvidedNo), userProvidedNo)
      : await retryOnUniqueNo(() => nextHurdaNo(d.date), doInsertHurda);
    const created = await queryOne('SELECT id FROM hurda_purchases WHERE date = ? AND purchase_no = ?', [d.date, purchase_no]);
    res.json({ success: true, id: created?.id, purchase_no });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/hurda-purchases/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const d = req.body || {};
    const existing = await queryOne('SELECT * FROM hurda_purchases WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'not found' });
    const total_amount = computeHurdaTotal(d);
    await run(
      `UPDATE hurda_purchases SET date=?, supplier_name=?, supplier_nipt=?,
        gram=?, price_per_gram=?, currency=?, exchange_rate=?, total_amount=?, notes=?
       WHERE id=?`,
      [
        d.date || existing.date,
        d.supplier_name || '', d.supplier_nipt || '',
        parseFloat(d.gram) || 0, parseFloat(d.price_per_gram) || 0,
        d.currency || 'LEK', parseFloat(d.exchange_rate) || 1,
        total_amount, d.notes || '',
        id,
      ]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/hurda-purchases/:id', async (req, res) => {
  try {
    await run('DELETE FROM hurda_purchases WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// BLERJE HAS — bulk gold-jewelry batch purchases (paid in cash).
// Same shape as hurda_purchases: total grams + price/gram + supplier + cash payment.
// Deducted from arka via the arka-ditore endpoint (like hurda).
// ============================================================
async function nextHasNo(date) {
  const year = (date || '').slice(0, 4) || new Date().getFullYear().toString();
  const row = await queryOne("SELECT COUNT(*) AS c FROM has_purchases WHERE date LIKE ?", [year + '%']);
  const next = (row?.c || 0) + 1;
  return `BH${year}-${String(next).padStart(5, '0')}`;
}

function computeHasTotal(d) {
  if (d.total_amount != null && d.total_amount !== '') {
    return +parseFloat(d.total_amount).toFixed(2) || 0;
  }
  const g = parseFloat(d.gram) || 0;
  const p = parseFloat(d.price_per_gram) || 0;
  return +(g * p).toFixed(2);
}

app.get('/api/has-purchases/next-no', async (req, res) => {
  try {
    const { date } = req.query;
    res.json({ purchase_no: await nextHasNo(date) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/has-purchases/by-date/:date', async (req, res) => {
  try {
    res.json(await queryAll(
      'SELECT * FROM has_purchases WHERE date = ? ORDER BY id ASC',
      [req.params.date]
    ));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/has-purchases/by-range', async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to required' });
    res.json(await queryAll(
      'SELECT * FROM has_purchases WHERE date BETWEEN ? AND ? ORDER BY date ASC, id ASC',
      [from, to]
    ));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/has-purchases/:id', async (req, res) => {
  try {
    const row = await queryOne('SELECT * FROM has_purchases WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'not found' });
    res.json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/has-purchases', async (req, res) => {
  try {
    const d = req.body || {};
    if (!d.date) return res.status(400).json({ error: 'date required' });
    const userProvidedNo = (d.purchase_no || '').trim();
    const total_amount = computeHasTotal(d);
    const doInsertHas = (no) => run(
      `INSERT INTO has_purchases (date, purchase_no, supplier_name, supplier_nipt,
        gram, price_per_gram, currency, exchange_rate, total_amount, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        d.date, no,
        d.supplier_name || '', d.supplier_nipt || '',
        parseFloat(d.gram) || 0, parseFloat(d.price_per_gram) || 0,
        d.currency || 'EUR', parseFloat(d.exchange_rate) || 1,
        total_amount, d.notes || '',
      ]
    );
    const purchase_no = userProvidedNo
      ? (await doInsertHas(userProvidedNo), userProvidedNo)
      : await retryOnUniqueNo(() => nextHasNo(d.date), doInsertHas);
    const created = await queryOne('SELECT id FROM has_purchases WHERE date = ? AND purchase_no = ?', [d.date, purchase_no]);
    res.json({ success: true, id: created?.id, purchase_no });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/has-purchases/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const d = req.body || {};
    const existing = await queryOne('SELECT * FROM has_purchases WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'not found' });
    const total_amount = computeHasTotal(d);
    await run(
      `UPDATE has_purchases SET date=?, supplier_name=?, supplier_nipt=?,
        gram=?, price_per_gram=?, currency=?, exchange_rate=?, total_amount=?, notes=?
       WHERE id=?`,
      [
        d.date || existing.date,
        d.supplier_name || '', d.supplier_nipt || '',
        parseFloat(d.gram) || 0, parseFloat(d.price_per_gram) || 0,
        d.currency || 'EUR', parseFloat(d.exchange_rate) || 1,
        total_amount, d.notes || '',
        id,
      ]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/has-purchases/:id', async (req, res) => {
  try {
    await run('DELETE FROM has_purchases WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// FLETË HYRJE / FLETË DALJE — inventory adjustment notes
// ============================================================
function makeFleteEndpoints(kind, sign) {
  // kind: 'hyrje' or 'dalje'; sign: +1 for hyrje (adds stock), -1 for dalje (removes)
  const table  = `flete_${kind}`;
  const itable = `flete_${kind}_items`;
  const path   = `/api/flete-${kind}`;

  async function nextRefNo(date) {
    const year = (date || '').slice(0, 4) || new Date().getFullYear().toString();
    const prefix = kind === 'hyrje' ? 'H' : 'D';
    const row = await queryOne(`SELECT COUNT(*) AS c FROM ${table} WHERE date LIKE ?`, [year + '%']);
    const next = (row?.c || 0) + 1;
    return `${prefix}${year}-${String(next).padStart(5, '0')}`;
  }

  async function adjustStock(items, mult) {
    for (const it of items) {
      if (it.product_id && it.qty) {
        const delta = mult * sign * (parseFloat(it.qty) || 0);
        if (delta !== 0) {
          await run('UPDATE products SET stock = MAX(0, stock + ?) WHERE id = ?', [delta, it.product_id]);
        }
      }
    }
  }

  app.get(`${path}/next-no`, async (req, res) => {
    try { res.json({ ref_no: await nextRefNo(req.query.date) }); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get(`${path}/by-date/:date`, async (req, res) => {
    try {
      const rows = await queryAll(`SELECT * FROM ${table} WHERE date = ? ORDER BY id ASC`, [req.params.date]);
      // For each, attach item count and total qty
      const enriched = rows.map(async r => {
        const stats = await queryOne(`SELECT COUNT(*) AS c, COALESCE(SUM(qty),0) AS q FROM ${itable} WHERE flete_id = ?`, [r.id]);
        return { ...r, item_count: stats?.c || 0, total_qty: stats?.q || 0 };
      });
      res.json(enriched);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get(`${path}/by-range`, async (req, res) => {
    try {
      const { from, to } = req.query;
      if (!from || !to) return res.status(400).json({ error: 'from and to required' });
      const rows = await queryAll(
        `SELECT * FROM ${table} WHERE date BETWEEN ? AND ? ORDER BY date ASC, id ASC`,
        [from, to]
      );
      const enriched = rows.map(async r => {
        const stats = await queryOne(`SELECT COUNT(*) AS c, COALESCE(SUM(qty),0) AS q FROM ${itable} WHERE flete_id = ?`, [r.id]);
        return { ...r, item_count: stats?.c || 0, total_qty: stats?.q || 0 };
      });
      res.json(enriched);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get(`${path}/:id`, async (req, res) => {
    try {
      const head = await queryOne(`SELECT * FROM ${table} WHERE id = ?`, [req.params.id]);
      if (!head) return res.status(404).json({ error: 'not found' });
      const items = await queryAll(`SELECT * FROM ${itable} WHERE flete_id = ? ORDER BY id ASC`, [req.params.id]);
      res.json({ ...head, items });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post(path, async (req, res) => {
    try {
      const d = req.body || {};
      if (!d.date) return res.status(400).json({ error: 'date required' });
      const userProvidedNo = (d.ref_no || '').trim();
      const doInsertHead = (no) => run(
        `INSERT INTO ${table} (date, ref_no, notes) VALUES (?, ?, ?)`,
        [d.date, no, d.notes || ''],
      );
      const ref_no = userProvidedNo
        ? (await doInsertHead(userProvidedNo), userProvidedNo)
        : await retryOnUniqueNo(() => nextRefNo(d.date), doInsertHead);
      const created = await queryOne(`SELECT id FROM ${table} WHERE date = ? AND ref_no = ?`, [d.date, ref_no]);
      const newId = created?.id;
      const items = (d.items || []).filter(it => (it.name && it.name.trim()) || parseFloat(it.qty) > 0);
      for (const it of items) {
        await run(
          `INSERT INTO ${itable} (flete_id, product_id, barcode, name, qty) VALUES (?, ?, ?, ?, ?)`,
          [newId, it.product_id || null, it.barcode || '', it.name || '', parseFloat(it.qty) || 0]
        );
      }
      await adjustStock(items, +1);
      res.json({ success: true, id: newId, ref_no });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.put(`${path}/:id`, async (req, res) => {
    try {
      const { id } = req.params;
      const d = req.body || {};
      const existing = await queryOne(`SELECT * FROM ${table} WHERE id = ?`, [id]);
      if (!existing) return res.status(404).json({ error: 'not found' });
      const oldItems = await queryAll(`SELECT * FROM ${itable} WHERE flete_id = ?`, [id]);
      await adjustStock(oldItems, -1); // reverse old
      await run(`UPDATE ${table} SET date=?, notes=? WHERE id=?`,
        [d.date || existing.date, d.notes || '', id]);
      await run(`DELETE FROM ${itable} WHERE flete_id = ?`, [id]);
      const items = (d.items || []).filter(it => (it.name && it.name.trim()) || parseFloat(it.qty) > 0);
      for (const it of items) {
        await run(
          `INSERT INTO ${itable} (flete_id, product_id, barcode, name, qty) VALUES (?, ?, ?, ?, ?)`,
          [id, it.product_id || null, it.barcode || '', it.name || '', parseFloat(it.qty) || 0]
        );
      }
      await adjustStock(items, +1); // apply new
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete(`${path}/:id`, async (req, res) => {
    try {
      const { id } = req.params;
      const items = await queryAll(`SELECT * FROM ${itable} WHERE flete_id = ?`, [id]);
      await adjustStock(items, -1);
      await run(`DELETE FROM ${itable} WHERE flete_id = ?`, [id]);
      await run(`DELETE FROM ${table} WHERE id = ?`, [id]);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
}

makeFleteEndpoints('hyrje', +1);
makeFleteEndpoints('dalje', -1);

// ============================================================
// MAGAZINA — fletë hyrje / dalje me kod magazine, monedhë, kurs
// dhe çmim për njësi (pa TVSH). Hyrje rrit stokun, dalje e zbret.
// ============================================================
function makeMagazinaEndpoints(kind, sign) {
  const table  = `magazina_${kind}`;
  const itable = `magazina_${kind}_items`;
  const path   = `/api/magazina-${kind}`;

  async function nextRefNo(date) {
    const year = (date || '').slice(0, 4) || new Date().getFullYear().toString();
    const prefix = kind === 'hyrje' ? 'MH' : 'MD';
    const row = await queryOne(`SELECT COUNT(*) AS c FROM ${table} WHERE date LIKE ?`, [year + '%']);
    const next = (row?.c || 0) + 1;
    return `${prefix}${year}-${String(next).padStart(5, '0')}`;
  }

  function computeItem(it) {
    const qty   = parseFloat(it.qty) || 0;
    const price = parseFloat(it.unit_price) || 0;
    const disc  = parseFloat(it.discount_percent) || 0;
    const subtotal = +((qty * price) * (1 - disc / 100)).toFixed(2);
    return { qty, price, disc, subtotal };
  }

  async function adjustStock(items, mult) {
    for (const it of items) {
      if (it.product_id && it.qty) {
        const delta = mult * sign * (parseFloat(it.qty) || 0);
        if (delta !== 0) {
          await run('UPDATE products SET stock = MAX(0, stock + ?) WHERE id = ?', [delta, it.product_id]);
        }
      }
    }
  }

  async function insertItems(headId, items) {
    let totalSub = 0, totalDisc = 0;
    for (const it of items) {
      const c = computeItem(it);
      const gross = +((c.qty * c.price)).toFixed(2);
      totalSub  += c.subtotal;
      totalDisc += +(gross - c.subtotal).toFixed(2);
      await run(
        `INSERT INTO ${itable} (magazina_id, product_id, barcode, name, qty, unit_price, discount_percent, subtotal)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [headId, it.product_id || null, it.barcode || '', it.name || '',
         c.qty, c.price, c.disc, c.subtotal]
      );
    }
    return { subtotal: +totalSub.toFixed(2), total_discount: +totalDisc.toFixed(2) };
  }

  app.get(`${path}/next-no`, async (req, res) => {
    try { res.json({ ref_no: await nextRefNo(req.query.date) }); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get(`${path}/by-date/:date`, async (req, res) => {
    try {
      const rows = await queryAll(`SELECT * FROM ${table} WHERE date = ? ORDER BY id ASC`, [req.params.date]);
      const enriched = rows.map(async r => {
        const stats = await queryOne(`SELECT COUNT(*) AS c, COALESCE(SUM(qty),0) AS q FROM ${itable} WHERE magazina_id = ?`, [r.id]);
        return { ...r, item_count: stats?.c || 0, total_qty: stats?.q || 0 };
      });
      res.json(enriched);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get(`${path}/by-range`, async (req, res) => {
    try {
      const { from, to } = req.query;
      if (!from || !to) return res.status(400).json({ error: 'from and to required' });
      const rows = await queryAll(
        `SELECT * FROM ${table} WHERE date BETWEEN ? AND ? ORDER BY date ASC, id ASC`,
        [from, to]
      );
      const enriched = rows.map(async r => {
        const stats = await queryOne(`SELECT COUNT(*) AS c, COALESCE(SUM(qty),0) AS q FROM ${itable} WHERE magazina_id = ?`, [r.id]);
        return { ...r, item_count: stats?.c || 0, total_qty: stats?.q || 0 };
      });
      res.json(enriched);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get(`${path}/:id`, async (req, res) => {
    try {
      const head = await queryOne(`SELECT * FROM ${table} WHERE id = ?`, [req.params.id]);
      if (!head) return res.status(404).json({ error: 'not found' });
      const items = await queryAll(`SELECT * FROM ${itable} WHERE magazina_id = ? ORDER BY id ASC`, [req.params.id]);
      res.json({ ...head, items });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post(path, async (req, res) => {
    try {
      const d = req.body || {};
      if (!d.date) return res.status(400).json({ error: 'date required' });
      const userProvidedNo = (d.ref_no || '').trim();
      const currency = d.currency || 'LEK';
      const exchange_rate = parseFloat(d.exchange_rate) || 1;
      const doInsertMagHead = (no) => run(
        `INSERT INTO ${table} (date, warehouse_code, ref_no, currency, exchange_rate, subtotal, total_discount, total, notes)
         VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?)`,
        [d.date, d.warehouse_code || '', no, currency, exchange_rate, d.notes || ''],
      );
      const ref_no = userProvidedNo
        ? (await doInsertMagHead(userProvidedNo), userProvidedNo)
        : await retryOnUniqueNo(() => nextRefNo(d.date), doInsertMagHead);
      const created = await queryOne(`SELECT id FROM ${table} WHERE date = ? AND ref_no = ?`, [d.date, ref_no]);
      const newId = created?.id;
      const items = (d.items || []).filter(it => (it.name && it.name.trim()) || parseFloat(it.qty) > 0);
      const t = await insertItems(newId, items);
      const total = +(t.subtotal).toFixed(2);
      await run(`UPDATE ${table} SET subtotal=?, total_discount=?, total=? WHERE id=?`,
        [t.subtotal, t.total_discount, total, newId]);
      await adjustStock(items, +1);
      res.json({ success: true, id: newId, ref_no });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.put(`${path}/:id`, async (req, res) => {
    try {
      const { id } = req.params;
      const d = req.body || {};
      const existing = await queryOne(`SELECT * FROM ${table} WHERE id = ?`, [id]);
      if (!existing) return res.status(404).json({ error: 'not found' });
      const oldItems = await queryAll(`SELECT * FROM ${itable} WHERE magazina_id = ?`, [id]);
      await adjustStock(oldItems, -1);
      const currency = d.currency || existing.currency || 'LEK';
      const exchange_rate = parseFloat(d.exchange_rate) || 1;
      await run(
        `UPDATE ${table} SET date=?, warehouse_code=?, currency=?, exchange_rate=?, notes=? WHERE id=?`,
        [d.date || existing.date, d.warehouse_code || '', currency, exchange_rate, d.notes || '', id]
      );
      await run(`DELETE FROM ${itable} WHERE magazina_id = ?`, [id]);
      const items = (d.items || []).filter(it => (it.name && it.name.trim()) || parseFloat(it.qty) > 0);
      const t = await insertItems(id, items);
      const total = +(t.subtotal).toFixed(2);
      await run(`UPDATE ${table} SET subtotal=?, total_discount=?, total=? WHERE id=?`,
        [t.subtotal, t.total_discount, total, id]);
      await adjustStock(items, +1);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete(`${path}/:id`, async (req, res) => {
    try {
      const { id } = req.params;
      const items = await queryAll(`SELECT * FROM ${itable} WHERE magazina_id = ?`, [id]);
      await adjustStock(items, -1);
      await run(`DELETE FROM ${itable} WHERE magazina_id = ?`, [id]);
      await run(`DELETE FROM ${table} WHERE id = ?`, [id]);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
}

makeMagazinaEndpoints('hyrje', +1);
makeMagazinaEndpoints('dalje', -1);

// ── Purchase invoice payments (partial supplier payments) ─────────────────────
app.get('/api/purchase-invoices/:id/payments', async (req, res) => {
  try {
    const { id } = req.params;
    const inv = await queryOne('SELECT * FROM purchase_invoices WHERE id = ?', [id]);
    if (!inv) return res.status(404).json({ error: 'not found' });
    const payments = await queryAll(
      'SELECT * FROM purchase_payments WHERE purchase_id = ? ORDER BY date ASC, id ASC',
      [id]
    );
    const sumExtra = payments.reduce((s, p) => s + (p.amount || 0), 0);
    const initialPaid = +Math.max(0, (inv.amount_paid || 0) - sumExtra).toFixed(2);
    res.json({
      invoice: inv,
      payments,
      initial_paid: initialPaid,
      initial_date: inv.date,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/purchase-invoices/:id/payments', async (req, res) => {
  try {
    const { id } = req.params;
    const d = req.body || {};
    const amount = parseFloat(d.amount);
    if (!amount || amount <= 0) return res.status(400).json({ error: 'invalid amount' });
    const inv = await queryOne('SELECT * FROM purchase_invoices WHERE id = ?', [id]);
    if (!inv) return res.status(404).json({ error: 'not found' });
    const due = Math.max(0, (inv.total_with_vat || 0) - (inv.amount_paid || 0));
    if (amount > due + 0.005) return res.status(400).json({ error: `max ${due.toFixed(2)}` });
    const pm = ['cash','bank','pos'].includes(d.payment_method) ? d.payment_method : 'cash';
    await run(
      `INSERT INTO purchase_payments (purchase_id, date, amount, payment_method, notes) VALUES (?, ?, ?, ?, ?)`,
      [id, d.date || new Date().toISOString().slice(0, 10), amount, pm, d.notes || '']
    );
    const newPaid = +((inv.amount_paid || 0) + amount).toFixed(2);
    const newDue  = +Math.max(0, (inv.total_with_vat || 0) - newPaid).toFixed(2);
    await run('UPDATE purchase_invoices SET amount_paid = ?, amount_due = ? WHERE id = ?', [newPaid, newDue, id]);
    res.json({ success: true, amount_paid: newPaid, amount_due: newDue });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/purchase-payments/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const pay = await queryOne('SELECT * FROM purchase_payments WHERE id = ?', [id]);
    if (!pay) return res.status(404).json({ error: 'not found' });
    const inv = await queryOne('SELECT * FROM purchase_invoices WHERE id = ?', [pay.purchase_id]);
    if (!inv) return res.status(404).json({ error: 'invoice missing' });
    await run('DELETE FROM purchase_payments WHERE id = ?', [id]);
    const newPaid = +Math.max(0, (inv.amount_paid || 0) - (pay.amount || 0)).toFixed(2);
    const newDue  = +Math.max(0, (inv.total_with_vat || 0) - newPaid).toFixed(2);
    await run('UPDATE purchase_invoices SET amount_paid = ?, amount_due = ? WHERE id = ?', [newPaid, newDue, pay.purchase_id]);
    res.json({ success: true, amount_paid: newPaid, amount_due: newDue });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// SUPPLIER DEBT REPORT — outstanding purchase invoices per supplier
// ============================================================
app.get('/api/supplier-debts', async (req, res) => {
  try {
    const { q, nipt, name, from, to } = req.query;
    let sql = `
      SELECT pi.*,
        (SELECT date   FROM purchase_payments WHERE purchase_id = pi.id ORDER BY date DESC, id DESC LIMIT 1) AS last_payment_date,
        (SELECT amount FROM purchase_payments WHERE purchase_id = pi.id ORDER BY date DESC, id DESC LIMIT 1) AS last_payment_amount,
        (SELECT COUNT(*) FROM purchase_payments WHERE purchase_id = pi.id) AS payment_count
      FROM purchase_invoices pi
      WHERE pi.payment_method IN ('bank', 'debt')
        AND COALESCE(pi.amount_due, pi.total_with_vat - pi.amount_paid) > 0`;
    const params = [];
    if (nipt) {
      sql += ' AND pi.supplier_nipt = ?';
      params.push(nipt);
    } else if (name) {
      sql += ' AND pi.supplier_name = ?';
      params.push(name);
    } else if (q && q.trim()) {
      sql += ' AND (pi.supplier_name LIKE ? OR pi.supplier_nipt LIKE ?)';
      params.push(`%${q}%`, `%${q}%`);
    }
    if (from) { sql += ' AND pi.date >= ?'; params.push(from); }
    if (to)   { sql += ' AND pi.date <= ?'; params.push(to); }
    sql += ' ORDER BY pi.date DESC, pi.id DESC';
    res.json(await queryAll(sql, params));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/supplier-debts/summary', async (req, res) => {
  try {
    const onlyDebt = req.query.onlyDebt === '1' || req.query.onlyDebt === 'true';
    const { from, to } = req.query;
    const conds = ["payment_method IN ('bank','debt')"];
    const params = [];
    if (from) { conds.push('date >= ?'); params.push(from); }
    if (to)   { conds.push('date <= ?'); params.push(to); }
    const where = `WHERE ${conds.join(' AND ')}`;
    const sql = `
      SELECT
        COALESCE(NULLIF(supplier_nipt, ''), supplier_name) AS supplier_key,
        supplier_name,
        supplier_nipt,
        currency,
        COUNT(*) AS invoice_count,
        SUM(total_with_vat) AS total,
        SUM(amount_paid) AS paid,
        SUM(COALESCE(amount_due, total_with_vat - amount_paid)) AS due
      FROM purchase_invoices
      ${where}
      GROUP BY supplier_key, supplier_name, supplier_nipt, currency
      ${onlyDebt ? 'HAVING SUM(COALESCE(amount_due, total_with_vat - amount_paid)) > 0' : ''}
      ORDER BY
        CASE WHEN supplier_name IS NULL OR supplier_name = '' THEN 1 ELSE 0 END,
        supplier_name COLLATE NOCASE ASC,
        supplier_nipt ASC
    `;
    res.json(await queryAll(sql, params));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/supplier-activity', async (req, res) => {
  try {
    const { q, nipt, name, from, to } = req.query;
    const conds = [];
    const params = [];
    if (nipt) {
      conds.push('supplier_nipt = ?');
      params.push(nipt);
    } else if (name) {
      conds.push('supplier_name = ?');
      params.push(name);
    } else if (q && q.trim()) {
      conds.push('(supplier_name LIKE ? OR supplier_nipt LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    } else {
      return res.json({ supplier: null, invoices: [], payments: [], totals: { invoiced: 0, paid: 0, due: 0 } });
    }
    if (from) { conds.push('date >= ?'); params.push(from); }
    if (to)   { conds.push('date <= ?'); params.push(to); }
    const invoices = await queryAll(
      `SELECT * FROM purchase_invoices WHERE ${conds.join(' AND ')} ORDER BY date ASC, id ASC`,
      params
    );
    if (invoices.length === 0) {
      return res.json({ supplier: null, invoices: [], payments: [], totals: { invoiced: 0, paid: 0, due: 0 } });
    }
    const ids = invoices.map(i => i.id);
    const placeholders = ids.map(() => '?').join(',');
    const payParams = [...ids];
    let payWhere = `p.purchase_id IN (${placeholders})`;
    if (from) { payWhere += ' AND p.date >= ?'; payParams.push(from); }
    if (to)   { payWhere += ' AND p.date <= ?'; payParams.push(to); }
    const payments = await queryAll(
      `SELECT p.*, pi.invoice_no, pi.date AS invoice_date, pi.total_with_vat AS invoice_total
         FROM purchase_payments p
         JOIN purchase_invoices pi ON pi.id = p.purchase_id
        WHERE ${payWhere}
        ORDER BY p.date ASC, p.id ASC`,
      payParams
    );
    const supplier = {
      name: invoices[0].supplier_name || '',
      nipt: invoices[0].supplier_nipt || '',
    };
    const invoiced = invoices.reduce((s, i) => s + (i.total_with_vat || 0), 0);
    let paid;
    if (from || to) {
      paid = payments.reduce((s, p) => s + (p.amount || 0), 0);
    } else {
      paid = invoices.reduce((s, i) => s + (i.amount_paid || 0), 0);
    }
    const due = +(invoiced - paid).toFixed(2);
    const totals = { invoiced: +invoiced.toFixed(2), paid: +paid.toFixed(2), due };
    res.json({ supplier, invoices, payments, totals });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// CLIENTS (KLIENTI)
// ============================================================
function clientFullName(c) {
  return [c.first_name, c.last_name].filter(Boolean).join(' ').trim();
}

app.get('/api/clients', async (req, res) => {
  try {
    const rows = await queryAll('SELECT * FROM clients ORDER BY last_name, first_name', []);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/clients/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json([]);
    const like = `%${q}%`;
    const rows = await queryAll(
      `SELECT * FROM clients
        WHERE nipt LIKE ? OR first_name LIKE ? OR last_name LIKE ?
           OR (first_name || ' ' || last_name) LIKE ? OR phone LIKE ?
        ORDER BY last_name, first_name LIMIT 12`,
      [like, like, like, like, like]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/clients/:id', async (req, res) => {
  try {
    const c = await queryOne('SELECT * FROM clients WHERE id = ?', [req.params.id]);
    if (!c) return res.status(404).json({ error: 'not found' });
    res.json(c);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/clients', async (req, res) => {
  try {
    const d = req.body || {};
    await run(
      `INSERT INTO clients (nipt, first_name, last_name, address, phone, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [d.nipt || '', d.first_name || '', d.last_name || '', d.address || '', d.phone || '', d.notes || '']
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/clients/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const d = req.body || {};
    await run(
      `UPDATE clients SET nipt=?, first_name=?, last_name=?, address=?, phone=?, notes=? WHERE id=?`,
      [d.nipt || '', d.first_name || '', d.last_name || '', d.address || '', d.phone || '', d.notes || '', id]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/clients/:id', async (req, res) => {
  try {
    await run('DELETE FROM clients WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// INVENTORY SUMMARY — agreguar për çdo produkt:
//   IN  = fatura blerje + magazina hyrje
//   OUT = fatura shitje (përjashtuar anuluarat; kreditoret kanë qty negative
//         dhe absorbohen vetiu te shuma) + magazina dalje
//   Çmimi mesatar i hyrjes = mesatare e ponderuar nga IN (në LEK)
// ============================================================
app.get('/api/inventory-summary', async (req, res) => {
  try {
    const { from, to } = req.query;
    // Helpers to apply optional date range to a parent table aliased as `parent`.
    const dateCond = (parent) => (from && to)
      ? `AND ${parent}.date BETWEEN ? AND ?`
      : (from ? `AND ${parent}.date >= ?` : (to ? `AND ${parent}.date <= ?` : ''));
    const dateParams = () => {
      if (from && to) return [from, to];
      if (from) return [from];
      if (to) return [to];
      return [];
    };

    const products = await queryAll(
      `SELECT id, name, sku, barcode, category, unit, stock, cost_price, sell_price
       FROM products WHERE COALESCE(active, 1) = 1
       ORDER BY name COLLATE NOCASE ASC`
    );

    // IN — purchase invoices (price in LEK = price * exchange_rate)
    // Filtruar sipas periudhës — për shfaqjen e aktivitetit hyrës në periudhë.
    const inPurchase = await queryAll(
      `SELECT pi.product_id AS pid,
              SUM(pi.qty) AS qty,
              SUM(pi.qty * pi.purchase_price_no_vat * COALESCE(p.exchange_rate, 1)) AS value_no_vat_lek,
              SUM(pi.vat_amount      * COALESCE(p.exchange_rate, 1)) AS vat_lek,
              SUM(pi.total_with_vat  * COALESCE(p.exchange_rate, 1)) AS value_with_vat_lek
       FROM purchase_items pi
       JOIN purchase_invoices p ON p.id = pi.purchase_id
       WHERE pi.product_id IS NOT NULL ${dateCond('p')}
       GROUP BY pi.product_id`,
      dateParams()
    );

    // IN — magazina hyrje (pa TVSH → TVSH = 0, me TVSH = pa TVSH)
    // Filtruar sipas periudhës — për shfaqjen e aktivitetit hyrës në periudhë.
    const inMag = await queryAll(
      `SELECT mi.product_id AS pid,
              SUM(mi.qty) AS qty,
              SUM(mi.qty * mi.unit_price * COALESCE(m.exchange_rate, 1)) AS value_no_vat_lek
       FROM magazina_hyrje_items mi
       JOIN magazina_hyrje m ON m.id = mi.magazina_id
       WHERE mi.product_id IS NOT NULL ${dateCond('m')}
       GROUP BY mi.product_id`,
      dateParams()
    );

    // "Deri në `to`" — për llogaritjen e kostos mesatare të ponderuar që reflekton
    // të gjithë historikun e blerjeve deri në fund të periudhës. Kështu një artikull
    // i shitur sot që u ble muajin e kaluar merr koston reale të blerjes, jo 0.
    const upToCond = (parent) => to ? `AND ${parent}.date <= ?` : '';
    const upToParams = () => to ? [to] : [];

    const inPurchaseHist = await queryAll(
      `SELECT pi.product_id AS pid,
              SUM(pi.qty) AS qty,
              SUM(pi.qty * pi.purchase_price_no_vat * COALESCE(p.exchange_rate, 1)) AS value_no_vat_lek,
              SUM(pi.vat_amount      * COALESCE(p.exchange_rate, 1)) AS vat_lek,
              SUM(pi.total_with_vat  * COALESCE(p.exchange_rate, 1)) AS value_with_vat_lek
       FROM purchase_items pi
       JOIN purchase_invoices p ON p.id = pi.purchase_id
       WHERE pi.product_id IS NOT NULL ${upToCond('p')}
       GROUP BY pi.product_id`,
      upToParams()
    );

    const inMagHist = await queryAll(
      `SELECT mi.product_id AS pid,
              SUM(mi.qty) AS qty,
              SUM(mi.qty * mi.unit_price * COALESCE(m.exchange_rate, 1)) AS value_no_vat_lek
       FROM magazina_hyrje_items mi
       JOIN magazina_hyrje m ON m.id = mi.magazina_id
       WHERE mi.product_id IS NOT NULL ${upToCond('m')}
       GROUP BY mi.product_id`,
      upToParams()
    );

    // OUT — sales (skip cancelled; credit notes have negative qty so they
    // self-net within the sum).
    // Përfshin edhe COGS të llogaritur nga `products.cost_price` × kursi i secilës
    // faturë — që fitimi/marzhi të pasqyrojë koston "e vendosur" në kartën e produktit,
    // jo mesataren e ponderuar historike (që mund të ndryshojë).
    const outSales = await queryAll(
      `SELECT ii.product_id AS pid,
              SUM(ii.qty) AS qty,
              SUM(ii.subtotal_no_vat * COALESCE(i.exchange_rate, 1)) AS sales_no_vat_lek,
              SUM(ii.total_with_vat  * COALESCE(i.exchange_rate, 1)) AS sales_with_vat_lek,
              SUM(ii.qty * COALESCE(p.cost_price, 0) * COALESCE(i.exchange_rate, 1)) AS cogs_from_product_lek
       FROM invoice_items ii
       JOIN invoices i      ON i.id = ii.invoice_id
       LEFT JOIN products p ON p.id = ii.product_id
       WHERE ii.product_id IS NOT NULL
         AND COALESCE(i.cancelled, 0) = 0
         ${dateCond('i')}
       GROUP BY ii.product_id`,
      dateParams()
    );

    // OUT — magazina dalje
    const outMag = await queryAll(
      `SELECT mi.product_id AS pid, SUM(mi.qty) AS qty
       FROM magazina_dalje_items mi
       JOIN magazina_dalje m ON m.id = mi.magazina_id
       WHERE mi.product_id IS NOT NULL ${dateCond('m')}
       GROUP BY mi.product_id`,
      dateParams()
    );

    const mapBy = (rows, key = 'pid') => {
      const m = new Map();
      for (const r of rows) m.set(r[key], r);
      return m;
    };
    const mInPurch     = mapBy(inPurchase);
    const mInMag       = mapBy(inMag);
    const mInPurchHist = mapBy(inPurchaseHist);
    const mInMagHist   = mapBy(inMagHist);
    const mOutSale     = mapBy(outSales);
    const mOutMag      = mapBy(outMag);

    const rows = products.map(p => {
      const ip = mInPurch.get(p.id) || { qty: 0, value_no_vat_lek: 0, vat_lek: 0, value_with_vat_lek: 0 };
      const im = mInMag.get(p.id)   || { qty: 0, value_no_vat_lek: 0 };
      const iph = mInPurchHist.get(p.id) || { qty: 0, value_no_vat_lek: 0, vat_lek: 0, value_with_vat_lek: 0 };
      const imh = mInMagHist.get(p.id)   || { qty: 0, value_no_vat_lek: 0 };
      const os = mOutSale.get(p.id) || { qty: 0, sales_no_vat_lek: 0, sales_with_vat_lek: 0 };
      const om = mOutMag.get(p.id)  || { qty: 0 };

      // Aktivitet HYRËS për periudhën (për shfaqje në rresht)
      const qty_in_purchase    = +(ip.qty || 0);
      const qty_in_magazina    = +(im.qty || 0);
      const total_in           = qty_in_purchase + qty_in_magazina;

      const qty_out_sales     = +(os.qty || 0);
      const qty_out_magazina  = +(om.qty || 0);
      const total_out         = qty_out_sales + qty_out_magazina;
      const net_qty           = +(total_in - total_out).toFixed(4);

      // Kosto mesatare e ponderuar HISTORIKE (nga të gjitha blerjet deri në `to`)
      // — përdoret për COGS dhe vlerën e stokut. Kështu artikujt e shitur nga
      // stoku i vjetër marrin koston reale, jo 0 kur nuk ka blerje në periudhë.
      const total_in_hist = +((iph.qty || 0) + (imh.qty || 0));
      const value_in_no_vat_lek_hist   = +((iph.value_no_vat_lek   || 0) + (imh.value_no_vat_lek || 0));
      const value_in_with_vat_lek_hist = +((iph.value_with_vat_lek || 0) + (imh.value_no_vat_lek || 0));

      const avg_price_no_vat_lek   = total_in_hist > 0 ? +(value_in_no_vat_lek_hist   / total_in_hist).toFixed(2) : 0;
      const avg_price_with_vat_lek = total_in_hist > 0 ? +(value_in_with_vat_lek_hist / total_in_hist).toFixed(2) : 0;

      const total_value_no_vat_lek   = +(net_qty * avg_price_no_vat_lek).toFixed(2);
      const total_value_with_vat_lek = +(net_qty * avg_price_with_vat_lek).toFixed(2);
      const total_value_vat_lek      = +(total_value_with_vat_lek - total_value_no_vat_lek).toFixed(2);

      // Profit — COGS on units actually sold (excludes magazina dalje transfers).
      // Përparësi: kosto nga karta e produktit (`products.cost_price` × kursi i shitjes)
      // sepse kjo pasqyron pritshmërinë e përdoruesit dhe është stabile.
      // Fallback: mesatarja e ponderuar historike e blerjeve deri në `to`.
      const sales_no_vat_lek    = +(os.sales_no_vat_lek   || 0);
      const sales_with_vat_lek  = +(os.sales_with_vat_lek || 0);
      const cogs_from_product   = +(os.cogs_from_product_lek || 0);
      const cogs_no_vat_lek     = cogs_from_product > 0
        ? +cogs_from_product.toFixed(2)
        : +(qty_out_sales * avg_price_no_vat_lek).toFixed(2);
      const profit_no_vat_lek   = +(sales_no_vat_lek - cogs_no_vat_lek).toFixed(2);
      const profit_margin_pct   = sales_no_vat_lek > 0
        ? +((profit_no_vat_lek / sales_no_vat_lek) * 100).toFixed(2)
        : 0;

      return {
        id: p.id, name: p.name, sku: p.sku, barcode: p.barcode,
        category: p.category, unit: p.unit, stock: p.stock,
        cost_price: p.cost_price, sell_price: p.sell_price,
        qty_in_purchase, qty_in_magazina, total_in,
        qty_out_sales, qty_out_magazina, total_out,
        net_qty,
        // Legacy aliases (UI ende mund t'i përdorë)
        avg_price_lek:   avg_price_no_vat_lek,
        total_value_lek: total_value_no_vat_lek,
        // Pa TVSH / Me TVSH
        avg_price_no_vat_lek, avg_price_with_vat_lek,
        total_value_no_vat_lek, total_value_vat_lek, total_value_with_vat_lek,
        // Fitim
        sales_no_vat_lek, sales_with_vat_lek,
        cogs_no_vat_lek, profit_no_vat_lek, profit_margin_pct,
      };
    });

    const totals = rows.reduce((a, r) => ({
      total_in:                 a.total_in                 + r.total_in,
      total_out:                a.total_out                + r.total_out,
      net_qty:                  a.net_qty                  + r.net_qty,
      total_value_lek:          a.total_value_lek          + r.total_value_lek,
      total_value_no_vat_lek:   a.total_value_no_vat_lek   + r.total_value_no_vat_lek,
      total_value_vat_lek:      a.total_value_vat_lek      + r.total_value_vat_lek,
      total_value_with_vat_lek: a.total_value_with_vat_lek + r.total_value_with_vat_lek,
      sales_no_vat_lek:         a.sales_no_vat_lek         + r.sales_no_vat_lek,
      cogs_no_vat_lek:          a.cogs_no_vat_lek          + r.cogs_no_vat_lek,
      profit_no_vat_lek:        a.profit_no_vat_lek        + r.profit_no_vat_lek,
    }), {
      total_in: 0, total_out: 0, net_qty: 0,
      total_value_lek: 0,
      total_value_no_vat_lek: 0, total_value_vat_lek: 0, total_value_with_vat_lek: 0,
      sales_no_vat_lek: 0, cogs_no_vat_lek: 0, profit_no_vat_lek: 0,
    });

    // Përmbledhje e Shitjes/Kostos/Fitimit sipas monedhës origjinale të faturës
    // (pa konvertim në LEK) — për shfaqjen në Dashboard sipas monedhës.
    const profitByCurrencyRaw = await queryAll(
      `SELECT
         COALESCE(i.currency, 'LEK') AS currency,
         SUM(ii.qty) AS qty,
         SUM(ii.subtotal_no_vat)                       AS sales_no_vat,
         SUM(ii.total_with_vat)                        AS sales_with_vat,
         SUM(ii.qty * COALESCE(p.cost_price, 0))       AS cogs
       FROM invoice_items ii
       JOIN invoices i      ON i.id = ii.invoice_id
       LEFT JOIN products p ON p.id = ii.product_id
       WHERE ii.product_id IS NOT NULL
         AND COALESCE(i.cancelled, 0) = 0
         ${dateCond('i')}
       GROUP BY COALESCE(i.currency, 'LEK')
       ORDER BY currency ASC`,
      dateParams()
    );
    const profitByCurrency = {};
    for (const r of profitByCurrencyRaw) {
      const sales = +(+r.sales_no_vat || 0).toFixed(2);
      const cogs  = +(+r.cogs || 0).toFixed(2);
      const profit = +(sales - cogs).toFixed(2);
      const margin = sales > 0 ? +((profit / sales) * 100).toFixed(2) : 0;
      profitByCurrency[r.currency] = {
        qty:           +(+r.qty || 0),
        sales_no_vat:  sales,
        sales_with_vat:+(+r.sales_with_vat || 0).toFixed(2),
        cogs,
        profit,
        margin_pct:    margin,
      };
    }

    res.json({ rows, totals, profitByCurrency });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// ARKA DITORE — bilanci i ditës bazuar tek faturat + shpenzimet
// ============================================================
//
// Formula:
//   Gjendja e Arkës = Xhiro Totale (Fatura Shitje)
//                   − Pagesa me Bankë
//                   − Pagesa me POS
//                   − Borxhi i Papaguar (amount_due)
//                   − Shpenzime
//                   − Fatura Blerje të paguara Kesh
// Të gjitha vlerat kthehen në LEK duke përdorur exchange_rate të secilës faturë/shpenzim.
app.get('/api/arka-ditore/:date', async (req, res) => {
  try {
    const { date } = req.params;
    if (!date) return res.status(400).json({ error: 'date required' });

    const CURS = ['LEK', 'EUR', 'USD', 'GBP', 'CHF'];
    const zeroPerCur = () => ({ LEK: 0, EUR: 0, USD: 0, GBP: 0, CHF: 0 });
    const fx = (obj) => {
      const out = {};
      for (const c of CURS) out[c] = +(obj[c] || 0).toFixed(2);
      return out;
    };

    // Ndarja e faturës në cash/pos/bank/debt për 'mikse', ose gjithë totali
    // për pm='cash'|'pos'|'bank'|'debt'. Këto llogariten pastaj për çdo monedhë.
    // Për 'debt' me parapagim kesh: amount_paid > 0 → pjesa e paguar hyn te
    // kesh_nga_shitjet (nëpërmjet formulës xhiro − bank − pos − due), dhe
    // amount_due mban vetëm mbetjen. Amount_paid këtu është snapshot i
    // regjistrimit (pagesat e mëpasme nga Detyrimet nuk hyjnë në arkën e ditës).
    // Për 'mikse' me splits në disa monedha, ndarja bëhet sipas monedhës reale
    // të secilit split (jo sipas monedhës së faturës) — që arka të pasqyrojë
    // pagesat fizike EUR/USD/GBP/etj. që hynë faktikisht në sirtar.
    const salesRows = await queryAll(
      `SELECT
         i.id                                 AS id,
         COALESCE(i.currency, 'LEK')          AS cur,
         COALESCE(i.total_with_vat, 0)        AS total,
         COALESCE(i.payment_method, 'cash')   AS pm,
         COALESCE(i.paid_cash, 0)             AS paid_cash,
         COALESCE(i.paid_pos, 0)              AS paid_pos,
         COALESCE(i.paid_bank, 0)             AS paid_bank,
         (COALESCE(i.amount_paid, 0)
           - COALESCE((SELECT SUM(amount) FROM invoice_payments WHERE invoice_id = i.id), 0)
         )                                    AS initial_paid
       FROM invoices i
       WHERE i.date = ? AND COALESCE(i.cancelled, 0) = 0`,
      [date]
    );

    // Për fatura 'mikse', ngarko splits që të atribuojmë secilën pagesë tek
    // monedha e vet reale (jo tek monedha e faturës).
    const mikseIds = salesRows.filter(r => r.pm === 'mikse').map(r => r.id);
    const splitsByInv = {};
    if (mikseIds.length > 0) {
      const placeholders = mikseIds.map(() => '?').join(',');
      const splitRows = await queryAll(
        `SELECT invoice_id, method, COALESCE(currency, 'LEK') AS currency, COALESCE(amount, 0) AS amount
           FROM invoice_payment_splits
          WHERE invoice_id IN (${placeholders})`,
        mikseIds
      );
      for (const s of splitRows) {
        (splitsByInv[s.invoice_id] = splitsByInv[s.invoice_id] || []).push(s);
      }
    }

    const xhiro_total = zeroPerCur();
    const paid_bank   = zeroPerCur();
    const paid_pos    = zeroPerCur();
    const amount_due  = zeroPerCur();
    for (const r of salesRows) {
      const c = (r.cur || 'LEK').toUpperCase();
      if (!(c in xhiro_total)) continue;
      if (r.pm === 'bank') {
        xhiro_total[c] += r.total;
        paid_bank[c] += r.total;
      }
      else if (r.pm === 'pos') {
        xhiro_total[c] += r.total;
        paid_pos[c] += r.total;
      }
      else if (r.pm === 'debt') {
        xhiro_total[c] += r.total;
        const paidNow = Math.max(0, Math.min(r.initial_paid || 0, r.total));
        const due     = Math.max(0, r.total - paidNow);
        amount_due[c] += due;
        // paidNow bie te kesh_nga_shitjet automatikisht (xhiro − bank − pos − due).
      }
      else if (r.pm === 'mikse') {
        // Atribuo çdo split tek monedha e vet reale.
        const splits = splitsByInv[r.id] || [];
        for (const s of splits) {
          const sc = (s.currency || c).toUpperCase();
          if (!(sc in xhiro_total)) continue;
          const amt = parseFloat(s.amount) || 0;
          xhiro_total[sc] += amt;
          if (s.method === 'bank') paid_bank[sc] += amt;
          else if (s.method === 'pos') paid_pos[sc] += amt;
          // Cash splits kalojnë tek kesh_nga_shitjet përmes xhiro − bank − pos − due.
        }
        // Pjesa e papaguar mbetet borxh në monedhën e faturës.
        const paidInInvCur = (r.paid_cash || 0) + (r.paid_pos || 0) + (r.paid_bank || 0);
        const debt = +(r.total - paidInInvCur).toFixed(2);
        if (debt > 0.005) {
          xhiro_total[c] += debt;
          amount_due[c] += debt;
        }
      }
      else {
        // pm === 'cash' (default)
        xhiro_total[c] += r.total;
      }
    }

    const expRows = await queryAll(
      `SELECT COALESCE(currency, 'LEK') AS cur,
              COALESCE(amount, 0)       AS amt
         FROM expense_entries WHERE date = ?`,
      [date]
    );
    const expenses = zeroPerCur();
    for (const r of expRows) {
      const c = (r.cur || 'LEK').toUpperCase();
      if (c in expenses) expenses[c] += r.amt;
    }

    // Fatura Blerje kesh (payment_method='cash') → amount_paid në monedhën origjinale.
    const purRows = await queryAll(
      `SELECT COALESCE(currency, 'LEK') AS cur,
              COALESCE(amount_paid, 0)  AS amt
         FROM purchase_invoices
         WHERE date = ? AND payment_method = 'cash'`,
      [date]
    );
    const purchase_cash = zeroPerCur();
    for (const r of purRows) {
      const c = (r.cur || 'LEK').toUpperCase();
      if (c in purchase_cash) purchase_cash[c] += r.amt;
    }

    // Hurdë (scrap gold) purchases — paid fully in cash, deducted from arka per currency
    const hurdaRows = await queryAll(
      `SELECT COALESCE(currency, 'LEK') AS cur,
              COALESCE(total_amount, 0) AS amt
         FROM hurda_purchases WHERE date = ?`,
      [date]
    );
    const hurda_cash = zeroPerCur();
    let hurda_gram_total = 0;
    for (const r of hurdaRows) {
      const c = (r.cur || 'LEK').toUpperCase();
      if (c in hurda_cash) hurda_cash[c] += r.amt;
    }
    const hurdaGramRow = await queryOne('SELECT COALESCE(SUM(gram),0) AS g FROM hurda_purchases WHERE date = ?', [date]);
    hurda_gram_total = +(hurdaGramRow?.g || 0).toFixed(3);

    // Pagesa borxhi kesh të bëra në këtë datë (por për fatura të datave të mëparshme).
    // Këto hyjnë në arkën e datës së pagesës — NUK trajtohen si xhiro (xhiro
    // mbetet pjesë e datës së faturës).
    const debtPayRows = await queryAll(
      `SELECT COALESCE(i.currency, 'LEK') AS cur,
              COALESCE(ip.amount, 0)     AS amt
         FROM invoice_payments ip
         JOIN invoices i ON i.id = ip.invoice_id
        WHERE ip.date = ?
          AND ip.payment_method = 'cash'
          AND COALESCE(i.cancelled, 0) = 0`,
      [date]
    );
    const debt_repayments = zeroPerCur();
    for (const r of debtPayRows) {
      const c = (r.cur || 'LEK').toUpperCase();
      if (c in debt_repayments) debt_repayments[c] += r.amt;
    }

    // HAS (bulk gold-jewelry batch) purchases — same treatment as hurda: cash out per currency
    const hasRows = await queryAll(
      `SELECT COALESCE(currency, 'EUR') AS cur,
              COALESCE(total_amount, 0) AS amt
         FROM has_purchases WHERE date = ?`,
      [date]
    );
    const has_cash = zeroPerCur();
    let has_gram_total = 0;
    for (const r of hasRows) {
      const c = (r.cur || 'EUR').toUpperCase();
      if (c in has_cash) has_cash[c] += r.amt;
    }
    const hasGramRow = await queryOne('SELECT COALESCE(SUM(gram),0) AS g FROM has_purchases WHERE date = ?', [date]);
    has_gram_total = +(hasGramRow?.g || 0).toFixed(3);

    const dailyRow = await queryOne(
      `SELECT COALESCE(opening_lek, 0)              AS opening_LEK,
              COALESCE(opening_eur, 0)              AS opening_EUR,
              COALESCE(opening_usd, 0)              AS opening_USD,
              COALESCE(opening_gbp, 0)              AS opening_GBP,
              COALESCE(opening_chf, 0)              AS opening_CHF,
              COALESCE(physical_cash_lek, 0)        AS phys_LEK,
              COALESCE(physical_cash_eur, 0)        AS phys_EUR,
              COALESCE(physical_cash_usd, 0)        AS phys_USD,
              COALESCE(physical_cash_gbp, 0)        AS phys_GBP,
              COALESCE(physical_cash_chf, 0)        AS phys_CHF,
              COALESCE(closeout_to_safe_lek, 0)     AS safe_LEK,
              COALESCE(closeout_to_safe_eur, 0)     AS safe_EUR,
              COALESCE(closeout_to_safe_usd, 0)     AS safe_USD,
              COALESCE(closeout_to_safe_gbp, 0)     AS safe_GBP,
              COALESCE(closeout_to_safe_chf, 0)     AS safe_CHF
         FROM daily_records WHERE date = ?`,
      [date]
    ) || {};

    const opening_cash   = zeroPerCur();
    const physical_cash  = zeroPerCur();
    const closeout_to_safe = zeroPerCur();
    for (const c of CURS) {
      opening_cash[c]     = dailyRow[`opening_${c}`] || 0;
      physical_cash[c]    = dailyRow[`phys_${c}`]    || 0;
      closeout_to_safe[c] = dailyRow[`safe_${c}`]    || 0;
    }

    // Kesh nga shitjet (për çdo monedhë) = xhiro − bankë − pos − borxh
    const cash_from_sales = zeroPerCur();
    const cash_balance    = zeroPerCur();
    const carryover_next_day = zeroPerCur();
    const difference = zeroPerCur();
    for (const c of CURS) {
      cash_from_sales[c] = xhiro_total[c] - paid_bank[c] - paid_pos[c] - amount_due[c];
      cash_balance[c]    = opening_cash[c] + cash_from_sales[c] + debt_repayments[c]
                          - expenses[c] - purchase_cash[c] - hurda_cash[c] - has_cash[c];
      carryover_next_day[c] = Math.max(0, physical_cash[c] - closeout_to_safe[c]);
      difference[c]      = physical_cash[c] - cash_balance[c];
    }

    res.json({
      date,
      currencies: CURS,
      xhiro_total:       fx(xhiro_total),
      paid_bank:         fx(paid_bank),
      paid_pos:          fx(paid_pos),
      amount_due:        fx(amount_due),
      opening_cash:      fx(opening_cash),
      cash_from_sales:   fx(cash_from_sales),
      debt_repayments:   fx(debt_repayments),
      expenses:          fx(expenses),
      purchase_cash:     fx(purchase_cash),
      hurda_cash:        fx(hurda_cash),
      hurda_gram_total,
      has_cash:          fx(has_cash),
      has_gram_total,
      cash_balance:      fx(cash_balance),
      physical_cash:     fx(physical_cash),
      difference:        fx(difference),
      closeout_to_safe:  fx(closeout_to_safe),
      carryover_next_day: fx(carryover_next_day),
      counts: {
        invoices: salesRows.length,
        expenses: expRows.length,
        purchases_cash: purRows.length,
        hurda_purchases: hurdaRows.length,
        has_purchases: hasRows.length,
        debt_repayments: debtPayRows.length,
      },
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Version periudhë (range) i arka-ditore: kthen fluksin e keshit të agreguar
// gjatë periudhës `from..to`. Përdoret nga Dashboard-i kur user-i zgjedh një
// periudhë me shume ditë. NUK ka opening/physical/closeout — ato janë koncepte
// ditore; për një periudhë, kthimi është neto (kesh in − kesh out) gjatë saj.
app.get('/api/arka-ditore-range', async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to required' });

    const CURS = ['LEK', 'EUR', 'USD', 'GBP', 'CHF'];
    const zeroPerCur = () => ({ LEK: 0, EUR: 0, USD: 0, GBP: 0, CHF: 0 });
    const fx = (obj) => {
      const out = {};
      for (const c of CURS) out[c] = +(obj[c] || 0).toFixed(2);
      return out;
    };

    const salesRows = await queryAll(
      `SELECT
         i.id                                 AS id,
         COALESCE(i.currency, 'LEK')          AS cur,
         COALESCE(i.total_with_vat, 0)        AS total,
         COALESCE(i.payment_method, 'cash')   AS pm,
         COALESCE(i.paid_cash, 0)             AS paid_cash,
         COALESCE(i.paid_pos, 0)              AS paid_pos,
         COALESCE(i.paid_bank, 0)             AS paid_bank,
         (COALESCE(i.amount_paid, 0)
           - COALESCE((SELECT SUM(amount) FROM invoice_payments WHERE invoice_id = i.id), 0)
         )                                    AS initial_paid
       FROM invoices i
       WHERE i.date BETWEEN ? AND ? AND COALESCE(i.cancelled, 0) = 0`,
      [from, to]
    );

    const mikseIds = salesRows.filter(r => r.pm === 'mikse').map(r => r.id);
    const splitsByInv = {};
    if (mikseIds.length > 0) {
      const placeholders = mikseIds.map(() => '?').join(',');
      const splitRows = await queryAll(
        `SELECT invoice_id, method, COALESCE(currency, 'LEK') AS currency, COALESCE(amount, 0) AS amount
           FROM invoice_payment_splits
          WHERE invoice_id IN (${placeholders})`,
        mikseIds
      );
      for (const s of splitRows) {
        (splitsByInv[s.invoice_id] = splitsByInv[s.invoice_id] || []).push(s);
      }
    }

    const xhiro_total = zeroPerCur();
    const paid_bank   = zeroPerCur();
    const paid_pos    = zeroPerCur();
    const amount_due  = zeroPerCur();
    for (const r of salesRows) {
      const c = (r.cur || 'LEK').toUpperCase();
      if (!(c in xhiro_total)) continue;
      if (r.pm === 'bank') {
        xhiro_total[c] += r.total;
        paid_bank[c] += r.total;
      } else if (r.pm === 'pos') {
        xhiro_total[c] += r.total;
        paid_pos[c] += r.total;
      } else if (r.pm === 'debt') {
        xhiro_total[c] += r.total;
        const paidNow = Math.max(0, Math.min(r.initial_paid || 0, r.total));
        const due     = Math.max(0, r.total - paidNow);
        amount_due[c] += due;
      } else if (r.pm === 'mikse') {
        const splits = splitsByInv[r.id] || [];
        for (const s of splits) {
          const sc = (s.currency || c).toUpperCase();
          if (!(sc in xhiro_total)) continue;
          const amt = parseFloat(s.amount) || 0;
          xhiro_total[sc] += amt;
          if (s.method === 'bank') paid_bank[sc] += amt;
          else if (s.method === 'pos') paid_pos[sc] += amt;
        }
        const paidInInvCur = (r.paid_cash || 0) + (r.paid_pos || 0) + (r.paid_bank || 0);
        const debt = +(r.total - paidInInvCur).toFixed(2);
        if (debt > 0.005) {
          xhiro_total[c] += debt;
          amount_due[c] += debt;
        }
      } else {
        xhiro_total[c] += r.total;
      }
    }

    const expRows = await queryAll(
      `SELECT COALESCE(currency, 'LEK') AS cur, COALESCE(amount, 0) AS amt
         FROM expense_entries WHERE date BETWEEN ? AND ?`,
      [from, to]
    );
    const expenses = zeroPerCur();
    for (const r of expRows) {
      const c = (r.cur || 'LEK').toUpperCase();
      if (c in expenses) expenses[c] += r.amt;
    }

    const purRows = await queryAll(
      `SELECT COALESCE(currency, 'LEK') AS cur, COALESCE(amount_paid, 0) AS amt
         FROM purchase_invoices
        WHERE date BETWEEN ? AND ? AND payment_method = 'cash'`,
      [from, to]
    );
    const purchase_cash = zeroPerCur();
    for (const r of purRows) {
      const c = (r.cur || 'LEK').toUpperCase();
      if (c in purchase_cash) purchase_cash[c] += r.amt;
    }

    const hurdaRows = await queryAll(
      `SELECT COALESCE(currency, 'LEK') AS cur, COALESCE(total_amount, 0) AS amt
         FROM hurda_purchases WHERE date BETWEEN ? AND ?`,
      [from, to]
    );
    const hurda_cash = zeroPerCur();
    for (const r of hurdaRows) {
      const c = (r.cur || 'LEK').toUpperCase();
      if (c in hurda_cash) hurda_cash[c] += r.amt;
    }

    const debtPayRows = await queryAll(
      `SELECT COALESCE(i.currency, 'LEK') AS cur, COALESCE(ip.amount, 0) AS amt
         FROM invoice_payments ip
         JOIN invoices i ON i.id = ip.invoice_id
        WHERE ip.date BETWEEN ? AND ?
          AND ip.payment_method = 'cash'
          AND COALESCE(i.cancelled, 0) = 0`,
      [from, to]
    );
    const debt_repayments = zeroPerCur();
    for (const r of debtPayRows) {
      const c = (r.cur || 'LEK').toUpperCase();
      if (c in debt_repayments) debt_repayments[c] += r.amt;
    }

    const hasRows = await queryAll(
      `SELECT COALESCE(currency, 'EUR') AS cur, COALESCE(total_amount, 0) AS amt
         FROM has_purchases WHERE date BETWEEN ? AND ?`,
      [from, to]
    );
    const has_cash = zeroPerCur();
    for (const r of hasRows) {
      const c = (r.cur || 'EUR').toUpperCase();
      if (c in has_cash) has_cash[c] += r.amt;
    }

    const cash_from_sales = zeroPerCur();
    const cash_balance    = zeroPerCur();
    for (const c of CURS) {
      cash_from_sales[c] = xhiro_total[c] - paid_bank[c] - paid_pos[c] - amount_due[c];
      cash_balance[c]    = cash_from_sales[c] + debt_repayments[c]
                          - expenses[c] - purchase_cash[c] - hurda_cash[c] - has_cash[c];
    }

    res.json({
      from, to,
      currencies: CURS,
      xhiro_total:     fx(xhiro_total),
      paid_bank:       fx(paid_bank),
      paid_pos:        fx(paid_pos),
      amount_due:      fx(amount_due),
      cash_from_sales: fx(cash_from_sales),
      debt_repayments: fx(debt_repayments),
      expenses:        fx(expenses),
      purchase_cash:   fx(purchase_cash),
      hurda_cash:      fx(hurda_cash),
      has_cash:        fx(has_cash),
      cash_balance:    fx(cash_balance),
      counts: {
        invoices: salesRows.length,
        expenses: expRows.length,
        purchases_cash: purRows.length,
        hurda_purchases: hurdaRows.length,
        has_purchases: hasRows.length,
        debt_repayments: debtPayRows.length,
      },
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Mbyllje e ditës për çdo monedhë: ndaj gjendjen fizike midis kasafortës dhe
// gjendjes fillestare të ditës pasardhëse.
//   to_safe: { LEK, EUR, USD, GBP, CHF } → closeout_to_safe_{cur} për këtë datë
//   carry:   physical_cash_{cur} - to_safe[cur] → opening_{cur} për datën pasardhëse
app.post('/api/arka-ditore/:date/closeout', async (req, res) => {
  try {
    const { date } = req.params;
    const CURS = ['LEK', 'EUR', 'USD', 'GBP', 'CHF'];
    const body = req.body || {};
    // Accept either { to_safe: {LEK, EUR, ...} } or legacy { to_safe_lek }
    const toSafe = {};
    for (const c of CURS) {
      const raw = body.to_safe?.[c] ?? body[`to_safe_${c.toLowerCase()}`] ?? 0;
      toSafe[c] = Math.max(0, parseFloat(raw) || 0);
    }

    const today = await queryOne(
      `SELECT COALESCE(physical_cash_lek, 0) AS phys_LEK,
              COALESCE(physical_cash_eur, 0) AS phys_EUR,
              COALESCE(physical_cash_usd, 0) AS phys_USD,
              COALESCE(physical_cash_gbp, 0) AS phys_GBP,
              COALESCE(physical_cash_chf, 0) AS phys_CHF
         FROM daily_records WHERE date = ?`,
      [date]
    ) || {};
    const carry = {};
    for (const c of CURS) {
      const phys = +(today[`phys_${c}`] || 0);
      carry[c] = +Math.max(0, phys - toSafe[c]).toFixed(2);
    }

    const existsToday = await queryOne('SELECT id FROM daily_records WHERE date = ?', [date]);
    const closeoutCols = CURS.map(c => `closeout_to_safe_${c.toLowerCase()}`);
    const closeoutVals = CURS.map(c => toSafe[c]);
    if (existsToday) {
      const setClause = closeoutCols.map(col => `${col} = ?`).join(', ');
      await run(`UPDATE daily_records SET ${setClause} WHERE date = ?`, [...closeoutVals, date]);
    } else {
      const cols = closeoutCols.join(', ');
      const placeholders = closeoutCols.map(() => '?').join(', ');
      await run(`INSERT INTO daily_records (date, ${cols}) VALUES (?, ${placeholders})`, [date, ...closeoutVals]);
    }

    const d = new Date(date + 'T12:00:00');
    d.setDate(d.getDate() + 1);
    const nextDate = d.toISOString().split('T')[0];

    const existsNext = await queryOne('SELECT id FROM daily_records WHERE date = ?', [nextDate]);
    const openCols = CURS.map(c => `opening_${c.toLowerCase()}`);
    const openVals = CURS.map(c => carry[c]);
    if (existsNext) {
      const setClause = openCols.map(col => `${col} = ?`).join(', ');
      await run(`UPDATE daily_records SET ${setClause} WHERE date = ?`, [...openVals, nextDate]);
    } else {
      const cols = openCols.join(', ');
      const placeholders = openCols.map(() => '?').join(', ');
      await run(`INSERT INTO daily_records (date, ${cols}) VALUES (?, ${placeholders})`, [nextDate, ...openVals]);
    }

    res.json({ success: true, to_safe: toSafe, carry, next_date: nextDate });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Kasaforta: bilanci kumulativ + historiku i lëvizjeve (derdhje + closeout − tërheqje)
// për çdo monedhë (LEK, EUR, USD, GBP, CHF).
app.get('/api/kasaforta', async (req, res) => {
  try {
    const CURS = ['LEK', 'EUR', 'USD', 'GBP', 'CHF'];
    const selectCols = CURS.flatMap(c => {
      const lc = c.toLowerCase();
      return [
        `COALESCE(safe_deposit_${lc}, 0)     AS dep_${c}`,
        `COALESCE(safe_withdraw_${lc}, 0)    AS wd_${c}`,
        `COALESCE(closeout_to_safe_${lc}, 0) AS co_${c}`,
      ];
    }).join(', ');
    const whereActivity = CURS.flatMap(c => {
      const lc = c.toLowerCase();
      return [
        `COALESCE(safe_deposit_${lc}, 0) > 0`,
        `COALESCE(safe_withdraw_${lc}, 0) > 0`,
        `COALESCE(closeout_to_safe_${lc}, 0) > 0`,
      ];
    }).join(' OR ');

    const rows = await queryAll(
      `SELECT date, ${selectCols}
         FROM daily_records
         WHERE ${whereActivity}
         ORDER BY date ASC`
    );

    // Përfshi edhe lëvizjet bankë → kasafortë si depozita në kasafortë (pa cenuar
    // kolonat e safe_deposit që janë të rezervuara për konvertimet e valutës).
    const bmSelect = CURS.map(c =>
      `COALESCE(SUM(amount_${c.toLowerCase()}), 0) AS bm_${c}`
    ).join(', ');
    const bmRows = await queryAll(
      `SELECT date, ${bmSelect}
         FROM bank_movements
         WHERE direction = 'to_safe'
         GROUP BY date`
    );
    const bmByDate = {};
    for (const r of bmRows) bmByDate[r.date] = r;

    // Konvertimet e monedhës brenda kasafortës — për çdo (datë, monedhë)
    // llogarit conv_in / conv_out dhe listën e ngjarjeve për tooltip / detaje.
    const convRows = await queryAll(
      `SELECT date, from_currency, from_amount, to_currency, to_amount, exchange_rate, note
         FROM safe_conversions
         ORDER BY date ASC, id ASC`
    );
    const convByDate = {}; // { date: { CUR: { in, out, events: [] } } }
    for (const cv of convRows) {
      const d  = cv.date;
      const fc = String(cv.from_currency || '').toUpperCase();
      const tc = String(cv.to_currency   || '').toUpperCase();
      const fA = parseFloat(cv.from_amount) || 0;
      const tA = parseFloat(cv.to_amount)   || 0;
      if (!convByDate[d]) convByDate[d] = {};
      const ensure = (cur) => {
        if (!convByDate[d][cur]) convByDate[d][cur] = { in: 0, out: 0, events: [] };
        return convByDate[d][cur];
      };
      if (fc && CURS.includes(fc)) {
        const bucket = ensure(fc);
        bucket.out += fA;
        bucket.events.push({
          direction: 'out', amount: fA, other_cur: tc, other_amount: tA,
          rate: parseFloat(cv.exchange_rate) || 0, note: cv.note || '',
        });
      }
      if (tc && CURS.includes(tc)) {
        const bucket = ensure(tc);
        bucket.in += tA;
        bucket.events.push({
          direction: 'in', amount: tA, other_cur: fc, other_amount: fA,
          rate: parseFloat(cv.exchange_rate) || 0, note: cv.note || '',
        });
      }
    }

    // Bashkoj datat: nga daily_records, bank_movements dhe konvertimet.
    const allDates = new Set(rows.map(r => r.date));
    for (const d of Object.keys(bmByDate))   allDates.add(d);
    for (const d of Object.keys(convByDate)) allDates.add(d);
    const sortedDates = [...allDates].sort();

    const rowsByDate = {};
    for (const r of rows) rowsByDate[r.date] = r;

    const running = { LEK: 0, EUR: 0, USD: 0, GBP: 0, CHF: 0 };
    const history = sortedDates.map(date => {
      const r  = rowsByDate[date] || {};
      const bm = bmByDate[date]   || {};
      const cv = convByDate[date] || {};
      const perCur = {};
      for (const c of CURS) {
        const rawDep = r[`dep_${c}`] || 0;   // safe_deposit_{cur} nga daily_records
        const rawWd  = r[`wd_${c}`]  || 0;   // safe_withdraw_{cur}
        const co     = r[`co_${c}`]  || 0;
        const convIn  = cv[c]?.in  || 0;
        const convOut = cv[c]?.out || 0;
        // "Derdhje" e pastër = bankë→kasafortë (safe_deposit ekziston vetëm nga
        // konvertimet, ndaj e heqim conv_in që të mos dyfishohet).
        const depositPure  = Math.max(0, rawDep - convIn) + (bm[`bm_${c}`] || 0);
        const withdrawPure = Math.max(0, rawWd  - convOut);
        const net = (depositPure + co + convIn) - (withdrawPure + convOut);
        const balanceBefore = running[c];
        running[c] += net;
        perCur[c] = {
          deposit:  +depositPure.toFixed(2),
          closeout_in: +co.toFixed(2),
          conv_in:  +convIn.toFixed(2),
          conv_out: +convOut.toFixed(2),
          withdraw: +withdrawPure.toFixed(2),
          net:      +net.toFixed(2),
          balance_before: +balanceBefore.toFixed(2),
          balance:  +running[c].toFixed(2),
          conversions: cv[c]?.events || [],
        };
      }
      return { date, ...perCur };
    });

    const balance = {};
    for (const c of CURS) balance[c] = +running[c].toFixed(2);

    res.json({
      currencies: CURS,
      balance,
      // Backwards compat: keep balance_lek for any old caller
      balance_lek: balance.LEK,
      history: history.reverse(),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// SAFE WITHDRAWALS — Tërheqje nga Kasaforta
// ============================================================
// Çdo tërheqje ruhet si rresht më vete me metadata (person, shënim, kohë).
// Shuma agregate për datë sinkronizohet edhe në daily_records.safe_withdraw_lek/eur
// që raportet ekzistuese (Kasaforta, permbledhëse) të vazhdojnë të punojnë.

const CURS_SW = ['lek', 'eur', 'usd', 'gbp', 'chf'];

async function syncSafeWithdrawTotals(date) {
  const agg = await queryOne(
    `SELECT ${CURS_SW.map(c => `COALESCE(SUM(amount_${c}), 0) AS ${c}`).join(', ')}
       FROM safe_withdrawals WHERE date = ?`,
    [date]
  ) || {};
  const existing = await queryOne('SELECT id FROM daily_records WHERE date = ?', [date]);
  const cols = CURS_SW.map(c => `safe_withdraw_${c}`);
  const vals = CURS_SW.map(c => +(agg[c] || 0).toFixed(2));
  if (existing) {
    const setClause = cols.map(col => `${col} = ?`).join(', ');
    await run(`UPDATE daily_records SET ${setClause} WHERE date = ?`, [...vals, date]);
  } else {
    const colList = cols.join(', ');
    const placeholders = cols.map(() => '?').join(', ');
    await run(`INSERT INTO daily_records (date, ${colList}) VALUES (?, ${placeholders})`, [date, ...vals]);
  }
}

app.get('/api/safe-withdrawals', async (req, res) => {
  try {
    const { from, to, limit } = req.query;
    const params = [];
    let where = '1=1';
    if (from) { where += ' AND date >= ?'; params.push(from); }
    if (to)   { where += ' AND date <= ?'; params.push(to); }
    const lim = Math.min(parseInt(limit) || 200, 500);
    const rows = await queryAll(
      `SELECT id, date, amount_lek, amount_eur, amount_usd, amount_gbp, amount_chf,
              person, note, created_at
         FROM safe_withdrawals
        WHERE ${where}
        ORDER BY date DESC, created_at DESC
        LIMIT ${lim}`,
      params
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/safe-withdrawals', async (req, res) => {
  try {
    const d = req.body || {};
    const date = d.date;
    if (!date) return res.status(400).json({ error: 'date required' });
    const amounts = {};
    let anyPositive = false;
    for (const c of CURS_SW) {
      const v = parseFloat(d[`amount_${c}`]) || 0;
      amounts[c] = v;
      if (v > 0) anyPositive = true;
    }
    if (!anyPositive) return res.status(400).json({ error: 'shuma duhet të jetë > 0' });
    const person = String(d.person || '').trim();
    const note   = String(d.note   || '').trim();
    const cols = CURS_SW.map(c => `amount_${c}`);
    const vals = CURS_SW.map(c => amounts[c]);
    await run(
      `INSERT INTO safe_withdrawals (date, ${cols.join(', ')}, person, note)
       VALUES (?, ${cols.map(() => '?').join(', ')}, ?, ?)`,
      [date, ...vals, person, note]
    );
    await syncSafeWithdrawTotals(date);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/safe-withdrawals/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const row = await queryOne('SELECT date FROM safe_withdrawals WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'not found' });
    await run('DELETE FROM safe_withdrawals WHERE id = ?', [id]);
    await syncSafeWithdrawTotals(row.date);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// SAFE CONVERSIONS — Konvertim valute brenda kasafortës
// ============================================================
// Ekuivalenti: tërhiq shumën nga një monedhë, derdh ekuivalentin në një tjetër.
// Prek daily_records: safe_withdraw_{from} += from_amount, safe_deposit_{to} += to_amount.

async function syncSafeConvertTotals(date) {
  const CURS_CV = ['lek', 'eur', 'usd', 'gbp', 'chf'];
  // withdraw = shitje (from_amount) për çdo monedhë kur ajo është "from"
  // deposit  = derdhje (to_amount)   për çdo monedhë kur ajo është "to"
  const wdParts = CURS_CV.map(c =>
    `COALESCE((SELECT SUM(from_amount) FROM safe_conversions WHERE date = ? AND UPPER(from_currency) = '${c.toUpperCase()}'), 0)`
  );
  const dpParts = CURS_CV.map(c =>
    `COALESCE((SELECT SUM(to_amount)   FROM safe_conversions WHERE date = ? AND UPPER(to_currency)   = '${c.toUpperCase()}'), 0)`
  );
  // Për parë sigurojmë që sums e safe_withdrawals normale ekzistojnë, pastaj ripërsërisim me convert-in.
  const swAgg = await queryOne(
    `SELECT ${CURS_CV.map(c => `COALESCE(SUM(amount_${c}), 0) AS sw_${c}`).join(', ')}
       FROM safe_withdrawals WHERE date = ?`,
    [date]
  ) || {};
  // Merr shumat e konvertimit
  const cvW = await queryOne(
    `SELECT ${wdParts.map((p, i) => `${p} AS cw_${CURS_CV[i]}`).join(', ')}`,
    [...CURS_CV.map(() => date)]
  ) || {};
  const cvD = await queryOne(
    `SELECT ${dpParts.map((p, i) => `${p} AS cd_${CURS_CV[i]}`).join(', ')}`,
    [...CURS_CV.map(() => date)]
  ) || {};

  const existing = await queryOne('SELECT id FROM daily_records WHERE date = ?', [date]);
  const wdCols = CURS_CV.map(c => `safe_withdraw_${c}`);
  const dpCols = CURS_CV.map(c => `safe_deposit_${c}`);
  const wdVals = CURS_CV.map(c => +((swAgg[`sw_${c}`] || 0) + (cvW[`cw_${c}`] || 0)).toFixed(2));
  const dpVals = CURS_CV.map(c => +(cvD[`cd_${c}`] || 0).toFixed(2));

  if (existing) {
    const setClause = [...wdCols, ...dpCols].map(col => `${col} = ?`).join(', ');
    await run(`UPDATE daily_records SET ${setClause} WHERE date = ?`, [...wdVals, ...dpVals, date]);
  } else {
    const cols = [...wdCols, ...dpCols].join(', ');
    const placeholders = [...wdCols, ...dpCols].map(() => '?').join(', ');
    await run(`INSERT INTO daily_records (date, ${cols}) VALUES (?, ${placeholders})`, [date, ...wdVals, ...dpVals]);
  }
}

app.get('/api/safe-conversions', async (req, res) => {
  try {
    const { from, to, limit } = req.query;
    const params = [];
    let where = '1=1';
    if (from) { where += ' AND date >= ?'; params.push(from); }
    if (to)   { where += ' AND date <= ?'; params.push(to); }
    const lim = Math.min(parseInt(limit) || 200, 500);
    const rows = await queryAll(
      `SELECT id, date, from_currency, from_amount, to_currency, to_amount,
              exchange_rate, note, created_at
         FROM safe_conversions
        WHERE ${where}
        ORDER BY date DESC, created_at DESC
        LIMIT ${lim}`,
      params
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/safe-conversions', async (req, res) => {
  try {
    const d = req.body || {};
    const date = d.date;
    if (!date) return res.status(400).json({ error: 'date required' });
    const CURS = ['LEK', 'EUR', 'USD', 'GBP', 'CHF'];
    const fromCurrency = String(d.from_currency || '').toUpperCase();
    const toCurrency   = String(d.to_currency   || '').toUpperCase();
    if (!CURS.includes(fromCurrency)) return res.status(400).json({ error: 'from_currency invalid' });
    if (!CURS.includes(toCurrency))   return res.status(400).json({ error: 'to_currency invalid' });
    if (fromCurrency === toCurrency)  return res.status(400).json({ error: 'monedhat duhet të jenë të ndryshme' });
    const fromAmount = parseFloat(d.from_amount) || 0;
    const toAmount   = parseFloat(d.to_amount)   || 0;
    if (fromAmount <= 0) return res.status(400).json({ error: 'from_amount duhet > 0' });
    if (toAmount   <= 0) return res.status(400).json({ error: 'to_amount duhet > 0' });
    const exchangeRate = parseFloat(d.exchange_rate) || +(toAmount / fromAmount).toFixed(6);
    const note = String(d.note || '').trim();
    await run(
      `INSERT INTO safe_conversions
        (date, from_currency, from_amount, to_currency, to_amount, exchange_rate, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [date, fromCurrency, fromAmount, toCurrency, toAmount, exchangeRate, note]
    );
    await syncSafeConvertTotals(date);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/safe-conversions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const row = await queryOne('SELECT date FROM safe_conversions WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'not found' });
    await run('DELETE FROM safe_conversions WHERE id = ?', [id]);
    await syncSafeConvertTotals(row.date);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// BANK MOVEMENTS — Lëvizje Banke (Kesh → Bankë, Bankë → Kasafortë)
// ============================================================
// Regjistër i pavarur. Bilanci i bankës = SUM(to_bank) − SUM(to_safe).
// Për to_safe (bankë → kasafortë), shuma i shtohet edhe kasafortës — kjo bëhet
// duke agreguar bank_movements(to_safe) brenda /api/kasaforta pa prekur kolonat
// e safe_deposit që janë të rezervuara për safe_conversions.

const CURS_BM = ['lek', 'eur', 'usd', 'gbp', 'chf'];

app.get('/api/bank-movements', async (req, res) => {
  try {
    const { from, to, limit } = req.query;
    const params = [];
    let where = '1=1';
    if (from) { where += ' AND date >= ?'; params.push(from); }
    if (to)   { where += ' AND date <= ?'; params.push(to); }
    const lim = Math.min(parseInt(limit) || 200, 500);
    const rows = await queryAll(
      `SELECT id, date, direction,
              amount_lek, amount_eur, amount_usd, amount_gbp, amount_chf,
              person, note, created_at
         FROM bank_movements
        WHERE ${where}
        ORDER BY date DESC, created_at DESC
        LIMIT ${lim}`,
      params
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/bank-balance', async (req, res) => {
  try {
    // + to_bank (depozito në bankë), − to_safe (tërheqje për në kasafortë)
    const parts = CURS_BM.map(c =>
      `COALESCE(SUM(CASE WHEN direction='to_bank' THEN amount_${c} ELSE -amount_${c} END), 0) AS bal_${c}`
    ).join(', ');
    const row = await queryOne(`SELECT ${parts} FROM bank_movements`) || {};
    const balance = {};
    for (const c of CURS_BM) balance[c.toUpperCase()] = +((row[`bal_${c}`] || 0)).toFixed(2);
    res.json({ balance });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/bank-movements', async (req, res) => {
  try {
    const d = req.body || {};
    const date = d.date;
    const direction = String(d.direction || '').trim();
    if (!date) return res.status(400).json({ error: 'date required' });
    if (!['to_bank', 'to_safe'].includes(direction)) {
      return res.status(400).json({ error: "direction duhet të jetë 'to_bank' ose 'to_safe'" });
    }
    const amounts = {};
    let anyPositive = false;
    for (const c of CURS_BM) {
      const v = parseFloat(d[`amount_${c}`]) || 0;
      if (v < 0) return res.status(400).json({ error: `amount_${c} duhet ≥ 0` });
      amounts[c] = v;
      if (v > 0) anyPositive = true;
    }
    if (!anyPositive) return res.status(400).json({ error: 'shuma duhet të jetë > 0 në të paktën një monedhë' });

    const person = String(d.person || '').trim();
    const note   = String(d.note   || '').trim();
    const cols = CURS_BM.map(c => `amount_${c}`);
    const vals = CURS_BM.map(c => amounts[c]);
    const result = await run(
      `INSERT INTO bank_movements (date, direction, ${cols.join(', ')}, person, note)
       VALUES (?, ?, ${cols.map(() => '?').join(', ')}, ?, ?)`,
      [date, direction, ...vals, person, note]
    );
    const rawId = result?.lastInsertRowid ?? result?.lastID;
    res.json({ success: true, id: typeof rawId === 'bigint' ? Number(rawId) : rawId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/bank-movements/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const row = await queryOne('SELECT id FROM bank_movements WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'not found' });
    await run('DELETE FROM bank_movements WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Ruaj gjendjen fizike të arkës (e numëruar dorazi) për një datë, për çdo monedhë.
// Pranon { physical_cash: { LEK, EUR, USD, GBP, CHF } } ose formatin e vjetër
// { physical_cash_lek } për prapa-kompatibilitet.
app.post('/api/arka-ditore/:date/physical', async (req, res) => {
  try {
    const { date } = req.params;
    const CURS = ['LEK', 'EUR', 'USD', 'GBP', 'CHF'];
    const body = req.body || {};
    const vals = {};
    for (const c of CURS) {
      const raw = body.physical_cash?.[c] ?? body[`physical_cash_${c.toLowerCase()}`] ?? null;
      if (raw !== null) vals[c] = parseFloat(raw) || 0;
    }
    if (Object.keys(vals).length === 0) return res.status(400).json({ error: 'no values provided' });

    const existing = await queryOne('SELECT id FROM daily_records WHERE date = ?', [date]);
    const cols = Object.keys(vals).map(c => `physical_cash_${c.toLowerCase()}`);
    const values = Object.values(vals);
    if (existing) {
      const setClause = cols.map(col => `${col} = ?`).join(', ');
      await run(`UPDATE daily_records SET ${setClause} WHERE date = ?`, [...values, date]);
    } else {
      const colList = cols.join(', ');
      const placeholders = cols.map(() => '?').join(', ');
      await run(`INSERT INTO daily_records (date, ${colList}) VALUES (?, ${placeholders})`, [date, ...values]);
    }
    res.json({ success: true, physical_cash: vals });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// ITEM REPORTS — Raport Artikuj Shitje / Blerje
// ============================================================
//
// Të dyja raportet kthejnë të njëjtin format kolonash (në LEK):
//   qty, unit_price_lek (mes.), discount_lek, value_no_vat_lek,
//   vat_lek, value_with_vat_lek.
// Çmimi mesatar = vlera bruto (qty × cmim, para zbritjes) / qty.

// Sales items — burimi: Fatura Shitje (invoice_items).
app.get('/api/reports/sales-items', async (req, res) => {
  try {
    const { from, to, q, material, detailed } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to required' });
    const isDetailed = detailed === '1' || detailed === 'true';

    const params = [from, to];
    let where = `i.date BETWEEN ? AND ? AND COALESCE(i.cancelled, 0) = 0`;
    if (q && q.trim()) {
      const like = `%${q.trim()}%`;
      where += ` AND (ii.barcode LIKE ? OR ii.name LIKE ? OR p.sku LIKE ?)`;
      params.push(like, like, like);
    }
    if (material === 'flori' || material === 'diamant') {
      where += ` AND COALESCE(p.material, '') = ?`;
      params.push(material);
    }

    // Rreshtat e detajuar — një rresht për çdo shitje (invoice item), pa mbledhje.
    const rowsDetailed = isDetailed ? await queryAll(
      `SELECT
         ii.id AS item_id,
         i.id  AS invoice_id,
         i.date,
         i.invoice_no,
         COALESCE(i.customer_name, '') AS customer_name,
         COALESCE(i.currency, 'LEK')   AS currency,
         COALESCE(i.exchange_rate, 1)  AS exchange_rate,
         COALESCE(i.is_credit_note, 0) AS is_credit_note,
         COALESCE(ii.product_id, 0)                     AS product_id,
         COALESCE(NULLIF(ii.barcode, ''), p.barcode, '') AS barcode,
         COALESCE(NULLIF(ii.name, ''), p.name, '')       AS name,
         COALESCE(p.sku, '')      AS sku,
         COALESCE(p.category, '') AS category,
         COALESCE(p.material, '') AS material,
         COALESCE(p.unit, 'copë') AS unit,
         ii.qty AS qty,
         ii.unit_price_no_vat AS unit_price,
         ii.discount_percent  AS discount_percent,
         ii.subtotal_no_vat   AS subtotal_no_vat,
         ii.vat_amount        AS vat_amount,
         ii.total_with_vat    AS total_with_vat
       FROM invoice_items ii
       JOIN invoices i      ON i.id = ii.invoice_id
       LEFT JOIN products p ON p.id = ii.product_id
       WHERE ${where}
       ORDER BY i.date ASC, i.invoice_no ASC, ii.id ASC`,
      params
    ).map(r => {
      const rate      = +(r.exchange_rate || 1);
      const qty       = +(r.qty || 0);
      const unitOrig  = +(r.unit_price || 0);
      const discPct   = +(r.discount_percent || 0);
      const subOrig   = +(r.subtotal_no_vat || 0);
      const vatOrig   = +(r.vat_amount || 0);
      const totOrig   = +(r.total_with_vat || 0);
      const discOrig  = +(qty * unitOrig * discPct / 100);
      return {
        item_id: r.item_id, invoice_id: r.invoice_id,
        date: r.date, invoice_no: r.invoice_no,
        customer_name: r.customer_name,
        currency: r.currency, exchange_rate: rate,
        is_credit_note: !!r.is_credit_note,
        product_id: r.product_id, barcode: r.barcode, name: r.name,
        sku: r.sku, category: r.category, material: r.material, unit: r.unit,
        qty,
        unit_price:           +unitOrig.toFixed(2),
        discount_percent:     discPct,
        discount:             +discOrig.toFixed(2),
        value_no_vat:         +subOrig.toFixed(2),
        vat:                  +vatOrig.toFixed(2),
        value_with_vat:       +totOrig.toFixed(2),
        // Ekuivalentët në LEK për krahasim vizual
        unit_price_lek:       +(unitOrig * rate).toFixed(2),
        discount_lek:         +(discOrig * rate).toFixed(2),
        value_no_vat_lek:     +(subOrig * rate).toFixed(2),
        vat_lek:              +(vatOrig * rate).toFixed(2),
        value_with_vat_lek:   +(totOrig * rate).toFixed(2),
      };
    }) : null;

    const rows = await queryAll(
      `SELECT
         COALESCE(ii.product_id, 0) AS product_id,
         COALESCE(NULLIF(ii.barcode, ''), p.barcode, '') AS barcode,
         COALESCE(NULLIF(ii.name, ''), p.name, '')       AS name,
         COALESCE(p.sku, '')      AS sku,
         COALESCE(p.category, '') AS category,
         COALESCE(p.material, '') AS material,
         COALESCE(p.unit, 'copë') AS unit,
         SUM(ii.qty) AS qty,
         SUM(ii.qty * ii.unit_price_no_vat * COALESCE(i.exchange_rate, 1)) AS gross_lek,
         SUM(ii.qty * ii.unit_price_no_vat * (ii.discount_percent / 100.0) * COALESCE(i.exchange_rate, 1)) AS discount_lek,
         SUM(ii.subtotal_no_vat * COALESCE(i.exchange_rate, 1)) AS value_no_vat_lek,
         SUM(ii.vat_amount       * COALESCE(i.exchange_rate, 1)) AS vat_lek,
         SUM(ii.total_with_vat   * COALESCE(i.exchange_rate, 1)) AS value_with_vat_lek,
         COUNT(DISTINCT i.id) AS docs_count
       FROM invoice_items ii
       JOIN invoices i      ON i.id = ii.invoice_id
       LEFT JOIN products p ON p.id = ii.product_id
       WHERE ${where}
       GROUP BY COALESCE(ii.product_id, 0),
                COALESCE(NULLIF(ii.barcode, ''), p.barcode, ''),
                COALESCE(NULLIF(ii.name, ''), p.name, '')
       ORDER BY name ASC`,
      params
    ).map(r => {
      const qty       = +(r.qty || 0);
      const gross     = +(r.gross_lek || 0);
      const discount  = +(r.discount_lek || 0);
      const valNoVat  = +(r.value_no_vat_lek || 0);
      const vat       = +(r.vat_lek || 0);
      const valWith   = +(r.value_with_vat_lek || 0);
      return {
        product_id: r.product_id, barcode: r.barcode, name: r.name,
        sku: r.sku, category: r.category, material: r.material, unit: r.unit,
        qty,
        unit_price_lek:    qty !== 0 ? +(gross / qty).toFixed(2) : 0,
        discount_lek:      +discount.toFixed(2),
        value_no_vat_lek:  +valNoVat.toFixed(2),
        vat_lek:           +vat.toFixed(2),
        value_with_vat_lek:+valWith.toFixed(2),
        docs_count:        +(r.docs_count || 0),
      };
    });

    const emptyTotals = () => ({ qty: 0, discount_lek: 0, value_no_vat_lek: 0, vat_lek: 0, value_with_vat_lek: 0 });
    const addInto = (a, r) => ({
      qty:                a.qty                + r.qty,
      discount_lek:       a.discount_lek       + r.discount_lek,
      value_no_vat_lek:   a.value_no_vat_lek   + r.value_no_vat_lek,
      vat_lek:            a.vat_lek            + r.vat_lek,
      value_with_vat_lek: a.value_with_vat_lek + r.value_with_vat_lek,
    });
    const totals = rows.reduce(addInto, emptyTotals());
    const totalsByMaterial = {
      flori:   rows.filter(r => r.material === 'flori').reduce(addInto, emptyTotals()),
      diamant: rows.filter(r => r.material === 'diamant').reduce(addInto, emptyTotals()),
      tjeter:  rows.filter(r => r.material !== 'flori' && r.material !== 'diamant').reduce(addInto, emptyTotals()),
    };

    // Totalet e grupuara sipas monedhës origjinale të faturës — pa konvertim në LEK.
    // Përdorin të njëjtat filtra (datë, q, material) si query kryesor.
    const totalsByCurrencyRaw = await queryAll(
      `SELECT
         COALESCE(i.currency, 'LEK') AS currency,
         SUM(ii.qty) AS qty,
         SUM(ii.qty * ii.unit_price_no_vat * (ii.discount_percent / 100.0)) AS discount,
         SUM(ii.subtotal_no_vat) AS value_no_vat,
         SUM(ii.vat_amount)      AS vat,
         SUM(ii.total_with_vat)  AS value_with_vat
       FROM invoice_items ii
       JOIN invoices i      ON i.id = ii.invoice_id
       LEFT JOIN products p ON p.id = ii.product_id
       WHERE ${where}
       GROUP BY COALESCE(i.currency, 'LEK')
       ORDER BY currency ASC`,
      params
    );
    const totalsByCurrency = {};
    for (const r of totalsByCurrencyRaw) {
      totalsByCurrency[r.currency] = {
        qty:                +(+r.qty || 0),
        discount:           +(+r.discount || 0).toFixed(2),
        value_no_vat:       +(+r.value_no_vat || 0).toFixed(2),
        vat:                +(+r.vat || 0).toFixed(2),
        value_with_vat:     +(+r.value_with_vat || 0).toFixed(2),
      };
    }

    res.json({ rows, rowsDetailed, totals, totalsByMaterial, totalsByCurrency });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Purchase items — burimet: Fatura Blerje (purchase_items) + Magazina Hyrje
// (magazina_hyrje_items, pa TVSH → trajtohet si TVSH = 0).
app.get('/api/reports/purchase-items', async (req, res) => {
  try {
    const { from, to, q, category } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to required' });

    const ql   = (q || '').trim();
    const like = ql ? `%${ql}%` : null;
    const cat  = (category || '').trim();

    // ── Fatura Blerje
    const purchaseParams = [from, to];
    let purchaseWhere = `pi.date BETWEEN ? AND ?`;
    if (like) {
      purchaseWhere += ` AND (pit.barcode LIKE ? OR pit.name LIKE ? OR p.sku LIKE ?)`;
      purchaseParams.push(like, like, like);
    }
    if (cat) {
      purchaseWhere += ` AND COALESCE(p.category, '') = ?`;
      purchaseParams.push(cat);
    }
    const purchases = await queryAll(
      `SELECT
         COALESCE(pit.product_id, 0) AS product_id,
         COALESCE(NULLIF(pit.barcode, ''), p.barcode, '') AS barcode,
         COALESCE(NULLIF(pit.name, ''), p.name, '')       AS name,
         COALESCE(p.sku, '')      AS sku,
         COALESCE(p.category, '') AS category,
         COALESCE(p.unit, 'copë') AS unit,
         SUM(pit.qty) AS qty,
         SUM(pit.qty * pit.purchase_price_no_vat * COALESCE(pi.exchange_rate, 1)) AS gross_lek,
         SUM(pit.qty * pit.purchase_price_no_vat * (pit.discount_percent / 100.0) * COALESCE(pi.exchange_rate, 1)) AS discount_lek,
         SUM(pit.subtotal_no_vat * COALESCE(pi.exchange_rate, 1)) AS value_no_vat_lek,
         SUM(pit.vat_amount      * COALESCE(pi.exchange_rate, 1)) AS vat_lek,
         SUM(pit.total_with_vat  * COALESCE(pi.exchange_rate, 1)) AS value_with_vat_lek,
         COUNT(DISTINCT pi.id) AS docs_count
       FROM purchase_items pit
       JOIN purchase_invoices pi ON pi.id = pit.purchase_id
       LEFT JOIN products p      ON p.id = pit.product_id
       WHERE ${purchaseWhere}
       GROUP BY COALESCE(pit.product_id, 0),
                COALESCE(NULLIF(pit.barcode, ''), p.barcode, ''),
                COALESCE(NULLIF(pit.name, ''), p.name, '')`,
      purchaseParams
    );

    // ── Magazina Hyrje (pa TVSH)
    const magParams = [from, to];
    let magWhere = `m.date BETWEEN ? AND ?`;
    if (like) {
      magWhere += ` AND (mi.barcode LIKE ? OR mi.name LIKE ? OR p.sku LIKE ?)`;
      magParams.push(like, like, like);
    }
    if (cat) {
      magWhere += ` AND COALESCE(p.category, '') = ?`;
      magParams.push(cat);
    }
    const mags = await queryAll(
      `SELECT
         COALESCE(mi.product_id, 0) AS product_id,
         COALESCE(NULLIF(mi.barcode, ''), p.barcode, '') AS barcode,
         COALESCE(NULLIF(mi.name, ''), p.name, '')       AS name,
         COALESCE(p.sku, '')      AS sku,
         COALESCE(p.category, '') AS category,
         COALESCE(p.unit, 'copë') AS unit,
         SUM(mi.qty) AS qty,
         SUM(mi.qty * mi.unit_price * COALESCE(m.exchange_rate, 1)) AS gross_lek,
         SUM(mi.qty * mi.unit_price * (mi.discount_percent / 100.0) * COALESCE(m.exchange_rate, 1)) AS discount_lek,
         SUM(mi.subtotal * COALESCE(m.exchange_rate, 1)) AS value_no_vat_lek,
         COUNT(DISTINCT m.id) AS docs_count
       FROM magazina_hyrje_items mi
       JOIN magazina_hyrje m ON m.id = mi.magazina_id
       LEFT JOIN products p  ON p.id = mi.product_id
       WHERE ${magWhere}
       GROUP BY COALESCE(mi.product_id, 0),
                COALESCE(NULLIF(mi.barcode, ''), p.barcode, ''),
                COALESCE(NULLIF(mi.name, ''), p.name, '')`,
      magParams
    );

    // Bashko sipas (product_id | barcode | name)
    const keyOf = (r) => `${r.product_id || 0}|${(r.barcode || '').toLowerCase()}|${(r.name || '').toLowerCase()}`;
    const empty = (r) => ({
      product_id: r.product_id, barcode: r.barcode, name: r.name,
      sku: r.sku || '', category: r.category || '', unit: r.unit || 'copë',
      qty: 0, gross_lek: 0, discount_lek: 0,
      value_no_vat_lek: 0, vat_lek: 0, value_with_vat_lek: 0,
      docs_count: 0,
    });

    const map = new Map();
    for (const r of purchases) {
      const k = keyOf(r);
      const e = map.get(k) || empty(r);
      e.qty                += +(r.qty || 0);
      e.gross_lek          += +(r.gross_lek || 0);
      e.discount_lek       += +(r.discount_lek || 0);
      e.value_no_vat_lek   += +(r.value_no_vat_lek || 0);
      e.vat_lek            += +(r.vat_lek || 0);
      e.value_with_vat_lek += +(r.value_with_vat_lek || 0);
      e.docs_count         += +(r.docs_count || 0);
      map.set(k, e);
    }
    for (const r of mags) {
      const k = keyOf(r);
      const e = map.get(k) || empty(r);
      const valNoVat = +(r.value_no_vat_lek || 0);
      e.qty                += +(r.qty || 0);
      e.gross_lek          += +(r.gross_lek || 0);
      e.discount_lek       += +(r.discount_lek || 0);
      e.value_no_vat_lek   += valNoVat;
      // Magazina Hyrje është pa TVSH → vat = 0, total = subtotal
      e.value_with_vat_lek += valNoVat;
      e.docs_count         += +(r.docs_count || 0);
      map.set(k, e);
    }

    const rows = Array.from(map.values()).map(r => {
      const qty = r.qty;
      return {
        product_id: r.product_id, barcode: r.barcode, name: r.name,
        sku: r.sku, category: r.category, unit: r.unit,
        qty,
        unit_price_lek:    qty !== 0 ? +(r.gross_lek / qty).toFixed(2) : 0,
        discount_lek:      +r.discount_lek.toFixed(2),
        value_no_vat_lek:  +r.value_no_vat_lek.toFixed(2),
        vat_lek:           +r.vat_lek.toFixed(2),
        value_with_vat_lek:+r.value_with_vat_lek.toFixed(2),
        docs_count:        r.docs_count,
      };
    }).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    const totals = rows.reduce((a, r) => ({
      qty:                a.qty                + r.qty,
      discount_lek:       a.discount_lek       + r.discount_lek,
      value_no_vat_lek:   a.value_no_vat_lek   + r.value_no_vat_lek,
      vat_lek:            a.vat_lek            + r.vat_lek,
      value_with_vat_lek: a.value_with_vat_lek + r.value_with_vat_lek,
    }), { qty: 0, discount_lek: 0, value_no_vat_lek: 0, vat_lek: 0, value_with_vat_lek: 0 });

    // Lista e kategorive për të mbushur filtër-in në frontend
    // (nga produktet aktive që kanë të paktën një kategori të vendosur).
    const categoryRows = await queryAll(
      `SELECT DISTINCT category FROM products
       WHERE COALESCE(active, 1) = 1 AND COALESCE(category, '') != ''
       ORDER BY category ASC`
    );
    const categories = categoryRows.map(r => r.category);

    res.json({ rows, totals, categories });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Docs që përmbajnë artikullin (për modalin "Hap dokumentat") ──
// Çelësi i përputhjes: product_id (kur > 0) OSE (barcode + name).
function buildItemMatchSQL(itemAlias, productId, barcode, name, params) {
  const pid = parseInt(productId);
  if (pid > 0) {
    params.push(pid);
    return `${itemAlias}.product_id = ?`;
  }
  params.push(barcode || '', name || '');
  return `COALESCE(NULLIF(${itemAlias}.barcode, ''), '') = ? AND COALESCE(NULLIF(${itemAlias}.name, ''), '') = ?`;
}

app.get('/api/reports/sales-items/docs', async (req, res) => {
  try {
    const { from, to, product_id, barcode, name } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to required' });
    const params = [from, to];
    const matchSQL = buildItemMatchSQL('ii', product_id, barcode, name, params);
    const rows = await queryAll(
      `SELECT
         i.id              AS invoice_id,
         i.date            AS date,
         i.invoice_no      AS invoice_no,
         i.customer_name   AS customer_name,
         i.customer_nipt   AS customer_nipt,
         i.currency        AS currency,
         COALESCE(i.exchange_rate, 1) AS exchange_rate,
         COALESCE(i.cancelled, 0)     AS cancelled,
         COALESCE(i.is_credit_note, 0) AS is_credit_note,
         SUM(ii.qty)                                  AS qty,
         SUM(ii.qty * ii.unit_price_no_vat * COALESCE(i.exchange_rate, 1)) AS gross_lek,
         SUM(ii.subtotal_no_vat)                      AS value_no_vat,
         SUM(ii.vat_amount)                           AS vat,
         SUM(ii.total_with_vat)                       AS value_with_vat,
         SUM(ii.subtotal_no_vat * COALESCE(i.exchange_rate, 1)) AS value_no_vat_lek,
         SUM(ii.total_with_vat  * COALESCE(i.exchange_rate, 1)) AS value_with_vat_lek
       FROM invoice_items ii
       JOIN invoices i ON i.id = ii.invoice_id
       WHERE i.date BETWEEN ? AND ?
         AND COALESCE(i.cancelled, 0) = 0
         AND ${matchSQL}
       GROUP BY i.id
       ORDER BY i.date ASC, i.id ASC`,
      params
    ).map(r => {
      const qty = +(r.qty || 0);
      const gross = +(r.gross_lek || 0);
      return { ...r, unit_price_lek: qty !== 0 ? +(gross / qty).toFixed(2) : 0 };
    });
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/reports/purchase-items/docs', async (req, res) => {
  try {
    const { from, to, product_id, barcode, name } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to required' });

    // Fatura Blerje
    const pParams = [from, to];
    const pMatch  = buildItemMatchSQL('pit', product_id, barcode, name, pParams);
    const purchases = await queryAll(
      `SELECT
         'purchase' AS source,
         pi.id            AS doc_id,
         pi.date          AS date,
         pi.invoice_no    AS doc_no,
         pi.supplier_name AS party_name,
         pi.supplier_nipt AS party_nipt,
         pi.currency      AS currency,
         COALESCE(pi.exchange_rate, 1) AS exchange_rate,
         SUM(pit.qty)              AS qty,
         SUM(pit.qty * pit.purchase_price_no_vat * COALESCE(pi.exchange_rate, 1)) AS gross_lek,
         SUM(pit.subtotal_no_vat)  AS value_no_vat,
         SUM(pit.vat_amount)       AS vat,
         SUM(pit.total_with_vat)   AS value_with_vat,
         SUM(pit.subtotal_no_vat * COALESCE(pi.exchange_rate, 1)) AS value_no_vat_lek,
         SUM(pit.total_with_vat  * COALESCE(pi.exchange_rate, 1)) AS value_with_vat_lek
       FROM purchase_items pit
       JOIN purchase_invoices pi ON pi.id = pit.purchase_id
       WHERE pi.date BETWEEN ? AND ?
         AND ${pMatch}
       GROUP BY pi.id`,
      pParams
    );

    // Magazina Hyrje (pa TVSH)
    const mParams = [from, to];
    const mMatch  = buildItemMatchSQL('mi', product_id, barcode, name, mParams);
    const mags = await queryAll(
      `SELECT
         'magazina' AS source,
         m.id            AS doc_id,
         m.date          AS date,
         m.ref_no        AS doc_no,
         m.warehouse_code AS party_name,
         ''              AS party_nipt,
         m.currency      AS currency,
         COALESCE(m.exchange_rate, 1) AS exchange_rate,
         SUM(mi.qty)             AS qty,
         SUM(mi.qty * mi.unit_price * COALESCE(m.exchange_rate, 1)) AS gross_lek,
         SUM(mi.subtotal)        AS value_no_vat,
         0                       AS vat,
         SUM(mi.subtotal)        AS value_with_vat,
         SUM(mi.subtotal * COALESCE(m.exchange_rate, 1)) AS value_no_vat_lek,
         SUM(mi.subtotal * COALESCE(m.exchange_rate, 1)) AS value_with_vat_lek
       FROM magazina_hyrje_items mi
       JOIN magazina_hyrje m ON m.id = mi.magazina_id
       WHERE m.date BETWEEN ? AND ?
         AND ${mMatch}
       GROUP BY m.id`,
      mParams
    );

    const out = [...purchases, ...mags].map(r => {
      const qty = +(r.qty || 0);
      const gross = +(r.gross_lek || 0);
      return { ...r, unit_price_lek: qty !== 0 ? +(gross / qty).toFixed(2) : 0 };
    }).sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return (a.doc_no || '').localeCompare(b.doc_no || '');
    });
    res.json(out);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// SHPENZIME — Zëra (regjistër) + Fleta ditore
// ============================================================

// Përditëson totalet ditore te daily_records nga zërat e ditës.
// Çdo zë ka monedhën e vet + kursin manual; agregojmë sipas monedhës.
// Monedhat jashtë LEK/EUR/USD (p.sh. GBP, CHF) konvertohen në LEK dhe shtohen
// te expenses_lek për të ruajtur përputhshmërinë me MonthlySummary/EndOfDay.
async function syncExpenseTotals(date) {
  const groups = await queryAll(
    `SELECT
       COALESCE(currency, 'LEK') AS cur,
       COALESCE(SUM(amount), 0) AS amt,
       COALESCE(SUM(amount * exchange_rate), 0) AS amt_lek
     FROM expense_entries WHERE date = ?
     GROUP BY COALESCE(currency, 'LEK')`,
    [date]
  );
  let lek = 0, eur = 0, usd = 0;
  for (const g of groups) {
    if (g.cur === 'LEK')      lek += g.amt;
    else if (g.cur === 'EUR') eur += g.amt;
    else if (g.cur === 'USD') usd += g.amt;
    else                      lek += g.amt_lek;
  }
  const exists = await queryOne('SELECT id FROM daily_records WHERE date = ?', [date]);
  if (exists) {
    await run(
      `UPDATE daily_records SET expenses_lek = ?, expenses_eur = ?, expenses_usd = ? WHERE date = ?`,
      [lek, eur, usd, date]
    );
  } else {
    await run(
      `INSERT INTO daily_records (date, expenses_lek, expenses_eur, expenses_usd) VALUES (?, ?, ?, ?)`,
      [date, lek, eur, usd]
    );
  }
}

// ── Kategoritë e shpenzimeve ─────────────────────────────────
// Lista e kategorive të produkteve (për filtra në disa faqe).
app.get('/api/products/categories', async (req, res) => {
  try {
    const rows = await queryAll(
      `SELECT DISTINCT category FROM products
       WHERE COALESCE(active, 1) = 1 AND COALESCE(category, '') != ''
       ORDER BY category COLLATE NOCASE ASC`
    );
    res.json(rows.map(r => r.category));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/expense-categories', async (req, res) => {
  try {
    const includeInactive = req.query.all === '1';
    const where = includeInactive ? '' : 'WHERE COALESCE(active, 1) = 1';
    res.json(await queryAll(`SELECT * FROM expense_categories ${where} ORDER BY name COLLATE NOCASE ASC`));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/expense-categories', async (req, res) => {
  try {
    const { name, description } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
    await run(
      `INSERT INTO expense_categories (name, description, active) VALUES (?, ?, 1)`,
      [name.trim(), description || '']
    );
    const row = await queryOne('SELECT * FROM expense_categories ORDER BY id DESC LIMIT 1');
    res.json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/expense-categories/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, active } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
    await run(
      `UPDATE expense_categories SET name = ?, description = ?, active = ? WHERE id = ?`,
      [name.trim(), description || '', active === 0 ? 0 : 1, id]
    );
    res.json(await queryOne('SELECT * FROM expense_categories WHERE id = ?', [id]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/expense-categories/:id', async (req, res) => {
  try {
    await run('DELETE FROM expense_categories WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Zërat ditorë (Fleta e Shpenzimeve) ───────────────────────
const SUPPORTED_EXPENSE_CURRENCIES = ['LEK', 'EUR', 'USD', 'GBP', 'CHF'];

function pickCurrency(cur) {
  const c = String(cur || 'LEK').toUpperCase();
  return SUPPORTED_EXPENSE_CURRENCIES.includes(c) ? c : 'LEK';
}

app.get('/api/expense-entries/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const rows = await queryAll(
      `SELECT e.*, c.name AS category_name,
              (COALESCE(e.amount, 0) * COALESCE(e.exchange_rate, 1)) AS total_lek
       FROM expense_entries e
       LEFT JOIN expense_categories c ON c.id = e.category_id
       WHERE e.date = ?
       ORDER BY e.id ASC`,
      [date]
    );
    const totals = rows.reduce((a, r) => {
      const cur = r.currency || 'LEK';
      a.total_lek += +(r.total_lek || 0);
      a.by_currency[cur] = (a.by_currency[cur] || 0) + (r.amount || 0);
      return a;
    }, { total_lek: 0, by_currency: {} });
    res.json({ rows, totals });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/expense-entries', async (req, res) => {
  try {
    const { date, category_id, description, currency, amount, exchange_rate } = req.body || {};
    if (!date) return res.status(400).json({ error: 'date required' });
    const cur = pickCurrency(currency);
    const amt = parseFloat(amount) || 0;
    const rate = cur === 'LEK' ? 1 : (parseFloat(exchange_rate) || 0);
    if (cur !== 'LEK' && rate <= 0) return res.status(400).json({ error: 'exchange_rate required for foreign currency' });
    await run(
      `INSERT INTO expense_entries (date, category_id, description, currency, amount, exchange_rate,
         amount_lek, amount_eur, amount_usd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        date,
        category_id || null,
        description || '',
        cur, amt, rate,
        // Legacy mirrors për përputhshmëri me kod të vjetër (lexime që preken)
        cur === 'LEK' ? amt : 0,
        cur === 'EUR' ? amt : 0,
        cur === 'USD' ? amt : 0,
      ]
    );
    await syncExpenseTotals(date);
    const row = await queryOne(
      `SELECT e.*, c.name AS category_name,
              (COALESCE(e.amount, 0) * COALESCE(e.exchange_rate, 1)) AS total_lek
       FROM expense_entries e LEFT JOIN expense_categories c ON c.id = e.category_id
       ORDER BY e.id DESC LIMIT 1`
    );
    res.json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/expense-entries/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { date, category_id, description, currency, amount, exchange_rate } = req.body || {};
    const existing = await queryOne('SELECT date FROM expense_entries WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'not found' });
    const cur = pickCurrency(currency);
    const amt = parseFloat(amount) || 0;
    const rate = cur === 'LEK' ? 1 : (parseFloat(exchange_rate) || 0);
    if (cur !== 'LEK' && rate <= 0) return res.status(400).json({ error: 'exchange_rate required for foreign currency' });
    await run(
      `UPDATE expense_entries SET date = ?, category_id = ?, description = ?,
         currency = ?, amount = ?, exchange_rate = ?,
         amount_lek = ?, amount_eur = ?, amount_usd = ?
       WHERE id = ?`,
      [
        date || existing.date,
        category_id || null,
        description || '',
        cur, amt, rate,
        cur === 'LEK' ? amt : 0,
        cur === 'EUR' ? amt : 0,
        cur === 'USD' ? amt : 0,
        id,
      ]
    );
    await syncExpenseTotals(existing.date);
    if (date && date !== existing.date) await syncExpenseTotals(date);
    res.json(await queryOne(
      `SELECT e.*, c.name AS category_name,
              (COALESCE(e.amount, 0) * COALESCE(e.exchange_rate, 1)) AS total_lek
       FROM expense_entries e LEFT JOIN expense_categories c ON c.id = e.category_id
       WHERE e.id = ?`, [id]
    ));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/expense-entries/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await queryOne('SELECT date FROM expense_entries WHERE id = ?', [id]);
    await run('DELETE FROM expense_entries WHERE id = ?', [id]);
    if (existing) await syncExpenseTotals(existing.date);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Raporti i Shpenzimeve ────────────────────────────────────
app.get('/api/reports/expenses', async (req, res) => {
  try {
    const { from, to, category_id, currency } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to required' });

    const params = [from, to];
    let where = `e.date BETWEEN ? AND ?`;
    if (category_id) {
      where += ` AND e.category_id = ?`;
      params.push(parseInt(category_id));
    }
    if (currency) {
      where += ` AND COALESCE(e.currency, 'LEK') = ?`;
      params.push(String(currency).toUpperCase());
    }

    const entries = await queryAll(
      `SELECT e.*, c.name AS category_name,
              (COALESCE(e.amount, 0) * COALESCE(e.exchange_rate, 1)) AS total_lek
       FROM expense_entries e
       LEFT JOIN expense_categories c ON c.id = e.category_id
       WHERE ${where}
       ORDER BY e.date ASC, e.id ASC`,
      params
    );

    const rows = entries.map(e => ({
      ...e,
      currency: e.currency || 'LEK',
      amount: +(e.amount || 0),
      exchange_rate: +(e.exchange_rate || 1),
      total_lek: +(e.total_lek || 0),
    }));

    const totals = rows.reduce((a, r) => {
      a.total_lek += r.total_lek;
      a.by_currency[r.currency] = (a.by_currency[r.currency] || 0) + r.amount;
      return a;
    }, { total_lek: 0, by_currency: {} });
    totals.total_lek = +totals.total_lek.toFixed(2);

    // Përmbledhje sipas zërit (kategorisë)
    const byCat = new Map();
    for (const r of rows) {
      const key = r.category_id || 0;
      const name = r.category_name || '(pa zër)';
      const cur = byCat.get(key) || { category_id: key || null, category_name: name, count: 0, total_lek: 0 };
      cur.count += 1;
      cur.total_lek += r.total_lek;
      byCat.set(key, cur);
    }
    const by_category = Array.from(byCat.values())
      .map(c => ({ ...c, total_lek: +c.total_lek.toFixed(2) }))
      .sort((a, b) => b.total_lek - a.total_lek);

    res.json({ rows, totals, by_category });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// SHPENZIME MARKETINGU — të njëjtin flow si shpenzimet ditore
// ============================================================
app.get('/api/marketing-categories', async (req, res) => {
  try {
    const includeInactive = req.query.all === '1';
    const where = includeInactive ? '' : 'WHERE COALESCE(active, 1) = 1';
    res.json(await queryAll(`SELECT * FROM marketing_categories ${where} ORDER BY name COLLATE NOCASE ASC`));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/marketing-categories', async (req, res) => {
  try {
    const { name, description } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
    await run(
      `INSERT INTO marketing_categories (name, description, active) VALUES (?, ?, 1)`,
      [name.trim(), description || '']
    );
    const row = await queryOne('SELECT * FROM marketing_categories ORDER BY id DESC LIMIT 1');
    res.json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/marketing-categories/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, active } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
    await run(
      `UPDATE marketing_categories SET name = ?, description = ?, active = ? WHERE id = ?`,
      [name.trim(), description || '', active === 0 ? 0 : 1, id]
    );
    res.json(await queryOne('SELECT * FROM marketing_categories WHERE id = ?', [id]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/marketing-categories/:id', async (req, res) => {
  try {
    await run('DELETE FROM marketing_categories WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/marketing-entries/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const rows = await queryAll(
      `SELECT m.*, c.name AS category_name,
              (COALESCE(m.amount, 0) * COALESCE(m.exchange_rate, 1)) AS total_lek
       FROM marketing_expenses m
       LEFT JOIN marketing_categories c ON c.id = m.category_id
       WHERE m.date = ?
       ORDER BY m.id ASC`,
      [date]
    );
    const totals = rows.reduce((a, r) => {
      const cur = r.currency || 'LEK';
      a.total_lek += +(r.total_lek || 0);
      a.by_currency[cur] = (a.by_currency[cur] || 0) + (r.amount || 0);
      return a;
    }, { total_lek: 0, by_currency: {} });
    res.json({ rows, totals });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/marketing-entries', async (req, res) => {
  try {
    const { date, category_id, description, currency, amount, exchange_rate } = req.body || {};
    if (!date) return res.status(400).json({ error: 'date required' });
    const cur = pickCurrency(currency);
    const amt = parseFloat(amount) || 0;
    const rate = cur === 'LEK' ? 1 : (parseFloat(exchange_rate) || 0);
    if (cur !== 'LEK' && rate <= 0) return res.status(400).json({ error: 'exchange_rate required for foreign currency' });
    await run(
      `INSERT INTO marketing_expenses (date, category_id, description, currency, amount, exchange_rate,
         amount_lek, amount_eur, amount_usd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        date,
        category_id || null,
        description || '',
        cur, amt, rate,
        cur === 'LEK' ? amt : 0,
        cur === 'EUR' ? amt : 0,
        cur === 'USD' ? amt : 0,
      ]
    );
    const row = await queryOne(
      `SELECT m.*, c.name AS category_name,
              (COALESCE(m.amount, 0) * COALESCE(m.exchange_rate, 1)) AS total_lek
       FROM marketing_expenses m LEFT JOIN marketing_categories c ON c.id = m.category_id
       ORDER BY m.id DESC LIMIT 1`
    );
    res.json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/marketing-entries/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { date, category_id, description, currency, amount, exchange_rate } = req.body || {};
    const existing = await queryOne('SELECT date FROM marketing_expenses WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'not found' });
    const cur = pickCurrency(currency);
    const amt = parseFloat(amount) || 0;
    const rate = cur === 'LEK' ? 1 : (parseFloat(exchange_rate) || 0);
    if (cur !== 'LEK' && rate <= 0) return res.status(400).json({ error: 'exchange_rate required for foreign currency' });
    await run(
      `UPDATE marketing_expenses SET date = ?, category_id = ?, description = ?,
         currency = ?, amount = ?, exchange_rate = ?,
         amount_lek = ?, amount_eur = ?, amount_usd = ?
       WHERE id = ?`,
      [
        date || existing.date,
        category_id || null,
        description || '',
        cur, amt, rate,
        cur === 'LEK' ? amt : 0,
        cur === 'EUR' ? amt : 0,
        cur === 'USD' ? amt : 0,
        id,
      ]
    );
    res.json(await queryOne(
      `SELECT m.*, c.name AS category_name,
              (COALESCE(m.amount, 0) * COALESCE(m.exchange_rate, 1)) AS total_lek
       FROM marketing_expenses m LEFT JOIN marketing_categories c ON c.id = m.category_id
       WHERE m.id = ?`, [id]
    ));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/marketing-entries/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await run('DELETE FROM marketing_expenses WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/reports/marketing', async (req, res) => {
  try {
    const { from, to, category_id, currency } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to required' });

    const params = [from, to];
    let where = `m.date BETWEEN ? AND ?`;
    if (category_id) {
      where += ` AND m.category_id = ?`;
      params.push(parseInt(category_id));
    }
    if (currency) {
      where += ` AND COALESCE(m.currency, 'LEK') = ?`;
      params.push(String(currency).toUpperCase());
    }

    const entries = await queryAll(
      `SELECT m.*, c.name AS category_name,
              (COALESCE(m.amount, 0) * COALESCE(m.exchange_rate, 1)) AS total_lek
       FROM marketing_expenses m
       LEFT JOIN marketing_categories c ON c.id = m.category_id
       WHERE ${where}
       ORDER BY m.date ASC, m.id ASC`,
      params
    );

    const rows = entries.map(e => ({
      ...e,
      currency: e.currency || 'LEK',
      amount: +(e.amount || 0),
      exchange_rate: +(e.exchange_rate || 1),
      total_lek: +(e.total_lek || 0),
    }));

    const totals = rows.reduce((a, r) => {
      a.total_lek += r.total_lek;
      a.by_currency[r.currency] = (a.by_currency[r.currency] || 0) + r.amount;
      return a;
    }, { total_lek: 0, by_currency: {} });
    totals.total_lek = +totals.total_lek.toFixed(2);

    res.json({ rows, totals });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Raport Xhiro Ditore (nga Faturat e Shitjes) ──────────────
app.get('/api/reports/daily-turnover', async (req, res) => {
  try {
    const { to, payment_method, currency } = req.query;
    let { from } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to required' });

    if (req.user?.role === 'sales') {
      const min = new Date(); min.setDate(min.getDate() - 29);
      const minStr = min.toISOString().split('T')[0];
      if (from < minStr) from = minStr;
    }

    const params = [from, to];
    let where = `i.date BETWEEN ? AND ? AND COALESCE(i.cancelled, 0) = 0`;
    if (payment_method) {
      where += ` AND COALESCE(i.payment_method, 'cash') = ?`;
      params.push(payment_method);
    }
    if (currency) {
      where += ` AND COALESCE(i.currency, 'LEK') = ?`;
      params.push(String(currency).toUpperCase());
    }

    const invoices = await queryAll(
      `SELECT
         i.id, i.date, i.invoice_no,
         COALESCE(i.currency, 'LEK')      AS currency,
         COALESCE(i.exchange_rate, 1)     AS exchange_rate,
         COALESCE(i.payment_method, 'cash') AS pm,
         COALESCE(i.is_credit_note, 0)    AS is_credit_note,
         COALESCE(i.subtotal_no_vat, 0)   AS sub,
         COALESCE(i.total_discount, 0)    AS disc,
         COALESCE(i.total_vat, 0)         AS vat,
         COALESCE(i.total_with_vat, 0)    AS tot,
         COALESCE(i.amount_paid, 0)
           - COALESCE((SELECT SUM(amount) FROM invoice_payments WHERE invoice_id = i.id), 0)
           AS init_paid
       FROM invoices i
       WHERE ${where}
       ORDER BY i.date ASC, i.id ASC`,
      params
    );

    // Marr splits për të gjitha faturat në periudhë — pagesa mund të ndahen
    // në disa monedha/mënyra për të njëjtën faturë.
    const splitsByInv = new Map();
    if (invoices.length > 0) {
      const ids = invoices.map(i => i.id);
      const ph = ids.map(() => '?').join(',');
      const splits = await queryAll(
        `SELECT invoice_id,
                COALESCE(method, 'cash') AS method,
                COALESCE(currency, 'LEK') AS currency,
                COALESCE(amount, 0) AS amount,
                COALESCE(exchange_rate, 1) AS exchange_rate
         FROM invoice_payment_splits WHERE invoice_id IN (${ph})`,
        ids
      );
      for (const s of splits) {
        if (!splitsByInv.has(s.invoice_id)) splitsByInv.set(s.invoice_id, []);
        splitsByInv.get(s.invoice_id).push(s);
      }
    }

    // Kursi EUR/LEK: user-provided > kursi më i freskët nga faturat EUR > tabela
    // exchange_rates > 100 (fallback).
    let eurRate = parseFloat(req.query.eur_rate);
    if (!Number.isFinite(eurRate) || eurRate <= 0) {
      const eurInvs = invoices.filter(i => i.currency === 'EUR');
      if (eurInvs.length > 0) {
        eurInvs.sort((a, b) => (a.date < b.date ? 1 : -1));
        eurRate = +eurInvs[0].exchange_rate || 100;
      } else {
        const r = await queryOne(
          `SELECT rate FROM exchange_rates WHERE currency = 'EUR' AND date <= ? ORDER BY date DESC LIMIT 1`,
          [to]
        );
        eurRate = r?.rate ? +r.rate : 100;
      }
    }
    const toEur = (lek) => lek / eurRate;

    const byDate = new Map();

    function ensureDay(date) {
      let d = byDate.get(date);
      if (!d) {
        d = {
          date, count: 0, credit_count: 0,
          gross_eur: 0, disc_eur: 0, sub_eur: 0, vat_eur: 0, tot_eur: 0,
          paid_eur: 0, due_eur: 0,
          cash_eur: 0, pos_eur: 0, bank_eur: 0, debt_eur: 0,
          by_currency: new Map(),
        };
        byDate.set(date, d);
      }
      return d;
    }

    function ensureCur(day, cur) {
      let c = day.by_currency.get(cur);
      if (!c) {
        c = { currency: cur, cash: 0, pos: 0, bank: 0, debt: 0 };
        day.by_currency.set(cur, c);
      }
      return c;
    }

    for (const inv of invoices) {
      const rate = +inv.exchange_rate || 1;
      const day = ensureDay(inv.date);
      day.count += 1;
      if (inv.is_credit_note) day.credit_count += 1;

      // Totalet e faturës → LEK → EUR (bazë).
      const subLek   = inv.sub * rate;
      const discLek  = inv.disc * rate;
      const vatLek   = inv.vat * rate;
      const totLek   = inv.tot * rate;
      const grossLek = (inv.sub + inv.disc) * rate;
      const paidLek  = (inv.init_paid || 0) * rate;
      const dueLek   = totLek - paidLek;
      day.gross_eur += toEur(grossLek);
      day.disc_eur  += toEur(discLek);
      day.sub_eur   += toEur(subLek);
      day.vat_eur   += toEur(vatLek);
      day.tot_eur   += toEur(totLek);
      day.paid_eur  += toEur(paidLek);
      day.due_eur   += toEur(dueLek);

      // Ndarja e pagesave: splits (native currency) kanë prioritet; përndryshe
      // e gjithë vlera i shkon monedhës+mënyrës së faturës.
      const invSplits = splitsByInv.get(inv.id) || [];
      if (invSplits.length > 0) {
        for (const s of invSplits) {
          const c = ensureCur(day, s.currency);
          const method = s.method === 'bank' ? 'bank' : 'cash';
          c[method] += s.amount;
          const splitLek = s.amount * (+s.exchange_rate || 1);
          if (method === 'bank') day.bank_eur += toEur(splitLek);
          else day.cash_eur += toEur(splitLek);
        }
        // Pjesa e pa-paguar (borxhi) i mbetet monedhës së faturës.
        const unpaid = inv.tot - (inv.init_paid || 0);
        if (Math.abs(unpaid) > 0.005) {
          const c = ensureCur(day, inv.currency);
          c.debt += unpaid;
          day.debt_eur += toEur(unpaid * rate);
        }
      } else {
        const c = ensureCur(day, inv.currency);
        if (inv.pm === 'cash')      { c.cash += inv.tot; day.cash_eur += toEur(totLek); }
        else if (inv.pm === 'pos')  { c.pos  += inv.tot; day.pos_eur  += toEur(totLek); }
        else if (inv.pm === 'bank') { c.bank += inv.tot; day.bank_eur += toEur(totLek); }
        else if (inv.pm === 'debt') { c.debt += inv.tot; day.debt_eur += toEur(totLek); }
        else                         { c.cash += inv.tot; day.cash_eur += toEur(totLek); }
      }
    }

    const rows = Array.from(byDate.values())
      .map(d => {
        // Total Cash (EUR) = Total − POS − Bankë − Pa Paguar
        const total_cash_eur = +(d.tot_eur - d.pos_eur - d.bank_eur - d.due_eur).toFixed(2);
        return {
          date: d.date,
          count: d.count,
          credit_count: d.credit_count,
          gross_eur: +d.gross_eur.toFixed(2),
          disc_eur:  +d.disc_eur.toFixed(2),
          sub_eur:   +d.sub_eur.toFixed(2),
          vat_eur:   +d.vat_eur.toFixed(2),
          tot_eur:   +d.tot_eur.toFixed(2),
          paid_eur:  +d.paid_eur.toFixed(2),
          due_eur:   +d.due_eur.toFixed(2),
          cash_eur:  +d.cash_eur.toFixed(2),
          pos_eur:   +d.pos_eur.toFixed(2),
          bank_eur:  +d.bank_eur.toFixed(2),
          debt_eur:  +d.debt_eur.toFixed(2),
          total_cash_eur,
          by_currency: Array.from(d.by_currency.values())
            .map(x => ({
              currency: x.currency,
              cash: +x.cash.toFixed(2),
              pos:  +x.pos.toFixed(2),
              bank: +x.bank.toFixed(2),
              debt: +x.debt.toFixed(2),
            }))
            .filter(x =>
              Math.abs(x.cash) > 0.005 || Math.abs(x.pos) > 0.005 ||
              Math.abs(x.bank) > 0.005 || Math.abs(x.debt) > 0.005
            )
            .sort((a, b) => a.currency.localeCompare(b.currency)),
        };
      })
      .sort((a, b) => (a.date < b.date ? -1 : 1));

    const totals = rows.reduce((a, r) => ({
      count:     a.count     + r.count,
      credit_count: a.credit_count + r.credit_count,
      gross_eur: a.gross_eur + r.gross_eur,
      disc_eur:  a.disc_eur  + r.disc_eur,
      sub_eur:   a.sub_eur   + r.sub_eur,
      vat_eur:   a.vat_eur   + r.vat_eur,
      tot_eur:   a.tot_eur   + r.tot_eur,
      paid_eur:  a.paid_eur  + r.paid_eur,
      due_eur:   a.due_eur   + r.due_eur,
      cash_eur:  a.cash_eur  + r.cash_eur,
      pos_eur:   a.pos_eur   + r.pos_eur,
      bank_eur:  a.bank_eur  + r.bank_eur,
      debt_eur:  a.debt_eur  + r.debt_eur,
      total_cash_eur: a.total_cash_eur + r.total_cash_eur,
    }), {
      count: 0, credit_count: 0,
      gross_eur: 0, disc_eur: 0, sub_eur: 0, vat_eur: 0, tot_eur: 0,
      paid_eur: 0, due_eur: 0,
      cash_eur: 0, pos_eur: 0, bank_eur: 0, debt_eur: 0,
      total_cash_eur: 0,
    });

    // Totale për periudhë sipas monedhës (native).
    const perCurTotals = new Map();
    for (const r of rows) {
      for (const bc of r.by_currency) {
        let t = perCurTotals.get(bc.currency);
        if (!t) {
          t = { currency: bc.currency, cash: 0, pos: 0, bank: 0, debt: 0 };
          perCurTotals.set(bc.currency, t);
        }
        t.cash += bc.cash;
        t.pos  += bc.pos;
        t.bank += bc.bank;
        t.debt += bc.debt;
      }
    }
    const by_currency_totals = Array.from(perCurTotals.values())
      .map(t => ({
        currency: t.currency,
        cash: +t.cash.toFixed(2),
        pos:  +t.pos.toFixed(2),
        bank: +t.bank.toFixed(2),
        debt: +t.debt.toFixed(2),
      }))
      .sort((a, b) => a.currency.localeCompare(b.currency));

    res.json({
      rows, totals, by_currency_totals,
      eur_rate: +eurRate.toFixed(4),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// STATIC FRONTEND (only in production — dev uses Vite dev server)
// ============================================================
// When packaged inside Electron, the built React app lives in ../dist and is
// served from the same origin as the API so relative `/api/*` paths work with
// no proxy. In dev (`npm run dev`), Vite serves the frontend and proxies /api
// to this server; the block below is a no-op because dist/ doesn't exist yet.
const distDir = path.join(__dirname, '..', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^\/(?!api|uploads).*/, (req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

// ============================================================
// START SERVER (HTTP + WebSocket on the same port)
// ============================================================
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
const httpServer = http.createServer(app);

// WebSocket endpoint. Vite dev proxy needs to forward /ws with ws: true — see
// vite.config.js. In production the Electron window loads over the same origin.
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
wss.on('connection', (ws) => {
  wsClients.add(ws);
  ws.on('close', () => wsClients.delete(ws));
  ws.on('error', () => wsClients.delete(ws));
  try { ws.send(JSON.stringify({ type: 'hello', at: Date.now() })); } catch (_) {}
});

httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT} (ws on /ws)`);
});
