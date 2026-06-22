import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { initDB, queryAll, queryOne, run, exportDB } from './db.js';

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

// Initialize DB before starting server
await initDB();

// ============================================================
// DAILY RECORDS
// ============================================================
app.get('/api/daily/:date', async (req, res) => {
  try {
    const { date } = req.params;
    let record = queryOne('SELECT * FROM daily_records WHERE date = ?', [date]);

    if (!record) {
      // Try to carry forward opening balance from previous day
      const prevRecord = queryOne(
        `SELECT * FROM daily_records WHERE date < ? ORDER BY date DESC LIMIT 1`,
        [date]
      );

      if (prevRecord) {
        // Calculate closing balance of previous day to use as opening
        const prevSales = queryAll(
          'SELECT * FROM sales WHERE date = ? AND is_return = 0',
          [prevRecord.date]
        );
        const prevReturns = queryAll(
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

    const existing = queryOne('SELECT id FROM daily_records WHERE date = ?', [date]);

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

    const values = fields.map(f => data[f] || 0);

    if (existing) {
      const setClause = fields.map(f => `${f} = ?`).join(', ');
      run(`UPDATE daily_records SET ${setClause} WHERE date = ?`, [...values, date]);
    } else {
      const cols = fields.join(', ');
      const placeholders = fields.map(() => '?').join(', ');
      run(
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
    res.json(queryAll(sql, params));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/sales/recent', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 30, 90);
    const rows = queryAll(`
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
    const rows = queryAll(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sales', async (req, res) => {
  try {
    const d = req.body;
    run(
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
    run(
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
    run('DELETE FROM sales WHERE id = ?', [id]);
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
    const rows = queryAll(`
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
    const rows = queryAll(
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
    const rows = queryAll(
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
    run(
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
    run('DELETE FROM customer_debts WHERE id = ?', [id]);
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
    const rows = queryAll(
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
    const existing = queryOne(
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
      run(
        `UPDATE inventory SET ${setClause} WHERE date = ? AND type = ?`,
        [...values, d.date, d.type]
      );
    } else {
      const cols = fields.join(', ');
      const placeholders = fields.map(() => '?').join(', ');
      run(
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
      rows = queryAll(
        "SELECT * FROM marketing_expenses WHERE date LIKE ? ORDER BY date ASC",
        [date + '%']
      );
    } else {
      rows = queryAll(
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
    run(
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
    run('DELETE FROM marketing_expenses WHERE id = ?', [id]);
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

    const records = queryAll(
      'SELECT * FROM daily_records WHERE date LIKE ? ORDER BY date',
      [prefix + '%']
    );

    const result = [];
    for (const rec of records) {
      const sales = queryAll('SELECT * FROM sales WHERE date = ? AND is_return = 0', [rec.date]);
      const returns = queryAll('SELECT * FROM sales WHERE date = ? AND is_return = 1', [rec.date]);
      const debts = queryAll('SELECT * FROM customer_debts WHERE date = ?', [rec.date]);
      const marketing = queryAll('SELECT * FROM marketing_expenses WHERE date = ?', [rec.date]);

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

    const recs   = queryAll('SELECT * FROM daily_records WHERE date BETWEEN ? AND ?', [from, to]);
    const sales  = queryAll('SELECT * FROM sales WHERE date BETWEEN ? AND ?', [from, to]);
    const debts  = queryAll('SELECT * FROM customer_debts WHERE date BETWEEN ? AND ?', [from, to]);

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
      const recs = queryAll('SELECT * FROM daily_records WHERE date LIKE ?', [prefix + '%']);
      const sales = queryAll('SELECT * FROM sales WHERE date LIKE ?', [prefix + '%']);
      const debts = queryAll('SELECT * FROM customer_debts WHERE date LIKE ?', [prefix + '%']);

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
    const product = queryOne(
      'SELECT * FROM products WHERE active = 1 AND (barcode = ? OR sku = ?) LIMIT 1',
      [q, q]
    );
    res.json(product || null);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/products/:id/stock', async (req, res) => {
  try {
    const { id } = req.params;
    const { delta } = req.body;
    if (typeof delta !== 'number') return res.status(400).json({ error: 'delta required' });
    run('UPDATE products SET stock = MAX(0, stock + ?) WHERE id = ?', [delta, id]);
    const p = queryOne('SELECT stock FROM products WHERE id = ?', [id]);
    res.json({ success: true, stock: p?.stock ?? 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/products/:id/image', upload.single('image'), async (req, res) => {
  try {
    const { id } = req.params;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const image_path = req.file.filename;
    run('UPDATE products SET image_path = ? WHERE id = ?', [image_path, id]);
    res.json({ success: true, image_path });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/products/:id/image', async (req, res) => {
  try {
    const { id } = req.params;
    const p = queryOne('SELECT image_path FROM products WHERE id = ?', [id]);
    if (p?.image_path) {
      const fp = path.join(uploadDir, p.image_path);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
    run("UPDATE products SET image_path = '' WHERE id = ?", [id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/backup', (req, res) => {
  try {
    const data = exportDB();
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
    const rows = queryAll(
      'SELECT * FROM products WHERE active = 1 ORDER BY category, name',
      []
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/products', async (req, res) => {
  try {
    const d = req.body;
    run(
      `INSERT INTO products (name, sku, barcode, category, brand, description, cost_price, sell_price, stock, min_stock)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        d.name, d.sku || '', d.barcode || '',
        d.category || 'Tjeter', d.brand || '', d.description || '',
        d.cost_price || 0, d.sell_price || 0,
        d.stock || 0, d.min_stock !== undefined ? d.min_stock : 5,
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
    run(
      `UPDATE products
       SET name=?, sku=?, barcode=?, category=?, brand=?, description=?,
           cost_price=?, sell_price=?, stock=?, min_stock=?
       WHERE id=?`,
      [
        d.name, d.sku || '', d.barcode || '',
        d.category || 'Tjeter', d.brand || '', d.description || '',
        d.cost_price || 0, d.sell_price || 0,
        d.stock || 0, d.min_stock !== undefined ? d.min_stock : 5,
        id,
      ]
    );
    res.json({ success: true });
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
    let imported = 0;
    for (const d of products) {
      if (!d.name || !String(d.name).trim()) continue;
      run(
        `INSERT INTO products (name, sku, barcode, category, brand, description, cost_price, sell_price, stock, min_stock)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          String(d.name).trim(),
          d.sku || '', d.barcode || '',
          d.category || 'Tjeter', d.brand || '', d.description || '',
          parseFloat(d.cost_price) || 0, parseFloat(d.sell_price) || 0,
          parseInt(d.stock) || 0, parseInt(d.min_stock) || 5,
        ]
      );
      imported++;
    }
    res.json({ success: true, imported });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    run('UPDATE products SET active = 0 WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// START SERVER
// ============================================================
const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
