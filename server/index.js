import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import http from 'http';
import https from 'https';
import net from 'net';
import dns from 'dns/promises';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import {
  initDB, queryAll, queryOne, run, batchWrite, exportDB,
  isUniqueViolation, retryOnUniqueNo,
} from './db.js';
import { cache, cached } from './cache.js';

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

// Në production paketimi vendos server-in brenda app.asar (read-only). Përdor
// UPLOAD_DIR nga Electron (te userData) nëse është dhënë; përndryshe fallback
// te folderi lokal (për dev).
const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads', 'products');
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
    'safe-deposits': 'safe_deposits',
    'bank-movements': 'bank_movements',
    'workers': 'workers',
    'worker-payments': 'worker_payments',
    'kasaforta': 'daily_records',
    'flete-hyrje': 'flete_hyrje',
    'flete-dalje': 'flete_dalje',
    'magazina-hyrje': 'magazina_hyrje',
    'magazina-dalje': 'magazina_dalje',
    'invoice-payments': 'invoice_payments',
    'purchase-payments': 'purchase_payments',
    'comments': 'comments',
    'repairs': 'repairs',
    'porosi': 'porosi',
    'porosi-deposits': 'porosi_deposits',
  };
  return map[seg] || null;
}
// Cache in-memory për endpoint-e "të njëjtë për të gjithë klientët" që bëjnë
// JOIN të shtrenjtë mbi historikun (p.sh. /api/inventory-summary). Invalidohet
// automatikisht nga middleware-i broadcast më poshtë kur preket një tabelë që
// prek rezultatin. Kur 3 PC-të hapin Dashboard-in njëkohësisht, vetëm 1 kalkulim
// del te Turso; të tjerët marrin nga memoria.
const responseCache = new Map(); // key: `${endpoint}:${queryString}` → { at, data, ttlMs }
function cacheGet(key) {
  const e = responseCache.get(key);
  if (!e) return null;
  if (Date.now() - e.at > e.ttlMs) { responseCache.delete(key); return null; }
  return e.data;
}
function cacheSet(key, data, ttlMs = 60_000) {
  responseCache.set(key, { at: Date.now(), data, ttlMs });
}
function cacheInvalidate(prefix) {
  for (const k of responseCache.keys()) {
    if (k.startsWith(prefix)) responseCache.delete(k);
  }
}
// Tabela që ndikojnë te /api/inventory-summary (stok, blerje, shitje, magazina).
const INVENTORY_SUMMARY_TABLES = new Set([
  'products', 'purchase_invoices', 'invoices',
  'magazina_hyrje', 'magazina_dalje',
  'flete_hyrje', 'flete_dalje',
]);

app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const origJson = res.json.bind(res);
  res.json = (data) => {
    const ret = origJson(data);
    if (res.statusCode < 300) {
      const table = tableFromPath(req.path);
      if (table) {
        broadcast({ type: 'change', table, action: req.method, at: Date.now() });
        // Invalido cache-in për endpoint-e që varen nga kjo tabelë.
        if (INVENTORY_SUMMARY_TABLES.has(table)) {
          cacheInvalidate('inventory-summary:');
        }
      }
    }
    return ret;
  };
  next();
});

// Nis DB init në sfond — MOS `await` këtu që porti të hapet menjëherë dhe
// Electron `waitForServer()` të kalojë brenda millisekondave. Middleware-i
// më poshtë e mban /api/* në pritje derisa init të mbarojë. Kjo shmang
// dialogun "Server-i nuk u nis" kur Turso është i ngadaltë (portable/USB).
let dbReady = false;
let dbError = null;
let dbReadyPromise = null;
let dbDiagnostic = { stage: 'idle', dns: null, tcp: null, tls: null, http: null, attempts: 0 };
const DB_INIT_TIMEOUT_MS = 60_000;
const DB_INIT_MAX_RETRIES = 3;

