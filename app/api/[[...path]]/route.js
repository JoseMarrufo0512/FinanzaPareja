import { NextResponse } from 'next/server';
import Decimal from 'decimal.js';
import { initDb, query } from '@/lib/db';
import { refreshRates, getLatestRates } from '@/lib/rates';
import { D, fmt } from '@/lib/money';

Decimal.set({ precision: 30, rounding: Decimal.ROUND_HALF_UP });

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const json = (data, status = 200) => NextResponse.json(data, { status });
const err = (msg, status = 400) => json({ error: msg }, status);

function getPath(req, params) {
  const segs = (params?.path || []);
  return '/' + segs.join('/');
}

async function ensureInit() {
  await initDb();
}

// ---------- ROUTE DISPATCH ----------
async function dispatch(req, params) {
  const method = req.method;
  const path = getPath(req, params);
  const url = new URL(req.url);

  await ensureInit();

  // Auto-refresh rates if none exist yet
  if (path !== '/rates/refresh' && path !== '/init') {
    const latest = await getLatestRates();
    if (!latest.bcv_usd && !latest.binance_usdt) {
      refreshRates().catch(() => {}); // fire-and-forget
    }
  }

  // -------- HEALTH & INIT --------
  if (path === '/health') return json({ ok: true, ts: new Date().toISOString() });

  if (path === '/init' && method === 'POST') {
    const body = await req.json().catch(() => ({}));
    const { mode = 'couple', names = null } = body;
    const existing = await query('SELECT id FROM app_users LIMIT 1');
    if (existing.rowCount === 0) {
      if (mode === 'couple') {
        const [n1, n2] = names && names.length === 2 ? names : ['José', 'Aliexis'];
        await query('INSERT INTO app_users(name,short,color) VALUES($1,$2,$3)', [n1, n1[0].toUpperCase(), '#6366f1']);
        await query('INSERT INTO app_users(name,short,color) VALUES($1,$2,$3)', [n2, n2[0].toUpperCase(), '#ec4899']);
      } else {
        const n = names?.[0] || 'Yo';
        await query('INSERT INTO app_users(name,short,color) VALUES($1,$2,$3)', [n, n[0].toUpperCase(), '#6366f1']);
      }
      await query('INSERT INTO app_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=$2', ['mode', mode]);
    }
    refreshRates().catch(() => {});
    return json({ ok: true });
  }

  // -------- USERS --------
  if (path === '/users' && method === 'GET') {
    const r = await query('SELECT * FROM app_users ORDER BY created_at ASC');
    return json(r.rows);
  }
  if (path === '/users' && method === 'POST') {
    const b = await req.json();
    const r = await query(
      'INSERT INTO app_users(name,short,color) VALUES($1,$2,$3) RETURNING *',
      [b.name, (b.short || b.name[0]).toUpperCase().slice(0, 3), b.color || '#6366f1']
    );
    return json(r.rows[0], 201);
  }
  if (path.startsWith('/users/') && method === 'DELETE') {
    const id = path.split('/')[2];
    await query('DELETE FROM app_users WHERE id=$1', [id]);
    return json({ ok: true });
  }

  // -------- CATEGORIES --------
  if (path === '/categories' && method === 'GET') {
    const r = await query('SELECT * FROM categories ORDER BY name');
    return json(r.rows);
  }
  if (path === '/categories' && method === 'POST') {
    const b = await req.json();
    const r = await query(
      'INSERT INTO categories(name,icon) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET icon=EXCLUDED.icon RETURNING *',
      [b.name, b.icon || '💰']
    );
    return json(r.rows[0], 201);
  }

  // -------- WALLETS --------
  if (path === '/wallets' && method === 'GET') {
    const uid = url.searchParams.get('user_id');
    const r = uid
      ? await query('SELECT * FROM wallets WHERE user_id=$1 ORDER BY created_at', [uid])
      : await query('SELECT w.*, u.name AS user_name FROM wallets w JOIN app_users u ON u.id=w.user_id ORDER BY u.name, w.created_at');
    return json(r.rows);
  }
  if (path === '/wallets' && method === 'POST') {
    const b = await req.json();
    const r = await query(
      'INSERT INTO wallets(user_id,name,account_type,currency,current_balance) VALUES($1,$2,$3,$4,$5) RETURNING *',
      [b.user_id, b.name, b.account_type || 'BANK', b.currency || 'USD', b.current_balance || 0]
    );
    return json(r.rows[0], 201);
  }
  if (path.startsWith('/wallets/') && method === 'DELETE') {
    const id = path.split('/')[2];
    await query('DELETE FROM wallets WHERE id=$1', [id]);
    return json({ ok: true });
  }

  // -------- RATES --------
  if (path === '/rates' && method === 'GET') {
    const latest = await getLatestRates();
    // if stale (> 6h) refresh
    const stale = !latest.fetched_at || (Date.now() - new Date(latest.fetched_at).getTime()) > 6 * 3600 * 1000;
    if (stale) {
      const fresh = await refreshRates();
      const l2 = await getLatestRates();
      return json({ ...l2, refreshed: true, refresh_result: fresh });
    }
    return json({ ...latest, refreshed: false });
  }
  if (path === '/rates/refresh' && method === 'POST') {
    const r = await refreshRates();
    const l = await getLatestRates();
    return json({ result: r, latest: l });
  }

  // -------- TRANSACTIONS --------
  if (path === '/transactions' && method === 'GET') {
    const limit = Math.min(500, parseInt(url.searchParams.get('limit') || '100', 10));
    const type = url.searchParams.get('type');
    const uid = url.searchParams.get('user_id');
    const month = url.searchParams.get('month'); // YYYY-MM
    const cond = [];
    const vals = [];
    if (type) { vals.push(type); cond.push(`t.type=$${vals.length}`); }
    if (uid) { vals.push(uid); cond.push(`(t.payer_id=$${vals.length} OR t.beneficiary_id=$${vals.length})`); }
    if (month) {
      vals.push(month + '-01');
      cond.push(`t.transaction_date >= $${vals.length}::date`);
      vals.push(month + '-01');
      cond.push(`t.transaction_date < ($${vals.length}::date + interval '1 month')`);
    }
    const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
    const sql = `
      SELECT t.*, p.name AS payer_name, p.color AS payer_color, p.short AS payer_short,
             b.name AS beneficiary_name, b.short AS beneficiary_short,
             c.name AS category_name, c.icon AS category_icon,
             w.name AS wallet_name
      FROM transactions t
      LEFT JOIN app_users p ON p.id=t.payer_id
      LEFT JOIN app_users b ON b.id=t.beneficiary_id
      LEFT JOIN categories c ON c.id=t.category_id
      LEFT JOIN wallets w ON w.id=t.wallet_id
      ${where}
      ORDER BY t.transaction_date DESC
      LIMIT ${limit}
    `;
    const r = await query(sql, vals);
    return json(r.rows);
  }

  if (path === '/transactions' && method === 'POST') {
    const b = await req.json();
    if (!b.payer_id || !b.type || !b.original_amount || !b.original_currency) return err('Faltan campos', 422);
    if (b.type === 'PRESTAMO' && !b.beneficiary_id) return err('Préstamo requiere beneficiario', 422);

    const rates = await getLatestRates();
    const originalAmount = D(b.original_amount);
    const currency = b.original_currency;

    // Determine applied rate (units of original per 1 USD). User may override.
    let appliedRate;
    if (b.applied_rate !== undefined && b.applied_rate !== null && b.applied_rate !== '') {
      appliedRate = D(b.applied_rate);
    } else if (currency === 'USD') appliedRate = D(1);
    else if (currency === 'BS') appliedRate = D(rates.bcv_usd?.rate || 1);
    else if (currency === 'EUR') {
      // EUR per USD = bcv_usd / bcv_eur (both bs-per-x)
      const bu = D(rates.bcv_usd?.rate || 1);
      const be = D(rates.bcv_eur?.rate || 1);
      appliedRate = be.isZero() ? D(1) : bu.div(be);
    } else if (currency === 'USDT') appliedRate = D(1);
    else appliedRate = D(1);

    // amount_usd = original_amount / applied_rate  (except identity for USD/USDT)
    let amountUsd;
    if (currency === 'USD' || currency === 'USDT') amountUsd = originalAmount;
    else amountUsd = appliedRate.isZero() ? originalAmount : originalAmount.div(appliedRate);
    amountUsd = amountUsd.toDecimalPlaces(2);

    // USDT freezing for PRESTAMO
    let amountUsdt = null;
    let usdtRate = null;
    if (b.type === 'PRESTAMO') {
      const bcvUsd = D(rates.bcv_usd?.rate || 0);
      const binUsdt = D(rates.binance_usdt?.rate || 0);
      usdtRate = binUsdt.toNumber() || null;
      // Compute VES equivalent, then convert VES -> USDT via binance
      let ves;
      if (currency === 'BS') ves = originalAmount;
      else if (currency === 'USD') ves = originalAmount.mul(bcvUsd);
      else if (currency === 'EUR') ves = originalAmount.mul(D(rates.bcv_eur?.rate || 0));
      else if (currency === 'USDT') { amountUsdt = originalAmount.toDecimalPlaces(2); }
      if (amountUsdt === null) {
        if (binUsdt.gt(0) && ves) amountUsdt = ves.div(binUsdt).toDecimalPlaces(2);
        else amountUsdt = amountUsd; // fallback
      }
    }

    const r = await query(
      `INSERT INTO transactions(payer_id, wallet_id, type, original_amount, original_currency, applied_rate, amount_usd, amount_usdt, usdt_rate, beneficiary_id, category_id, description, receipt_image_url, created_via, transaction_date)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, COALESCE($15::timestamptz, NOW())) RETURNING *`,
      [
        b.payer_id, b.wallet_id || null, b.type, originalAmount.toFixed(2), currency,
        appliedRate.toFixed(6), amountUsd.toFixed(2),
        amountUsdt ? amountUsdt.toString() : null,
        usdtRate,
        b.beneficiary_id || null, b.category_id || null, b.description || null,
        b.receipt_image_url || null, b.created_via || 'WEB', b.transaction_date || null,
      ]
    );
    return json(r.rows[0], 201);
  }

  if (path.startsWith('/transactions/') && method === 'DELETE') {
    const id = path.split('/')[2];
    await query('DELETE FROM transactions WHERE id=$1', [id]);
    return json({ ok: true });
  }

  // -------- BUDGETS --------
  if (path === '/budgets' && method === 'GET') {
    const r = await query(`
      SELECT b.*, c.name AS category_name, c.icon AS category_icon, u.name AS user_name
      FROM budgets b LEFT JOIN categories c ON c.id=b.category_id
      LEFT JOIN app_users u ON u.id=b.user_id
      ORDER BY c.name`);
    return json(r.rows);
  }
  if (path === '/budgets' && method === 'POST') {
    const b = await req.json();
    const r = await query(
      `INSERT INTO budgets(category_id, monthly_limit_usd, is_shared, user_id)
       VALUES($1,$2,$3,$4)
       ON CONFLICT (category_id, user_id, is_shared) DO UPDATE SET monthly_limit_usd=EXCLUDED.monthly_limit_usd
       RETURNING *`,
      [b.category_id, b.monthly_limit_usd, b.is_shared !== false, b.user_id || null]
    );
    return json(r.rows[0], 201);
  }
  if (path.startsWith('/budgets/') && method === 'DELETE') {
    const id = path.split('/')[2];
    await query('DELETE FROM budgets WHERE id=$1', [id]);
    return json({ ok: true });
  }

  // -------- SETTLEMENTS --------
  if (path === '/settlements' && method === 'POST') {
    const b = await req.json();
    const rates = await getLatestRates();
    const binUsdt = D(rates.binance_usdt?.rate || 0);
    const bcvUsd = D(rates.bcv_usd?.rate || 0);
    const amtUsd = D(b.amount_usd);
    let amtUsdt = null;
    if (binUsdt.gt(0) && bcvUsd.gt(0)) amtUsdt = amtUsd.mul(bcvUsd).div(binUsdt).toDecimalPlaces(2).toString();
    const r = await query(
      `INSERT INTO settlements(payer_id, receiver_id, amount_usd, amount_usdt, notes)
       VALUES($1,$2,$3,$4,$5) RETURNING *`,
      [b.payer_id, b.receiver_id, amtUsd.toFixed(2), amtUsdt, b.notes || null]
    );
    return json(r.rows[0], 201);
  }
  if (path === '/settlements' && method === 'GET') {
    const r = await query(`
      SELECT s.*, p.name AS payer_name, r.name AS receiver_name
      FROM settlements s JOIN app_users p ON p.id=s.payer_id JOIN app_users r ON r.id=s.receiver_id
      ORDER BY s.settlement_date DESC LIMIT 100`);
    return json(r.rows);
  }

  // -------- DASHBOARD --------
  if (path === '/dashboard' && method === 'GET') {
    const month = url.searchParams.get('month') || new Date().toISOString().slice(0, 7);
    const users = (await query('SELECT id, name, short, color FROM app_users ORDER BY created_at')).rows;

    // Sum by type/user for the month (all-time also possible)
    const txAgg = await query(`
      SELECT type, payer_id, beneficiary_id,
             SUM(amount_usd)::numeric AS total_usd,
             SUM(COALESCE(amount_usdt,0))::numeric AS total_usdt
      FROM transactions
      WHERE transaction_date >= $1::date AND transaction_date < ($1::date + interval '1 month')
      GROUP BY type, payer_id, beneficiary_id
    `, [month + '-01']);

    // Compute balances between users (for couple mode: net debt)
    // For each user, sum of #NOS paid (they cover 50% for the other) + sum of PRESTAMO where beneficiary=other
    // Balance owed FROM other TO this user = (0.5 * sum_nos_paid_by_this) + (sum_prestamo_this_paid_for_other in USDT)
    const balances = {};
    for (const u of users) {
      balances[u.id] = { user: u, nos_paid_usd: '0', mio_usd: '0', prestamo_given_usd: '0', prestamo_given_usdt: '0', prestamo_received_usd: '0', prestamo_received_usdt: '0' };
    }
    for (const row of txAgg.rows) {
      if (!balances[row.payer_id]) continue;
      const b = balances[row.payer_id];
      if (row.type === 'NOS') b.nos_paid_usd = D(b.nos_paid_usd).plus(row.total_usd).toString();
      if (row.type === 'MIO') b.mio_usd = D(b.mio_usd).plus(row.total_usd).toString();
      if (row.type === 'PRESTAMO') {
        b.prestamo_given_usd = D(b.prestamo_given_usd).plus(row.total_usd).toString();
        b.prestamo_given_usdt = D(b.prestamo_given_usdt).plus(row.total_usdt).toString();
        if (row.beneficiary_id && balances[row.beneficiary_id]) {
          balances[row.beneficiary_id].prestamo_received_usd = D(balances[row.beneficiary_id].prestamo_received_usd).plus(row.total_usd).toString();
          balances[row.beneficiary_id].prestamo_received_usdt = D(balances[row.beneficiary_id].prestamo_received_usdt).plus(row.total_usdt).toString();
        }
      }
    }

    // Net debt (couple mode with 2 users)
    let net = null;
    if (users.length === 2) {
      const [A, B] = users;
      const bA = balances[A.id], bB = balances[B.id];
      // What A owes B = (half of NOS B paid) + (prestamo B gave A) - (half of NOS A paid) - (prestamo A gave B)
      const aOwesB_usd = D(bB.nos_paid_usd).div(2).plus(bB.prestamo_given_usd).minus(D(bA.nos_paid_usd).div(2)).minus(bA.prestamo_given_usd);
      const aOwesB_usdt = D(bB.nos_paid_usd).div(2).plus(bB.prestamo_given_usdt).minus(D(bA.nos_paid_usd).div(2)).minus(bA.prestamo_given_usdt);
      net = {
        from: aOwesB_usd.gte(0) ? A : B,
        to: aOwesB_usd.gte(0) ? B : A,
        amount_usd: aOwesB_usd.abs().toDecimalPlaces(2).toString(),
        amount_usdt: aOwesB_usdt.abs().toDecimalPlaces(2).toString(),
      };
    }

    // Budgets progress
    const budgets = (await query(`
      SELECT b.*, c.name AS category_name, c.icon AS category_icon
      FROM budgets b LEFT JOIN categories c ON c.id=b.category_id
    `)).rows;
    const spendByCat = (await query(`
      SELECT category_id, SUM(amount_usd)::numeric AS spent_usd
      FROM transactions
      WHERE type IN ('NOS','MIO') AND transaction_date >= $1::date AND transaction_date < ($1::date + interval '1 month')
      GROUP BY category_id
    `, [month + '-01'])).rows.reduce((m, r) => { m[r.category_id] = r.spent_usd; return m; }, {});
    const budgetsWithSpend = budgets.map(b => ({
      ...b,
      spent_usd: spendByCat[b.category_id] || '0',
      pct: D(spendByCat[b.category_id] || 0).div(D(b.monthly_limit_usd).eq(0) ? 1 : b.monthly_limit_usd).mul(100).toDecimalPlaces(1).toNumber(),
    }));

    // Totals for month
    const totalsRow = (await query(`
      SELECT
        COALESCE(SUM(CASE WHEN type='NOS' THEN amount_usd END),0)::numeric AS total_nos,
        COALESCE(SUM(CASE WHEN type='MIO' THEN amount_usd END),0)::numeric AS total_mio,
        COALESCE(SUM(CASE WHEN type='PRESTAMO' THEN amount_usd END),0)::numeric AS total_prestamo,
        COALESCE(SUM(CASE WHEN type='PRESTAMO' THEN amount_usdt END),0)::numeric AS total_prestamo_usdt,
        COUNT(*) AS n
      FROM transactions
      WHERE transaction_date >= $1::date AND transaction_date < ($1::date + interval '1 month')
    `, [month + '-01'])).rows[0];

    const rates = await getLatestRates();

    return json({
      month,
      users,
      balances,
      net,
      budgets: budgetsWithSpend,
      totals: totalsRow,
      rates,
    });
  }

  return err('Ruta no encontrada: ' + path, 404);
}

// Handlers
export async function GET(req, ctx) {
  try { return await dispatch(req, await ctx.params); }
  catch (e) { console.error(e); return err(e.message || 'Error interno', 500); }
}
export async function POST(req, ctx) {
  try { return await dispatch(req, await ctx.params); }
  catch (e) { console.error(e); return err(e.message || 'Error interno', 500); }
}
export async function PATCH(req, ctx) {
  try { return await dispatch(req, await ctx.params); }
  catch (e) { console.error(e); return err(e.message || 'Error interno', 500); }
}
export async function DELETE(req, ctx) {
  try { return await dispatch(req, await ctx.params); }
  catch (e) { console.error(e); return err(e.message || 'Error interno', 500); }
}