// Diagnostikë shtresore për të identifikuar SAKTËSISHT ku bllokohet lidhja me
// Turso: DNS resolve → TCP connect → TLS handshake → HTTP POST. Kthen një objekt
// me statusin e çdo shtrese që të shfaqet te splash-i.
async function probeTursoConnectivity() {
  const out = { stage: 'starting', dns: null, tcp: null, tls: null, http: null };
  const tursoUrl = process.env.TURSO_URL || '';
  const tursoToken = process.env.TURSO_TOKEN || '';
  const host = tursoUrl.replace(/^(libsql|https?):\/\//, '').split('/')[0];
  if (!host) {
    out.stage = 'config';
    out.error = 'TURSO_URL mungon te .env';
    return out;
  }

  // 1) DNS
  out.stage = 'dns';
  try {
    const addrs = await Promise.race([
      dns.lookup(host, { all: true }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
    ]);
    out.dns = { ok: true, addresses: addrs.map(a => a.address) };
  } catch (err) {
    out.dns = { ok: false, error: err.message };
    out.error = `DNS s'e zgjidhi dot ${host}: ${err.message}`;
    return out;
  }

  // 2) TCP
  out.stage = 'tcp';
  const tcpResult = await new Promise((resolve) => {
    const sock = net.createConnection({ host, port: 443 });
    const tim = setTimeout(() => { sock.destroy(); resolve({ ok: false, error: 'timeout pas 5s' }); }, 5000);
    sock.once('connect', () => { clearTimeout(tim); sock.end(); resolve({ ok: true }); });
    sock.once('error', (err) => { clearTimeout(tim); resolve({ ok: false, error: err.message }); });
  });
  out.tcp = tcpResult;
  if (!tcpResult.ok) {
    out.error = `TCP dështoi drejt ${host}:443 — ${tcpResult.error}. Firewall/router po e bllokon.`;
    return out;
  }

  // 3) TLS + 4) HTTP (bashkë përmes një POST-i të vërtetë)
  out.stage = 'http';
  const httpResult = await new Promise((resolve) => {
    const req = https.request({
      host, port: 443, path: '/v2/pipeline', method: 'POST',
      headers: {
        'Authorization': `Bearer ${tursoToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 10_000,
    }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ ok: res.statusCode < 500, status: res.statusCode, body: body.slice(0, 200) }));
    });
    req.on('error', (err) => resolve({ ok: false, error: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'HTTP timeout pas 10s' }); });
    req.write(JSON.stringify({ requests: [{ type: 'execute', stmt: { sql: 'SELECT 1' } }] }));
    req.end();
  });
  out.tls = { ok: httpResult.ok || httpResult.status != null };
  out.http = httpResult;
  if (!httpResult.ok) {
    out.error = httpResult.error
      ? `TLS/HTTP dështoi: ${httpResult.error}`
      : `Turso përgjigjet HTTP ${httpResult.status}: ${httpResult.body}`;
    return out;
  }
  out.stage = 'done';
  return out;
}

async function kickoffDbInit() {
  dbReady = false;
  dbError = null;
  for (let attempt = 1; attempt <= DB_INIT_MAX_RETRIES; attempt++) {
    dbDiagnostic = { ...dbDiagnostic, stage: 'probe', attempts: attempt };
    const probe = await probeTursoConnectivity();
    dbDiagnostic = { ...probe, attempts: attempt };
    if (!probe.error) {
      // Konektiviteti OK — provo init-in aktual.
      dbDiagnostic.stage = 'init';
      try {
        await Promise.race([
          initDB(),
          new Promise((_, rej) => setTimeout(
            () => rej(new Error(`Init timeout pas ${DB_INIT_TIMEOUT_MS / 1000}s`)),
            DB_INIT_TIMEOUT_MS
          )),
        ]);
        dbReady = true;
        dbError = null;
        dbDiagnostic.stage = 'ready';
        // Pastro produktet "jetim" të mbetura nga fshirje faturash para v1.2.0.
        // I sigurt sepse fshin vetëm produktet pa asnjë referencë blerjeje/shitjeje.
        try {
          const res = await run(
            `DELETE FROM products
              WHERE NOT EXISTS (SELECT 1 FROM purchase_items pit WHERE pit.product_id = products.id)
                AND NOT EXISTS (SELECT 1 FROM invoice_items  ii  WHERE ii.product_id  = products.id)`
          );
          const n = res?.rowsAffected ?? res?.rows_affected ?? 0;
          if (n > 0) console.log(`[startup cleanup] u fshinë ${n} produkte jetim`);
        } catch (e) {
          console.warn('[startup cleanup] dështoi pastrimi i produkteve jetim:', e.message);
        }
        return;
      } catch (err) {
        dbError = err;
        dbDiagnostic.stage = 'init_failed';
        dbDiagnostic.error = err.message;
        console.error(`[db init attempt ${attempt}/${DB_INIT_MAX_RETRIES} failed]`, err.message);
      }
    } else {
      dbError = new Error(probe.error);
      console.error(`[db probe attempt ${attempt}/${DB_INIT_MAX_RETRIES}]`, probe.error);
    }
    if (attempt < DB_INIT_MAX_RETRIES) {
      const backoffMs = 3000 * attempt;
      await new Promise(r => setTimeout(r, backoffMs));
    }
  }
}
dbReadyPromise = kickoffDbInit();

// Health check — hapet menjëherë, s'ka nevojë për DB. Electron e përdor
// për të konfirmuar që porti është hapur. Splash-i lexon `diagnostic` që të
// tregojë shtresat DNS/TCP/TLS/HTTP.
app.get('/healthz', (req, res) => {
  res.json({
    ok: true,
    dbReady,
    error: dbError ? String(dbError.message || dbError) : null,
    diagnostic: dbDiagnostic,
  });
});

// Riprovo init-in pa restart. E vendosim JASHTË /api/* middleware-it që të
// mos bllokohet vetë kur dbError është aktive. Frontend-i e thërret nga
// butoni "🔄 Provo Përsëri" te splash-i.
app.post('/reinit', (req, res) => {
  if (dbReady) return res.json({ ok: true, message: 'already_ready' });
  dbReadyPromise = kickoffDbInit();
  res.json({ ok: true, message: 'reinit_triggered' });
});

// Bllokon çdo /api/* derisa initDB të mbarojë. Kur mbaron, kalon tutje.
app.use('/api', async (req, res, next) => {
  if (dbReady) return next();
  if (dbError) return res.status(503).json({ error: 'db_init_failed', detail: String(dbError.message || dbError) });
  try {
    await dbReadyPromise;
    if (dbError) return res.status(503).json({ error: 'db_init_failed', detail: String(dbError.message || dbError) });
    next();
  } catch (err) {
    res.status(503).json({ error: 'db_init_failed', detail: String(err?.message || err) });
  }
});

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
  /^\/api\/marketing-contracts/,
  /^\/api\/marketing-contract-entries/,
  // Kategoritë e materialit (Fatura Blerje) — admin
  /^\/api\/material-categories/,
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
  // Shpenzime ditore — shitësi mund të shtojë, editojë dhe fshijë
  // shpenzime dhe zëra (veprim i përditshëm në dyqan, jo administrativ).
  { method: 'POST',   pattern: /^\/api\/expense-entries$/ },
  { method: 'PUT',    pattern: /^\/api\/expense-entries\/\d+$/ },
  { method: 'DELETE', pattern: /^\/api\/expense-entries\/\d+$/ },
  { method: 'POST',   pattern: /^\/api\/expense-categories$/ },
  { method: 'PUT',    pattern: /^\/api\/expense-categories\/\d+$/ },
  { method: 'DELETE', pattern: /^\/api\/expense-categories\/\d+$/ },
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
  // Arka Ditore — gjendja fizike + mbyllja e ditës (veprim ditor i shitësit)
  { method: 'POST', pattern: /^\/api\/arka-ditore\/[\d-]+\/physical$/ },
  { method: 'POST', pattern: /^\/api\/arka-ditore\/[\d-]+\/closeout$/ },
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

// Endpoint i lehtë për poll — kthen vetëm MAX(id). Përdoret nga
// useUnreadCommentsCount që të mos bëjë fetch të plotë të LIMIT 500 çdo poll:
// klienti krahason latestId me atë të fundit të njohur; fetch të plotë vetëm
// kur ndryshon. 1 rresht/poll në vend të ~200-500 rreshtave.
app.get('/api/comments/latest-id', async (req, res) => {
  try {
    const row = await queryOne('SELECT COALESCE(MAX(id), 0) AS id FROM comments');
    res.json({ id: row?.id || 0 });
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

// ── Invalidim automatik i cache-it pas shkrimeve.
// Cdo path që fillon me një çelës cache invalidon vetëm atë prefiks.
// Prekjet indirekte (purchase-invoices krijojnë/përditësojnë produkte,
// invoices ulin stokun) invalidojnë cache-in 'products'.
const CACHE_INVALIDATION_RULES = [
  { pathRe: /^\/api\/(products|purchase-invoices|invoices|magazina-|flete-|hurda-purchases|has-purchases)/, keys: ['products'] },
  { pathRe: /^\/api\/expense-categories/, keys: ['expense-categories'] },
  { pathRe: /^\/api\/suppliers/,          keys: ['suppliers'] },
  { pathRe: /^\/api\/clients/,            keys: ['clients'] },
];
app.use('/api', (req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const fullPath = (req.baseUrl || '') + req.path;
    const keysToInvalidate = new Set();
    for (const rule of CACHE_INVALIDATION_RULES) {
      if (rule.pathRe.test(fullPath)) rule.keys.forEach(k => keysToInvalidate.add(k));
    }
    if (keysToInvalidate.size > 0) {
      res.on('finish', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          for (const k of keysToInvalidate) cache.invalidate(k);
        }
      });
    }
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
    const giftsOnly = req.query.gifts_only === '1' || req.query.gifts_only === 'true';
    // Gjatë përzgjedhjes së Dhuratës në Fatura Shitje, lejoj kërkim bosh që
    // të shfaqet lista e plotë e produkteve dhuratë me stok > 0.
    if (!q && !giftsOnly) return res.json([]);
    const like = `%${q}%`;
    const giftClause = giftsOnly ? ' AND is_gift = 1 AND stock > 0' : '';
    const searchClause = q
      ? ' AND (barcode LIKE ? OR sku LIKE ? OR name LIKE ? OR serial_no LIKE ?)'
      : '';
    const orderClause = q
      ? 'ORDER BY (CASE WHEN barcode = ? THEN 0 WHEN sku = ? THEN 1 WHEN serial_no = ? THEN 2 ELSE 3 END), name'
      : 'ORDER BY name';
    const params = [];
    if (q) params.push(like, like, like, like);
    if (q) params.push(q, q, q);
    const rows = await queryAll(
      `SELECT id, name, sku, barcode, category, sell_price, cost_price, vat_rate, stock, image_path, gram,
              is_promotion, promo_discount_pct, serial_no, purchase_price_no_vat,
              has_gram, has_currency, has_rate,
              kodi, koeficent_pune, multiplier, sell_rate,
              is_gift
         FROM products
        WHERE active = 1${giftClause}${searchClause}
        ${orderClause}
        LIMIT 30`,
      params
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
    // Memory cache 30s: endpoint më hot i sistemit, thirret nga picker-i i
    // produkteve në çdo faturë + Products list + Inventory + shumë vende të
    // tjera. Cache invalidohet nga çdo POST/PUT/DELETE që prek 'products'.
    const rows = await cached('products:all', 30_000, () => queryAll(
      `SELECT * FROM products
        WHERE active = 1
        ORDER BY category, name`
    ));
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// updated_at is a millisecond timestamp used for optimistic locking on
// concurrent product edits. INSERT and UPDATE both stamp `now`, so a client
// that PUTs with a stale value gets a 409 and can re-fetch.
const NOW_TS_SQL = "strftime('%Y-%m-%d %H:%M:%f','now')";

// Karat → kodi flori (fineness në pjesë për mijë). Përdoret në formulën:
// has_gram = (kodi/1000) × gram (sasi ari e pastër në gramë).
const KARAT_TO_KODI = { 8: 333, 9: 375, 10: 417, 12: 500, 14: 585, 18: 750, 21: 875, 22: 916, 24: 999 };

// Fallback: kur importi nga Excel s'ka kolonën "Kodi" (ose ka vlerë joreale),
// nxjerre nga emri i produktit që zakonisht përmban p.sh. "18K", "14K".
function inferKodiFromName(name) {
  if (!name) return 0;
  const m = String(name).match(/\b(\d{1,2})\s*[Kk]\b/);
  if (!m) return 0;
  return KARAT_TO_KODI[parseInt(m[1], 10)] || 0;
}

app.post('/api/products', async (req, res) => {
  try {
    const d = req.body;
    const promoPct = d.is_promotion
      ? Math.max(0, Math.min(100, parseFloat(d.promo_discount_pct) || 0))
      : 0;
    await run(
      `INSERT INTO products (name, sku, barcode, category, brand, description, cost_price, sell_price, stock, min_stock, vat_rate, unit, is_promotion, promo_discount_pct, gram, serial_no, purchase_price_no_vat, has_gram, has_currency, has_rate, has_rate_currency, kodi, koeficent_pune, multiplier, sell_rate, sell_rate_currency, is_gift, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${NOW_TS_SQL})`,
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
        parseFloat(d.has_gram) || 0,
        d.has_currency || 'HAS',
        parseFloat(d.has_rate) || 0,
        d.has_rate_currency === 'USD' ? 'USD' : 'EUR',
        parseFloat(d.kodi) || 0,
        parseFloat(d.koeficent_pune) || 0,
        parseFloat(d.multiplier) || 0,
        parseFloat(d.sell_rate) || 0,
        d.sell_rate_currency === 'USD' ? 'USD' : 'EUR',
        d.is_gift ? 1 : 0,
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
           has_gram=?, has_currency=?, has_rate=?, has_rate_currency=?,
           kodi=?, koeficent_pune=?, multiplier=?, sell_rate=?, sell_rate_currency=?,
           is_gift=?,
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
        parseFloat(d.has_gram) || 0,
        d.has_currency || 'HAS',
        parseFloat(d.has_rate) || 0,
        d.has_rate_currency === 'USD' ? 'USD' : 'EUR',
        parseFloat(d.kodi) || 0,
        parseFloat(d.koeficent_pune) || 0,
        parseFloat(d.multiplier) || 0,
        parseFloat(d.sell_rate) || 0,
        d.sell_rate_currency === 'USD' ? 'USD' : 'EUR',
        d.is_gift ? 1 : 0,
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
    // Regjistër i dublikatave — çfarë (barkodi, SKU, ose serial) përplaset me
    // një rresht të mëparshëm. Frontend-i i shfaq që user-i të gjejë rreshtin
    // problematik në Excel dhe ta rregullojë.
    const duplicates = [];
    for (const d of products) {
      if (!d.name || !String(d.name).trim()) { ids.push(null); continue; }
      const barcode   = String(d.barcode || '').trim();
      const sku       = String(d.sku || '').trim();
      const serial_no = String(d.serial_no || '').trim();
      // Reuse existing product if barcode / serial / SKU matches — otherwise
      // repeat imports create duplicate rows. Stock/cost nuk mbishkruhen këtu;
      // për invoice-based updates ekziston flow-i i faturës që i menaxhon.
      let existing = null;
      let matchedBy = '';
      if (barcode)              { existing = await queryOne('SELECT id FROM products WHERE barcode = ? LIMIT 1', [barcode]); if (existing) matchedBy = `barkodi "${barcode}"`; }
      if (!existing && serial_no) { existing = await queryOne('SELECT id FROM products WHERE serial_no = ? LIMIT 1', [serial_no]); if (existing) matchedBy = `serial "${serial_no}"`; }
      if (!existing && sku)     { existing = await queryOne('SELECT id FROM products WHERE sku = ? LIMIT 1', [sku]); if (existing) matchedBy = `SKU "${sku}"`; }
      if (existing) {
        await run('UPDATE products SET active = 1 WHERE id = ?', [existing.id]);
        ids.push(existing.id);
        matched++;
        // Gjej faturën e fundit të blerjes që përmban këtë produkt — që user-i
        // të dijë "ky produkt është përdorur tashmë te B2025-XXXXX".
        const inv = await queryOne(
          `SELECT pi.invoice_no, pi.date
             FROM purchase_items pit
             JOIN purchase_invoices pi ON pi.id = pit.purchase_id
            WHERE pit.product_id = ?
            ORDER BY pi.date DESC, pi.id DESC LIMIT 1`,
          [existing.id],
        );
        duplicates.push({
          name: String(d.name).trim(),
          matchedBy,
          existingInvoiceNo: inv?.invoice_no || '',
          existingInvoiceDate: inv?.date || '',
        });
        continue;
      }
      await run(
        `INSERT INTO products (name, sku, barcode, category, brand, description,
           cost_price, sell_price, stock, min_stock,
           serial_no, purchase_price_no_vat, vat_rate, unit, gram,
           kodi, has_gram, has_rate, has_currency)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          (parseInt(d.kodi) || 0) || inferKodiFromName(d.name),
          parseFloat(d.has_gram) || 0,
          parseFloat(d.has_rate) || 0,
          'HAS',
        ]
      );
      const row = await queryOne('SELECT last_insert_rowid() AS id');
      ids.push(row?.id || null);
      imported++;
    }
    res.json({ success: true, imported, matched, ids, duplicates });
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
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ChamShopApp/1.0)' },
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
    // Memory cache 10min: kurset e datës nuk ndryshojnë brenda ditës.
    const payload = await cached(`exchange-rates:${date}`, 600_000, async () => {
      const dbRows = await queryAll('SELECT currency, rate, source FROM exchange_rates WHERE date = ?', [date]);
      let rates = {};
      let source = 'cache';
      if (dbRows.length >= SUPPORTED_CURRENCIES.length) {
        for (const r of dbRows) rates[r.currency] = r.rate;
        source = dbRows[0].source || 'cache';
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
      return { date, rates, source };
    });
    res.json(payload);
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
  const prefix = `${year}-`;
  // MAX i numrit ekzistues + 1 (jo COUNT) — që fshirja e një fature të mos
  // rikthejë një numër që tashmë ekziston, duke shkaktuar UNIQUE constraint fail.
  // Number(...) është i domosdoshëm: libSQL kthen aggregate-e si string/BigInt
  // sipas driver-it → pa cast, "29" + 1 = "291" (bashkim stringu).
  const row = await queryOne(
    `SELECT MAX(CAST(SUBSTR(invoice_no, ${prefix.length + 1}) AS INTEGER)) AS max_no
       FROM invoices
      WHERE invoice_no LIKE ?`,
    [`${prefix}%`],
  );
  const next = Number(row?.max_no || 0) + 1;
  return `${prefix}${String(next).padStart(5, '0')}`;
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

// Total gram (peshë) i artikujve për faturë shitje. invoice_items s'ka
// kolonë gram, kështu që bashkohet me products për të marrë pesha aktuale.
// Kur ka material filter, numërohen vetëm artikujt e produkteve me atë material.
function salesGramSubquery(material) {
  const matClause = (material && String(material).trim())
    ? `AND COALESCE(xp3.material,'') = ?`
    : '';
  const sql = `(SELECT COALESCE(SUM(COALESCE(xp3.gram, 0) * COALESCE(xii2.qty, 0)), 0)
     FROM invoice_items xii2
     LEFT JOIN products xp3 ON xp3.id = xii2.product_id
     WHERE xii2.invoice_id = i.id ${matClause}) AS total_gram`;
  const params = matClause ? [String(material).trim()] : [];
  return { sql, params };
}

// Kosto totale e faturës (në monedhën e faturës) = SUM(qty * products.cost_price).
// Përdoret për të llogaritur Fitim & Marzh në listën e faturave. Përputhet me
// konvencionin e /api/inventory-summary → profitByCurrency (pa konvertim LEK).
function salesCostSubquery() {
  return `(SELECT COALESCE(SUM(COALESCE(xii3.qty,0) * COALESCE(xp4.cost_price,0)), 0)
     FROM invoice_items xii3
     LEFT JOIN products xp4 ON xp4.id = xii3.product_id
     WHERE xii3.invoice_id = i.id AND xii3.product_id IS NOT NULL) AS total_cost`;
}

app.get('/api/invoices/by-date/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const { material, category, online, status } = req.query;
    const filter = buildItemFilterSQL(material, category);
    const onl = buildOnlineFilter(online, status);
    const gram = salesGramSubquery(material);
    const rows = await queryAll(
      `SELECT i.*,
         (i.amount_paid - COALESCE((SELECT SUM(amount) FROM invoice_payments WHERE invoice_id = i.id), 0)) AS initial_amount_paid,
         (SELECT GROUP_CONCAT(barcode, '|') FROM invoice_items WHERE invoice_id = i.id AND barcode IS NOT NULL AND barcode <> '') AS barcodes,
         (SELECT GROUP_CONCAT(method || ':' || COALESCE(currency,'') || ':' || COALESCE(amount,0), '|')
            FROM invoice_payment_splits WHERE invoice_id = i.id) AS splits_summary,
         ${gram.sql},
         ${salesCostSubquery()}
       FROM invoices i WHERE i.date = ? ${filter.sql} ${onl.sql} ORDER BY i.id ASC`,
      [...gram.params, date, ...filter.params, ...onl.params]
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
    const gram = salesGramSubquery(material);
    const rows = await queryAll(
      `SELECT i.*,
         (i.amount_paid - COALESCE((SELECT SUM(amount) FROM invoice_payments WHERE invoice_id = i.id), 0)) AS initial_amount_paid,
         (SELECT GROUP_CONCAT(barcode, '|') FROM invoice_items WHERE invoice_id = i.id AND barcode IS NOT NULL AND barcode <> '') AS barcodes,
         (SELECT GROUP_CONCAT(method || ':' || COALESCE(currency,'') || ':' || COALESCE(amount,0), '|')
            FROM invoice_payment_splits WHERE invoice_id = i.id) AS splits_summary,
         ${gram.sql},
         ${salesCostSubquery()}
       FROM invoices i WHERE i.date BETWEEN ? AND ? ${filter.sql} ${onl.sql} ORDER BY i.date ASC, i.id ASC`,
      [...gram.params, from, to, ...filter.params, ...onl.params]
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
    // Backdating (data më e vjetër se sot) lejohet vetëm për admin. Sales lejohet
    // vetëm data e sotme — përndryshe do të kalonin shitje ditore në ditë të gabuara.
    if (req.user?.role !== 'admin' && date !== new Date().toISOString().slice(0, 10)) {
      return res.status(403).json({ error: 'only admin can set a non-today date' });
    }
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
    // Nëse dy PC-ja bëjnë race, UNIQUE indeksi mbi invoice_no bën që një INSERT
    // të dështojë. retryOnUniqueNo provon numrin që klienti dërgoi si fillestar
    // (auto nga /next-no) dhe, në rast përplasje, kalon te një numër i freskët
    // — që user-i të mos shohë kurrë SQLITE_CONSTRAINT.
    const invoice_no = await retryOnUniqueNo(
      () => nextInvoiceNo(date),
      doInsertInvoice,
      5,
      userProvidedNo || null,
    );
    const invoice = await queryOne('SELECT id FROM invoices WHERE date = ? AND invoice_no = ?', [date, invoice_no]);
    const invoiceId = invoice?.id;
    for (const it of items) {
      await run(
        `INSERT INTO invoice_items (invoice_id, product_id, serial_no, barcode, name, qty, gram, unit_price_no_vat,
          discount_percent, subtotal_no_vat, vat_rate, vat_amount, total_with_vat,
          on_promotion, promo_discount_pct, sell_rate, has_gram, multiplier, is_gift)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          invoiceId, it.product_id || null, it.serial_no || '', it.barcode || '', it.name || '',
          it.qty, parseFloat(it.gram) || 0, it.unit_price_no_vat, it.discount_percent,
          it.subtotal_no_vat, it.vat_rate, it.vat_amount, it.total_with_vat,
          it.on_promotion ? 1 : 0, parseFloat(it.promo_discount_pct) || 0,
          parseFloat(it.sell_rate) || 0,
          parseFloat(it.has_gram) || 0, parseFloat(it.multiplier) || 0,
          it.is_gift ? 1 : 0,
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
    // Sales nuk mund ta ndryshojë datën e faturës (nga sot në një ditë tjetër),
    // dhe as të mbajë të vjetër një datë të vjetër. Vetëm admin ka të drejtë.
    if (req.user?.role !== 'admin') {
      const today = new Date().toISOString().slice(0, 10);
      if (d.date && d.date !== today) {
        return res.status(403).json({ error: 'only admin can set a non-today date' });
      }
    }
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
          on_promotion, promo_discount_pct, sell_rate, has_gram, multiplier, is_gift)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, it.product_id || null, it.serial_no || '', it.barcode || '', it.name || '',
          it.qty, parseFloat(it.gram) || 0, it.unit_price_no_vat, it.discount_percent,
          it.subtotal_no_vat, it.vat_rate, it.vat_amount, it.total_with_vat,
          it.on_promotion ? 1 : 0, parseFloat(it.promo_discount_pct) || 0,
          parseFloat(it.sell_rate) || 0,
          parseFloat(it.has_gram) || 0, parseFloat(it.multiplier) || 0,
          it.is_gift ? 1 : 0,
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

// ============================================================
// CREDIT NOTES — listë e kthimeve për menaxhim admin
// ============================================================
// Listim i faturave kreditore me filtra date + search. Përdoret nga UI e
// Kthim Shitjeve (admin-only) për të parë historikun, ndryshuar datën, ose
// fshirë kthime të bëra gabimisht.
app.get('/api/credit-notes', async (req, res) => {
  try {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
    const { from, to, q, limit } = req.query;
    const params = [];
    let where = 'cn.is_credit_note = 1';
    if (from) { where += ' AND cn.date >= ?'; params.push(from); }
    if (to)   { where += ' AND cn.date <= ?'; params.push(to); }
    if (q) {
      const like = `%${String(q).toLowerCase()}%`;
      where += ' AND (LOWER(cn.invoice_no) LIKE ? OR LOWER(cn.customer_name) LIKE ? OR LOWER(orig.invoice_no) LIKE ?)';
      params.push(like, like, like);
    }
    const lim = Math.min(parseInt(limit) || 200, 500);
    const rows = await queryAll(
      `SELECT cn.id, cn.date, cn.invoice_no, cn.customer_name, cn.currency,
              cn.total_with_vat, cn.amount_paid, cn.payment_method,
              cn.paid_cash, cn.paid_bank, cn.paid_pos,
              cn.parent_invoice_id, cn.notes, cn.created_at,
              orig.invoice_no AS parent_invoice_no,
              orig.date       AS parent_invoice_date,
              (SELECT COUNT(*) FROM invoice_items ii WHERE ii.invoice_id = cn.id) AS items_count,
              (SELECT COALESCE(SUM(ABS(ii.qty)), 0) FROM invoice_items ii WHERE ii.invoice_id = cn.id) AS qty_total
         FROM invoices cn
         LEFT JOIN invoices orig ON orig.id = cn.parent_invoice_id
        WHERE ${where}
        ORDER BY cn.date DESC, cn.id DESC
        LIMIT ${lim}`,
      params
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Detajet e artikujve për një kreditore — për tooltip / preview në UI.
app.get('/api/credit-notes/:id/items', async (req, res) => {
  try {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
    const { id } = req.params;
    const cn = await queryOne('SELECT id FROM invoices WHERE id = ? AND is_credit_note = 1', [id]);
    if (!cn) return res.status(404).json({ error: 'not found' });
    const items = await queryAll(
      `SELECT id, name, barcode, qty, total_with_vat
         FROM invoice_items WHERE invoice_id = ? ORDER BY id`,
      [id]
    );
    res.json(items);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Ndrysho vetëm datën e një fature (kryesisht për kreditoret që janë bërë me
// datën e gabuar). Admin-only. Nuk prek artikujt, pagesat, stokun — vetëm
// zhvendos regjistrimin te një ditë tjetër (që reflektohet te Arka Ditore
// e datës së re dhe zhduket nga ajo e datës së vjetër).
app.patch('/api/invoices/:id/date', async (req, res) => {
  try {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
    const { id } = req.params;
    const newDate = String(req.body?.date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
      return res.status(400).json({ error: 'date duhet formati YYYY-MM-DD' });
    }
    const inv = await queryOne('SELECT id, date FROM invoices WHERE id = ?', [id]);
    if (!inv) return res.status(404).json({ error: 'not found' });
    if (inv.date === newDate) return res.json({ success: true, unchanged: true });
    await run('UPDATE invoices SET date = ? WHERE id = ?', [newDate, id]);
    res.json({ success: true, old_date: inv.date, new_date: newDate });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Krijo Faturë Kreditore (me minus). Suporton dy modalitete:
//  - Kthim i plotë (default): mirror i të gjithë artikujve me sasi negative
//  - Kthim i pjesshëm: në body dërgohet `items: [{ item_id, qty }]` — kreditorja
//    krijohet vetëm me ato rreshta të zgjedhur (me sasinë e specifikuar).
//    Refund i pagesave (paid_cash/bank + splits) shkallëzohet proporcionalisht
//    sipas raportit total_i_kthyer / total_origjinal.
// GET — kërko produkte të shitura sipas barkodit ose emrit. Kthen rreshtat
// e faturave të shitjes që përputhen, me qty_returned_so_far dhe qty_remaining
// të llogaritur nga kreditoret (invoices me is_credit_note=1 dhe parent_invoice_id
// që tregon origjinalin). Përdoret te faqja "Kthim Produkt".
app.get('/api/sales/items/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json([]);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const like = `%${q.toLowerCase()}%`;

    // Pa cutoff date — bizhutë kthehen edhe pas 1-2 vitesh; filtri LIKE
    // + LIMIT-i mjaftojnë për performancën.
    const rows = await queryAll(
      `SELECT ii.id AS item_id, ii.invoice_id, ii.product_id, ii.barcode, ii.name,
              ii.qty, ii.gram, ii.unit_price_no_vat, ii.discount_percent, ii.vat_rate,
              ii.subtotal_no_vat, ii.vat_amount, ii.total_with_vat,
              inv.invoice_no, inv.date AS invoice_date, inv.customer_name,
              inv.currency, inv.payment_method,
              COALESCE((
                SELECT SUM(ABS(cnii.qty))
                  FROM invoice_items cnii
                  JOIN invoices cninv ON cninv.id = cnii.invoice_id
                 WHERE cninv.parent_invoice_id = inv.id
                   AND cninv.is_credit_note = 1
                   AND (
                     (cnii.product_id IS NOT NULL AND cnii.product_id = ii.product_id)
                     OR (cnii.product_id IS NULL AND LOWER(cnii.name) = LOWER(ii.name))
                   )
              ), 0) AS qty_returned_so_far
         FROM invoice_items ii
         JOIN invoices inv ON inv.id = ii.invoice_id
        WHERE COALESCE(inv.is_credit_note, 0) = 0
          AND COALESCE(inv.cancelled, 0) = 0
          AND ii.qty > 0
          AND (
            LOWER(ii.barcode) LIKE ?
            OR LOWER(ii.name) LIKE ?
          )
        ORDER BY inv.date DESC, inv.id DESC, ii.id DESC
        LIMIT ?`,
      [like, like, limit]
    );

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const enriched = rows.map(r => {
      const qtyOrig = Math.abs(parseFloat(r.qty) || 0);
      const returned = parseFloat(r.qty_returned_so_far) || 0;
      const remaining = Math.max(0, +(qtyOrig - returned).toFixed(4));
      const invDate = r.invoice_date ? new Date(r.invoice_date + 'T00:00:00') : null;
      const daysSince = invDate
        ? Math.max(0, Math.floor((today.getTime() - invDate.getTime()) / 86400000))
        : 0;
      const unitTotal = qtyOrig > 0 ? +(parseFloat(r.total_with_vat) / qtyOrig).toFixed(2) : 0;
      return {
        ...r,
        qty_original: qtyOrig,
        qty_returned_so_far: returned,
        qty_remaining: remaining,
        days_since_sale: daysSince,
        unit_total_with_vat: unitTotal,
      };
    }).filter(r => r.qty_remaining > 0);

    res.json(enriched);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/invoices/:id/credit-note', async (req, res) => {
  try {
    const { id } = req.params;
    const inv = await queryOne('SELECT * FROM invoices WHERE id = ?', [id]);
    if (!inv) return res.status(404).json({ error: 'not found' });
    if (inv.cancelled) return res.status(400).json({ error: 'Nuk lëshohet kreditore për faturë të anuluar' });
    if (inv.is_credit_note) return res.status(400).json({ error: 'Kjo është tashmë një kreditore' });
    const allItems = await queryAll('SELECT * FROM invoice_items WHERE invoice_id = ?', [id]);
    const today = new Date().toISOString().slice(0, 10);
    const date = (req.body && req.body.date) || today;
    // Vetëm admin mund të regjistrojë kthim me datë të mëparshme (p.sh. kur
    // kthimi ka ndodhur dje/muajin e kaluar por po futet sot në sistem).
    if (date !== today && req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'vetëm admin mund të vendosë datë të ndryshme nga sot' });
    }

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
    // User mund të specifikojë me ç'metodë po e bën rimbursimin (p.sh. fatura
    // origjinale ishte me bankë por klientin e rimbursojmë me cash nga arka).
    // Vlerat e lejuara: 'cash' | 'bank' | 'pos'. Nëse nuk jepet, ruajmë
    // sjelljen ekzistuese (trashëgo nga origjinali).
    const rawRefundMethod = String(req.body?.refund_method || '').toLowerCase();
    const refundMethodOverride = ['cash', 'bank', 'pos'].includes(rawRefundMethod)
      ? rawRefundMethod : null;

    let creditPm, creditPaid, creditDue, creditPaidCash = 0, creditPaidPos = 0, creditPaidBank = 0;
    const negRefund = -refundAmount; // sasia e vërtetë që doli nga arka

    if (refundMethodOverride) {
      // Metodë e zgjedhur nga user-i — kreditorja bëhet single-method me atë
      // metodë (pavarësisht origjinalit). Kjo rregullon edhe rastin mikse.
      creditPm = refundMethodOverride;
      creditPaid = negRefund;
      creditDue = 0;
      if (refundMethodOverride === 'cash') creditPaidCash = negRefund;
      else if (refundMethodOverride === 'bank') creditPaidBank = negRefund;
      else if (refundMethodOverride === 'pos') creditPaidPos = negRefund;
    } else if (parentPm === 'debt') {
      // Klienti kishte borxh — kreditorja redukton borxhin me refundAmount, jo
      // rimbursim monetar në sirtar.
      creditPm = 'debt';
      creditPaid = 0;
      creditDue = negRefund;
    } else if (parentPm === 'mikse') {
      // Trashëgon proporcionalisht ndarjen; kreditorja mban 'mikse' me
      // splits negative (të krijuara më poshtë) që të reflektohet te arka.
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
      if (parentPm === 'cash') creditPaidCash = negRefund;
      else if (parentPm === 'bank') creditPaidBank = negRefund;
      else if (parentPm === 'pos') creditPaidPos = negRefund;
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
          on_promotion, promo_discount_pct, sell_rate, has_gram, multiplier, is_gift)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newId, it.product_id || null, it.serial_no || '', it.barcode || '', it.name || '',
          -(it.qty || 0), -(parseFloat(it.gram) || 0), it.unit_price_no_vat || 0, it.discount_percent || 0,
          -(it.subtotal_no_vat || 0), it.vat_rate || 0,
          -(it.vat_amount || 0), -(it.total_with_vat || 0),
          it.on_promotion ? 1 : 0, parseFloat(it.promo_discount_pct) || 0,
          parseFloat(it.sell_rate) || 0,
          parseFloat(it.has_gram) || 0, parseFloat(it.multiplier) || 0,
          it.is_gift ? 1 : 0,
        ]
      );
    }
    // Mirror payment splits me shuma negative dhe të shkallëzuara — vetëm kur
    // kreditorja mbetet 'mikse' (jo kur user-i override me single-method).
    if (creditPm === 'mikse') {
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
// Regjistron furnitorin te tabela master nëse mungon. Përdoret nga flow-t e
// blerjes (fatura/hurda/HAS) që një furnitor i shkruar dorazi një herë të
// bëhet i disponueshëm te autocomplete-i nga blerja tjetër e tutje. Match-i
// bëhet me prioritet mbi NIPT (kur ka), përndryshe me emrin.
async function upsertSupplierIfMissing(nipt, name) {
  const nip = (nipt || '').trim();
  const nam = (name || '').trim();
  if (!nip && !nam) return;
  const existing = nip
    ? await queryOne('SELECT id FROM suppliers WHERE nipt = ? LIMIT 1', [nip])
    : await queryOne('SELECT id FROM suppliers WHERE nipt = "" AND name = ? COLLATE NOCASE LIMIT 1', [nam]);
  if (existing) return;
  await run(
    `INSERT INTO suppliers (nipt, name, phone, address, notes) VALUES (?, ?, '', '', '')`,
    [nip, nam],
  );
}

app.get('/api/suppliers', async (req, res) => {
  try {
    // Memory cache 60s — furnitorët ndryshojnë rrallë.
    const rows = await cached('suppliers:all', 60_000, () =>
      queryAll('SELECT * FROM suppliers ORDER BY name COLLATE NOCASE ASC', []));
    res.json(rows);
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
  // "Cmimi PA" opsional — fallback te "Cmim Kosto" (jo Cmim Shitje) sepse
  // totali i blerjes reflekton koston, jo çmimin e shitjes.
  const price = (parseFloat(it.purchase_price_no_vat) || 0) || (parseFloat(it.cost_price) || 0);
  const disc  = parseFloat(it.discount_percent) || 0;
  const vatR  = parseFloat(it.vat_rate) || 0;
  const gross = qty * price;
  const subtotal_no_vat = +(gross * (1 - disc / 100)).toFixed(2);
  const vat_amount     = +(subtotal_no_vat * (vatR / 100)).toFixed(2);
  const total_with_vat = +(subtotal_no_vat + vat_amount).toFixed(2);
  return { qty, purchase_price_no_vat: price, discount_percent: disc, vat_rate: vatR, subtotal_no_vat, vat_amount, total_with_vat };
}

async function nextPurchaseNo(date, type = 'purchase') {
  const year = (date || '').slice(0, 4) || new Date().getFullYear().toString();
  // Blerje → B2026-00001; Kthim → KTH-2026-00001 (sekuencë e ndarë).
  const prefix = type === 'return' ? `KTH-${year}-` : `B${year}-`;
  // MAX i numrit ekzistues + 1 (jo COUNT) — që fshirja e një fature të mos
  // rikthejë një numër që tashmë ekziston, duke shkaktuar UNIQUE constraint fail.
  // Number(...) është i domosdoshëm: libSQL kthen aggregate-e si string/BigInt
  // sipas driver-it → pa cast, "29" + 1 = "291" (bashkim stringu).
  const row = await queryOne(
    `SELECT MAX(CAST(SUBSTR(invoice_no, ${prefix.length + 1}) AS INTEGER)) AS max_no
       FROM purchase_invoices
      WHERE invoice_no LIKE ?`,
    [`${prefix}%`],
  );
  const next = Number(row?.max_no || 0) + 1;
  return `${prefix}${String(next).padStart(5, '0')}`;
}

async function adjustPurchaseStock(items, sign) {
  // sign=+1 when applying purchase (stock up); sign=-1 when reverting
  const stmts = buildAdjustPurchaseStockStmts(items, sign);
  if (stmts.length) await batchWrite(stmts);
}

// Version pa run() — kthen statement-et që të bundlohen nga caller-i.
function buildAdjustPurchaseStockStmts(items, sign) {
  const out = [];
  for (const it of items) {
    if (it.product_id && it.qty) {
      const delta = sign * (parseInt(it.qty) || 0);
      if (delta !== 0) {
        out.push({
          sql: 'UPDATE products SET stock = MAX(0, stock + ?) WHERE id = ?',
          args: [delta, it.product_id],
        });
      }
    }
  }
  return out;
}

// Rifresko `products.last_purchase_date` për produktet e prekura nga një
// mutation blerjeje (POST/PUT/DELETE). Përdorim një statement të vetëm me
// subquery të korreluar që shfrytëzon `idx_purchase_items_product_id`, kështu
// koston e kufizojmë te produktet e faturës (jo tërë tabela). Kur produkti
// s'ka më asnjë blerje (rasti i DELETE-it), MAX() kthen NULL → COALESCE në ''.
function buildRefreshLastPurchaseDateStmts(productIds) {
  const ids = [...new Set(productIds.filter(x => x != null && x !== ''))];
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  return [{
    sql: `UPDATE products
             SET last_purchase_date = COALESCE(
               (SELECT MAX(pi.date)
                  FROM purchase_items pit
                  JOIN purchase_invoices pi ON pi.id = pit.purchase_id
                 WHERE pit.product_id = products.id),
               ''
             )
           WHERE id IN (${placeholders})`,
    args: ids,
  }];
}

// Kur user-i shton në faturë blerje një rresht të ri pa e lidhur me një produkt
// (pra pa përdorur importin nga Excel ose pickerin), krijojmë automatikisht një
// produkt të ri që ai të shfaqet menjëherë te Produkte / Inventar dhe që
// azhurnimi i stokut e i çmimeve në flow-un e blerjes të funksionojë.
// Mutate: seton it.product_id për çdo rresht që nuk e ka pasur.
async function ensurePurchaseProducts(items) {
  // Faza 1: paralelo të gjitha lookup-et (barkod/serial) — ekzekutohen si një
  // grup Promise.all dhe kanë vetëm një network round-trip për të gjithë items.
  const needsInsert = [];
  await Promise.all(items.map(async (it) => {
    if (it.product_id) return;
    const name = String(it.name || '').trim();
    if (!name) return;
    const barcode   = String(it.barcode || '').trim();
    const serial_no = String(it.serial_no || '').trim();
    let existing = null;
    if (barcode)              existing = await queryOne('SELECT id FROM products WHERE barcode = ? LIMIT 1', [barcode]);
    if (!existing && serial_no) existing = await queryOne('SELECT id FROM products WHERE serial_no = ? LIMIT 1', [serial_no]);
    if (existing) { it.product_id = existing.id; return; }
    needsInsert.push(it);
  }));

  if (needsInsert.length === 0) return;

  // Faza 2: bundle të gjithë INSERT-et me RETURNING id në një thirrje batch.
  // libSQL kthen `rows` për çdo statement, pra marrim id-në pa një SELECT
  // shtesë last_insert_rowid.
  const results = await batchWrite(needsInsert.map(it => ({
    sql: `INSERT INTO products (name, sku, barcode, category, brand, description,
            cost_price, sell_price, stock, min_stock,
            serial_no, purchase_price_no_vat, vat_rate, unit, gram,
            has_gram, has_currency, has_rate)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          RETURNING id`,
    args: [
      String(it.name || '').trim(), '', String(it.barcode || '').trim(),
      it.category || 'Tjeter', '', '',
      parseFloat(it.cost_price) || parseFloat(it.purchase_price_no_vat) || 0,
      parseFloat(it.sell_price) || 0,
      0, 5,
      String(it.serial_no || '').trim(),
      parseFloat(it.purchase_price_no_vat) || 0,
      it.vat_rate != null && it.vat_rate !== '' ? parseFloat(it.vat_rate) : 20,
      it.unit || 'copë',
      parseFloat(it.gram) || 0,
      parseFloat(it.has_gram) || 0,
      it.has_currency || 'HAS',
      parseFloat(it.has_rate) || 0,
    ],
  })));

  needsInsert.forEach((it, idx) => {
    const row = results[idx]?.rows?.[0];
    const id = row?.id ?? row?.[0];
    if (id != null) it.product_id = Number(id);
  });
}

async function applyProductPrices(items) {
  const stmts = await buildApplyProductPricesStmts(items);
  if (stmts.length) await batchWrite(stmts);
}

// Version pa run() — kthen statement-et që të bundlohen nga caller-i.
async function buildApplyProductPricesStmts(items) {
  // Update each product's cost_price + sell_price from the purchase line
  // Ndërto një mape slug → label nga tabela material_categories që slug-jet
  // e reja (jo vetëm flori/diamant/ora) të ruajnë label-in e duhur te
  // products.category. Kërkimi bëhet një herë për të gjithë items në paralel.
  const materialSlugs = [...new Set(items.map(it => it.material).filter(Boolean))];
  const materialMap = {};
  if (materialSlugs.length > 0) {
    const rows = await Promise.all(materialSlugs.map(slug =>
      queryOne('SELECT label FROM material_categories WHERE slug = ?', [slug])
    ));
    materialSlugs.forEach((slug, i) => { if (rows[i]) materialMap[slug] = rows[i].label; });
  }
  const out = [];
  for (const it of items) {
    if (!it.product_id) continue;
    const updates = [];
    const params = [];
    // products.cost_price = "Cmim Blerje" qe shfaqet ne rreshtin e Blerjes.
    // Per Flori auto-llogaritet (has_gram × has_rate) dhe eshte kostoja e vertete
    // e materialit. Per te tjeret user-i e mbush ne kolonen "Cmim Blerje". Fallback
    // te purchase_price_no_vat vetem nese it.cost_price mungon ose eshte 0.
    const itemCost = parseFloat(it.cost_price) || 0;
    const itemPurchaseNoVat = parseFloat(it.purchase_price_no_vat) || 0;
    if (itemCost > 0) {
      updates.push('cost_price = ?');
      params.push(itemCost);
    } else if (it.purchase_price_no_vat != null && it.purchase_price_no_vat !== '') {
      updates.push('cost_price = ?');
      params.push(itemPurchaseNoVat);
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
    if (it.material && materialMap[it.material]) {
      updates.push('material = ?');
      params.push(it.material);
      updates.push('category = ?');
      params.push(materialMap[it.material]);
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
    // Blerja në gram HAS + kursi EUR/gram HAS: përditësohen te produkti me
    // vlerat e blerjes së fundit (user preference). Ruajmë vetëm kur ka vlerë
    // të re — mos e ulim rastësisht në 0 nga një rresht bosh.
    if (it.has_gram != null && it.has_gram !== '' && parseFloat(it.has_gram) > 0) {
      updates.push('has_gram = ?');
      params.push(parseFloat(it.has_gram));
    }
    if (it.has_currency && String(it.has_currency).trim()) {
      updates.push('has_currency = ?');
      params.push(String(it.has_currency).trim());
    }
    if (it.has_rate != null && it.has_rate !== '' && parseFloat(it.has_rate) > 0) {
      updates.push('has_rate = ?');
      params.push(parseFloat(it.has_rate));
      // Etiketa e valutës për kursin e blerjes (EUR/USD) — vetëm kur ka kurs > 0.
      updates.push('has_rate_currency = ?');
      params.push(it.has_rate_currency === 'USD' ? 'USD' : 'EUR');
    }
    // Fusha flori: kodi (585, 750...), shumëzuesi, dhe kursi i shitjes —
    // përditësohen te produkti nga blerja e fundit që përmban vlera > 0.
    if (it.kodi != null && it.kodi !== '' && parseFloat(it.kodi) > 0) {
      updates.push('kodi = ?');
      params.push(parseFloat(it.kodi));
    }
    if (it.multiplier != null && it.multiplier !== '' && parseFloat(it.multiplier) > 0) {
      updates.push('multiplier = ?');
      params.push(parseFloat(it.multiplier));
    }
    if (it.koeficent_pune != null && it.koeficent_pune !== '' && parseFloat(it.koeficent_pune) > 0) {
      updates.push('koeficent_pune = ?');
      params.push(parseFloat(it.koeficent_pune));
    }
    if (it.sell_rate != null && it.sell_rate !== '' && parseFloat(it.sell_rate) > 0) {
      updates.push('sell_rate = ?');
      params.push(parseFloat(it.sell_rate));
      // Etiketa e valutës për kursin e shitjes (EUR/USD) — vetëm kur ka kurs > 0.
      updates.push('sell_rate_currency = ?');
      params.push(it.sell_rate_currency === 'USD' ? 'USD' : 'EUR');
    }
    if (updates.length === 0) continue;
    params.push(it.product_id);
    out.push({ sql: `UPDATE products SET ${updates.join(', ')} WHERE id = ?`, args: params });
  }
  return out;
}

app.get('/api/purchase-invoices/next-no', async (req, res) => {
  try {
    const { date } = req.query;
    res.json({ invoice_no: await nextPurchaseNo(date) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Lista e thjeshtë e faturave të blerjes për picker-in te Shpenzime Transporti.
// Kthen id, invoice_no, date, supplier + shenjë nëse fatura ka tashmë një pagesë
// transporti (që UI ta shfaqë disabled ose me indikator). Filtër opsional `q`
// (kërkon te invoice_no ose supplier_name); pa filtër, kthen 200 më të fundit.
app.get('/api/purchase-invoices/list-simple', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const params = [];
    let where = `COALESCE(pi.type, 'purchase') = 'purchase'`;
    if (q) {
      where += ` AND (pi.invoice_no LIKE ? OR pi.supplier_name LIKE ?)`;
      params.push(`%${q}%`, `%${q}%`);
    }
    const rows = await queryAll(
      `SELECT pi.id, pi.invoice_no, pi.date, pi.supplier_name, pi.currency,
              pi.total_with_vat,
              CASE WHEN EXISTS (
                SELECT 1 FROM expense_entries e WHERE e.purchase_invoice_id = pi.id
              ) THEN 1 ELSE 0 END AS has_transport_payment
         FROM purchase_invoices pi
        WHERE ${where}
        ORDER BY pi.date DESC, pi.id DESC
        LIMIT 200`,
      params
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Filtër opsional për faqet Blerje Flori / Blerje Diamant — kthen vetëm faturat
// që kanë të paktën një artikull të lidhur me një produkt të asaj materialiteti.
function buildPurchaseMaterialFilter(material) {
  if (!material || !String(material).trim()) return { sql: '', params: [] };
  return {
    sql: `AND EXISTS (
      SELECT 1 FROM purchase_items xpit
      LEFT JOIN products xp ON xp.id = xpit.product_id
      WHERE xpit.purchase_id = pi.id AND COALESCE(xp.material, '') = ?
    )`,
    params: [String(material).trim()],
  };
}

// Total gram (peshë) i artikujve për faturë — kur ka materialFilter, numërohen
// vetëm artikujt e produkteve me atë material (p.sh. Blerje Flori s'duhet të
// përfshijë grama e diamanteve nëse fatura ka të dyja).
function purchaseGramSubquery(material) {
  const matClause = (material && String(material).trim())
    ? `AND EXISTS (SELECT 1 FROM products xp2 WHERE xp2.id = xpit2.product_id AND COALESCE(xp2.material,'') = ?)`
    : '';
  const sql = `(SELECT COALESCE(SUM(COALESCE(xpit2.gram,0) * COALESCE(xpit2.qty,0)), 0)
     FROM purchase_items xpit2
     WHERE xpit2.purchase_id = pi.id ${matClause}) AS total_gram`;
  const params = matClause ? [String(material).trim()] : [];
  return { sql, params };
}

// Totali i Cmim Blerje (me TVSH) dhe Cmim Shitje për artikujt e faturës,
// filtruar sipas materialit — përdoret në listat Blerje Flori/Diamant për
// të llogaritur Fitim %/Marzh % mesatar në rreshtin e totalit.
function purchaseBuyTotalSubquery(material) {
  const matClause = (material && String(material).trim())
    ? `AND EXISTS (SELECT 1 FROM products xp3 WHERE xp3.id = xpit3.product_id AND COALESCE(xp3.material,'') = ?)`
    : '';
  const sql = `(SELECT COALESCE(SUM(COALESCE(xpit3.total_with_vat,0)), 0)
     FROM purchase_items xpit3
     WHERE xpit3.purchase_id = pi.id ${matClause}) AS total_buy_price`;
  const params = matClause ? [String(material).trim()] : [];
  return { sql, params };
}

function purchaseSellTotalSubquery(material) {
  const matClause = (material && String(material).trim())
    ? `AND EXISTS (SELECT 1 FROM products xp4 WHERE xp4.id = xpit4.product_id AND COALESCE(xp4.material,'') = ?)`
    : '';
  const sql = `(SELECT COALESCE(SUM(COALESCE(xpit4.qty,0) * COALESCE(xpit4.sell_price,0)), 0)
     FROM purchase_items xpit4
     WHERE xpit4.purchase_id = pi.id ${matClause}) AS total_sell_price`;
  const params = matClause ? [String(material).trim()] : [];
  return { sql, params };
}

// Numri i artikujve për faturë — numëron TË GJITHË rreshtat, pa filtër materiali.
// Përdoret për verifikim me Excel: nëse Excel-i kishte 19 rreshta, ky duhet të
// tregojë 19, edhe nëse ndonjë produkt është fshirë më vonë (rreshti orphan te
// purchase_items).
function purchaseItemCountSubquery() {
  return {
    sql: `(SELECT COALESCE(SUM(COALESCE(xpit5.qty,0)), 0)
       FROM purchase_items xpit5
       WHERE xpit5.purchase_id = pi.id) AS item_count`,
    params: [],
  };
}

app.get('/api/purchase-invoices/by-date/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const mat = buildPurchaseMaterialFilter(req.query.material);
    const gram = purchaseGramSubquery(req.query.material);
    const buy = purchaseBuyTotalSubquery(req.query.material);
    const sell = purchaseSellTotalSubquery(req.query.material);
    const cnt = purchaseItemCountSubquery();
    res.json(await queryAll(
      `SELECT pi.*,
         (pi.amount_paid - COALESCE((SELECT SUM(amount) FROM purchase_payments WHERE purchase_id = pi.id), 0)) AS initial_amount_paid,
         ${gram.sql},
         ${buy.sql},
         ${sell.sql},
         ${cnt.sql}
       FROM purchase_invoices pi
       WHERE pi.date = ? AND COALESCE(pi.type, 'purchase') = 'purchase' ${mat.sql}
       ORDER BY pi.id ASC`,
      [...gram.params, ...buy.params, ...sell.params, ...cnt.params, date, ...mat.params]
    ));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/purchase-invoices/by-range', async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to required' });
    const mat = buildPurchaseMaterialFilter(req.query.material);
    const gram = purchaseGramSubquery(req.query.material);
    const buy = purchaseBuyTotalSubquery(req.query.material);
    const sell = purchaseSellTotalSubquery(req.query.material);
    const cnt = purchaseItemCountSubquery();
    res.json(await queryAll(
      `SELECT pi.*,
         (pi.amount_paid - COALESCE((SELECT SUM(amount) FROM purchase_payments WHERE purchase_id = pi.id), 0)) AS initial_amount_paid,
         ${gram.sql},
         ${buy.sql},
         ${sell.sql},
         ${cnt.sql}
       FROM purchase_invoices pi
       WHERE pi.date BETWEEN ? AND ? AND COALESCE(pi.type, 'purchase') = 'purchase' ${mat.sql}
       ORDER BY pi.date ASC, pi.id ASC`,
      [...gram.params, ...buy.params, ...sell.params, ...cnt.params, from, to, ...mat.params]
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
    const payment_splits = await queryAll(
      'SELECT id, method, currency, amount, exchange_rate FROM purchase_invoice_payment_splits WHERE purchase_id = ? ORDER BY id ASC',
      [req.params.id]
    );
    res.json({ ...inv, items, initial_amount_paid, payment_splits });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/purchase-invoices', async (req, res) => {
  try {
    const d = req.body || {};
    if (!d.date) return res.status(400).json({ error: 'date required' });
    // Backdate lejohet vetëm për admin (parallel me fatura shitje).
    if (req.user?.role !== 'admin' && d.date !== new Date().toISOString().slice(0, 10)) {
      return res.status(403).json({ error: 'only admin can set a non-today date' });
    }
    const userProvidedNo = (d.invoice_no || '').trim();
    const items = (d.items || []).map(it => ({ ...it, ...computePurchaseLineTotals(it) }));
    const sub = +items.reduce((s, it) => s + it.subtotal_no_vat, 0).toFixed(2);
    const vat = +items.reduce((s, it) => s + it.vat_amount,     0).toFixed(2);
    const tot = +items.reduce((s, it) => s + it.total_with_vat, 0).toFixed(2);
    const totalDiscount = +items.reduce((s, it) => {
      const gross = (parseFloat(it.qty) || 0) * (parseFloat(it.purchase_price_no_vat) || 0);
      return s + gross * ((parseFloat(it.discount_percent) || 0) / 100);
    }, 0).toFixed(2);

    // Splits janë burimi i së vërtetës kur jepen; përndryshe biem në fallback
    // të legacy fushave (payment_method + amount_paid) për backwards-compat.
    const splitsI = normalizeSplits(d.payment_splits);
    let pmI, amountPaidI;
    if (splitsI.length > 0) {
      pmI = splitsI.length === 1 ? splitsI[0].method : 'mikse';
      const agg = aggregateSplits(splitsI, d.exchange_rate);
      amountPaidI = agg.amountPaid;
    } else if (Array.isArray(d.payment_splits)) {
      // Klienti dërgoi splits array por bosh → borxh i plotë.
      pmI = 'debt';
      amountPaidI = 0;
    } else {
      pmI = ['cash','bank','debt','pos'].includes(d.payment_method) ? d.payment_method : 'cash';
      if (d.amount_paid != null && d.amount_paid !== '') {
        amountPaidI = parseFloat(d.amount_paid) || 0;
      } else {
        amountPaidI = (pmI === 'cash' || pmI === 'pos') ? tot : 0;
      }
    }
    const amountDueI = Math.max(0, +(tot - amountPaidI).toFixed(2));

    const doInsertPurchase = (invNo) => run(
      `INSERT INTO purchase_invoices (date, invoice_no, supplier_name, supplier_nipt, currency, exchange_rate,
        subtotal_no_vat, total_discount, total_vat, total_with_vat, payment_method, amount_paid, amount_due, notes, is_gift)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        d.date, invNo, d.supplier_name || '', d.supplier_nipt || '',
        d.currency || 'LEK', parseFloat(d.exchange_rate) || 1,
        sub, totalDiscount, vat, tot,
        pmI, amountPaidI, amountDueI,
        d.notes || '',
        d.is_gift ? 1 : 0,
      ]
    );
    // Retry-i tani provon userProvidedNo si numër fillestar; nëse ai numër
    // përplaset me UNIQUE (racë midis dy PC-ve ose një save i mëparshëm që
    // "fetch failed" por serveri e ruajti), auto-provon një numër të freskët
    // në vend që t'i japë user-it SQLITE_CONSTRAINT.
    const invoice_no = await retryOnUniqueNo(
      () => nextPurchaseNo(d.date),
      doInsertPurchase,
      5,
      userProvidedNo || null,
    );
    const created = await queryOne('SELECT id FROM purchase_invoices WHERE date = ? AND invoice_no = ?', [d.date, invoice_no]);
    const newId = created?.id;

    // Ensure products exists (paralel lookup + batched INSERT me RETURNING).
    await ensurePurchaseProducts(items);

    // Bundle të gjithë INSERT/UPDATE-t e mbetur në një thirrje batch → nga
    // ~90 round-trips Turso për një blerje me 21 artikuj → 1 batch call.
    const batch = [];
    for (const s of splitsI) {
      batch.push({
        sql: `INSERT INTO purchase_invoice_payment_splits (purchase_id, method, currency, amount, exchange_rate)
              VALUES (?, ?, ?, ?, ?)`,
        args: [newId, s.method, s.currency, s.amount, s.exchange_rate],
      });
    }
    for (const it of items) {
      batch.push({
        sql: `INSERT INTO purchase_items (purchase_id, product_id, serial_no, barcode, name, category, unit, gram, qty,
                purchase_price_no_vat, cost_price, discount_percent, subtotal_no_vat, vat_rate, vat_amount, total_with_vat, sell_price,
                has_gram, has_currency, has_rate, sell_rate, has_rate_currency, sell_rate_currency, koeficent_pune, multiplier)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          newId, it.product_id || null, it.serial_no || '', it.barcode || '', it.name || '',
          it.category || '', it.unit || '', parseFloat(it.gram) || 0,
          it.qty, it.purchase_price_no_vat, parseFloat(it.cost_price) || 0, it.discount_percent,
          it.subtotal_no_vat, it.vat_rate, it.vat_amount, it.total_with_vat,
          parseFloat(it.sell_price) || 0,
          parseFloat(it.has_gram) || 0, it.has_currency || 'HAS', parseFloat(it.has_rate) || 0,
          parseFloat(it.sell_rate) || parseFloat(it.has_rate) || 0,
          it.has_rate_currency === 'USD' ? 'USD' : 'EUR', it.sell_rate_currency === 'USD' ? 'USD' : 'EUR',
          parseFloat(it.koeficent_pune) || 0, parseFloat(it.multiplier) || 0,
        ],
      });
    }
    batch.push(...buildAdjustPurchaseStockStmts(items, +1));
    batch.push(...(await buildApplyProductPricesStmts(items)));
    batch.push(...buildRefreshLastPurchaseDateStmts(items.map(it => it.product_id)));
    // Nëse fatura është shënuar si dhuratë, marko produktet.
    if (d.is_gift) {
      for (const pid of items.map(it => it.product_id).filter(Boolean)) {
        batch.push({ sql: 'UPDATE products SET is_gift = 1 WHERE id = ?', args: [pid] });
      }
    }
    // Auto-regjistro furnitorin te tabela `suppliers` nëse mungon — që picker-i
    // të japë autocomplete nga blerja tjetër e tutje.
    if (d.supplier_nipt || d.supplier_name) {
      batch.push({
        sql: `INSERT INTO suppliers (nipt, name, phone, address, notes)
              SELECT ?, ?, '', '', ''
              WHERE NOT EXISTS (
                SELECT 1 FROM suppliers
                WHERE (? != '' AND nipt = ?)
                   OR (? = '' AND ? != '' AND name = ?)
              )`,
        args: [
          d.supplier_nipt || '', d.supplier_name || '',
          d.supplier_nipt || '', d.supplier_nipt || '',
          d.supplier_nipt || '', d.supplier_name || '', d.supplier_name || '',
        ],
      });
    }
    if (batch.length) await batchWrite(batch);

    res.json({ success: true, id: newId, invoice_no });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/purchase-invoices/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const d = req.body || {};
    const existing = await queryOne('SELECT * FROM purchase_invoices WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'not found' });
    // Sales nuk mund të ndryshojë datën në një ditë tjetër nga sot.
    if (req.user?.role !== 'admin') {
      const today = new Date().toISOString().slice(0, 10);
      if (d.date && d.date !== today) {
        return res.status(403).json({ error: 'only admin can set a non-today date' });
      }
    }
    const oldItems = await queryAll('SELECT * FROM purchase_items WHERE purchase_id = ?', [id]);
    const items = (d.items || []).map(it => ({ ...it, ...computePurchaseLineTotals(it) }));
    const sub = +items.reduce((s, it) => s + it.subtotal_no_vat, 0).toFixed(2);
    const vat = +items.reduce((s, it) => s + it.vat_amount,     0).toFixed(2);
    const tot = +items.reduce((s, it) => s + it.total_with_vat, 0).toFixed(2);
    const totalDiscount = +items.reduce((s, it) => {
      const gross = (parseFloat(it.qty) || 0) * (parseFloat(it.purchase_price_no_vat) || 0);
      return s + gross * ((parseFloat(it.discount_percent) || 0) / 100);
    }, 0).toFixed(2);

    // Splits janë burimi i së vërtetës kur jepen; përndryshe fallback legacy.
    const splitsU = normalizeSplits(d.payment_splits);
    let pmU, formInitialPaid;
    if (splitsU.length > 0) {
      pmU = splitsU.length === 1 ? splitsU[0].method : 'mikse';
      const agg = aggregateSplits(splitsU, d.exchange_rate);
      formInitialPaid = agg.amountPaid;
    } else if (Array.isArray(d.payment_splits)) {
      pmU = 'debt';
      formInitialPaid = 0;
    } else {
      pmU = ['cash','bank','debt','pos'].includes(d.payment_method) ? d.payment_method : 'cash';
      if (d.amount_paid != null && d.amount_paid !== '') {
        formInitialPaid = parseFloat(d.amount_paid) || 0;
      } else {
        formInitialPaid = (pmU === 'cash' || pmU === 'pos') ? tot : 0;
      }
    }
    const existingPaySum = await queryOne(
      'SELECT COALESCE(SUM(amount), 0) AS s FROM purchase_payments WHERE purchase_id = ?',
      [id]
    )?.s || 0;
    const amountPaidU = +(formInitialPaid + existingPaySum).toFixed(2);
    const amountDueU = Math.max(0, +(tot - amountPaidU).toFixed(2));

    await run(
      `UPDATE purchase_invoices SET date=?, supplier_name=?, supplier_nipt=?, currency=?, exchange_rate=?,
        subtotal_no_vat=?, total_discount=?, total_vat=?, total_with_vat=?, payment_method=?, amount_paid=?, amount_due=?, notes=?, is_gift=?
       WHERE id=?`,
      [
        d.date || existing.date,
        d.supplier_name || '', d.supplier_nipt || '',
        d.currency || 'LEK', parseFloat(d.exchange_rate) || 1,
        sub, totalDiscount, vat, tot,
        pmU, amountPaidU, amountDueU,
        d.notes || '',
        d.is_gift ? 1 : 0,
        id,
      ]
    );
    // Ensure products exists (paralel lookup + batched INSERT me RETURNING).
    await ensurePurchaseProducts(items);

    // Bundle të gjitha operacionet e mbetura në një thirrje batch te Turso.
    const batch = [];
    batch.push({ sql: 'DELETE FROM purchase_invoice_payment_splits WHERE purchase_id = ?', args: [id] });
    for (const s of splitsU) {
      batch.push({
        sql: `INSERT INTO purchase_invoice_payment_splits (purchase_id, method, currency, amount, exchange_rate)
              VALUES (?, ?, ?, ?, ?)`,
        args: [id, s.method, s.currency, s.amount, s.exchange_rate],
      });
    }
    batch.push(...buildAdjustPurchaseStockStmts(oldItems, -1));
    batch.push({ sql: 'DELETE FROM purchase_items WHERE purchase_id = ?', args: [id] });
    for (const it of items) {
      batch.push({
        sql: `INSERT INTO purchase_items (purchase_id, product_id, serial_no, barcode, name, category, unit, gram, qty,
                purchase_price_no_vat, cost_price, discount_percent, subtotal_no_vat, vat_rate, vat_amount, total_with_vat, sell_price,
                has_gram, has_currency, has_rate, sell_rate, has_rate_currency, sell_rate_currency, koeficent_pune, multiplier)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          id, it.product_id || null, it.serial_no || '', it.barcode || '', it.name || '',
          it.category || '', it.unit || '', parseFloat(it.gram) || 0,
          it.qty, it.purchase_price_no_vat, parseFloat(it.cost_price) || 0, it.discount_percent,
          it.subtotal_no_vat, it.vat_rate, it.vat_amount, it.total_with_vat,
          parseFloat(it.sell_price) || 0,
          parseFloat(it.has_gram) || 0, it.has_currency || 'HAS', parseFloat(it.has_rate) || 0,
          parseFloat(it.sell_rate) || parseFloat(it.has_rate) || 0,
          it.has_rate_currency === 'USD' ? 'USD' : 'EUR', it.sell_rate_currency === 'USD' ? 'USD' : 'EUR',
          parseFloat(it.koeficent_pune) || 0, parseFloat(it.multiplier) || 0,
        ],
      });
    }
    batch.push(...buildAdjustPurchaseStockStmts(items, +1));
    batch.push(...(await buildApplyProductPricesStmts(items)));
    // Rifresko last_purchase_date për produktet e prekura nga fatura (para dhe
    // pas edit-it) — data e faturës mund të ketë ndryshuar dhe/ose item-et.
    batch.push(...buildRefreshLastPurchaseDateStmts([
      ...oldItems.map(it => it.product_id),
      ...items.map(it => it.product_id),
    ]));
    // Sync is_gift te produktet (nga fatura). Nëse fatura është dhuratë,
    // marko produktet e saj.
    if (d.is_gift) {
      for (const pid of items.map(it => it.product_id).filter(Boolean)) {
        batch.push({ sql: 'UPDATE products SET is_gift = 1 WHERE id = ?', args: [pid] });
      }
    }
    // Auto-regjistro furnitorin te tabela `suppliers` nëse mungon.
    if (d.supplier_nipt || d.supplier_name) {
      batch.push({
        sql: `INSERT INTO suppliers (nipt, name, phone, address, notes)
              SELECT ?, ?, '', '', ''
              WHERE NOT EXISTS (
                SELECT 1 FROM suppliers
                WHERE (? != '' AND nipt = ?)
                   OR (? = '' AND ? != '' AND name = ?)
              )`,
        args: [
          d.supplier_nipt || '', d.supplier_name || '',
          d.supplier_nipt || '', d.supplier_nipt || '',
          d.supplier_nipt || '', d.supplier_name || '', d.supplier_name || '',
        ],
      });
    }
    if (batch.length) await batchWrite(batch);

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
    // Rifresko last_purchase_date te produktet e prekura: nëse ky ishte MAX-i,
    // kalon te fatura tjetër më e vjetër; nëse s'ka më blerje → ''.
    const productIds = [...new Set(items.map(it => it.product_id).filter(x => x != null))];
    if (productIds.length) {
      const stmts = buildRefreshLastPurchaseDateStmts(productIds);
      if (stmts.length) await batchWrite(stmts);
      // Pastro produktet "jetim": produktet që s'kanë më asnjë blerje tjetër
      // dhe s'janë shitur ndonjëherë — janë krijuar vetëm nga kjo faturë e fshirë.
      for (const pid of productIds) {
        const purchRef = await queryOne('SELECT COUNT(*) AS c FROM purchase_items WHERE product_id = ?', [pid]);
        const salesRef = await queryOne('SELECT COUNT(*) AS c FROM invoice_items WHERE product_id = ?', [pid]);
        if ((purchRef?.c || 0) === 0 && (salesRef?.c || 0) === 0) {
          await run('DELETE FROM products WHERE id = ?', [pid]);
        }
      }
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// PURCHASE RETURNS (Kthime te furnitori — parciale ose të plota)
// ============================================================
// Kthimi është fatura e re me type='return', e lidhur me faturën origjinale
// përmes `original_purchase_id`. Çmimet e rreshtave kopjohen nga origjinali që
// vlera e kthimit të përputhet ekzaktësisht me atë që u ble.
// Fluksi i parave (default automatik):
//   1. Sa origjinali ka amount_due të papaguar → zbritet së pari (debtReduction).
//   2. Pjesa e mbetur → hyn si cash në arka (cashBack, payment_method='cash').

// Për një faturë blerjeje: kthen çdo rresht origjinal me sasinë e mbetur
// (qty_remaining = qty_purchased - sum(qty në kthimet e mëparshme të kësaj faturë)).
// Vetëm rreshtat me qty_remaining > 0 kthehen.
app.get('/api/purchase-invoices/:id/returnable', async (req, res) => {
  try {
    const { id } = req.params;
    const inv = await queryOne(
      `SELECT * FROM purchase_invoices WHERE id = ? AND COALESCE(type, 'purchase') = 'purchase'`,
      [id]
    );
    if (!inv) return res.status(404).json({ error: 'Fatura origjinale nuk u gjet ose nuk është blerje' });

    const items = await queryAll(
      `SELECT pi.*,
              COALESCE((
                SELECT SUM(rit.qty)
                  FROM purchase_items rit
                  JOIN purchase_invoices rinv ON rinv.id = rit.purchase_id
                 WHERE rinv.original_purchase_id = ?
                   AND rinv.type = 'return'
                   AND rit.product_id = pi.product_id
              ), 0) AS qty_returned_so_far
         FROM purchase_items pi
        WHERE pi.purchase_id = ?
        ORDER BY pi.id ASC`,
      [id, id]
    );

    const returnable = items.map(it => {
      const qtyPurchased = parseFloat(it.qty) || 0;
      const qtyReturned  = parseFloat(it.qty_returned_so_far) || 0;
      const qtyRemaining = +(qtyPurchased - qtyReturned).toFixed(4);
      return {
        purchase_item_id: it.id,
        product_id: it.product_id,
        serial_no: it.serial_no || '',
        barcode: it.barcode || '',
        name: it.name || '',
        category: it.category || '',
        unit: it.unit || '',
        gram: parseFloat(it.gram) || 0,
        qty_purchased: qtyPurchased,
        qty_returned_so_far: qtyReturned,
        qty_remaining: Math.max(0, qtyRemaining),
        purchase_price_no_vat: parseFloat(it.purchase_price_no_vat) || 0,
        cost_price: parseFloat(it.cost_price) || 0,
        discount_percent: parseFloat(it.discount_percent) || 0,
        vat_rate: parseFloat(it.vat_rate) || 0,
        sell_price: parseFloat(it.sell_price) || 0,
        has_gram: parseFloat(it.has_gram) || 0,
        has_currency: it.has_currency || 'HAS',
        has_rate: parseFloat(it.has_rate) || 0,
        sell_rate: parseFloat(it.sell_rate) || 0,
        has_rate_currency: it.has_rate_currency || 'EUR',
        sell_rate_currency: it.sell_rate_currency || 'EUR',
        koeficent_pune: parseFloat(it.koeficent_pune) || 0,
        multiplier: parseFloat(it.multiplier) || 0,
      };
    });

    res.json({
      original: {
        id: inv.id,
        invoice_no: inv.invoice_no,
        date: inv.date,
        supplier_name: inv.supplier_name,
        supplier_nipt: inv.supplier_nipt,
        currency: inv.currency,
        exchange_rate: inv.exchange_rate,
        total_with_vat: inv.total_with_vat,
        amount_paid: inv.amount_paid,
        amount_due: inv.amount_due,
        payment_method: inv.payment_method,
      },
      items: returnable,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Lista e kthimeve — analog i /api/purchase-invoices/by-date dhe by-range,
// por vetëm për type='return'.
app.get('/api/purchase-returns/by-date/:date', async (req, res) => {
  try {
    const { date } = req.params;
    res.json(await queryAll(
      `SELECT pi.*,
              (SELECT invoice_no FROM purchase_invoices WHERE id = pi.original_purchase_id) AS original_invoice_no
         FROM purchase_invoices pi
        WHERE pi.date = ? AND pi.type = 'return'
        ORDER BY pi.id ASC`,
      [date]
    ));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/purchase-returns/by-range', async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to required' });
    res.json(await queryAll(
      `SELECT pi.*,
              (SELECT invoice_no FROM purchase_invoices WHERE id = pi.original_purchase_id) AS original_invoice_no
         FROM purchase_invoices pi
        WHERE pi.date BETWEEN ? AND ? AND pi.type = 'return'
        ORDER BY pi.date ASC, pi.id ASC`,
      [from, to]
    ));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Kthime të lidhura me një faturë origjinale — përdoret te dritarja e detajeve
// të faturës origjinale për të treguar se cilat kthime rrjedhin prej saj.
app.get('/api/purchase-invoices/:id/returns', async (req, res) => {
  try {
    const { id } = req.params;
    res.json(await queryAll(
      `SELECT id, invoice_no, date, total_with_vat, amount_paid, amount_due, payment_method, notes
         FROM purchase_invoices
        WHERE original_purchase_id = ? AND type = 'return'
        ORDER BY date ASC, id ASC`,
      [id]
    ));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST — krijon një faturë kthimi
app.post('/api/purchase-returns', async (req, res) => {
  try {
    const d = req.body || {};
    const origId = parseInt(d.original_purchase_id);
    if (!origId) return res.status(400).json({ error: 'original_purchase_id required' });
    if (!d.date) return res.status(400).json({ error: 'date required' });
    // Backdate lejohet vetëm për admin (parallel me blerjet/shitjet).
    if (req.user?.role !== 'admin' && d.date !== new Date().toISOString().slice(0, 10)) {
      return res.status(403).json({ error: 'only admin can set a non-today date' });
    }

    const orig = await queryOne(
      `SELECT * FROM purchase_invoices WHERE id = ? AND COALESCE(type, 'purchase') = 'purchase'`,
      [origId]
    );
    if (!orig) return res.status(404).json({ error: 'Fatura origjinale nuk u gjet ose nuk është blerje' });

    const inputItems = Array.isArray(d.items) ? d.items.filter(it => parseFloat(it.qty) > 0) : [];
    if (inputItems.length === 0) return res.status(400).json({ error: 'Nuk ka rreshta për kthim' });

    // Ngarko rreshtat origjinalë + sasinë e kthyer deri tani për validim.
    const origItemsRaw = await queryAll(
      `SELECT pi.*,
              COALESCE((
                SELECT SUM(rit.qty)
                  FROM purchase_items rit
                  JOIN purchase_invoices rinv ON rinv.id = rit.purchase_id
                 WHERE rinv.original_purchase_id = ?
                   AND rinv.type = 'return'
                   AND rit.product_id = pi.product_id
              ), 0) AS qty_returned_so_far
         FROM purchase_items pi
        WHERE pi.purchase_id = ?`,
      [origId, origId]
    );
    const origById = new Map(origItemsRaw.map(it => [it.id, it]));

    // Validime + ndërto rreshtat për ruajtje (kopjon çmimet nga origjinali).
    const itemsToInsert = [];
    for (const inp of inputItems) {
      const pid = parseInt(inp.purchase_item_id);
      const origItem = origById.get(pid);
      if (!origItem) {
        return res.status(400).json({ error: `Rreshti ${pid} nuk gjendet te fatura origjinale` });
      }
      const qty = parseFloat(inp.qty) || 0;
      const qtyRemaining = (parseFloat(origItem.qty) || 0) - (parseFloat(origItem.qty_returned_so_far) || 0);
      if (qty > qtyRemaining + 1e-6) {
        return res.status(400).json({
          error: `Sasia për kthim (${qty}) është më e madhe se sasia e mbetur (${qtyRemaining}) për "${origItem.name}"`,
        });
      }
      // Verifikim stoku — user tha "gjithmonë produkte të pa-shitura", pra
      // stoku duhet të jetë ≥ qty. Nëse s'është, e bllokojmë.
      if (origItem.product_id) {
        const prod = await queryOne('SELECT stock FROM products WHERE id = ?', [origItem.product_id]);
        const stock = parseFloat(prod?.stock) || 0;
        if (stock < qty - 1e-6) {
          return res.status(400).json({
            error: `Stoku aktual (${stock}) është më i vogël se sasia për kthim (${qty}) për "${origItem.name}". Produkti mund të jetë shitur — kontrollo.`,
          });
        }
      }
      // Rreshti i kthimit — kopjon të gjitha fushat nga origjinali, override vetëm qty.
      const line = {
        ...origItem,
        qty,
      };
      const totals = computePurchaseLineTotals(line);
      itemsToInsert.push({
        product_id: origItem.product_id,
        serial_no: origItem.serial_no || '',
        barcode: origItem.barcode || '',
        name: origItem.name || '',
        category: origItem.category || '',
        unit: origItem.unit || '',
        gram: parseFloat(origItem.gram) || 0,
        qty: totals.qty,
        purchase_price_no_vat: totals.purchase_price_no_vat,
        cost_price: parseFloat(origItem.cost_price) || 0,
        discount_percent: totals.discount_percent,
        subtotal_no_vat: totals.subtotal_no_vat,
        vat_rate: totals.vat_rate,
        vat_amount: totals.vat_amount,
        total_with_vat: totals.total_with_vat,
        sell_price: parseFloat(origItem.sell_price) || 0,
        has_gram: parseFloat(origItem.has_gram) || 0,
        has_currency: origItem.has_currency || 'HAS',
        has_rate: parseFloat(origItem.has_rate) || 0,
        sell_rate: parseFloat(origItem.sell_rate) || 0,
        has_rate_currency: origItem.has_rate_currency || 'EUR',
        sell_rate_currency: origItem.sell_rate_currency || 'EUR',
        koeficent_pune: parseFloat(origItem.koeficent_pune) || 0,
        multiplier: parseFloat(origItem.multiplier) || 0,
      });
    }

    // Totalet e faturës së kthimit.
    const sub = +itemsToInsert.reduce((s, it) => s + it.subtotal_no_vat, 0).toFixed(2);
    const vat = +itemsToInsert.reduce((s, it) => s + it.vat_amount, 0).toFixed(2);
    const tot = +itemsToInsert.reduce((s, it) => s + it.total_with_vat, 0).toFixed(2);
    const totalDiscount = +itemsToInsert.reduce((s, it) => {
      const gross = (parseFloat(it.qty) || 0) * (parseFloat(it.purchase_price_no_vat) || 0);
      return s + gross * ((parseFloat(it.discount_percent) || 0) / 100);
    }, 0).toFixed(2);

    // Fluksi i parave (default): zbrit borxhin e faturës origjinale së pari,
    // pjesa e mbetur → cash-back. Përdor amount_due të freskët të origjinalit.
    //
    // Modeli i ruajtjes te fatura kthimi:
    //   total_with_vat = vlera e kthyer
    //   amount_paid    = cashBack (paratë që hynë në arkë sot)
    //   amount_due     = 0 gjithmonë (kthimi s'është një detyrim për t'u paguar)
    // Debt reduction llogaritet implicit si total_with_vat - amount_paid, dhe
    // aplikohet direkt te amount_due e faturës origjinale. Kështu shmangim
    // double-counting kur mblidhen borxhet e furnitorit.
    const origDue = Math.max(0, parseFloat(orig.amount_due) || 0);
    const debtReduction = Math.min(tot, origDue);
    const cashBack = +(tot - debtReduction).toFixed(2);
    const amountPaid = cashBack;
    const amountDue = 0;
    const pmR = cashBack > 0 ? 'cash' : 'debt';

    const doInsert = (invNo) => run(
      `INSERT INTO purchase_invoices (
         date, invoice_no, supplier_name, supplier_nipt, currency, exchange_rate,
         subtotal_no_vat, total_discount, total_vat, total_with_vat,
         payment_method, amount_paid, amount_due, notes,
         type, original_purchase_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'return', ?)`,
      [
        d.date, invNo, orig.supplier_name || '', orig.supplier_nipt || '',
        orig.currency || 'LEK', parseFloat(orig.exchange_rate) || 1,
        sub, totalDiscount, vat, tot,
        pmR, amountPaid, amountDue,
        d.notes || `Kthim për faturën ${orig.invoice_no}`,
        origId,
      ]
    );
    const invoice_no = await retryOnUniqueNo(
      () => nextPurchaseNo(d.date, 'return'),
      doInsert,
      5,
      null,
    );
    const created = await queryOne(
      'SELECT id FROM purchase_invoices WHERE date = ? AND invoice_no = ?',
      [d.date, invoice_no]
    );
    const newId = created?.id;

    const batch = [];
    for (const it of itemsToInsert) {
      batch.push({
        sql: `INSERT INTO purchase_items (purchase_id, product_id, serial_no, barcode, name, category, unit, gram, qty,
                purchase_price_no_vat, cost_price, discount_percent, subtotal_no_vat, vat_rate, vat_amount, total_with_vat, sell_price,
                has_gram, has_currency, has_rate, sell_rate, has_rate_currency, sell_rate_currency, koeficent_pune, multiplier)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          newId, it.product_id || null, it.serial_no, it.barcode, it.name,
          it.category, it.unit, it.gram, it.qty,
          it.purchase_price_no_vat, it.cost_price, it.discount_percent,
          it.subtotal_no_vat, it.vat_rate, it.vat_amount, it.total_with_vat,
          it.sell_price,
          it.has_gram, it.has_currency, it.has_rate,
          it.sell_rate, it.has_rate_currency, it.sell_rate_currency,
          it.koeficent_pune, it.multiplier,
        ],
      });
    }
    // Stoku zbritet për kthimin (sign=-1: mallrat dalin nga inventari).
    batch.push(...buildAdjustPurchaseStockStmts(itemsToInsert, -1));
    // Zbrit borxhin e faturës origjinale me debtReduction.
    if (debtReduction > 0) {
      batch.push({
        sql: `UPDATE purchase_invoices
                 SET amount_due = MAX(0, COALESCE(amount_due, 0) - ?)
               WHERE id = ?`,
        args: [debtReduction, origId],
      });
    }
    if (batch.length) await batchWrite(batch);

    res.json({
      success: true,
      id: newId,
      invoice_no,
      total_with_vat: tot,
      cash_back: cashBack,
      debt_reduction: debtReduction,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST — bulk import kthimesh nga Excel. Pranon një listë rreshtash
// { purchase_date, barcode, name, qty, purchase_price } dhe krijon një
// faturë kthimi për secilën faturë origjinale. Çmimet kopjohen nga rreshti
// origjinal (Excel-i shërben si listë referencash, jo si burim çmimi).
app.post('/api/purchase-returns/import', async (req, res) => {
  try {
    const d = req.body || {};
    const date = d.date || new Date().toISOString().slice(0, 10);
    if (req.user?.role !== 'admin' && date !== new Date().toISOString().slice(0, 10)) {
      return res.status(403).json({ error: 'only admin can set a non-today date' });
    }
    const rows = Array.isArray(d.rows) ? d.rows : [];
    if (rows.length === 0) return res.status(400).json({ error: 'Nuk ka rreshta për kthim' });

    const errors = [];
    // purchase_id -> { items: [{ purchase_item_id, qty, origItem, remaining }] }
    const byPurchase = new Map();

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] || {};
      const rowNum = i + 1;
      const barcode = String(r.barcode || '').trim();
      const qty = parseFloat(r.qty) || 0;
      if (!barcode) { errors.push({ row: rowNum, message: 'Barkodi mungon' }); continue; }
      if (qty <= 0) { errors.push({ row: rowNum, barcode, message: 'Sasi jo e vlefshme' }); continue; }

      const prod = await queryOne(
        'SELECT id, stock, name FROM products WHERE barcode = ?',
        [barcode]
      );
      if (!prod) {
        errors.push({ row: rowNum, barcode, message: 'Produkti nuk u gjet për këtë barkod' });
        continue;
      }
      if ((parseFloat(prod.stock) || 0) < qty - 1e-6) {
        errors.push({
          row: rowNum, barcode,
          message: `Stoku aktual (${prod.stock}) < sasia për kthim (${qty}) — ndoshta është shitur`,
        });
        continue;
      }

      // User pohoi që produktet janë unike nëpër fatura, por për siguri
      // filtrojmë me date nëse dërgohet dhe kemi disa përputhje.
      const pItems = await queryAll(
        `SELECT pi.*, inv.date AS invoice_date
           FROM purchase_items pi
           JOIN purchase_invoices inv ON inv.id = pi.purchase_id
          WHERE pi.product_id = ?
            AND COALESCE(inv.type, 'purchase') = 'purchase'
          ORDER BY inv.date DESC, pi.id DESC`,
        [prod.id]
      );
      if (pItems.length === 0) {
        errors.push({ row: rowNum, barcode, message: 'Produkti s\'gjendet në asnjë faturë blerjeje' });
        continue;
      }
      let chosen = pItems[0];
      if (pItems.length > 1 && r.purchase_date) {
        const match = pItems.find(x => x.invoice_date === r.purchase_date);
        if (match) chosen = match;
      }

      const rr = await queryOne(
        `SELECT COALESCE(SUM(rit.qty), 0) AS returned
           FROM purchase_items rit
           JOIN purchase_invoices rinv ON rinv.id = rit.purchase_id
          WHERE rinv.original_purchase_id = ?
            AND rinv.type = 'return'
            AND rit.product_id = ?`,
        [chosen.purchase_id, chosen.product_id]
      );
      const alreadyReturned = parseFloat(rr?.returned) || 0;
      const qtyPurchased = parseFloat(chosen.qty) || 0;
      const remaining = +(qtyPurchased - alreadyReturned).toFixed(4);

      const grp = byPurchase.get(chosen.purchase_id);
      if (grp) {
        const existing = grp.items.find(x => x.purchase_item_id === chosen.id);
        if (existing) {
          const combined = existing.qty + qty;
          if (combined > remaining + 1e-6) {
            errors.push({
              row: rowNum, barcode,
              message: `Sasia totale në Excel (${combined}) > e mbetura (${remaining})`,
            });
            continue;
          }
          existing.qty = combined;
        } else {
          if (qty > remaining + 1e-6) {
            errors.push({
              row: rowNum, barcode,
              message: `Sasia (${qty}) > e mbetura për kthim (${remaining})`,
            });
            continue;
          }
          grp.items.push({ purchase_item_id: chosen.id, qty, origItem: chosen });
        }
      } else {
        if (qty > remaining + 1e-6) {
          errors.push({
            row: rowNum, barcode,
            message: `Sasia (${qty}) > e mbetura për kthim (${remaining})`,
          });
          continue;
        }
        byPurchase.set(chosen.purchase_id, {
          items: [{ purchase_item_id: chosen.id, qty, origItem: chosen }],
        });
      }
    }

    if (byPurchase.size === 0) {
      return res.status(400).json({ error: 'Asnjë rresht i vlefshëm për kthim', errors });
    }

    const invoicesCreated = [];
    for (const [origId, grp] of byPurchase.entries()) {
      const orig = await queryOne(
        `SELECT * FROM purchase_invoices WHERE id = ? AND COALESCE(type, 'purchase') = 'purchase'`,
        [origId]
      );
      if (!orig) {
        errors.push({ original_purchase_id: origId, message: 'Fatura origjinale s\'gjendet' });
        continue;
      }

      const itemsToInsert = grp.items.map(({ qty, origItem }) => {
        const line = { ...origItem, qty };
        const totals = computePurchaseLineTotals(line);
        return {
          product_id: origItem.product_id,
          serial_no: origItem.serial_no || '',
          barcode: origItem.barcode || '',
          name: origItem.name || '',
          category: origItem.category || '',
          unit: origItem.unit || '',
          gram: parseFloat(origItem.gram) || 0,
          qty: totals.qty,
          purchase_price_no_vat: totals.purchase_price_no_vat,
          cost_price: parseFloat(origItem.cost_price) || 0,
          discount_percent: totals.discount_percent,
          subtotal_no_vat: totals.subtotal_no_vat,
          vat_rate: totals.vat_rate,
          vat_amount: totals.vat_amount,
          total_with_vat: totals.total_with_vat,
          sell_price: parseFloat(origItem.sell_price) || 0,
          has_gram: parseFloat(origItem.has_gram) || 0,
          has_currency: origItem.has_currency || 'HAS',
          has_rate: parseFloat(origItem.has_rate) || 0,
          sell_rate: parseFloat(origItem.sell_rate) || 0,
          has_rate_currency: origItem.has_rate_currency || 'EUR',
          sell_rate_currency: origItem.sell_rate_currency || 'EUR',
          koeficent_pune: parseFloat(origItem.koeficent_pune) || 0,
          multiplier: parseFloat(origItem.multiplier) || 0,
        };
      });

      const sub = +itemsToInsert.reduce((s, it) => s + it.subtotal_no_vat, 0).toFixed(2);
      const vat = +itemsToInsert.reduce((s, it) => s + it.vat_amount, 0).toFixed(2);
      const tot = +itemsToInsert.reduce((s, it) => s + it.total_with_vat, 0).toFixed(2);
      const totalDiscount = +itemsToInsert.reduce((s, it) => {
        const gross = (parseFloat(it.qty) || 0) * (parseFloat(it.purchase_price_no_vat) || 0);
        return s + gross * ((parseFloat(it.discount_percent) || 0) / 100);
      }, 0).toFixed(2);

      const origDue = Math.max(0, parseFloat(orig.amount_due) || 0);
      const debtReduction = Math.min(tot, origDue);
      const cashBack = +(tot - debtReduction).toFixed(2);
      const amountPaid = cashBack;
      const amountDue = 0;
      const pmR = cashBack > 0 ? 'cash' : 'debt';

      const doInsert = (invNo) => run(
        `INSERT INTO purchase_invoices (
           date, invoice_no, supplier_name, supplier_nipt, currency, exchange_rate,
           subtotal_no_vat, total_discount, total_vat, total_with_vat,
           payment_method, amount_paid, amount_due, notes,
           type, original_purchase_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'return', ?)`,
        [
          date, invNo, orig.supplier_name || '', orig.supplier_nipt || '',
          orig.currency || 'LEK', parseFloat(orig.exchange_rate) || 1,
          sub, totalDiscount, vat, tot,
          pmR, amountPaid, amountDue,
          d.notes || `Kthim nga Excel — për faturën ${orig.invoice_no}`,
          origId,
        ]
      );
      const invoice_no = await retryOnUniqueNo(
        () => nextPurchaseNo(date, 'return'),
        doInsert,
        5,
        null,
      );
      const created = await queryOne(
        'SELECT id FROM purchase_invoices WHERE date = ? AND invoice_no = ?',
        [date, invoice_no]
      );
      const newId = created?.id;

      const batch = [];
      for (const it of itemsToInsert) {
        batch.push({
          sql: `INSERT INTO purchase_items (purchase_id, product_id, serial_no, barcode, name, category, unit, gram, qty,
                  purchase_price_no_vat, cost_price, discount_percent, subtotal_no_vat, vat_rate, vat_amount, total_with_vat, sell_price,
                  has_gram, has_currency, has_rate, sell_rate, has_rate_currency, sell_rate_currency, koeficent_pune, multiplier)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            newId, it.product_id || null, it.serial_no, it.barcode, it.name,
            it.category, it.unit, it.gram, it.qty,
            it.purchase_price_no_vat, it.cost_price, it.discount_percent,
            it.subtotal_no_vat, it.vat_rate, it.vat_amount, it.total_with_vat,
            it.sell_price,
            it.has_gram, it.has_currency, it.has_rate,
            it.sell_rate, it.has_rate_currency, it.sell_rate_currency,
            it.koeficent_pune, it.multiplier,
          ],
        });
      }
      batch.push(...buildAdjustPurchaseStockStmts(itemsToInsert, -1));
      if (debtReduction > 0) {
        batch.push({
          sql: `UPDATE purchase_invoices
                   SET amount_due = MAX(0, COALESCE(amount_due, 0) - ?)
                 WHERE id = ?`,
          args: [debtReduction, origId],
        });
      }
      if (batch.length) await batchWrite(batch);

      invoicesCreated.push({
        id: newId,
        invoice_no,
        original_purchase_id: origId,
        original_invoice_no: orig.invoice_no,
        supplier_name: orig.supplier_name,
        total_with_vat: tot,
        cash_back: cashBack,
        debt_reduction: debtReduction,
        items_count: itemsToInsert.length,
      });
    }

    res.json({
      success: true,
      invoices_created: invoicesCreated,
      errors,
      rows_ok: rows.length - errors.length,
      rows_failed: errors.length,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE — zhbën një faturë kthimi
app.delete('/api/purchase-returns/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const ret = await queryOne(
      `SELECT * FROM purchase_invoices WHERE id = ? AND type = 'return'`,
      [id]
    );
    if (!ret) return res.status(404).json({ error: 'Kthimi nuk u gjet' });

    const items = await queryAll('SELECT * FROM purchase_items WHERE purchase_id = ?', [id]);

    const batch = [];
    // Kthe stokun mbrapsht (sign=+1: mallrat rihyjnë në inventar).
    batch.push(...buildAdjustPurchaseStockStmts(items, +1));
    // Rikthe borxhin te fatura origjinale. Debt reduction = total - amount_paid
    // (pjesa që nuk u mor cash u zbrit nga borxhi i origjinalit).
    const debtReduction = Math.max(
      0,
      (parseFloat(ret.total_with_vat) || 0) - (parseFloat(ret.amount_paid) || 0)
    );
    if (debtReduction > 0 && ret.original_purchase_id) {
      batch.push({
        sql: `UPDATE purchase_invoices
                 SET amount_due = COALESCE(amount_due, 0) + ?
               WHERE id = ?`,
        args: [debtReduction, ret.original_purchase_id],
      });
    }
    batch.push({ sql: 'DELETE FROM purchase_items WHERE purchase_id = ?', args: [id] });
    batch.push({ sql: 'DELETE FROM purchase_invoices WHERE id = ?', args: [id] });
    if (batch.length) await batchWrite(batch);

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
    const purchase_no = await retryOnUniqueNo(
      () => nextHurdaNo(d.date),
      doInsertHurda,
      5,
      userProvidedNo || null,
    );
    const created = await queryOne('SELECT id FROM hurda_purchases WHERE date = ? AND purchase_no = ?', [d.date, purchase_no]);
    if (d.supplier_nipt || d.supplier_name) await upsertSupplierIfMissing(d.supplier_nipt, d.supplier_name);
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
    const purchase_no = await retryOnUniqueNo(
      () => nextHasNo(d.date),
      doInsertHas,
      5,
      userProvidedNo || null,
    );
    const created = await queryOne('SELECT id FROM has_purchases WHERE date = ? AND purchase_no = ?', [d.date, purchase_no]);
    if (d.supplier_nipt || d.supplier_name) await upsertSupplierIfMissing(d.supplier_nipt, d.supplier_name);
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
      const ref_no = await retryOnUniqueNo(
        () => nextRefNo(d.date),
        doInsertHead,
        5,
        userProvidedNo || null,
      );
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
      const ref_no = await retryOnUniqueNo(
        () => nextRefNo(d.date),
        doInsertMagHead,
        5,
        userProvidedNo || null,
      );
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
    // Çdo faturë me amount_due > 0 është detyrim, pavarësisht payment_method-it.
    // Filtri i vjetër (payment_method IN ('bank','debt')) fshinte faturat kur user-i
    // hapte faturën dhe bënte një pagesë të pjesshme cash — splits-i bënte
    // pmU='cash' dhe fatura zhdukej edhe pse amount_due > 0 ende.
    let sql = `
      SELECT pi.*,
        (SELECT date   FROM purchase_payments WHERE purchase_id = pi.id ORDER BY date DESC, id DESC LIMIT 1) AS last_payment_date,
        (SELECT amount FROM purchase_payments WHERE purchase_id = pi.id ORDER BY date DESC, id DESC LIMIT 1) AS last_payment_amount,
        (SELECT COUNT(*) FROM purchase_payments WHERE purchase_id = pi.id) AS payment_count
      FROM purchase_invoices pi
      WHERE COALESCE(pi.amount_due, pi.total_with_vat - pi.amount_paid) > 0
        AND COALESCE(pi.type, 'purchase') = 'purchase'`;
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
    // Përfshi çdo faturë — filtrimi bëhet me amount_due > 0 (te HAVING më poshtë
    // kur onlyDebt=1). Kështu edhe faturat me pagesa të pjesshme cash që kanë
    // ende borxh të pambuluar shfaqen te përmbledhësja e furnitorit.
    const conds = ['1=1'];
    const params = [];
    if (from) { conds.push('date >= ?'); params.push(from); }
    if (to)   { conds.push('date <= ?'); params.push(to); }
    const where = `WHERE ${conds.join(' AND ')}`;
    // Kthimet (type='return') netohen: total dhe amount_paid llogariten me shenjë
    // negative (kredi/rimbursim); amount_due kontribuon vetëm nga blerjet (kthimet
    // e ruajnë amount_due=0 dhe në vend të kësaj ulin amount_due të faturës origjinale).
    const sql = `
      SELECT
        COALESCE(NULLIF(supplier_nipt, ''), supplier_name) AS supplier_key,
        supplier_name,
        supplier_nipt,
        currency,
        SUM(CASE WHEN COALESCE(type, 'purchase') = 'purchase' THEN 1 ELSE 0 END) AS invoice_count,
        SUM(CASE WHEN COALESCE(type, 'purchase') = 'return' THEN 1 ELSE 0 END) AS return_count,
        SUM(CASE WHEN COALESCE(type, 'purchase') = 'return'
                 THEN -total_with_vat ELSE total_with_vat END) AS total,
        SUM(CASE WHEN COALESCE(type, 'purchase') = 'return'
                 THEN -amount_paid ELSE amount_paid END) AS paid,
        SUM(CASE WHEN COALESCE(type, 'purchase') = 'return'
                 THEN 0
                 ELSE COALESCE(amount_due, total_with_vat - amount_paid) END) AS due
      FROM purchase_invoices
      ${where}
      GROUP BY supplier_key, supplier_name, supplier_nipt, currency
      ${onlyDebt ? `HAVING SUM(CASE WHEN COALESCE(type, 'purchase') = 'return'
                                     THEN 0
                                     ELSE COALESCE(amount_due, total_with_vat - amount_paid) END) > 0` : ''}
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
    // Memory cache 60s — thirret në cdo Fatura Shitje.
    const rows = await cached('clients:all', 60_000, () =>
      queryAll('SELECT * FROM clients ORDER BY last_name, first_name', []));
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
    // Cache 60s për këtë endpoint të shtrenjtë — bën 8 JOIN të plota mbi
    // historikun e blerjeve/shitjeve për çdo thirrje. Dashboard-i i çdo klienti
    // e thërret disa herë; me cache, 3 klientë me Dashboard hapur ndajnë 1
    // kalkulim, jo 3. Invalidohet automatikisht kur preket products/invoices/
    // purchase_invoices/magazina_* (shih middleware-in e broadcast).
    const cacheKey = `inventory-summary:from=${from || ''}&to=${to || ''}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);
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

    const payload = { rows, totals, profitByCurrency };
    cacheSet(cacheKey, payload, 60_000);
    res.json(payload);
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
         COALESCE(i.is_credit_note, 0)        AS is_credit_note,
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

    const xhiro_total   = zeroPerCur();  // vetëm shitjet pozitive
    const paid_bank     = zeroPerCur();
    const paid_pos      = zeroPerCur();
    const amount_due    = zeroPerCur();
    // Kthimet ndahen për vete që të shfaqen si rresht i dedikuar te UI,
    // e jo të ndotin totalin e xhiros. `returns_gross` = vlera totale e artikujve
    // të kthyer; ndarja bank/pos/cash tregon nga cili kanal doli rimbursimi.
    const returns_gross = zeroPerCur();
    const returns_cash  = zeroPerCur();  // rimbursime kesh (dalje nga arka)
    const returns_bank  = zeroPerCur();  // rimbursime bankë (dalje nga bank)
    const returns_pos   = zeroPerCur();  // rimbursime POS (dalje nga pos)
    const returns_debt  = zeroPerCur();  // reduktim borxhi klienti (jo lëvizje kesh)
    let credit_note_count = 0;

    for (const r of salesRows) {
      const c = (r.cur || 'LEK').toUpperCase();
      if (!(c in xhiro_total)) continue;

      // ── Kthimet (kreditoret) — ndahen nga xhiro ──────────────────────────
      // total_with_vat është negativ; ekspozojmë vlerë pozitive për UI.
      if (r.is_credit_note) {
        credit_note_count += 1;
        const abs = Math.abs(r.total);
        returns_gross[c] += abs;
        if (r.pm === 'cash')      returns_cash[c] += abs;
        else if (r.pm === 'bank') returns_bank[c] += abs;
        else if (r.pm === 'pos')  returns_pos[c]  += abs;
        else if (r.pm === 'debt') returns_debt[c] += abs;
        else if (r.pm === 'mikse') {
          const splits = splitsByInv[r.id] || [];
          for (const s of splits) {
            const sc = (s.currency || c).toUpperCase();
            if (!(sc in returns_gross)) continue;
            const amt = Math.abs(parseFloat(s.amount) || 0);
            if (s.method === 'cash')      returns_cash[sc] += amt;
            else if (s.method === 'bank') returns_bank[sc] += amt;
            else if (s.method === 'pos')  returns_pos[sc]  += amt;
          }
        }
        continue;
      }

      // ── Shitjet e zakonshme (pozitive) ───────────────────────────────────
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
      else if (r.pm === 'cash') {
        // Fatura pm='cash' zakonisht janë paguar plotësisht, por user mund të
        // ketë vendosur manualisht një pjesë të papaguar (p.sh. amount_paid
        // < total_with_vat). Ne trajtojmë atë pjesë si borxh që nuk hyri kesh.
        xhiro_total[c] += r.total;
        const paidNow = Math.max(0, Math.min(r.initial_paid || 0, r.total));
        const due     = Math.max(0, r.total - paidNow);
        if (due > 0.005) amount_due[c] += due;
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

    // Shpenzimet ndahen në 3 kategori te Arka Ditore që të jenë të dallueshme:
    //   - daily     (Shpenzime Ditore)  — kolona `kind='daily'`
    //   - transport (Shpenzime Transporti) — kolona `kind='transport'`
    //   - marketing (Shpenzime Marketingu) — cash direkt + kontratë cash
    //     (in-kind trajtohet si shitje me vlerën e kostos, jo si shpenzim)
    const expRows = await queryAll(
      `SELECT COALESCE(currency, 'LEK') AS cur,
              COALESCE(amount, 0)       AS amt,
              COALESCE(kind, 'daily')   AS kind
         FROM expense_entries WHERE date = ?`,
      [date]
    );
    const expenses_daily     = zeroPerCur();
    const expenses_transport = zeroPerCur();
    const expenses_marketing = zeroPerCur();
    let daily_count = 0, transport_count = 0;
    for (const r of expRows) {
      const c = (r.cur || 'LEK').toUpperCase();
      if (!(c in expenses_daily)) continue;
      if (r.kind === 'transport') { expenses_transport[c] += r.amt; transport_count++; }
      else                         { expenses_daily[c]     += r.amt; daily_count++; }
    }
    // Marketing contract cash EUR entries — shpenzime marketingu EUR në arkë.
    const mktCashRows = await queryAll(
      `SELECT COALESCE(amount_eur, 0) AS amt
         FROM marketing_contract_entries
        WHERE date = ? AND type = 'cash'`,
      [date]
    );
    for (const r of mktCashRows) expenses_marketing.EUR += r.amt;

    // Zërat direkt cash të Marketingut (jo nga kontratë, pa produkt) → shpenzim
    // marketingu në arkë me monedhën përkatëse. Rreshtat me product_id janë
    // in-kind dhe trajtohen si shitje më poshtë (jo si shpenzim).
    const mktDirectCashRows = await queryAll(
      `SELECT COALESCE(currency, 'LEK') AS cur,
              COALESCE(amount, 0)       AS amt
         FROM marketing_expenses
        WHERE date = ? AND product_id IS NULL`,
      [date]
    );
    for (const r of mktDirectCashRows) {
      const c = (r.cur || 'LEK').toUpperCase();
      if (c in expenses_marketing) expenses_marketing[c] += r.amt;
    }

    // Marketing "in kind" (produkt si formë pagese/dhurate) — trajtohet SI SHITJE
    // me VLERËN E KOSTOS së produktit (qty × cost_price). Shtohet te xhiro_total.EUR,
    // që të dalë si "shitje" në Arka Ditore me 0 fitim (revenue = kosto). NUK
    // zbritet më si shpenzim (paratë u shpenzuan te blerja origjinale).
    const mktProdRows = await queryAll(
      `SELECT COALESCE(m.product_qty, 0)  AS qty,
              COALESCE(p.cost_price, 0)   AS cost
         FROM marketing_expenses m
         JOIN products p ON p.id = m.product_id
        WHERE m.date = ? AND m.product_id IS NOT NULL`,
      [date]
    );
    const mktContractProdRows = await queryAll(
      `SELECT COALESCE(mce.product_qty, 0) AS qty,
              COALESCE(p.cost_price, 0)    AS cost
         FROM marketing_contract_entries mce
         JOIN products p ON p.id = mce.product_id
        WHERE mce.date = ? AND mce.type = 'product' AND mce.product_id IS NOT NULL`,
      [date]
    );
    let marketing_in_kind_eur = 0;
    for (const r of mktProdRows) marketing_in_kind_eur += (r.qty * r.cost) || 0;
    for (const r of mktContractProdRows) marketing_in_kind_eur += (r.qty * r.cost) || 0;
    marketing_in_kind_eur = +marketing_in_kind_eur.toFixed(2);
    // marketing_in_kind_eur kthehet si fushë e veçantë dhe shfaqet ndarë te UI
    // si "Marketingu Shitje" — NUK përfshihet te xhiro_total (që të jetë e
    // dallueshme nga shitjet e vërteta). Sidoqoftë hyn te cash_from_sales më
    // poshtë që arka ta ketë efektin pozitiv sikur të kishte qenë shitje kesh.

    // Agregat për cash_balance calc dhe backward-compat (fusha `expenses`).
    const expenses = zeroPerCur();
    for (const c of CURS) {
      expenses[c] = expenses_daily[c] + expenses_transport[c] + expenses_marketing[c];
    }

    // Fatura Blerje kesh (payment_method='cash') → amount_paid në monedhën origjinale.
    // Kthimet (type='return') me pm='cash' kontribuojnë me shenjë negative:
    // paratë hynë mbrapsht në arkë, pra zbresin nga shpenzimi neto i ditës.
    const purRows = await queryAll(
      `SELECT COALESCE(currency, 'LEK') AS cur,
              CASE WHEN COALESCE(type, 'purchase') = 'return'
                   THEN -COALESCE(amount_paid, 0)
                   ELSE  COALESCE(amount_paid, 0)
              END AS amt
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

    // Depozitat nga porositë (custom orders) — cash që hyri në sirtar për
    // pagesa paraprake të porosive. Regjistrohet për datën e depozitës.
    const porosiDepRows = await queryAll(
      `SELECT COALESCE(currency, 'EUR') AS cur,
              COALESCE(amount, 0)       AS amt
         FROM porosi_deposits
        WHERE date = ? AND method = 'cash'`,
      [date]
    );
    const porosi_deposits = zeroPerCur();
    for (const r of porosiDepRows) {
      const c = (r.cur || 'EUR').toUpperCase();
      if (c in porosi_deposits) porosi_deposits[c] += r.amt;
    }

    // Pagesat e punëtorëve (pjesa kesh + shpërblim kesh) — dalje EUR nga arka.
    const workerCashRow = await queryOne(
      `SELECT COALESCE(SUM(salary_cash_eur + bonus_cash_eur), 0) AS amt,
              COUNT(*) AS cnt
         FROM worker_payments WHERE date_paid = ?`,
      [date]
    ) || {};
    const worker_payments_cash = zeroPerCur();
    worker_payments_cash.EUR = +(workerCashRow.amt || 0).toFixed(2);
    const worker_payments_count = workerCashRow.cnt || 0;

    // Tërheqjet nga kasaforta me destinacion 'arka' — hyjnë si kesh në sirtar.
    const safeToArkaRows = await queryAll(
      `SELECT COALESCE(amount_lek, 0) AS LEK,
              COALESCE(amount_eur, 0) AS EUR,
              COALESCE(amount_usd, 0) AS USD,
              COALESCE(amount_gbp, 0) AS GBP,
              COALESCE(amount_chf, 0) AS CHF
         FROM safe_withdrawals
        WHERE date = ? AND COALESCE(destination, 'jashte') = 'arka'`,
      [date]
    );
    const safe_to_arka = zeroPerCur();
    for (const r of safeToArkaRows) {
      for (const c of CURS) safe_to_arka[c] += (r[c] || 0);
    }

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
      // Marketing "in kind" trajtohet si shitje me vlerën e kostos — shtohet
      // te cash_from_sales.EUR (jo te xhiro_total, që aty të tregohen vetëm
      // shitjet reale). Për UI shfaqet si rresht i veçantë "Marketingu Shitje".
      if (c === 'EUR') cash_from_sales[c] += marketing_in_kind_eur;
      cash_balance[c]    = opening_cash[c] + cash_from_sales[c] + debt_repayments[c] + porosi_deposits[c]
                          + safe_to_arka[c]
                          - expenses[c] - purchase_cash[c] - hurda_cash[c] - has_cash[c]
                          - worker_payments_cash[c]
                          - returns_cash[c];
      carryover_next_day[c] = Math.max(0, physical_cash[c] - closeout_to_safe[c]);
      // Për rastin normal (cash_balance >= 0): physical - teorike, si zakonisht.
      // Kur cash_balance del negative (të dhëna inkonsistente — daljet tejkalojnë
      // hyrjet e regjistruara), përdorim |cash_balance| që shenja e diferencës të
      // jetë intuitive: mungesa shfaqet si negative, tepricat si pozitive.
      difference[c]      = physical_cash[c] - Math.abs(cash_balance[c]);
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
      porosi_deposits:   fx(porosi_deposits),
      safe_to_arka:      fx(safe_to_arka),
      worker_payments_cash: fx(worker_payments_cash),
      returns_gross:     fx(returns_gross),
      returns_cash:      fx(returns_cash),
      returns_bank:      fx(returns_bank),
      returns_pos:       fx(returns_pos),
      returns_debt:      fx(returns_debt),
      expenses:          fx(expenses),
      expenses_daily:     fx(expenses_daily),
      expenses_transport: fx(expenses_transport),
      expenses_marketing: fx(expenses_marketing),
      // Kosto e produkteve të dhëna si marketing "in kind" — trajtohet si shitje
      // me vlerën e kostos (shtohet te cash_from_sales.EUR, jo te xhiro_total).
      // Shfaqet si rresht i veçantë "Marketingu Shitje" te UI.
      marketing_in_kind_eur,
      marketing_in_kind: { LEK: 0, EUR: marketing_in_kind_eur, USD: 0, GBP: 0, CHF: 0 },
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
        invoices: salesRows.length - credit_note_count,
        credit_notes: credit_note_count,
        expenses: expRows.length,
        expenses_daily: daily_count,
        expenses_transport: transport_count,
        expenses_marketing: mktCashRows.length + mktDirectCashRows.length,
        purchases_cash: purRows.length,
        hurda_purchases: hurdaRows.length,
        has_purchases: hasRows.length,
        porosi_deposits: porosiDepRows.length,
        debt_repayments: debtPayRows.length,
        marketing_in_kind: mktProdRows.length + mktContractProdRows.length,
        safe_to_arka: safeToArkaRows.length,
        worker_payments: worker_payments_count,
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
      `SELECT COALESCE(currency, 'LEK') AS cur,
              COALESCE(amount, 0)       AS amt,
              COALESCE(kind, 'daily')   AS kind
         FROM expense_entries WHERE date BETWEEN ? AND ?`,
      [from, to]
    );
    const expenses_daily     = zeroPerCur();
    const expenses_transport = zeroPerCur();
    const expenses_marketing = zeroPerCur();
    let daily_count = 0, transport_count = 0;
    for (const r of expRows) {
      const c = (r.cur || 'LEK').toUpperCase();
      if (!(c in expenses_daily)) continue;
      if (r.kind === 'transport') { expenses_transport[c] += r.amt; transport_count++; }
      else                         { expenses_daily[c]     += r.amt; daily_count++; }
    }
    const mktCashRangeRows = await queryAll(
      `SELECT COALESCE(amount_eur, 0) AS amt
         FROM marketing_contract_entries
        WHERE date BETWEEN ? AND ? AND type = 'cash'`,
      [from, to]
    );
    for (const r of mktCashRangeRows) expenses_marketing.EUR += r.amt;

    // Zërat direkt cash të Marketingut për periudhën — shpenzime marketingu në arkë sipas monedhës.
    const mktDirectCashRangeRows = await queryAll(
      `SELECT COALESCE(currency, 'LEK') AS cur,
              COALESCE(amount, 0)       AS amt
         FROM marketing_expenses
        WHERE date BETWEEN ? AND ? AND product_id IS NULL`,
      [from, to]
    );
    for (const r of mktDirectCashRangeRows) {
      const c = (r.cur || 'LEK').toUpperCase();
      if (c in expenses_marketing) expenses_marketing[c] += r.amt;
    }

    // Marketing "in kind" për periudhën — trajtohet si shitje me vlerën e kostos
    // (shtohet te xhiro_total.EUR, jo si shpenzim).
    const mktProdRangeRows = await queryAll(
      `SELECT COALESCE(m.product_qty, 0) AS qty,
              COALESCE(p.cost_price, 0)  AS cost
         FROM marketing_expenses m
         JOIN products p ON p.id = m.product_id
        WHERE m.date BETWEEN ? AND ? AND m.product_id IS NOT NULL`,
      [from, to]
    );
    const mktContractProdRangeRows = await queryAll(
      `SELECT COALESCE(mce.product_qty, 0) AS qty,
              COALESCE(p.cost_price, 0)    AS cost
         FROM marketing_contract_entries mce
         JOIN products p ON p.id = mce.product_id
        WHERE mce.date BETWEEN ? AND ? AND mce.type = 'product' AND mce.product_id IS NOT NULL`,
      [from, to]
    );
    let marketing_in_kind_eur = 0;
    for (const r of mktProdRangeRows) marketing_in_kind_eur += (r.qty * r.cost) || 0;
    for (const r of mktContractProdRangeRows) marketing_in_kind_eur += (r.qty * r.cost) || 0;
    marketing_in_kind_eur = +marketing_in_kind_eur.toFixed(2);
    // marketing_in_kind_eur mbahet i ndarë nga xhiro; shtohet te cash_from_sales
    // më poshtë (efekti pozitiv në arkë, si shitje kesh).

    // Agregat për backward-compat dhe cash_balance calc në range endpoint.
    const expenses = zeroPerCur();
    for (const c of CURS) {
      expenses[c] = expenses_daily[c] + expenses_transport[c] + expenses_marketing[c];
    }

    const purRows = await queryAll(
      `SELECT COALESCE(currency, 'LEK') AS cur,
              CASE WHEN COALESCE(type, 'purchase') = 'return'
                   THEN -COALESCE(amount_paid, 0)
                   ELSE  COALESCE(amount_paid, 0)
              END AS amt
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

    const porosiDepRows = await queryAll(
      `SELECT COALESCE(currency, 'EUR') AS cur, COALESCE(amount, 0) AS amt
         FROM porosi_deposits
        WHERE date BETWEEN ? AND ? AND method = 'cash'`,
      [from, to]
    );
    const porosi_deposits = zeroPerCur();
    for (const r of porosiDepRows) {
      const c = (r.cur || 'EUR').toUpperCase();
      if (c in porosi_deposits) porosi_deposits[c] += r.amt;
    }

    const cash_from_sales = zeroPerCur();
    const cash_balance    = zeroPerCur();
    for (const c of CURS) {
      cash_from_sales[c] = xhiro_total[c] - paid_bank[c] - paid_pos[c] - amount_due[c];
      if (c === 'EUR') cash_from_sales[c] += marketing_in_kind_eur;
      cash_balance[c]    = cash_from_sales[c] + debt_repayments[c] + porosi_deposits[c]
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
      porosi_deposits: fx(porosi_deposits),
      expenses:        fx(expenses),
      expenses_daily:     fx(expenses_daily),
      expenses_transport: fx(expenses_transport),
      expenses_marketing: fx(expenses_marketing),
      marketing_in_kind_eur,
      marketing_in_kind: { LEK: 0, EUR: marketing_in_kind_eur, USD: 0, GBP: 0, CHF: 0 },
      purchase_cash:   fx(purchase_cash),
      hurda_cash:      fx(hurda_cash),
      has_cash:        fx(has_cash),
      cash_balance:    fx(cash_balance),
      counts: {
        invoices: salesRows.length,
        expenses: expRows.length,
        expenses_daily: daily_count,
        expenses_transport: transport_count,
        expenses_marketing: mktCashRangeRows.length + mktDirectCashRangeRows.length,
        purchases_cash: purRows.length,
        hurda_purchases: hurdaRows.length,
        has_purchases: hasRows.length,
        porosi_deposits: porosiDepRows.length,
        debt_repayments: debtPayRows.length,
        marketing_in_kind: mktProdRangeRows.length + mktContractProdRangeRows.length,
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

    // Derdhje direkte në kasafortë (safe_deposits) — agregohen për datë.
    const sdSelect = CURS.map(c =>
      `COALESCE(SUM(amount_${c.toLowerCase()}), 0) AS sd_${c}`
    ).join(', ');
    const sdRows = await queryAll(
      `SELECT date, ${sdSelect}
         FROM safe_deposits
         GROUP BY date`
    );
    const sdByDate = {};
    for (const r of sdRows) sdByDate[r.date] = r;

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

    // Bashkoj datat: nga daily_records, bank_movements, safe_deposits dhe konvertimet.
    const allDates = new Set(rows.map(r => r.date));
    for (const d of Object.keys(bmByDate))   allDates.add(d);
    for (const d of Object.keys(sdByDate))   allDates.add(d);
    for (const d of Object.keys(convByDate)) allDates.add(d);
    const sortedDates = [...allDates].sort();

    const rowsByDate = {};
    for (const r of rows) rowsByDate[r.date] = r;

    const running = { LEK: 0, EUR: 0, USD: 0, GBP: 0, CHF: 0 };
    const history = sortedDates.map(date => {
      const r  = rowsByDate[date] || {};
      const bm = bmByDate[date]   || {};
      const sd = sdByDate[date]   || {};
      const cv = convByDate[date] || {};
      const perCur = {};
      for (const c of CURS) {
        const rawDep = r[`dep_${c}`] || 0;   // safe_deposit_{cur} nga daily_records
        const rawWd  = r[`wd_${c}`]  || 0;   // safe_withdraw_{cur}
        const co     = r[`co_${c}`]  || 0;
        const convIn  = cv[c]?.in  || 0;
        const convOut = cv[c]?.out || 0;
        // "Derdhje" e pastër = bankë→kasafortë + derdhje direkte (safe_deposits).
        // safe_deposit_{cur} ekziston vetëm nga konvertimet — e heqim conv_in që
        // të mos dyfishohet.
        const depositPure  = Math.max(0, rawDep - convIn) + (bm[`bm_${c}`] || 0) + (sd[`sd_${c}`] || 0);
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

// GET — ngjarjet individuale të kasafortës për një datë specifike, të grupuara
// sipas llojit (withdrawals, conversions, bank→safe deposits, closeout). Përdoret
// nga modal-i "Menaxho Veprime" te Kasaforta për admin (fshirja e gabimeve).
app.get('/api/kasaforta/events/:date', async (req, res) => {
  try {
    const { date } = req.params;
    if (!date) return res.status(400).json({ error: 'date required' });

    const withdrawals = await queryAll(
      `SELECT id, date, amount_lek, amount_eur, amount_usd, amount_gbp, amount_chf,
              COALESCE(destination, 'jashte') AS destination,
              person, note, created_at
         FROM safe_withdrawals
        WHERE date = ?
        ORDER BY created_at ASC, id ASC`,
      [date]
    );

    const conversions = await queryAll(
      `SELECT id, date, from_currency, from_amount, to_currency, to_amount,
              exchange_rate, note, created_at
         FROM safe_conversions
        WHERE date = ?
        ORDER BY created_at ASC, id ASC`,
      [date]
    );

    const bankDeposits = await queryAll(
      `SELECT id, date, direction, amount_lek, amount_eur, amount_usd, amount_gbp, amount_chf,
              note, created_at
         FROM bank_movements
        WHERE date = ? AND direction = 'to_safe'
        ORDER BY created_at ASC, id ASC`,
      [date]
    );

    const directDeposits = await queryAll(
      `SELECT id, date, amount_lek, amount_eur, amount_usd, amount_gbp, amount_chf,
              note, created_at
         FROM safe_deposits
        WHERE date = ?
        ORDER BY created_at ASC, id ASC`,
      [date]
    );

    const closeoutRow = await queryOne(
      `SELECT COALESCE(closeout_to_safe_lek, 0) AS lek,
              COALESCE(closeout_to_safe_eur, 0) AS eur,
              COALESCE(closeout_to_safe_usd, 0) AS usd,
              COALESCE(closeout_to_safe_gbp, 0) AS gbp,
              COALESCE(closeout_to_safe_chf, 0) AS chf
         FROM daily_records
        WHERE date = ?`,
      [date]
    );
    const closeoutTotal = closeoutRow
      ? (closeoutRow.lek + closeoutRow.eur + closeoutRow.usd + closeoutRow.gbp + closeoutRow.chf)
      : 0;
    const closeout = closeoutTotal > 0 ? {
      date,
      amounts: {
        LEK: closeoutRow.lek, EUR: closeoutRow.eur, USD: closeoutRow.usd,
        GBP: closeoutRow.gbp, CHF: closeoutRow.chf,
      },
    } : null;

    res.json({ date, withdrawals, conversions, bank_deposits: bankDeposits, direct_deposits: directDeposits, closeout });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE — anulon closeout_to_safe për një datë (zeron kolonat në daily_records).
// Vetëm admin. Përdoret kur "Mbyllja e Ditës" është kryer gabimisht.
app.delete('/api/kasaforta/closeout/:date', async (req, res) => {
  try {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
    const { date } = req.params;
    if (!date) return res.status(400).json({ error: 'date required' });
    const CURS_LC = ['lek', 'eur', 'usd', 'gbp', 'chf'];
    const setClause = CURS_LC.map(c => `closeout_to_safe_${c} = 0`).join(', ');
    await run(`UPDATE daily_records SET ${setClause} WHERE date = ?`, [date]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

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
              COALESCE(destination, 'jashte') AS destination,
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
    const destination = String(d.destination || 'jashte').trim().toLowerCase();
    if (!['arka', 'bank', 'jashte'].includes(destination)) {
      return res.status(400).json({ error: "destination duhet të jetë 'arka' | 'bank' | 'jashte'" });
    }
    const person = String(d.person || '').trim();
    const note   = String(d.note   || '').trim();
    const cols = CURS_SW.map(c => `amount_${c}`);
    const vals = CURS_SW.map(c => amounts[c]);
    await run(
      `INSERT INTO safe_withdrawals (date, ${cols.join(', ')}, destination, person, note)
       VALUES (?, ${cols.map(() => '?').join(', ')}, ?, ?, ?)`,
      [date, ...vals, destination, person, note]
    );
    await syncSafeWithdrawTotals(date);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/safe-withdrawals/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await queryOne('SELECT date FROM safe_withdrawals WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'not found' });
    const d = req.body || {};
    const date = d.date || existing.date;
    const amounts = {};
    let anyPositive = false;
    for (const c of CURS_SW) {
      const v = parseFloat(d[`amount_${c}`]) || 0;
      amounts[c] = v;
      if (v > 0) anyPositive = true;
    }
    if (!anyPositive) return res.status(400).json({ error: 'shuma duhet të jetë > 0' });
    const destination = String(d.destination || 'jashte').trim().toLowerCase();
    if (!['arka', 'bank', 'jashte'].includes(destination)) {
      return res.status(400).json({ error: "destination duhet të jetë 'arka' | 'bank' | 'jashte'" });
    }
    const person = String(d.person || '').trim();
    const note   = String(d.note   || '').trim();
    const setParts = ['date = ?', ...CURS_SW.map(c => `amount_${c} = ?`), 'destination = ?', 'person = ?', 'note = ?'];
    const params = [date, ...CURS_SW.map(c => amounts[c]), destination, person, note, id];
    await run(`UPDATE safe_withdrawals SET ${setParts.join(', ')} WHERE id = ?`, params);
    await syncSafeWithdrawTotals(existing.date);
    if (date !== existing.date) await syncSafeWithdrawTotals(date);
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
// SAFE DEPOSITS — Derdhje direkte në Kasafortë
// ============================================================
// Kesh që futet drejtpërdrejt në kasafortë nga jashtë sistemit (jo nga arka,
// jo nga banka). Rrit bilancin e kasafortës; nuk prek arkën ose bankën.

const CURS_SD = ['lek', 'eur', 'usd', 'gbp', 'chf'];

app.get('/api/safe-deposits', async (req, res) => {
  try {
    const { from, to, limit } = req.query;
    const params = [];
    let where = '1=1';
    if (from) { where += ' AND date >= ?'; params.push(from); }
    if (to)   { where += ' AND date <= ?'; params.push(to); }
    const lim = Math.min(parseInt(limit) || 200, 500);
    const rows = await queryAll(
      `SELECT id, date, amount_lek, amount_eur, amount_usd, amount_gbp, amount_chf,
              note, created_at
         FROM safe_deposits
        WHERE ${where}
        ORDER BY date DESC, created_at DESC
        LIMIT ${lim}`,
      params
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/safe-deposits', async (req, res) => {
  try {
    const d = req.body || {};
    const date = d.date;
    if (!date) return res.status(400).json({ error: 'date required' });
    const amounts = {};
    let anyPositive = false;
    for (const c of CURS_SD) {
      const v = parseFloat(d[`amount_${c}`]) || 0;
      if (v < 0) return res.status(400).json({ error: `amount_${c} duhet ≥ 0` });
      amounts[c] = v;
      if (v > 0) anyPositive = true;
    }
    if (!anyPositive) return res.status(400).json({ error: 'shuma duhet të jetë > 0' });
    const note = String(d.note || '').trim();
    const cols = CURS_SD.map(c => `amount_${c}`);
    const vals = CURS_SD.map(c => amounts[c]);
    const result = await run(
      `INSERT INTO safe_deposits (date, ${cols.join(', ')}, note)
       VALUES (?, ${cols.map(() => '?').join(', ')}, ?)`,
      [date, ...vals, note]
    );
    const rawId = result?.lastInsertRowid ?? result?.lastID;
    res.json({ success: true, id: typeof rawId === 'bigint' ? Number(rawId) : rawId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/safe-deposits/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const row = await queryOne('SELECT id FROM safe_deposits WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'not found' });
    await run('DELETE FROM safe_deposits WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// WORKERS — Punëtorët + pagesat mujore
// ============================================================
// Punëtorët menaxhohen si listë me pagë bazë EUR. Pagesat regjistrohen për çdo
// muaj me 4 pjesë: paga bank/kesh, shpërblim bank/kesh (të gjitha EUR).
// Pjesa kesh shfaqet te Arka Ditore; pjesa bank zbritet nga bilanci i bankës.

app.get('/api/workers', async (req, res) => {
  try {
    const showAll = req.query.all === '1';
    const rows = await queryAll(
      `SELECT id, name, position, COALESCE(base_salary_eur, 0) AS base_salary_eur,
              COALESCE(active, 1) AS active, created_at
         FROM workers
         ${showAll ? '' : 'WHERE COALESCE(active, 1) = 1'}
         ORDER BY name ASC`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/workers', async (req, res) => {
  try {
    const d = req.body || {};
    const name = String(d.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    const position = String(d.position || '').trim();
    const base = parseFloat(d.base_salary_eur) || 0;
    if (base < 0) return res.status(400).json({ error: 'base_salary_eur duhet ≥ 0' });
    const active = d.active === false || d.active === 0 ? 0 : 1;
    const result = await run(
      `INSERT INTO workers (name, position, base_salary_eur, active) VALUES (?, ?, ?, ?)`,
      [name, position, base, active]
    );
    const rawId = result?.lastInsertRowid ?? result?.lastID;
    res.json({ success: true, id: typeof rawId === 'bigint' ? Number(rawId) : rawId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/workers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const row = await queryOne('SELECT id FROM workers WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'not found' });
    const d = req.body || {};
    const name = String(d.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    const position = String(d.position || '').trim();
    const base = parseFloat(d.base_salary_eur) || 0;
    if (base < 0) return res.status(400).json({ error: 'base_salary_eur duhet ≥ 0' });
    const active = d.active === false || d.active === 0 ? 0 : 1;
    await run(
      `UPDATE workers SET name = ?, position = ?, base_salary_eur = ?, active = ? WHERE id = ?`,
      [name, position, base, active, id]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/workers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const row = await queryOne('SELECT id FROM workers WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'not found' });
    // Pagesat lidhen me punëtorin — parandalo fshirjen e punëtorit me pagesa
    // ekzistuese që të mos humbet historiku. Përdor "çaktivizo" (active=0) në UI.
    const hasPayments = await queryOne('SELECT id FROM worker_payments WHERE worker_id = ? LIMIT 1', [id]);
    if (hasPayments) {
      return res.status(400).json({ error: 'punëtori ka pagesa të regjistruara — çaktivizoje në vend të fshirjes' });
    }
    await run('DELETE FROM workers WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/worker-payments', async (req, res) => {
  try {
    const { worker_id, month, from, to, limit } = req.query;
    const params = [];
    let where = '1=1';
    if (worker_id) { where += ' AND wp.worker_id = ?'; params.push(worker_id); }
    if (month)     { where += ' AND wp.month = ?'; params.push(month); }
    if (from)      { where += ' AND wp.date_paid >= ?'; params.push(from); }
    if (to)        { where += ' AND wp.date_paid <= ?'; params.push(to); }
    const lim = Math.min(parseInt(limit) || 500, 2000);
    const rows = await queryAll(
      `SELECT wp.id, wp.worker_id, w.name AS worker_name, w.position AS worker_position,
              wp.month, wp.date_paid,
              COALESCE(wp.salary_bank_eur, 0) AS salary_bank_eur,
              COALESCE(wp.salary_cash_eur, 0) AS salary_cash_eur,
              COALESCE(wp.bonus_bank_eur, 0)  AS bonus_bank_eur,
              COALESCE(wp.bonus_cash_eur, 0)  AS bonus_cash_eur,
              wp.note, wp.created_at
         FROM worker_payments wp
         JOIN workers w ON w.id = wp.worker_id
        WHERE ${where}
        ORDER BY wp.date_paid DESC, wp.id DESC
        LIMIT ${lim}`,
      params
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/worker-payments', async (req, res) => {
  try {
    const d = req.body || {};
    const workerId = parseInt(d.worker_id) || 0;
    if (!workerId) return res.status(400).json({ error: 'worker_id required' });
    const month = String(d.month || '').trim();
    if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month duhet formati YYYY-MM' });
    const datePaid = String(d.date_paid || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datePaid)) return res.status(400).json({ error: 'date_paid duhet formati YYYY-MM-DD' });
    const w = await queryOne('SELECT id FROM workers WHERE id = ?', [workerId]);
    if (!w) return res.status(404).json({ error: 'worker not found' });
    const sBank = parseFloat(d.salary_bank_eur) || 0;
    const sCash = parseFloat(d.salary_cash_eur) || 0;
    const bBank = parseFloat(d.bonus_bank_eur)  || 0;
    const bCash = parseFloat(d.bonus_cash_eur)  || 0;
    for (const [k, v] of [['salary_bank', sBank], ['salary_cash', sCash], ['bonus_bank', bBank], ['bonus_cash', bCash]]) {
      if (v < 0) return res.status(400).json({ error: `${k}_eur duhet ≥ 0` });
    }
    if (sBank + sCash + bBank + bCash <= 0) {
      return res.status(400).json({ error: 'shuma totale duhet > 0' });
    }
    const note = String(d.note || '').trim();
    const result = await run(
      `INSERT INTO worker_payments
         (worker_id, month, date_paid, salary_bank_eur, salary_cash_eur, bonus_bank_eur, bonus_cash_eur, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [workerId, month, datePaid, sBank, sCash, bBank, bCash, note]
    );
    const rawId = result?.lastInsertRowid ?? result?.lastID;
    res.json({ success: true, id: typeof rawId === 'bigint' ? Number(rawId) : rawId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/worker-payments/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await queryOne('SELECT id FROM worker_payments WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'not found' });
    const d = req.body || {};
    const month = String(d.month || '').trim();
    if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month duhet formati YYYY-MM' });
    const datePaid = String(d.date_paid || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datePaid)) return res.status(400).json({ error: 'date_paid duhet formati YYYY-MM-DD' });
    const sBank = parseFloat(d.salary_bank_eur) || 0;
    const sCash = parseFloat(d.salary_cash_eur) || 0;
    const bBank = parseFloat(d.bonus_bank_eur)  || 0;
    const bCash = parseFloat(d.bonus_cash_eur)  || 0;
    for (const [k, v] of [['salary_bank', sBank], ['salary_cash', sCash], ['bonus_bank', bBank], ['bonus_cash', bCash]]) {
      if (v < 0) return res.status(400).json({ error: `${k}_eur duhet ≥ 0` });
    }
    if (sBank + sCash + bBank + bCash <= 0) {
      return res.status(400).json({ error: 'shuma totale duhet > 0' });
    }
    const note = String(d.note || '').trim();
    await run(
      `UPDATE worker_payments SET month = ?, date_paid = ?,
              salary_bank_eur = ?, salary_cash_eur = ?, bonus_bank_eur = ?, bonus_cash_eur = ?, note = ?
        WHERE id = ?`,
      [month, datePaid, sBank, sCash, bBank, bCash, note, id]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/worker-payments/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const row = await queryOne('SELECT id FROM worker_payments WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'not found' });
    await run('DELETE FROM worker_payments WHERE id = ?', [id]);
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
    // + tërheqjet nga kasaforta me destinacion 'bank' → hyjnë në llogari
    const swParts = CURS_BM.map(c =>
      `COALESCE(SUM(amount_${c}), 0) AS sw_${c}`
    ).join(', ');
    const swRow = await queryOne(
      `SELECT ${swParts} FROM safe_withdrawals WHERE COALESCE(destination, 'jashte') = 'bank'`
    ) || {};
    // − pagesa pune (bank + bonus_bank) EUR — zbresin nga bilanci EUR
    const wpRow = await queryOne(
      `SELECT COALESCE(SUM(salary_bank_eur + bonus_bank_eur), 0) AS wp_eur FROM worker_payments`
    ) || {};
    const balance = {};
    for (const c of CURS_BM) {
      const bal = (row[`bal_${c}`] || 0) + (swRow[`sw_${c}`] || 0);
      const wp  = c === 'eur' ? (wpRow.wp_eur || 0) : 0;
      balance[c.toUpperCase()] = +((bal - wp)).toFixed(2);
    }
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
    const rowsDetailed = isDetailed ? (await queryAll(
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
         COALESCE(ii.gram, 0) AS gram,
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
    )).map(r => {
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
        gram:                 +(r.gram || 0),
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

    const rows = (await queryAll(
      `SELECT
         COALESCE(ii.product_id, 0) AS product_id,
         COALESCE(NULLIF(ii.barcode, ''), p.barcode, '') AS barcode,
         COALESCE(NULLIF(ii.name, ''), p.name, '')       AS name,
         COALESCE(p.sku, '')      AS sku,
         COALESCE(p.category, '') AS category,
         COALESCE(p.material, '') AS material,
         COALESCE(p.unit, 'copë') AS unit,
         SUM(ii.qty) AS qty,
         SUM(COALESCE(ii.gram, 0)) AS gram,
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
    )).map(r => {
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
        gram:              +(r.gram || 0),
        unit_price_lek:    qty !== 0 ? +(gross / qty).toFixed(2) : 0,
        discount_lek:      +discount.toFixed(2),
        value_no_vat_lek:  +valNoVat.toFixed(2),
        vat_lek:           +vat.toFixed(2),
        value_with_vat_lek:+valWith.toFixed(2),
        docs_count:        +(r.docs_count || 0),
      };
    });

    const emptyTotals = () => ({ qty: 0, gram: 0, discount_lek: 0, value_no_vat_lek: 0, vat_lek: 0, value_with_vat_lek: 0 });
    const addInto = (a, r) => ({
      qty:                a.qty                + r.qty,
      gram:               a.gram               + (r.gram || 0),
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
         SUM(COALESCE(ii.gram, 0)) AS gram,
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
        gram:               +(+r.gram || 0).toFixed(3),
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
    // Konvertim në USD: blerjet bëhen kryesisht në USD, kështu që raporti
    // agregon në USD. Për faturat me monedhë tjetër (EUR/LEK) përdorim kursin
    // USD/LEK të asaj date (nga exchange_rates) për të konvertuar përsëri në USD.
    // Formula: value_original * pi.exchange_rate (→ LEK) / usd_rate (→ USD).
    // Për faturat në USD, shumëzuesi bëhet 1 që të mos konvertohet dy herë.
    const purchases = await queryAll(
      `SELECT
         COALESCE(pit.product_id, 0) AS product_id,
         COALESCE(NULLIF(pit.barcode, ''), p.barcode, '') AS barcode,
         COALESCE(NULLIF(pit.name, ''), p.name, '')       AS name,
         COALESCE(p.sku, '')      AS sku,
         COALESCE(p.category, '') AS category,
         COALESCE(p.unit, 'copë') AS unit,
         SUM(pit.qty) AS qty,
         SUM(pit.qty * pit.purchase_price_no_vat *
             CASE WHEN pi.currency = 'USD' THEN 1
                  ELSE COALESCE(pi.exchange_rate, 1) / COALESCE(usd_rate.rate, 1) END) AS gross_usd,
         SUM(pit.qty * pit.purchase_price_no_vat * (pit.discount_percent / 100.0) *
             CASE WHEN pi.currency = 'USD' THEN 1
                  ELSE COALESCE(pi.exchange_rate, 1) / COALESCE(usd_rate.rate, 1) END) AS discount_usd,
         SUM(pit.subtotal_no_vat *
             CASE WHEN pi.currency = 'USD' THEN 1
                  ELSE COALESCE(pi.exchange_rate, 1) / COALESCE(usd_rate.rate, 1) END) AS value_no_vat_usd,
         SUM(pit.vat_amount *
             CASE WHEN pi.currency = 'USD' THEN 1
                  ELSE COALESCE(pi.exchange_rate, 1) / COALESCE(usd_rate.rate, 1) END) AS vat_usd,
         SUM(pit.total_with_vat *
             CASE WHEN pi.currency = 'USD' THEN 1
                  ELSE COALESCE(pi.exchange_rate, 1) / COALESCE(usd_rate.rate, 1) END) AS value_with_vat_usd,
         COUNT(DISTINCT pi.id) AS docs_count
       FROM purchase_items pit
       JOIN purchase_invoices pi ON pi.id = pit.purchase_id
       LEFT JOIN products p      ON p.id = pit.product_id
       LEFT JOIN exchange_rates usd_rate ON usd_rate.date = pi.date AND usd_rate.currency = 'USD'
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
         SUM(mi.qty * mi.unit_price *
             CASE WHEN m.currency = 'USD' THEN 1
                  ELSE COALESCE(m.exchange_rate, 1) / COALESCE(usd_rate.rate, 1) END) AS gross_usd,
         SUM(mi.qty * mi.unit_price * (mi.discount_percent / 100.0) *
             CASE WHEN m.currency = 'USD' THEN 1
                  ELSE COALESCE(m.exchange_rate, 1) / COALESCE(usd_rate.rate, 1) END) AS discount_usd,
         SUM(mi.subtotal *
             CASE WHEN m.currency = 'USD' THEN 1
                  ELSE COALESCE(m.exchange_rate, 1) / COALESCE(usd_rate.rate, 1) END) AS value_no_vat_usd,
         COUNT(DISTINCT m.id) AS docs_count
       FROM magazina_hyrje_items mi
       JOIN magazina_hyrje m ON m.id = mi.magazina_id
       LEFT JOIN products p  ON p.id = mi.product_id
       LEFT JOIN exchange_rates usd_rate ON usd_rate.date = m.date AND usd_rate.currency = 'USD'
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
      qty: 0, gross_usd: 0, discount_usd: 0,
      value_no_vat_usd: 0, vat_usd: 0, value_with_vat_usd: 0,
      docs_count: 0,
    });

    const map = new Map();
    for (const r of purchases) {
      const k = keyOf(r);
      const e = map.get(k) || empty(r);
      e.qty                += +(r.qty || 0);
      e.gross_usd          += +(r.gross_usd || 0);
      e.discount_usd       += +(r.discount_usd || 0);
      e.value_no_vat_usd   += +(r.value_no_vat_usd || 0);
      e.vat_usd            += +(r.vat_usd || 0);
      e.value_with_vat_usd += +(r.value_with_vat_usd || 0);
      e.docs_count         += +(r.docs_count || 0);
      map.set(k, e);
    }
    for (const r of mags) {
      const k = keyOf(r);
      const e = map.get(k) || empty(r);
      const valNoVat = +(r.value_no_vat_usd || 0);
      e.qty                += +(r.qty || 0);
      e.gross_usd          += +(r.gross_usd || 0);
      e.discount_usd       += +(r.discount_usd || 0);
      e.value_no_vat_usd   += valNoVat;
      // Magazina Hyrje është pa TVSH → vat = 0, total = subtotal
      e.value_with_vat_usd += valNoVat;
      e.docs_count         += +(r.docs_count || 0);
      map.set(k, e);
    }

    const rows = Array.from(map.values()).map(r => {
      const qty = r.qty;
      return {
        product_id: r.product_id, barcode: r.barcode, name: r.name,
        sku: r.sku, category: r.category, unit: r.unit,
        qty,
        unit_price_usd:    qty !== 0 ? +(r.gross_usd / qty).toFixed(2) : 0,
        discount_usd:      +r.discount_usd.toFixed(2),
        value_no_vat_usd:  +r.value_no_vat_usd.toFixed(2),
        vat_usd:           +r.vat_usd.toFixed(2),
        value_with_vat_usd:+r.value_with_vat_usd.toFixed(2),
        docs_count:        r.docs_count,
      };
    }).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    const totals = rows.reduce((a, r) => ({
      qty:                a.qty                + r.qty,
      discount_usd:       a.discount_usd       + r.discount_usd,
      value_no_vat_usd:   a.value_no_vat_usd   + r.value_no_vat_usd,
      vat_usd:            a.vat_usd            + r.vat_usd,
      value_with_vat_usd: a.value_with_vat_usd + r.value_with_vat_usd,
    }), { qty: 0, discount_usd: 0, value_no_vat_usd: 0, vat_usd: 0, value_with_vat_usd: 0 });

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
         SUM(pit.qty * pit.purchase_price_no_vat *
             CASE WHEN pi.currency = 'USD' THEN 1
                  ELSE COALESCE(pi.exchange_rate, 1) / COALESCE(usd_rate.rate, 1) END) AS gross_usd,
         SUM(pit.subtotal_no_vat *
             CASE WHEN pi.currency = 'USD' THEN 1
                  ELSE COALESCE(pi.exchange_rate, 1) / COALESCE(usd_rate.rate, 1) END) AS value_no_vat_usd,
         SUM(pit.total_with_vat *
             CASE WHEN pi.currency = 'USD' THEN 1
                  ELSE COALESCE(pi.exchange_rate, 1) / COALESCE(usd_rate.rate, 1) END) AS value_with_vat_usd
       FROM purchase_items pit
       JOIN purchase_invoices pi ON pi.id = pit.purchase_id
       LEFT JOIN exchange_rates usd_rate ON usd_rate.date = pi.date AND usd_rate.currency = 'USD'
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
         SUM(mi.qty * mi.unit_price *
             CASE WHEN m.currency = 'USD' THEN 1
                  ELSE COALESCE(m.exchange_rate, 1) / COALESCE(usd_rate.rate, 1) END) AS gross_usd,
         SUM(mi.subtotal *
             CASE WHEN m.currency = 'USD' THEN 1
                  ELSE COALESCE(m.exchange_rate, 1) / COALESCE(usd_rate.rate, 1) END) AS value_no_vat_usd,
         SUM(mi.subtotal *
             CASE WHEN m.currency = 'USD' THEN 1
                  ELSE COALESCE(m.exchange_rate, 1) / COALESCE(usd_rate.rate, 1) END) AS value_with_vat_usd
       FROM magazina_hyrje_items mi
       JOIN magazina_hyrje m ON m.id = mi.magazina_id
       LEFT JOIN exchange_rates usd_rate ON usd_rate.date = m.date AND usd_rate.currency = 'USD'
       WHERE m.date BETWEEN ? AND ?
         AND ${mMatch}
       GROUP BY m.id`,
      mParams
    );

    const out = [...purchases, ...mags].map(r => {
      const qty = +(r.qty || 0);
      const gross = +(r.gross_usd || 0);
      return { ...r, unit_price_usd: qty !== 0 ? +(gross / qty).toFixed(2) : 0 };
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
    const key = `expense-categories:${includeInactive ? 'all' : 'active'}`;
    // Memory cache 60s — thirret nga Fleta e Shpenzimeve në cdo load.
    const rows = await cached(key, 60_000, () => {
      const where = includeInactive ? '' : 'WHERE COALESCE(active, 1) = 1';
      return queryAll(`SELECT * FROM expense_categories ${where} ORDER BY name COLLATE NOCASE ASC`);
    });
    res.json(rows);
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
    // `type` diskriminon: 'daily' = shpenzime të zakonshme (pa lidhje me faturë blerje),
    // 'transport' = pagesa transporti të lidhura me fatura blerje, 'all' = të gjitha.
    const type = String(req.query.type || 'all').toLowerCase();
    let extra = '';
    if (type === 'daily')     extra = " AND COALESCE(e.kind, 'daily') = 'daily'";
    else if (type === 'transport') extra = " AND COALESCE(e.kind, 'daily') = 'transport'";
    const rows = await queryAll(
      `SELECT e.*, c.name AS category_name,
              pi.invoice_no AS purchase_invoice_no,
              pi.supplier_name AS purchase_supplier_name,
              pi.date AS purchase_invoice_date,
              (COALESCE(e.amount, 0) * COALESCE(e.exchange_rate, 1)) AS total_lek
       FROM expense_entries e
       LEFT JOIN expense_categories c ON c.id = e.category_id
       LEFT JOIN purchase_invoices pi ON pi.id = e.purchase_invoice_id
       WHERE e.date = ?${extra}
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
    const { date, category_id, description, currency, amount, exchange_rate, purchase_invoice_id, kind } = req.body || {};
    if (!date) return res.status(400).json({ error: 'date required' });
    const cur = pickCurrency(currency);
    const amt = parseFloat(amount) || 0;
    const rate = cur === 'LEK' ? 1 : (parseFloat(exchange_rate) || 0);
    if (cur !== 'LEK' && rate <= 0) return res.status(400).json({ error: 'exchange_rate required for foreign currency' });
    const invId = purchase_invoice_id ? parseInt(purchase_invoice_id) || null : null;
    // Backward-compat: nëse `kind` s'kalohet, e nxjerrim nga prania e faturës
    // (rreshti i vjetër: purchase_invoice_id => transport; ndryshe => daily).
    const rawKind = String(kind || (invId ? 'transport' : 'daily')).toLowerCase();
    const rowKind = rawKind === 'transport' ? 'transport' : 'daily';
    if (rowKind === 'transport' && !invId && !String(description || '').trim()) {
      return res.status(400).json({ error: 'për transport pa faturë duhet një përshkrim' });
    }
    if (invId) {
      // Validime për pagesat e transportit: fatura duhet të ekzistojë, dhe një
      // faturë mund të ketë vetëm një pagesë transporti (indeksi unik e mbron
      // te DB, por kthejmë gabim të qartë para se të prekim DB-në).
      const exists = await queryOne('SELECT id FROM purchase_invoices WHERE id = ?', [invId]);
      if (!exists) return res.status(400).json({ error: 'fatura e blerjes nuk u gjet' });
      const dup = await queryOne('SELECT id FROM expense_entries WHERE purchase_invoice_id = ?', [invId]);
      if (dup) return res.status(409).json({ error: 'kjo faturë ka tashmë një pagesë transporti' });
    }
    await run(
      `INSERT INTO expense_entries (date, category_id, description, currency, amount, exchange_rate,
         amount_lek, amount_eur, amount_usd, purchase_invoice_id, kind)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        date,
        category_id || null,
        description || '',
        cur, amt, rate,
        // Legacy mirrors për përputhshmëri me kod të vjetër (lexime që preken)
        cur === 'LEK' ? amt : 0,
        cur === 'EUR' ? amt : 0,
        cur === 'USD' ? amt : 0,
        invId,
        rowKind,
      ]
    );
    await syncExpenseTotals(date);
    const row = await queryOne(
      `SELECT e.*, c.name AS category_name,
              pi.invoice_no AS purchase_invoice_no,
              pi.supplier_name AS purchase_supplier_name,
              pi.date AS purchase_invoice_date,
              (COALESCE(e.amount, 0) * COALESCE(e.exchange_rate, 1)) AS total_lek
       FROM expense_entries e
       LEFT JOIN expense_categories c ON c.id = e.category_id
       LEFT JOIN purchase_invoices pi ON pi.id = e.purchase_invoice_id
       ORDER BY e.id DESC LIMIT 1`
    );
    res.json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/expense-entries/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { date, category_id, description, currency, amount, exchange_rate, purchase_invoice_id, kind } = req.body || {};
    const existing = await queryOne('SELECT date, purchase_invoice_id, kind FROM expense_entries WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'not found' });
    const cur = pickCurrency(currency);
    const amt = parseFloat(amount) || 0;
    const rate = cur === 'LEK' ? 1 : (parseFloat(exchange_rate) || 0);
    if (cur !== 'LEK' && rate <= 0) return res.status(400).json({ error: 'exchange_rate required for foreign currency' });
    // Nëse fusha `purchase_invoice_id` s'kalohet fare, ruhet vlera ekzistuese
    // (mos e prek — PUT nga Shpenzime Ditore nuk duhet ta zerojë lidhjen).
    const invId = purchase_invoice_id === undefined
      ? (existing.purchase_invoice_id || null)
      : (purchase_invoice_id ? parseInt(purchase_invoice_id) || null : null);
    // Ruaj kind-in ekzistues nëse s'kalohet; ndryshe validojë.
    const existingKind = existing.kind || (existing.purchase_invoice_id ? 'transport' : 'daily');
    const rowKind = kind === undefined
      ? existingKind
      : (String(kind).toLowerCase() === 'transport' ? 'transport' : 'daily');
    if (rowKind === 'transport' && !invId && !String(description || '').trim()) {
      return res.status(400).json({ error: 'për transport pa faturë duhet një përshkrim' });
    }
    if (invId && invId !== existing.purchase_invoice_id) {
      const exists = await queryOne('SELECT id FROM purchase_invoices WHERE id = ?', [invId]);
      if (!exists) return res.status(400).json({ error: 'fatura e blerjes nuk u gjet' });
      const dup = await queryOne('SELECT id FROM expense_entries WHERE purchase_invoice_id = ? AND id <> ?', [invId, id]);
      if (dup) return res.status(409).json({ error: 'kjo faturë ka tashmë një pagesë transporti' });
    }
    await run(
      `UPDATE expense_entries SET date = ?, category_id = ?, description = ?,
         currency = ?, amount = ?, exchange_rate = ?,
         amount_lek = ?, amount_eur = ?, amount_usd = ?,
         purchase_invoice_id = ?, kind = ?
       WHERE id = ?`,
      [
        date || existing.date,
        category_id || null,
        description || '',
        cur, amt, rate,
        cur === 'LEK' ? amt : 0,
        cur === 'EUR' ? amt : 0,
        cur === 'USD' ? amt : 0,
        invId,
        rowKind,
        id,
      ]
    );
    await syncExpenseTotals(existing.date);
    if (date && date !== existing.date) await syncExpenseTotals(date);
    res.json(await queryOne(
      `SELECT e.*, c.name AS category_name,
              pi.invoice_no AS purchase_invoice_no,
              pi.supplier_name AS purchase_supplier_name,
              pi.date AS purchase_invoice_date,
              (COALESCE(e.amount, 0) * COALESCE(e.exchange_rate, 1)) AS total_lek
       FROM expense_entries e
       LEFT JOIN expense_categories c ON c.id = e.category_id
       LEFT JOIN purchase_invoices pi ON pi.id = e.purchase_invoice_id
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
    const { from, to, category_id, currency, type } = req.query;
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
    const t = String(type || 'all').toLowerCase();
    if (t === 'daily')     where += " AND COALESCE(e.kind, 'daily') = 'daily'";
    else if (t === 'transport') where += " AND COALESCE(e.kind, 'daily') = 'transport'";

    const entries = await queryAll(
      `SELECT e.*, c.name AS category_name,
              pi.invoice_no AS purchase_invoice_no,
              pi.supplier_name AS purchase_supplier_name,
              pi.date AS purchase_invoice_date,
              (COALESCE(e.amount, 0) * COALESCE(e.exchange_rate, 1)) AS total_lek
       FROM expense_entries e
       LEFT JOIN expense_categories c ON c.id = e.category_id
       LEFT JOIN purchase_invoices pi ON pi.id = e.purchase_invoice_id
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

// ============================================================
// KATEGORITË E MATERIALIT (Fatura Blerje) — CRUD me built_in
// Slug ruhet te products.material dhe label te products.category kur admin
// zgjedh një kategori për të gjithë rreshtat e faturës. Kategoritë built_in
// (flori/diamant/ora) mbrohen nga fshirja/ndryshimi i slug — sepse raportet
// bazë varen nga këto vlera.
// ============================================================
function slugify(s) {
  return String(s || '').trim().toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

app.get('/api/material-categories', async (req, res) => {
  try {
    const includeInactive = req.query.all === '1';
    const where = includeInactive ? '' : 'WHERE COALESCE(active, 1) = 1';
    res.json(await queryAll(
      `SELECT * FROM material_categories ${where}
       ORDER BY built_in DESC, label COLLATE NOCASE ASC`
    ));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/material-categories', async (req, res) => {
  try {
    const { label, icon } = req.body || {};
    if (!label || !label.trim()) return res.status(400).json({ error: 'label required' });
    let slug = slugify(label);
    if (!slug) return res.status(400).json({ error: 'slug invalid' });
    // Nëse slug ekziston, shtoj një sufiks numerik për të shmangur konfliktin.
    const existing = await queryOne('SELECT id FROM material_categories WHERE slug = ?', [slug]);
    if (existing) {
      let i = 2;
      while (await queryOne('SELECT id FROM material_categories WHERE slug = ?', [`${slug}-${i}`])) i++;
      slug = `${slug}-${i}`;
    }
    await run(
      `INSERT INTO material_categories (slug, label, icon, built_in, active) VALUES (?, ?, ?, 0, 1)`,
      [slug, label.trim(), (icon || '').trim()]
    );
    res.json(await queryOne('SELECT * FROM material_categories WHERE slug = ?', [slug]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/material-categories/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { label, icon, active } = req.body || {};
    if (!label || !label.trim()) return res.status(400).json({ error: 'label required' });
    const row = await queryOne('SELECT * FROM material_categories WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'not found' });
    await run(
      `UPDATE material_categories SET label = ?, icon = ?, active = ? WHERE id = ?`,
      [label.trim(), (icon || '').trim(), active === 0 ? 0 : 1, id]
    );
    res.json(await queryOne('SELECT * FROM material_categories WHERE id = ?', [id]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/material-categories/:id', async (req, res) => {
  try {
    const row = await queryOne('SELECT * FROM material_categories WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'not found' });
    if (row.built_in) return res.status(400).json({ error: 'Kategoria bazë nuk mund të fshihet' });
    await run('DELETE FROM material_categories WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/marketing-entries/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const rows = await queryAll(
      `SELECT m.*, c.name AS category_name,
              p.name AS product_name, p.barcode AS product_barcode,
              p.cost_price AS product_cost_price, p.stock AS product_stock,
              p.serial_no AS product_serial_no, p.gram AS product_gram,
              p.vat_rate AS product_vat_rate, p.sell_price AS product_sell_price,
              (COALESCE(m.amount, 0) * COALESCE(m.exchange_rate, 1)) AS total_lek
       FROM marketing_expenses m
       LEFT JOIN marketing_categories c ON c.id = m.category_id
       LEFT JOIN products p ON p.id = m.product_id
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
    const breakdown = await computeMarketingBreakdown(date, date);
    res.json({ rows, totals, breakdown });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/marketing-entries', async (req, res) => {
  try {
    const { date, category_id, description, currency, amount, exchange_rate,
            product_id, product_qty } = req.body || {};
    if (!date) return res.status(400).json({ error: 'date required' });

    // Marketing "in kind" — një produkt merret nga inventari (dhuratë/mostër/promo).
    // Nuk krijohet faturë shitjeje (pra nuk hyn te xhiro), por stoku ulet dhe
    // regjistrimi mbetet i dukshëm te historiku i marketingut.
    if (product_id) {
      const pid = parseInt(product_id);
      const qty = Math.max(1, parseInt(product_qty) || 1);
      const prod = await queryOne(
        'SELECT id, name, cost_price, sell_price, stock FROM products WHERE id = ?', [pid]
      );
      if (!prod) return res.status(404).json({ error: 'product not found' });
      if ((prod.stock || 0) < qty) {
        return res.status(400).json({ error: `insufficient stock (aktual: ${prod.stock || 0})` });
      }
      // Vlera në EUR: nëse klienti dërgon `amount` (llogaritur si te Fatura Shitje —
      // sell_price × qty × (1 - disc%/100) × (1 + vat%/100)), përdore atë; përndryshe
      // fallback te sell_price × qty ose cost_price × qty.
      const cur = 'EUR';
      const providedAmt = parseFloat(amount);
      const sellPrice = parseFloat(prod.sell_price) || 0;
      const costPrice = parseFloat(prod.cost_price) || 0;
      const amt = providedAmt > 0
        ? +providedAmt.toFixed(2)
        : +((sellPrice || costPrice) * qty).toFixed(2);
      const rate = parseFloat(exchange_rate) > 0 ? parseFloat(exchange_rate) : 1;
      await run(
        `INSERT INTO marketing_expenses (date, category_id, description, currency, amount, exchange_rate,
           amount_lek, amount_eur, amount_usd, product_id, product_qty)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          date, category_id || null,
          description || '',
          cur, amt, rate,
          0, amt, 0,
          pid, qty,
        ]
      );
      await run('UPDATE products SET stock = stock - ? WHERE id = ?', [qty, pid]);
      const row = await queryOne(
        `SELECT m.*, c.name AS category_name,
                p.name AS product_name, p.barcode AS product_barcode,
              p.cost_price AS product_cost_price, p.stock AS product_stock,
              p.serial_no AS product_serial_no, p.gram AS product_gram,
              p.vat_rate AS product_vat_rate, p.sell_price AS product_sell_price,
                (COALESCE(m.amount, 0) * COALESCE(m.exchange_rate, 1)) AS total_lek
         FROM marketing_expenses m
         LEFT JOIN marketing_categories c ON c.id = m.category_id
         LEFT JOIN products p ON p.id = m.product_id
         ORDER BY m.id DESC LIMIT 1`
      );
      return res.json(row);
    }

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
              p.name AS product_name, p.barcode AS product_barcode,
              p.cost_price AS product_cost_price, p.stock AS product_stock,
              p.serial_no AS product_serial_no, p.gram AS product_gram,
              p.vat_rate AS product_vat_rate, p.sell_price AS product_sell_price,
              (COALESCE(m.amount, 0) * COALESCE(m.exchange_rate, 1)) AS total_lek
       FROM marketing_expenses m
       LEFT JOIN marketing_categories c ON c.id = m.category_id
       LEFT JOIN products p ON p.id = m.product_id
       ORDER BY m.id DESC LIMIT 1`
    );
    res.json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/marketing-entries/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { date, category_id, description, currency, amount, exchange_rate,
            product_id, product_qty } = req.body || {};
    const existing = await queryOne(
      'SELECT date, product_id, product_qty FROM marketing_expenses WHERE id = ?', [id]
    );
    if (!existing) return res.status(404).json({ error: 'not found' });

    // Nëse regjistrimi është (ose bëhet) tip PRODUKT, bëj diferencën e stokut:
    // riktheji stokun e vjetër dhe zbrit atë të riun. Kështu ndryshimi funksionon
    // edhe kur ndryshon produkti ose sasia.
    const wasProduct = !!existing.product_id;
    const isProduct = !!product_id;
    if (wasProduct || isProduct) {
      const oldPid = existing.product_id;
      const oldQty = existing.product_qty || 0;
      const newPid = isProduct ? parseInt(product_id) : null;
      const newQty = isProduct ? Math.max(1, parseInt(product_qty) || 1) : 0;

      if (oldPid) {
        await run('UPDATE products SET stock = stock + ? WHERE id = ?', [oldQty, oldPid]);
      }
      let newAmtFromProduct = 0;
      if (newPid) {
        const prod = await queryOne(
          'SELECT id, name, cost_price, sell_price, stock FROM products WHERE id = ?', [newPid]
        );
        if (!prod) {
          if (oldPid) await run('UPDATE products SET stock = stock - ? WHERE id = ?', [oldQty, oldPid]);
          return res.status(404).json({ error: 'product not found' });
        }
        if ((prod.stock || 0) < newQty) {
          if (oldPid) await run('UPDATE products SET stock = stock - ? WHERE id = ?', [oldQty, oldPid]);
          return res.status(400).json({ error: `insufficient stock (aktual: ${prod.stock || 0})` });
        }
        await run('UPDATE products SET stock = stock - ? WHERE id = ?', [newQty, newPid]);
        // Preferohet amount i dërguar nga UI (llogaritur si Fatura Shitje).
        const sellPrice = parseFloat(prod.sell_price) || 0;
        const costPrice = parseFloat(prod.cost_price) || 0;
        newAmtFromProduct = +((sellPrice || costPrice) * newQty).toFixed(2);
      }

      const cur = isProduct ? 'EUR' : pickCurrency(currency);
      const providedAmt = parseFloat(amount);
      const amt = isProduct
        ? (providedAmt > 0 ? +providedAmt.toFixed(2) : newAmtFromProduct)
        : (parseFloat(amount) || 0);
      const rate = isProduct
        ? (parseFloat(exchange_rate) > 0 ? parseFloat(exchange_rate) : 1)
        : (cur === 'LEK' ? 1 : (parseFloat(exchange_rate) || 0));
      if (!isProduct && cur !== 'LEK' && rate <= 0) {
        // Rollback stock changes nëse tranzicioni dështon.
        if (newPid) await run('UPDATE products SET stock = stock + ? WHERE id = ?', [newQty, newPid]);
        if (oldPid) await run('UPDATE products SET stock = stock - ? WHERE id = ?', [oldQty, oldPid]);
        return res.status(400).json({ error: 'exchange_rate required for foreign currency' });
      }

      await run(
        `UPDATE marketing_expenses SET date = ?, category_id = ?, description = ?,
           currency = ?, amount = ?, exchange_rate = ?,
           amount_lek = ?, amount_eur = ?, amount_usd = ?,
           product_id = ?, product_qty = ?
         WHERE id = ?`,
        [
          date || existing.date, category_id || null, description || '',
          cur, amt, rate,
          cur === 'LEK' ? amt : 0,
          cur === 'EUR' ? amt : 0,
          cur === 'USD' ? amt : 0,
          newPid, newQty, id,
        ]
      );
      return res.json(await queryOne(
        `SELECT m.*, c.name AS category_name,
                p.name AS product_name, p.barcode AS product_barcode,
                p.cost_price AS product_cost_price, p.stock AS product_stock,
                (COALESCE(m.amount, 0) * COALESCE(m.exchange_rate, 1)) AS total_lek
         FROM marketing_expenses m
         LEFT JOIN marketing_categories c ON c.id = m.category_id
         LEFT JOIN products p ON p.id = m.product_id
         WHERE m.id = ?`, [id]
      ));
    }

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
    const existing = await queryOne(
      'SELECT product_id, product_qty FROM marketing_expenses WHERE id = ?', [id]
    );
    await run('DELETE FROM marketing_expenses WHERE id = ?', [id]);
    // Nëse ishte një produkt nga inventari, riktheje stokun te produkti.
    if (existing?.product_id && existing.product_qty > 0) {
      await run(
        'UPDATE products SET stock = stock + ? WHERE id = ?',
        [existing.product_qty, existing.product_id]
      );
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// MARKETING — KONTRATAT (budget + entries)
// ============================================================
// Kontrata ka një buxhet total EUR dhe përmban zëra (product ose cash EUR)
// që zbriten nga buxheti derisa arrihet totali. Cash EUR entries reflektohen
// si shpenzim në Arkën Ditore.

app.get('/api/marketing-contracts', async (req, res) => {
  try {
    const rows = await queryAll(
      `SELECT mc.*,
              COALESCE((SELECT SUM(amount_eur) FROM marketing_contract_entries WHERE contract_id = mc.id), 0) AS used_eur,
              COALESCE((SELECT COUNT(*) FROM marketing_contract_entries WHERE contract_id = mc.id), 0) AS entries_count
         FROM marketing_contracts mc
        ORDER BY (mc.status = 'closed') ASC, mc.created_at DESC`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/marketing-contracts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const contract = await queryOne('SELECT * FROM marketing_contracts WHERE id = ?', [id]);
    if (!contract) return res.status(404).json({ error: 'not found' });
    const entries = await queryAll(
      `SELECT e.*,
              p.name AS product_name, p.barcode AS product_barcode,
              p.sell_price AS product_sell_price, p.stock AS product_stock
         FROM marketing_contract_entries e
         LEFT JOIN products p ON p.id = e.product_id
        WHERE e.contract_id = ?
        ORDER BY e.date ASC, e.id ASC`,
      [id]
    );
    const usedRow = await queryOne(
      'SELECT COALESCE(SUM(amount_eur), 0) AS used FROM marketing_contract_entries WHERE contract_id = ?',
      [id]
    );
    res.json({ ...contract, entries, used_eur: usedRow?.used || 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/marketing-contracts', async (req, res) => {
  try {
    const { name, total_amount_eur, notes, start_date } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'name required' });
    const total = parseFloat(total_amount_eur) || 0;
    if (total <= 0) return res.status(400).json({ error: 'total_amount_eur must be > 0' });
    await run(
      `INSERT INTO marketing_contracts (name, total_amount_eur, notes, status, start_date) VALUES (?, ?, ?, 'open', ?)`,
      [String(name).trim(), total, notes || '', start_date || '']
    );
    const row = await queryOne('SELECT * FROM marketing_contracts ORDER BY id DESC LIMIT 1');
    res.json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/marketing-contracts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await queryOne('SELECT * FROM marketing_contracts WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'not found' });
    const { name, total_amount_eur, notes, status } = req.body || {};
    const newStatus = status === 'closed' ? 'closed' : 'open';
    const closedAt = newStatus === 'closed' && existing.status !== 'closed'
      ? "strftime('%Y-%m-%d %H:%M:%f','now')"
      : (newStatus === 'open' ? 'NULL' : 'closed_at');
    await run(
      `UPDATE marketing_contracts
         SET name = ?, total_amount_eur = ?, notes = ?, status = ?, closed_at = ${closedAt}
       WHERE id = ?`,
      [
        name != null ? String(name).trim() : existing.name,
        total_amount_eur != null ? parseFloat(total_amount_eur) || 0 : existing.total_amount_eur,
        notes != null ? notes : existing.notes,
        newStatus,
        id,
      ]
    );
    res.json(await queryOne('SELECT * FROM marketing_contracts WHERE id = ?', [id]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/marketing-contracts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    // Riktheji stokun për të gjitha product entries përpara fshirjes.
    const productEntries = await queryAll(
      `SELECT product_id, product_qty FROM marketing_contract_entries
        WHERE contract_id = ? AND type = 'product' AND product_id IS NOT NULL`,
      [id]
    );
    for (const e of productEntries) {
      if (e.product_qty > 0) {
        await run('UPDATE products SET stock = stock + ? WHERE id = ?', [e.product_qty, e.product_id]);
      }
    }
    await run('DELETE FROM marketing_contracts WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/marketing-contracts/:id/entries', async (req, res) => {
  try {
    const { id } = req.params;
    const contract = await queryOne('SELECT * FROM marketing_contracts WHERE id = ?', [id]);
    if (!contract) return res.status(404).json({ error: 'contract not found' });
    const { date, type, amount_eur, product_id, product_qty, description } = req.body || {};
    if (!date) return res.status(400).json({ error: 'date required' });
    if (type !== 'product' && type !== 'cash') return res.status(400).json({ error: 'type must be product or cash' });
    if (type === 'product') {
      const pid = parseInt(product_id);
      const qty = Math.max(1, parseInt(product_qty) || 1);
      if (!pid) return res.status(400).json({ error: 'product_id required' });
      const prod = await queryOne('SELECT id, sell_price, stock, vat_rate FROM products WHERE id = ?', [pid]);
      if (!prod) return res.status(404).json({ error: 'product not found' });
      if ((prod.stock || 0) < qty) {
        return res.status(400).json({ error: `insufficient stock (aktual: ${prod.stock || 0})` });
      }
      const provided = parseFloat(amount_eur);
      const amt = provided > 0
        ? +provided.toFixed(2)
        : +((parseFloat(prod.sell_price) || 0) * qty * (1 + (parseFloat(prod.vat_rate) || 0) / 100)).toFixed(2);
      await run(
        `INSERT INTO marketing_contract_entries (contract_id, date, type, amount_eur, product_id, product_qty, description)
         VALUES (?, ?, 'product', ?, ?, ?, ?)`,
        [id, date, amt, pid, qty, description || '']
      );
      await run('UPDATE products SET stock = stock - ? WHERE id = ?', [qty, pid]);
    } else {
      const amt = parseFloat(amount_eur) || 0;
      if (amt <= 0) return res.status(400).json({ error: 'amount_eur must be > 0' });
      await run(
        `INSERT INTO marketing_contract_entries (contract_id, date, type, amount_eur, description)
         VALUES (?, ?, 'cash', ?, ?)`,
        [id, date, +amt.toFixed(2), description || '']
      );
    }
    const row = await queryOne(
      `SELECT e.*, p.name AS product_name, p.barcode AS product_barcode,
              p.sell_price AS product_sell_price, p.stock AS product_stock
         FROM marketing_contract_entries e
         LEFT JOIN products p ON p.id = e.product_id
        ORDER BY e.id DESC LIMIT 1`
    );
    res.json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/marketing-contract-entries/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await queryOne(
      'SELECT type, product_id, product_qty FROM marketing_contract_entries WHERE id = ?',
      [id]
    );
    if (!existing) return res.status(404).json({ error: 'not found' });
    await run('DELETE FROM marketing_contract_entries WHERE id = ?', [id]);
    if (existing.type === 'product' && existing.product_id && existing.product_qty > 0) {
      await run(
        'UPDATE products SET stock = stock + ? WHERE id = ?',
        [existing.product_qty, existing.product_id]
      );
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// POROSI (Custom Orders) — klienti sheh nje produkt referencë, e do me
// modifikime (gur tjeter, iniciale, permasa etj), paguan një depozitë
// dhe kur artikulli është gati krijohet fatura reale e shitjes.
// ============================================================
async function nextPorosiNo(date) {
  const year = (date || '').slice(0, 4) || new Date().getFullYear().toString();
  const prefix = `P${year}-`;
  const row = await queryOne(
    `SELECT MAX(CAST(SUBSTR(porosi_no, ${prefix.length + 1}) AS INTEGER)) AS max_no
       FROM porosi WHERE porosi_no LIKE ?`,
    [`${prefix}%`],
  );
  const next = Number(row?.max_no || 0) + 1;
  return `${prefix}${String(next).padStart(5, '0')}`;
}

app.get('/api/porosi/next-no', async (req, res) => {
  try {
    const { date } = req.query;
    res.json({ porosi_no: await nextPorosiNo(date) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/porosi', async (req, res) => {
  try {
    const { from, to, status } = req.query;
    const where = [];
    const params = [];
    if (from) { where.push('p.date >= ?'); params.push(from); }
    if (to)   { where.push('p.date <= ?'); params.push(to); }
    if (status && ['ne_progres','gati','dorezuar'].includes(status)) {
      where.push('p.status = ?'); params.push(status);
    }
    const rows = await queryAll(
      `SELECT p.*,
              COALESCE((SELECT SUM(amount * COALESCE(exchange_rate, 1))
                          FROM porosi_deposits WHERE porosi_id = p.id
                            AND currency = p.currency), 0)
                + COALESCE((SELECT SUM(amount * COALESCE(exchange_rate, 1))
                              FROM porosi_deposits WHERE porosi_id = p.id
                                AND currency != p.currency), 0)
                AS total_deposits_in_currency,
              COALESCE((SELECT COUNT(*) FROM porosi_deposits WHERE porosi_id = p.id), 0) AS deposits_count,
              rp.name AS reference_product_name, rp.barcode AS reference_product_barcode
         FROM porosi p
         LEFT JOIN products rp ON rp.id = p.reference_product_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY p.date DESC, p.id DESC`,
      params
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/porosi/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const p = await queryOne(
      `SELECT p.*, rp.name AS reference_product_name, rp.barcode AS reference_product_barcode,
              rp.image_path AS reference_product_image
         FROM porosi p
         LEFT JOIN products rp ON rp.id = p.reference_product_id
        WHERE p.id = ?`,
      [id]
    );
    if (!p) return res.status(404).json({ error: 'not found' });
    const deposits = await queryAll(
      `SELECT * FROM porosi_deposits WHERE porosi_id = ? ORDER BY date ASC, id ASC`,
      [id]
    );
    res.json({ ...p, deposits });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/porosi', async (req, res) => {
  try {
    const d = req.body || {};
    if (!d.date) return res.status(400).json({ error: 'date required' });
    const porosi_no = (d.porosi_no || '').trim() || await nextPorosiNo(d.date);
    await ensureClientExists(d.customer_name, '');
    await run(
      `INSERT INTO porosi (
         porosi_no, date, expected_delivery_date, status,
         customer_name, customer_phone, customer_id,
         reference_product_id, reference_note,
         category, karat, gram, stones, initials, size, notes, image_path,
         currency, sell_price, updated_at
       ) VALUES (?, ?, ?, 'ne_progres', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%d %H:%M:%f','now'))`,
      [
        porosi_no, d.date, d.expected_delivery_date || '',
        d.customer_name || '', d.customer_phone || '',
        d.customer_id ? parseInt(d.customer_id) : null,
        d.reference_product_id ? parseInt(d.reference_product_id) : null,
        d.reference_note || '',
        d.category || '', d.karat || '', parseFloat(d.gram) || 0,
        d.stones || '', d.initials || '', d.size || '',
        d.notes || '', d.image_path || '',
        (d.currency || 'EUR').toUpperCase(), parseFloat(d.sell_price) || 0,
      ]
    );
    const row = await queryOne('SELECT * FROM porosi WHERE porosi_no = ? ORDER BY id DESC LIMIT 1', [porosi_no]);
    res.json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/porosi/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await queryOne('SELECT * FROM porosi WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'not found' });
    if (existing.status === 'dorezuar') {
      return res.status(400).json({ error: 'porosi e dorëzuar nuk mund të ndryshohet' });
    }
    const d = req.body || {};
    await ensureClientExists(d.customer_name, '');
    await run(
      `UPDATE porosi SET
         date = ?, expected_delivery_date = ?, status = ?,
         customer_name = ?, customer_phone = ?, customer_id = ?,
         reference_product_id = ?, reference_note = ?,
         category = ?, karat = ?, gram = ?, stones = ?, initials = ?, size = ?,
         notes = ?, image_path = ?, currency = ?, sell_price = ?,
         updated_at = strftime('%Y-%m-%d %H:%M:%f','now')
       WHERE id = ?`,
      [
        d.date || existing.date, d.expected_delivery_date || '',
        ['ne_progres','gati','dorezuar'].includes(d.status) ? d.status : existing.status,
        d.customer_name || '', d.customer_phone || '',
        d.customer_id ? parseInt(d.customer_id) : null,
        d.reference_product_id ? parseInt(d.reference_product_id) : null,
        d.reference_note || '',
        d.category || '', d.karat || '', parseFloat(d.gram) || 0,
        d.stones || '', d.initials || '', d.size || '',
        d.notes || '', d.image_path || existing.image_path || '',
        (d.currency || existing.currency || 'EUR').toUpperCase(),
        parseFloat(d.sell_price) || 0,
        id,
      ]
    );
    res.json(await queryOne('SELECT * FROM porosi WHERE id = ?', [id]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/porosi/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await queryOne('SELECT * FROM porosi WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'not found' });
    if (existing.status === 'dorezuar') {
      return res.status(400).json({ error: 'porosi e dorëzuar nuk mund të fshihet — fshi së pari faturën e shitjes' });
    }
    // Fshi imazhin nga disku nëse ekziston
    if (existing.image_path) {
      const fp = path.join(uploadDir, existing.image_path);
      try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (_) {}
    }
    await run('DELETE FROM porosi WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/porosi/:id/image', upload.single('image'), async (req, res) => {
  try {
    const { id } = req.params;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const image_path = req.file.filename;
    await run('UPDATE porosi SET image_path = ? WHERE id = ?', [image_path, id]);
    res.json({ success: true, image_path });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/porosi/:id/image', async (req, res) => {
  try {
    const { id } = req.params;
    const p = await queryOne('SELECT image_path FROM porosi WHERE id = ?', [id]);
    if (p?.image_path) {
      const fp = path.join(uploadDir, p.image_path);
      try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (_) {}
    }
    await run("UPDATE porosi SET image_path = '' WHERE id = ?", [id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Depozitat për një porosi
app.post('/api/porosi/:id/deposits', async (req, res) => {
  try {
    const { id } = req.params;
    const p = await queryOne('SELECT * FROM porosi WHERE id = ?', [id]);
    if (!p) return res.status(404).json({ error: 'porosi not found' });
    if (p.status === 'dorezuar') {
      return res.status(400).json({ error: 'porosi e dorëzuar — depozitat nuk lejohen' });
    }
    const { date, amount, currency, method, exchange_rate, notes } = req.body || {};
    if (!date) return res.status(400).json({ error: 'date required' });
    const amt = parseFloat(amount) || 0;
    if (amt <= 0) return res.status(400).json({ error: 'amount must be > 0' });
    await run(
      `INSERT INTO porosi_deposits (porosi_id, date, amount, currency, method, exchange_rate, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id, date, +amt.toFixed(2),
        (currency || p.currency || 'EUR').toUpperCase(),
        ['cash','bank','pos'].includes(method) ? method : 'cash',
        parseFloat(exchange_rate) || 1,
        notes || '',
      ]
    );
    const row = await queryOne(
      'SELECT * FROM porosi_deposits WHERE porosi_id = ? ORDER BY id DESC LIMIT 1',
      [id]
    );
    res.json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/porosi-deposits/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const dep = await queryOne('SELECT porosi_id FROM porosi_deposits WHERE id = ?', [id]);
    if (!dep) return res.status(404).json({ error: 'not found' });
    const p = await queryOne('SELECT status FROM porosi WHERE id = ?', [dep.porosi_id]);
    if (p?.status === 'dorezuar') {
      return res.status(400).json({ error: 'porosi e dorëzuar — depozitat nuk mund të fshihen' });
    }
    await run('DELETE FROM porosi_deposits WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Dorëzim: krijon një faturë shitjeje me artikull custom (pa lidhje inventari)
// dhe aplikon automatikisht depozitat si "paguar tashmë". Diferenca paguhet
// nga klienti me metodën e zgjedhur (cash/bank/pos/debt).
app.post('/api/porosi/:id/deliver', async (req, res) => {
  try {
    const { id } = req.params;
    const p = await queryOne('SELECT * FROM porosi WHERE id = ?', [id]);
    if (!p) return res.status(404).json({ error: 'porosi not found' });
    if (p.status === 'dorezuar') return res.status(400).json({ error: 'porosi tashmë e dorëzuar' });
    if (!(parseFloat(p.sell_price) > 0)) return res.status(400).json({ error: 'vendos sell_price para dorëzimit' });

    const d = req.body || {};
    const date = d.date || new Date().toISOString().slice(0, 10);
    if (req.user?.role !== 'admin' && date !== new Date().toISOString().slice(0, 10)) {
      return res.status(403).json({ error: 'only admin can set a non-today date' });
    }

    const deposits = await queryAll('SELECT * FROM porosi_deposits WHERE porosi_id = ?', [id]);
    // Depozitat konvertohen në monedhën e porosisë me exchange_rate të depozitës.
    let depositsInInvoiceCurrency = 0;
    for (const dep of deposits) {
      if (dep.currency === p.currency) {
        depositsInInvoiceCurrency += dep.amount;
      } else {
        // Depozita në monedhë tjetër → konvertim direkt via kursin e ruajtur.
        depositsInInvoiceCurrency += dep.amount * (dep.exchange_rate || 1);
      }
    }
    depositsInInvoiceCurrency = +depositsInInvoiceCurrency.toFixed(2);

    const total = +parseFloat(p.sell_price).toFixed(2);
    const remaining = Math.max(0, +(total - depositsInInvoiceCurrency).toFixed(2));

    // Fatura krijohet me: total = sell_price, amount_paid = depozitat + pagesa e re
    const newPayAmount = Math.min(remaining, parseFloat(d.new_payment_amount) || 0);
    const amountPaid = +(depositsInInvoiceCurrency + newPayAmount).toFixed(2);
    const amountDue  = Math.max(0, +(total - amountPaid).toFixed(2));
    const pm = amountDue > 0.005 ? 'debt' : (['cash','bank','pos'].includes(d.new_payment_method) ? d.new_payment_method : 'cash');

    // Emri i artikullit — përfshin kategorinë + karatin + gramin + iniciale për qartësi.
    const itemName = d.item_name || [
      p.category || 'Artikull custom',
      p.karat ? p.karat : '',
      p.gram ? `${p.gram}g` : '',
      p.initials ? `("${p.initials}")` : '',
    ].filter(Boolean).join(' ');

    await ensureClientExists(p.customer_name, '');
    const userProvidedNo = (d.invoice_no || '').trim();
    const doInsert = (invNo) => run(
      `INSERT INTO invoices (date, invoice_no, customer_name, customer_nipt, currency, exchange_rate,
        subtotal_no_vat, total_discount, total_vat, total_with_vat, payment_method, amount_paid, amount_due,
        paid_cash, paid_pos, paid_bank, notes)
       VALUES (?, ?, ?, '', ?, ?, ?, 0, 0, ?, ?, ?, ?, 0, 0, 0, ?)`,
      [
        date, invNo, p.customer_name || '',
        p.currency, 1,
        total, total, pm, amountPaid, amountDue,
        `Dorëzim porosie ${p.porosi_no}${p.notes ? ' · ' + p.notes : ''}`,
      ]
    );
    const invoice_no = await retryOnUniqueNo(
      () => nextInvoiceNo(date),
      doInsert,
      5,
      userProvidedNo || null,
    );
    const inv = await queryOne('SELECT id FROM invoices WHERE date = ? AND invoice_no = ?', [date, invoice_no]);
    const invoiceId = inv?.id;

    // Nje rresht "artikull custom" (product_id = null, s'ka lidhje inventari).
    await run(
      `INSERT INTO invoice_items (invoice_id, product_id, serial_no, barcode, name, qty, gram, unit_price_no_vat,
        discount_percent, subtotal_no_vat, vat_rate, vat_amount, total_with_vat,
        on_promotion, promo_discount_pct)
       VALUES (?, NULL, '', '', ?, 1, ?, ?, 0, ?, 0, 0, ?, 0, 0)`,
      [invoiceId, itemName, parseFloat(p.gram) || 0, total, total, total]
    );

    // Marko porosinë si dorëzuar
    await run(
      `UPDATE porosi SET status = 'dorezuar', delivered_invoice_id = ?, delivered_at = ?,
                        updated_at = strftime('%Y-%m-%d %H:%M:%f','now')
        WHERE id = ?`,
      [invoiceId, date, id]
    );

    res.json({ success: true, invoice_id: invoiceId, invoice_no, total, deposits_applied: depositsInInvoiceCurrency, new_payment: newPayAmount, amount_due: amountDue });
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
              p.name AS product_name, p.barcode AS product_barcode,
              p.cost_price AS product_cost_price, p.stock AS product_stock,
              p.serial_no AS product_serial_no, p.gram AS product_gram,
              p.vat_rate AS product_vat_rate, p.sell_price AS product_sell_price,
              (COALESCE(m.amount, 0) * COALESCE(m.exchange_rate, 1)) AS total_lek
       FROM marketing_expenses m
       LEFT JOIN marketing_categories c ON c.id = m.category_id
       LEFT JOIN products p ON p.id = m.product_id
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

    // Breakdown për periudhën — 3 totale që të ndihmojnë të kuptohet ku
    // shpenzohet buxheti i marketingut: kontratat (cash + produkte), cash direkt
    // dhe produktet direkte. Produktet vlerësohen edhe me çmim (amount_eur) edhe
    // me kosto (qty × cost_price) — shpesh të dyja janë të dobishme.
    const breakdown = await computeMarketingBreakdown(from, to);
    res.json({ rows, totals, breakdown });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

async function computeMarketingBreakdown(from, to) {
  const [contractCash, contractProd, directCash, directProd] = await Promise.all([
    queryOne(
      `SELECT COALESCE(SUM(amount_eur), 0) AS total, COUNT(*) AS cnt
         FROM marketing_contract_entries
        WHERE date BETWEEN ? AND ? AND type = 'cash'`,
      [from, to]
    ),
    queryAll(
      `SELECT COALESCE(mce.amount_eur, 0) AS amt,
              COALESCE(mce.product_qty, 0) AS qty,
              COALESCE(p.cost_price, 0) AS cost
         FROM marketing_contract_entries mce
         LEFT JOIN products p ON p.id = mce.product_id
        WHERE mce.date BETWEEN ? AND ? AND mce.type = 'product'`,
      [from, to]
    ),
    queryOne(
      `SELECT COALESCE(SUM(amount_eur), 0) AS total, COUNT(*) AS cnt
         FROM marketing_expenses
        WHERE date BETWEEN ? AND ? AND product_id IS NULL`,
      [from, to]
    ),
    queryAll(
      `SELECT COALESCE(m.amount_eur, 0) AS amt,
              COALESCE(m.product_qty, 0) AS qty,
              COALESCE(p.cost_price, 0) AS cost
         FROM marketing_expenses m
         LEFT JOIN products p ON p.id = m.product_id
        WHERE m.date BETWEEN ? AND ? AND m.product_id IS NOT NULL`,
      [from, to]
    ),
  ]);
  const contractProdSell = contractProd.reduce((s, r) => s + (r.amt || 0), 0);
  const contractProdCost = contractProd.reduce((s, r) => s + (r.qty * r.cost || 0), 0);
  const contractProdQty  = contractProd.reduce((s, r) => s + (r.qty || 0), 0);
  const directProdSell   = directProd.reduce((s, r) => s + (r.amt || 0), 0);
  const directProdCost   = directProd.reduce((s, r) => s + (r.qty * r.cost || 0), 0);
  const directProdQty    = directProd.reduce((s, r) => s + (r.qty || 0), 0);
  return {
    contracts_cash_eur:          +(contractCash?.total || 0).toFixed(2),
    contracts_products_eur:      +contractProdSell.toFixed(2),
    contracts_products_cost_eur: +contractProdCost.toFixed(2),
    contracts_products_qty:      contractProdQty,
    contracts_total_eur:         +((contractCash?.total || 0) + contractProdSell).toFixed(2),
    contracts_count_cash:        contractCash?.cnt || 0,
    contracts_count_products:    contractProd.length,
    direct_cash_eur:             +(directCash?.total || 0).toFixed(2),
    direct_products_eur:         +directProdSell.toFixed(2),
    direct_products_cost_eur:    +directProdCost.toFixed(2),
    direct_products_qty:         directProdQty,
    direct_count_cash:           directCash?.cnt || 0,
    direct_count_products:       directProd.length,
  };
}

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
  // Hashed asset filenames (index-XYZ.js) mund të cache-ohen përgjithmonë,
  // por index.html duhet të ridownload-ohet gjithmonë që pas update-it të
  // reflektohet versioni i ri (përndryshe Chromium mban HTML-në e vjetër).
  app.use(express.static(distDir, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      }
    },
  }));
  app.get(/^\/(?!api|uploads).*/, (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
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
