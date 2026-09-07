import { NextResponse } from 'next/server';
import Decimal from 'decimal.js';
import { initDb, query, withTx } from '@/lib/db';
import { refreshRates, getLatestRates } from '@/lib/rates';
import { D, fmt, convertUsdTo } from '@/lib/money';
import { computeSplits, settleUp } from '@/lib/splits';
import { parseExpenseText } from '@/lib/parser';
import { tg, sendMessage, answerCallback, editMessage, downloadFile, setWebhook, getWebhookInfo } from '@/lib/telegram';
import { transcribeAudio, extractReceipt, suggestCategory } from '@/lib/ai';
import { hashPin, verifyPin, newToken, safeEqual } from '@/lib/auth';
import { startScheduler } from '@/lib/scheduler';

Decimal.set({ precision: 30, rounding: Decimal.ROUND_HALF_UP });

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Kick off scheduler once when this module loads
try { startScheduler(); } catch (e) { console.error('scheduler init', e.message); }

// Given a parsed expense and the sender's user record, create the transaction and confirm via Telegram.
async function handleParsedExpense(me, parsed, chatId, source = 'WHATSAPP_BOT') {
  const users = (await query('SELECT id, name, short FROM app_users WHERE is_active ORDER BY created_at')).rows;

  // "#Mio A" = a personal expense that belongs to Aliexis;
  // "#Prestamo J" = money lent to José. Both land in beneficiary_id.
  let beneficiary_id = null;
  if (parsed.beneficiaryHint) {
    const hint = parsed.beneficiaryHint.toLowerCase();
    const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const found = users.find(u => norm(u.short) === norm(hint) || norm(u.name).startsWith(norm(hint)));
    if (found && found.id !== me.id) beneficiary_id = found.id;
  }
  if (parsed.type === 'PRESTAMO' && !beneficiary_id) {
    const others = users.filter(u => u.id !== me.id);
    if (others.length === 1) beneficiary_id = others[0].id;
    else {
      await sendMessage(chatId, others.length
        ? `❌ ¿Préstamo para quién? Indica la persona: <code>15$ hotel #Prestamo ${others[0].short || others[0].name}</code>`
        : '❌ No hay otro miembro configurado para el préstamo.');
      return;
    }
  }
  const tx = await createTransaction({
    payer_id: me.id, type: parsed.type,
    original_amount: parsed.amount.toString(), original_currency: parsed.currency,
    beneficiary_id, description: parsed.description || null, created_via: source,
  });
  const usdtLine = tx.amount_usdt ? `\n❄️ <b>Congelado:</b> ${Number(tx.amount_usdt).toFixed(2)} USDT` : '';
  const benef = beneficiary_id ? users.find(u => u.id === beneficiary_id)?.name : null;
  let catLine = '';
  if (tx.category_id) {
    const c = (await query('SELECT name, icon FROM categories WHERE id=$1', [tx.category_id])).rows[0];
    if (c) catLine = `\n🏷️ <b>${c.icon || ''} ${c.name}</b>${tx._category_auto ? ' <i>(IA)</i>' : ''}`;
  }
  const typeIcon = { NOS: '👫', MIO: '🧑', PRESTAMO: '🤝' }[parsed.type];
  const ownerLine = parsed.type === 'MIO'
    ? (benef ? `Personal de: <b>${benef}</b>\n` : '')
    : (benef ? `Para: <b>${benef}</b>\n` : '');
  await sendMessage(chatId,
    `${typeIcon} <b>Registrado #${parsed.type}</b>\n` +
    `${parsed.currency} <b>${parsed.amount.toFixed(2)}</b> · ~$${Number(tx.amount_usd).toFixed(2)} USD${usdtLine}${catLine}\n` +
    ownerLine +
    (await walletLine(tx)) +
    (parsed.description ? `<i>${parsed.description}</i>` : ''));
  notifyPartner(tx).catch(() => {});
}

// ---------------------------------------------------------------------------
// Receipts with several products: the bill is turned into a draft and each line
// gets assigned to whoever it belongs to (shared, or one member) before saving.
// ---------------------------------------------------------------------------
const ASSIGN_SHARED = 'NOS';

function normalizeItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map(it => ({
      name: String(it?.name || '').trim().slice(0, 60),
      amount: Number(it?.amount_bs ?? it?.amount),
    }))
    .filter(it => it.name && isFinite(it.amount) && it.amount > 0)
    .slice(0, 20); // Telegram keyboards get unusable beyond this
}

function draftKeyboard(draftId, payload, members) {
  const label = (assign) => {
    if (assign === ASSIGN_SHARED) return '👫 Nos';
    const m = members.find(u => u.id === assign);
    return m ? `🧑 ${m.short || m.name}` : '👫 Nos';
  };
  const n = (v) => Number(v).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const rows = payload.items.map((it, i) => ([{
    text: `${it.name} · ${n(it.amount)} → ${label(it.assign)}`,
    callback_data: `di:${draftId}:${i}`,
  }]));
  rows.push([
    { text: '✅ Guardar', callback_data: `dok:${draftId}` },
    { text: '❌ Cancelar', callback_data: `dno:${draftId}` },
  ]);
  return { inline_keyboard: rows };
}

function draftText(payload, members) {
  const n = (v) => Number(v).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const total = payload.items.reduce((a, it) => a + Number(it.amount), 0);
  const perPerson = {};
  for (const it of payload.items) {
    const key = it.assign === ASSIGN_SHARED ? '👫 Compartido' : (members.find(u => u.id === it.assign)?.name || '?');
    perPerson[key] = (perPerson[key] || 0) + Number(it.amount);
  }
  const resume = Object.entries(perPerson).map(([k, v]) => `· ${k}: <b>${n(v)} Bs</b>`).join('\n');
  return `🧾 <b>Factura detectada</b>${payload.bank ? ` · ${payload.bank}` : ''}\n` +
    `Total: <b>${n(total)} Bs</b> · ${payload.items.length} producto(s)\n\n` +
    `Toca cada producto para cambiar de quién es:\n${resume}\n\n` +
    `<i>Cuando esté listo, pulsa Guardar.</i>`;
}

async function startReceiptDraft(me, chatId, items, meta) {
  const members = (await query('SELECT id, name, short FROM app_users WHERE is_active ORDER BY created_at')).rows;
  const payload = {
    bank: meta.bank || null,
    reference: meta.reference || null,
    currency: 'BS',
    items: items.map(it => ({ ...it, assign: me.id })), // default: whoever sent the photo
  };
  const d = await query(
    'INSERT INTO tg_drafts(chat_id, user_id, payload) VALUES($1,$2,$3) RETURNING id',
    [chatId, me.id, JSON.stringify(payload)]
  );
  const draftId = d.rows[0].id;
  const sent = await sendMessage(chatId, draftText(payload, members), { reply_markup: draftKeyboard(draftId, payload, members) });
  if (sent?.message_id) await query('UPDATE tg_drafts SET message_id=$1 WHERE id=$2', [sent.message_id, draftId]);
}

async function handleDraftCallback(cq, data) {
  const [action, draftId, idxRaw] = data.split(':');
  const chatId = cq.message?.chat?.id;
  const d = (await query("SELECT * FROM tg_drafts WHERE id=$1 AND status='OPEN'", [draftId])).rows[0];
  if (!d) { await answerCallback(cq.id, 'Esta factura ya no está disponible'); return; }
  const members = (await query('SELECT id, name, short FROM app_users WHERE is_active ORDER BY created_at')).rows;
  const payload = typeof d.payload === 'string' ? JSON.parse(d.payload) : d.payload;

  if (action === 'dno') {
    await query("UPDATE tg_drafts SET status='CANCELLED' WHERE id=$1", [draftId]);
    await answerCallback(cq.id, 'Cancelado');
    await editMessage(chatId, d.message_id, '❌ <b>Factura descartada</b>').catch(() => {});
    return;
  }

  if (action === 'di') {
    // Cycle: shared → member 1 → member 2 → ... → shared
    const idx = parseInt(idxRaw, 10);
    const item = payload.items[idx];
    if (!item) { await answerCallback(cq.id, 'Producto no encontrado'); return; }
    const cycle = [ASSIGN_SHARED, ...members.map(m => m.id)];
    const pos = cycle.indexOf(item.assign);
    item.assign = cycle[(pos + 1) % cycle.length];
    await query('UPDATE tg_drafts SET payload=$1 WHERE id=$2', [JSON.stringify(payload), draftId]);
    await answerCallback(cq.id, '');
    await editMessage(chatId, d.message_id, draftText(payload, members), {
      reply_markup: draftKeyboard(draftId, payload, members),
    }).catch(() => {});
    return;
  }

  if (action === 'dok') {
    const me = (await query('SELECT id, name FROM app_users WHERE id=$1', [d.user_id])).rows[0];
    if (!me) { await answerCallback(cq.id, 'Usuario no encontrado'); return; }
    const created = [];
    for (const it of payload.items) {
      const shared = it.assign === ASSIGN_SHARED;
      const tx = await createTransaction({
        payer_id: me.id,
        type: shared ? 'NOS' : 'MIO',
        beneficiary_id: shared || it.assign === me.id ? null : it.assign,
        original_amount: String(it.amount),
        original_currency: payload.currency || 'BS',
        description: [it.name, payload.bank].filter(Boolean).join(' · '),
        created_via: 'OCR',
      });
      created.push(tx);
    }
    await query("UPDATE tg_drafts SET status='SAVED' WHERE id=$1", [draftId]);
    await answerCallback(cq.id, `Guardado: ${created.length} gasto(s)`);
    const totalUsd = created.reduce((a, t) => a + Number(t.amount_usd), 0);
    const last = created[created.length - 1];
    await editMessage(chatId, d.message_id,
      `✅ <b>Factura registrada</b>\n${created.length} gasto(s) · ~$${totalUsd.toFixed(2)} USD\n` +
      (await walletLine(last))
    ).catch(() => {});
    for (const tx of created) notifyPartner(tx).catch(() => {});
    return;
  }
}

// "💳 Venezuela: 372.534,64 Bs" — shown after a bot expense so the balance is visible.
async function walletLine(tx) {
  if (!tx?.wallet_id || tx.wallet_amount === null || tx.wallet_amount === undefined) return '';
  const w = (await query('SELECT name, currency, current_balance FROM wallets WHERE id=$1', [tx.wallet_id])).rows[0];
  if (!w) return '';
  const sym = { USD: '$', BS: 'Bs', EUR: '€', USDT: '₮' }[w.currency] || w.currency;
  const n = (v) => Number(v).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `💳 <b>${w.name}:</b> −${n(tx.wallet_amount)} → queda ${n(w.current_balance)} ${sym}\n`;
}

// Which wallet should this expense come out of?
// Explicit choice wins; otherwise the payer's default wallet, and failing that
// their only wallet in the expense currency. Returns null when undecidable.
async function resolveWalletId(client, { wallet_id, payer_id, currency }) {
  if (wallet_id) return wallet_id;
  if (!payer_id) return null;
  const u = (await client.query('SELECT default_wallet_id FROM app_users WHERE id=$1', [payer_id])).rows[0];
  if (u?.default_wallet_id) return u.default_wallet_id;
  const same = await client.query(
    'SELECT id FROM wallets WHERE user_id=$1 AND currency=$2',
    [payer_id, currency]
  );
  if (same.rowCount === 1) return same.rows[0].id;
  return null;
}

// How much leaves the wallet, expressed in the WALLET's own currency.
function walletDeduction({ wallet, originalAmount, originalCurrency, amountUsd, rates }) {
  if (!wallet) return null;
  if (wallet.currency === originalCurrency) return D(originalAmount).toDecimalPlaces(2);
  return convertUsdTo(amountUsd, wallet.currency, rates);
}

// Shared helper: create transaction (used by web and telegram)
async function createTransaction(b) {
  const rates = await getLatestRates();
  const originalAmount = D(b.original_amount);
  const currency = b.original_currency;
  let appliedRate;
  if (b.applied_rate !== undefined && b.applied_rate !== null && b.applied_rate !== '') appliedRate = D(b.applied_rate);
  else if (currency === 'USD') appliedRate = D(1);
  else if (currency === 'BS') appliedRate = D(rates.bcv_usd?.rate || 1);
  else if (currency === 'EUR') {
    const bu = D(rates.bcv_usd?.rate || 1); const be = D(rates.bcv_eur?.rate || 1);
    appliedRate = be.isZero() ? D(1) : bu.div(be);
  } else if (currency === 'USDT') appliedRate = D(1);
  else appliedRate = D(1);
  let amountUsd = (currency === 'USD' || currency === 'USDT') ? originalAmount : (appliedRate.isZero() ? originalAmount : originalAmount.div(appliedRate));
  amountUsd = amountUsd.toDecimalPlaces(2);
  let amountUsdt = null, usdtRate = null;
  if (b.type === 'PRESTAMO') {
    const bcvUsd = D(rates.bcv_usd?.rate || 0);
    const binUsdt = D(rates.binance_usdt?.rate || 0);
    usdtRate = binUsdt.toNumber() || null;
    let ves;
    if (currency === 'BS') ves = originalAmount;
    else if (currency === 'USD') ves = originalAmount.mul(bcvUsd);
    else if (currency === 'EUR') ves = originalAmount.mul(D(rates.bcv_eur?.rate || 0));
    else if (currency === 'USDT') amountUsdt = originalAmount.toDecimalPlaces(2);
    if (amountUsdt === null) amountUsdt = (binUsdt.gt(0) && ves) ? ves.div(binUsdt).toDecimalPlaces(2) : amountUsd;
  }
  // AI auto-categorization: when no category is chosen but we have a description
  let categoryId = b.category_id || null;
  let categoryAuto = false;
  if (!categoryId && b.description && b.auto_categorize !== false) {
    try {
      const cats = (await query('SELECT id, name FROM categories')).rows;
      const suggested = await suggestCategory(b.description, cats.map(c => c.name));
      if (suggested) {
        const match = cats.find(c => c.name.toLowerCase() === suggested.toLowerCase());
        if (match) { categoryId = match.id; categoryAuto = true; }
      }
    } catch (e) { console.error('auto-categorize', e.message); }
  }
  // Insert + wallet discount + participant shares must land together or not at all.
  const created = await withTx(async (client) => {
    const walletId = await resolveWalletId(client, { wallet_id: b.wallet_id, payer_id: b.payer_id, currency });
    let wallet = null;
    if (walletId) {
      const w = await client.query('SELECT id, currency, current_balance FROM wallets WHERE id=$1 FOR UPDATE', [walletId]);
      wallet = w.rows[0] || null;
    }
    const deduction = walletDeduction({
      wallet, originalAmount, originalCurrency: currency, amountUsd, rates,
    });

    const r = await client.query(
      `INSERT INTO transactions(payer_id, wallet_id, type, original_amount, original_currency, applied_rate, amount_usd, amount_usdt, usdt_rate, beneficiary_id, category_id, description, receipt_image_url, created_via, transaction_date, wallet_amount)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, COALESCE($15::timestamptz, NOW()), $16) RETURNING *`,
      [b.payer_id, wallet ? wallet.id : null, b.type, originalAmount.toFixed(2), currency, appliedRate.toFixed(6), amountUsd.toFixed(2),
       amountUsdt ? amountUsdt.toString() : null, usdtRate, b.beneficiary_id || null, categoryId, b.description || null,
       b.receipt_image_url || null, b.created_via || 'WEB', b.transaction_date || null,
       deduction ? deduction.toFixed(2) : null]
    );
    const tx = r.rows[0];

    if (wallet && deduction) {
      const upd = await client.query(
        'UPDATE wallets SET current_balance = current_balance - $1 WHERE id=$2 RETURNING current_balance',
        [deduction.toFixed(2), wallet.id]
      );
      tx._wallet_balance = upd.rows[0]?.current_balance ?? null;
    }

    await writeSplits(client, tx, b.participant_ids);
    return tx;
  });

  created._category_auto = categoryAuto;
  return created;
}

// Persist who owes what for a transaction (see lib/splits.js for the rules).
async function writeSplits(client, tx, participantIds) {
  const activeUserIds = (await client.query('SELECT id FROM app_users WHERE is_active ORDER BY created_at')).rows.map(r => r.id);
  const splits = computeSplits({
    type: tx.type,
    payer_id: tx.payer_id,
    beneficiary_id: tx.beneficiary_id,
    amount_usd: tx.amount_usd,
    amount_usdt: tx.amount_usdt,
    activeUserIds,
    participantIds,
  });
  await client.query('DELETE FROM transaction_splits WHERE transaction_id=$1', [tx.id]);
  for (const s of splits) {
    await client.query(
      'INSERT INTO transaction_splits(transaction_id, user_id, share_usd, share_usdt) VALUES($1,$2,$3,$4)',
      [tx.id, s.user_id, s.share_usd, s.share_usdt]
    );
  }
  return splits;
}

async function notifyPartner(tx) {
  // Notify beneficiary (for PRESTAMO) or partner (for NOS) via Telegram
  try {
    const users = (await query('SELECT id, name, telegram_chat_id FROM app_users')).rows;
    const payer = users.find(u => u.id === tx.payer_id);
    let targets = [];
    if (tx.type === 'PRESTAMO' && tx.beneficiary_id) {
      const b = users.find(u => u.id === tx.beneficiary_id);
      if (b?.telegram_chat_id) targets.push(b);
    } else if (tx.type === 'NOS') {
      targets = users.filter(u => u.id !== tx.payer_id && u.telegram_chat_id);
    }
    for (const t of targets) {
      const emoji = tx.type === 'PRESTAMO' ? '❄️' : '👫';
      const extra = tx.amount_usdt ? `\n<b>USDT congelado:</b> ${Number(tx.amount_usdt).toFixed(2)} ₮` : '';
      const desc = tx.description ? `\n<i>${tx.description}</i>` : '';
      await sendMessage(t.telegram_chat_id,
        `${emoji} <b>${payer?.name || 'Alguien'}</b> registró un ${tx.type === 'PRESTAMO' ? 'préstamo para ti' : 'gasto compartido'}\n` +
        `<b>${tx.original_currency} ${Number(tx.original_amount).toFixed(2)}</b> · ~$${Number(tx.amount_usd).toFixed(2)}${extra}${desc}`);
    }
  } catch (e) { console.error('notifyPartner', e.message); }
}

const json = (data, status = 200) => NextResponse.json(data, { status });
const err = (msg, status = 400) => json({ error: msg }, status);

function getPath(req, params) {
  const segs = (params?.path || []);
  return '/' + segs.join('/');
}

async function ensureInit() {
  await initDb();
}

const SESSION_COOKIE = 'sid';
const SESSION_DAYS = 30;

async function getSession(req) {
  const token = req.cookies?.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const r = await query('SELECT token, expires_at FROM auth_sessions WHERE token=$1', [token]);
  if (!r.rowCount) return null;
  if (new Date(r.rows[0].expires_at) < new Date()) {
    await query('DELETE FROM auth_sessions WHERE token=$1', [token]);
    return null;
  }
  return r.rows[0];
}

function setSessionCookie(res, token) {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * SESSION_DAYS,
  });
  return res;
}

async function pinIsSet() {
  const r = await query("SELECT value FROM app_settings WHERE key='access_pin_hash'");
  return r.rowCount > 0 && !!r.rows[0].value;
}

// ---------- ROUTE DISPATCH ----------
async function dispatch(req, params) {
  const method = req.method;
  const path = getPath(req, params);
  const url = new URL(req.url);

  await ensureInit();

  // -------- AUTH ENDPOINTS (public) --------
  if (path === '/auth/status' && method === 'GET') {
    const pin_set = await pinIsSet();
    const sess = await getSession(req);
    return json({ pin_set, authenticated: !!sess });
  }
  if (path === '/auth/setup' && method === 'POST') {
    if (await pinIsSet()) return err('El PIN ya fue configurado. Usa iniciar sesión.', 409);
    const b = await req.json().catch(() => ({}));
    const pin = (b.pin || '').toString().trim();
    if (pin.length < 4) return err('El PIN debe tener al menos 4 caracteres', 422);
    await query("INSERT INTO app_settings(key,value) VALUES('access_pin_hash',$1) ON CONFLICT(key) DO UPDATE SET value=$1", [hashPin(pin)]);
    const token = newToken();
    await query("INSERT INTO auth_sessions(token, expires_at) VALUES($1, NOW() + interval '30 days')", [token]);
    return setSessionCookie(json({ ok: true, authenticated: true }, 201), token);
  }
  if (path === '/auth/login' && method === 'POST') {
    const b = await req.json().catch(() => ({}));
    const pin = (b.pin || '').toString().trim();
    const r = await query("SELECT value FROM app_settings WHERE key='access_pin_hash'");
    if (!r.rowCount || !r.rows[0].value) return err('No hay PIN configurado', 400);
    if (!verifyPin(pin, r.rows[0].value)) return err('PIN incorrecto', 401);
    const token = newToken();
    await query("INSERT INTO auth_sessions(token, expires_at) VALUES($1, NOW() + interval '30 days')", [token]);
    return setSessionCookie(json({ ok: true, authenticated: true }), token);
  }
  if (path === '/auth/logout' && method === 'POST') {
    const token = req.cookies?.get(SESSION_COOKIE)?.value;
    if (token) await query('DELETE FROM auth_sessions WHERE token=$1', [token]);
    const res = json({ ok: true });
    res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
    return res;
  }

  // -------- AUTH GATE (everything except public routes) --------
  const isPublic = path === '/health' || path === '/webhooks/telegram' || path.startsWith('/auth/');
  if (!isPublic) {
    const sess = await getSession(req);
    if (!sess) return err('No autorizado', 401);
  }

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
    if (!b.name || !b.name.toString().trim()) return err('Nombre requerido', 422);
    const name = b.name.toString().trim().slice(0, 50);
    const r = await query(
      'INSERT INTO app_users(name,short,color) VALUES($1,$2,$3) RETURNING *',
      [name, (b.short || name[0]).toUpperCase().slice(0, 3), b.color || '#6366f1']
    );
    return json(r.rows[0], 201);
  }
  if (path.startsWith('/users/') && method === 'PATCH') {
    const id = path.split('/')[2];
    const b = await req.json().catch(() => ({}));
    const sets = [], vals = [];
    if (b.name !== undefined) {
      if (!b.name.toString().trim()) return err('Nombre requerido', 422);
      vals.push(b.name.toString().trim().slice(0, 50)); sets.push(`name=$${vals.length}`);
    }
    if (b.short !== undefined) { vals.push(b.short.toString().toUpperCase().slice(0, 3)); sets.push(`short=$${vals.length}`); }
    if (b.color !== undefined) { vals.push(b.color); sets.push(`color=$${vals.length}`); }
    if (b.email !== undefined) { vals.push(b.email ? b.email.toString().trim().toLowerCase() : null); sets.push(`email=$${vals.length}`); }
    if (b.default_wallet_id !== undefined) { vals.push(b.default_wallet_id || null); sets.push(`default_wallet_id=$${vals.length}`); }
    if (b.is_active !== undefined) {
      if (!b.is_active) {
        const actives = (await query('SELECT COUNT(*)::int AS n FROM app_users WHERE is_active AND id <> $1', [id])).rows[0].n;
        if (actives < 1) return err('Debe quedar al menos un miembro activo', 422);
      }
      vals.push(!!b.is_active); sets.push(`is_active=$${vals.length}`);
    }
    if (!sets.length) return err('Nada que actualizar', 422);
    vals.push(id);
    const r = await query(`UPDATE app_users SET ${sets.join(', ')} WHERE id=$${vals.length} RETURNING *`, vals);
    if (!r.rowCount) return err('Miembro no encontrado', 404);
    return json(r.rows[0]);
  }

  // Removing a member: hard delete only while they have no financial history,
  // otherwise deactivate so past expenses and balances stay intact.
  if (path.startsWith('/users/') && method === 'DELETE') {
    const id = path.split('/')[2];
    const actives = (await query('SELECT COUNT(*)::int AS n FROM app_users WHERE is_active AND id <> $1', [id])).rows[0].n;
    if (actives < 1) return err('Debe quedar al menos un miembro activo', 422);
    const usage = (await query(`
      SELECT
        (SELECT COUNT(*) FROM transactions WHERE payer_id=$1 OR beneficiary_id=$1)::int AS tx,
        (SELECT COUNT(*) FROM transaction_splits WHERE user_id=$1)::int AS splits,
        (SELECT COUNT(*) FROM settlements WHERE payer_id=$1 OR receiver_id=$1)::int AS setts,
        (SELECT COUNT(*) FROM wallets WHERE user_id=$1)::int AS wallets
    `, [id])).rows[0];
    const hasHistory = usage.tx + usage.splits + usage.setts + usage.wallets > 0;
    if (hasHistory) {
      const r = await query('UPDATE app_users SET is_active=FALSE WHERE id=$1 RETURNING *', [id]);
      if (!r.rowCount) return err('Miembro no encontrado', 404);
      return json({ ok: true, deactivated: true, user: r.rows[0], reason: 'Tiene historial financiero; se desactivó en lugar de borrarse.' });
    }
    await query('DELETE FROM app_users WHERE id=$1', [id]);
    return json({ ok: true, deleted: true });
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
    if (!b.user_id) return err('Dueño requerido', 422);
    if (!b.name || !b.name.toString().trim()) return err('Nombre requerido', 422);
    const bal = Number(b.current_balance || 0);
    if (!isFinite(bal) || Math.abs(bal) > 1e12) return err('Saldo inválido', 422);
    if (!['USD', 'BS', 'EUR', 'USDT'].includes(b.currency || 'USD')) return err('Moneda inválida', 422);
    const r = await query(
      'INSERT INTO wallets(user_id,name,account_type,currency,current_balance,initial_balance) VALUES($1,$2,$3,$4,$5,$5) RETURNING *',
      [b.user_id, b.name.toString().trim().slice(0, 80), b.account_type || 'BANK', b.currency || 'USD', bal.toFixed(2)]
    );
    return json(r.rows[0], 201);
  }

  // Adjust a wallet balance by hand (deposit / correction). Keeps initial_balance
  // in sync so the recalculation below stays consistent.
  if (path.match(/^\/wallets\/[^/]+\/adjust$/) && method === 'POST') {
    const id = path.split('/')[2];
    const b = await req.json().catch(() => ({}));
    const delta = Number(b.delta);
    if (!isFinite(delta) || delta === 0 || Math.abs(delta) > 1e12) return err('Ajuste inválido', 422);
    const r = await query(
      `UPDATE wallets SET current_balance = current_balance + $1, initial_balance = COALESCE(initial_balance,0) + $1
       WHERE id=$2 RETURNING *`, [delta.toFixed(2), id]
    );
    if (!r.rowCount) return err('Billetera no encontrada', 404);
    return json(r.rows[0]);
  }

  // Rebuild every wallet balance from initial_balance minus the expenses charged
  // to it. Also links past expenses that never got a wallet (Telegram/OCR ones)
  // when the payer has exactly one wallet in that currency.
  if (path === '/wallets/recalculate' && method === 'POST') {
    const b = await req.json().catch(() => ({}));
    const autoLink = b.link !== false;
    const dryRun = b.dry_run === true;
    const rates = await getLatestRates();
    const result = await withTx(async (client) => {
      const before = (await client.query('SELECT id, name, currency, current_balance, initial_balance FROM wallets ORDER BY name')).rows;
      const walletById = new Map(before.map(w => [w.id, w]));

      // 1. Adopt orphan expenses whose payer has exactly one wallet in that currency.
      const linked = [];
      if (autoLink) {
        const orphans = (await client.query(
          `SELECT id, payer_id, original_currency, original_amount, amount_usd, description
           FROM transactions WHERE wallet_id IS NULL`
        )).rows;
        for (const t of orphans) {
          const w = await client.query(
            'SELECT id FROM wallets WHERE user_id=$1 AND currency=$2',
            [t.payer_id, t.original_currency]
          );
          if (w.rowCount !== 1) continue;
          linked.push({ transaction_id: t.id, wallet_id: w.rows[0].id, description: t.description, amount: t.original_amount, currency: t.original_currency });
          if (!dryRun) await client.query('UPDATE transactions SET wallet_id=$1 WHERE id=$2', [w.rows[0].id, t.id]);
        }
      }
      const linkedById = new Map(linked.map(l => [l.transaction_id, l.wallet_id]));

      // 2. Price every charged expense in its wallet's currency.
      const all = (await client.query(`
        SELECT id, wallet_id, original_amount, original_currency, amount_usd FROM transactions
      `)).rows;
      const spentByWallet = new Map();
      let priced = 0, unpriced = 0;
      for (const t of all) {
        const walletId = t.wallet_id || linkedById.get(t.id) || null;
        if (!walletId) continue;
        const wallet = walletById.get(walletId);
        if (!wallet) continue;
        const amt = walletDeduction({
          wallet, originalAmount: t.original_amount, originalCurrency: t.original_currency,
          amountUsd: t.amount_usd, rates,
        });
        if (!amt) { unpriced++; continue; }
        priced++;
        spentByWallet.set(walletId, D(spentByWallet.get(walletId) || 0).plus(amt));
        if (!dryRun) await client.query('UPDATE transactions SET wallet_amount=$1 WHERE id=$2', [amt.toFixed(2), t.id]);
      }

      // 3. Rebuild balances: initial - everything spent from it.
      const wallets = before.map(w => {
        const spent = D(spentByWallet.get(w.id) || 0);
        const projected = D(w.initial_balance ?? w.current_balance).minus(spent);
        return {
          id: w.id, name: w.name, currency: w.currency,
          initial_balance: w.initial_balance,
          previous_balance: w.current_balance,
          spent: spent.toFixed(2),
          current_balance: projected.toFixed(2),
        };
      });
      if (!dryRun) {
        for (const w of wallets) {
          await client.query('UPDATE wallets SET current_balance=$1 WHERE id=$2', [w.current_balance, w.id]);
        }
      }
      return { dry_run: dryRun, linked_transactions: linked.length, linked, priced_transactions: priced, unpriced_transactions: unpriced, wallets };
    });
    return json({ ok: true, ...result });
  }

  if (path.startsWith('/wallets/') && method === 'PATCH') {
    const id = path.split('/')[2];
    const b = await req.json().catch(() => ({}));
    const sets = [], vals = [];
    if (b.name !== undefined) { vals.push(b.name.toString().trim().slice(0, 80)); sets.push(`name=$${vals.length}`); }
    if (b.account_type !== undefined) { vals.push(b.account_type); sets.push(`account_type=$${vals.length}`); }
    if (!sets.length) return err('Nada que actualizar', 422);
    vals.push(id);
    const r = await query(`UPDATE wallets SET ${sets.join(', ')} WHERE id=$${vals.length} RETURNING *`, vals);
    if (!r.rowCount) return err('Billetera no encontrada', 404);
    return json(r.rows[0]);
  }

  if (path.startsWith('/wallets/') && method === 'DELETE') {
    const id = path.split('/')[2];
    // Keep the expense history: unlink it instead of cascading the delete.
    await withTx(async (client) => {
      await client.query('UPDATE transactions SET wallet_id=NULL, wallet_amount=NULL WHERE wallet_id=$1', [id]);
      await client.query('UPDATE app_users SET default_wallet_id=NULL WHERE default_wallet_id=$1', [id]);
      await client.query('DELETE FROM wallets WHERE id=$1', [id]);
    });
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
    if (!b.payer_id || !b.type || b.original_amount === undefined || !b.original_currency) return err('Faltan campos', 422);
    const amt = Number(b.original_amount);
    if (!isFinite(amt) || amt <= 0 || amt > 1e12) return err('Monto inválido', 422);
    if (!['NOS', 'MIO', 'PRESTAMO'].includes(b.type)) return err('Tipo inválido', 422);
    if (!['USD', 'BS', 'EUR', 'USDT'].includes(b.original_currency)) return err('Moneda inválida', 422);
    if (b.type === 'PRESTAMO' && !b.beneficiary_id) return err('Préstamo requiere beneficiario', 422);
    const tx = await createTransaction(b);
    notifyPartner(tx).catch(() => {});
    return json(tx, 201);
  }

  // Who this expense was divided among.
  if (path.match(/^\/transactions\/[^/]+\/splits$/) && method === 'GET') {
    const id = path.split('/')[2];
    const r = await query(`
      SELECT s.*, u.name AS user_name, u.short AS user_short, u.color AS user_color
      FROM transaction_splits s JOIN app_users u ON u.id = s.user_id
      WHERE s.transaction_id = $1 ORDER BY u.created_at`, [id]);
    return json(r.rows);
  }

  if (path.startsWith('/transactions/') && method === 'DELETE') {
    const id = path.split('/')[2];
    // Deleting an expense gives the money back to the wallet it came from.
    await withTx(async (client) => {
      const t = (await client.query('SELECT wallet_id, wallet_amount FROM transactions WHERE id=$1', [id])).rows[0];
      if (t?.wallet_id && t.wallet_amount) {
        await client.query('UPDATE wallets SET current_balance = current_balance + $1 WHERE id=$2', [t.wallet_amount, t.wallet_id]);
      }
      await client.query('DELETE FROM transactions WHERE id=$1', [id]); // splits cascade
    });
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
    if (!b.payer_id || !b.receiver_id) return err('Faltan participantes', 422);
    const amtNum = Number(b.amount_usd);
    if (!isFinite(amtNum) || amtNum <= 0 || amtNum > 1e12) return err('Monto inválido', 422);
    const rates = await getLatestRates();
    const binUsdt = D(rates.binance_usdt?.rate || 0);
    const bcvUsd = D(rates.bcv_usd?.rate || 0);
    const amtUsd = D(b.amount_usd);
    let amtUsdt = null;
    if (binUsdt.gt(0) && bcvUsd.gt(0)) amtUsdt = amtUsd.mul(bcvUsd).div(binUsdt).toDecimalPlaces(2).toString();
    if (b.payer_id === b.receiver_id) return err('El pagador y el receptor no pueden ser la misma persona', 422);
    const parties = (await query('SELECT id FROM app_users WHERE id IN ($1,$2)', [b.payer_id, b.receiver_id])).rowCount;
    if (parties !== 2) return err('Participantes inválidos', 422);

    // Under the ledger model a settlement is just a payment between two members:
    // it offsets their balances directly, so transactions stay untouched (with 3+
    // members, flipping is_reconciled would wrongly clear everyone else's share).
    const r = await query(
      `INSERT INTO settlements(payer_id, receiver_id, amount_usd, amount_usdt, notes, pre_ledger)
       VALUES($1,$2,$3,$4,$5,FALSE) RETURNING *`,
      [b.payer_id, b.receiver_id, amtUsd.toFixed(2), amtUsdt, b.notes || null]
    );
    // Notify partner
    notifyPartner({
      payer_id: b.payer_id, type: 'SETTLEMENT', beneficiary_id: b.receiver_id,
      original_amount: amtUsd.toFixed(2), original_currency: 'USD', amount_usd: amtUsd.toFixed(2),
      amount_usdt: amtUsdt, description: b.notes || 'Liquidación de deuda',
    }).catch(() => {});
    return json(r.rows[0], 201);
  }
  if (path === '/settlements' && method === 'GET') {
    const r = await query(`
      SELECT s.*, p.name AS payer_name, r.name AS receiver_name
      FROM settlements s JOIN app_users p ON p.id=s.payer_id JOIN app_users r ON r.id=s.receiver_id
      ORDER BY s.settlement_date DESC LIMIT 100`);
    return json(r.rows);
  }

  // -------- TELEGRAM WEBHOOK & SETUP --------
  if (path === '/telegram/status' && method === 'GET') {
    try { const info = await getWebhookInfo(); return json({ ok: true, info }); }
    catch (e) { return json({ ok: false, error: e.message }); }
  }
  if (path === '/telegram/setup' && method === 'POST') {
    const base = process.env.NEXT_PUBLIC_BASE_URL;
    if (!base) return err('NEXT_PUBLIC_BASE_URL missing', 500);
    const webhookUrl = `${base.replace(/\/$/, '')}/api/webhooks/telegram`;
    const info = await setWebhook(webhookUrl, process.env.TELEGRAM_WEBHOOK_SECRET);
    return json({ ok: true, webhook: webhookUrl, result: info });
  }
  if (path === '/telegram/unbind' && method === 'POST') {
    const b = await req.json();
    await query('UPDATE app_users SET telegram_chat_id=NULL WHERE id=$1', [b.user_id]);
    return json({ ok: true });
  }

  if (path === '/webhooks/telegram' && method === 'POST') {
    const secret = req.headers.get('x-telegram-bot-api-secret-token');
    if (!safeEqual(secret, process.env.TELEGRAM_WEBHOOK_SECRET)) return json({ ok: true }); // silently ignore
    const upd = await req.json().catch(() => ({}));

    // Callback query for user binding
    if (upd.callback_query) {
      const cq = upd.callback_query;
      const data = cq.data || '';
      if (data.startsWith('di:') || data.startsWith('dok:') || data.startsWith('dno:')) {
        try { await handleDraftCallback(cq, data); }
        catch (e) { console.error('draft callback', e.message); await answerCallback(cq.id, 'Error al procesar'); }
        return json({ ok: true });
      }
      if (data.startsWith('bind:')) {
        const userId = data.slice(5);
        const chatId = cq.message?.chat?.id;
        try {
          const u = await query('SELECT id, name FROM app_users WHERE id=$1', [userId]);
          if (u.rowCount) {
            await query('UPDATE app_users SET telegram_chat_id=$1 WHERE id=$2', [chatId, userId]);
            await answerCallback(cq.id, `Vinculado como ${u.rows[0].name}`);
            await sendMessage(chatId,
              `✅ <b>¡Listo, ${u.rows[0].name}!</b> Ahora puedes registrar gastos así:\n\n` +
              `📝 <b>Texto:</b> <code>30$ cena #Nos J</code>\n` +
              `🎤 <b>Voz:</b> nota de voz "Gasté quinientos bolívares en café"\n` +
              `📷 <b>Foto:</b> captura de Pago Móvil / POS\n\n` +
              `Etiquetas: <code>#Nos</code> compartido · <code>#Mio</code> personal · <code>#Prestamo J</code> préstamo a J`);
          }
        } catch (e) { console.error(e); }
      }
      return json({ ok: true });
    }

    const msg = upd.message;
    if (!msg) return json({ ok: true });
    const chatId = msg.chat.id;
    const text = (msg.text || msg.caption || '').trim();

    // /start command
    if (text.startsWith('/start') || text === '/vincular') {
      const users = (await query('SELECT id, name, color FROM app_users ORDER BY created_at')).rows;
      const buttons = users.map(u => [{ text: `👤 ${u.name}`, callback_data: `bind:${u.id}` }]);
      await sendMessage(chatId,
        `👋 <b>Bienvenido a Finanzas Pareja</b>\n\n¿Quién eres? Toca tu nombre para vincular este chat:`,
        { reply_markup: { inline_keyboard: buttons } });
      return json({ ok: true });
    }

    // /help
    if (text.startsWith('/help') || text.startsWith('/ayuda')) {
      await sendMessage(chatId,
        `📖 <b>Comandos rápidos</b>\n\n` +
        `<code>30$ cena #Nos J</code> — 30 USD compartido con J\n` +
        `<code>5000 bs comida #Mio</code> — 5000 Bs personal\n` +
        `<code>15 usd hotel #Prestamo J</code> — 15 USD prestado a J (se congela en USDT)\n` +
        `<code>500 bs café</code> — sin hashtag = personal por defecto\n\n` +
        `🎤 Envía nota de voz en español para transcripción automática\n` +
        `📷 Envía captura de Pago Móvil para OCR automático`);
      return json({ ok: true });
    }

    // Look up bound user
    const bound = await query('SELECT id, name, telegram_chat_id FROM app_users WHERE telegram_chat_id=$1', [chatId]);
    if (bound.rowCount === 0) {
      await sendMessage(chatId, '⚠️ Este chat no está vinculado. Envía /start para vincularte.');
      return json({ ok: true });
    }
    const me = bound.rows[0];
    // Known members let the parser resolve "#Mio A" / "#Prestamo J" reliably.
    const activeUsers = (await query('SELECT id, name, short FROM app_users WHERE is_active ORDER BY created_at')).rows;

    // Handle voice / audio
    if (msg.voice || msg.audio) {
      const fileId = (msg.voice || msg.audio).file_id;
      const mime = (msg.voice || msg.audio).mime_type || 'audio/ogg';
      try {
        const { buffer } = await downloadFile(fileId);
        const transcript = await transcribeAudio(buffer, 'voice.ogg', mime);
        await sendMessage(chatId, `🎤 <i>Escuché:</i> "${transcript}"`);
        const parsed = parseExpenseText(transcript, activeUsers);
        if (!parsed) {
          await sendMessage(chatId, '❌ No pude interpretar un gasto. Intenta: "gasté 30 dólares en cena compartido"');
          return json({ ok: true });
        }
        await handleParsedExpense(me, parsed, chatId, 'WHATSAPP_BOT');
      } catch (e) { console.error('voice', e.message); await sendMessage(chatId, '❌ No pude procesar el audio. Intenta de nuevo o escríbelo.'); }
      return json({ ok: true });
    }

    // Handle photo (receipt OCR)
    if (msg.photo && msg.photo.length) {
      const largest = msg.photo[msg.photo.length - 1];
      try {
        const { buffer } = await downloadFile(largest.file_id);
        const data = await extractReceipt(buffer, 'image/jpeg');

        // A bill with several lines: ask who pays each product before saving.
        const items = normalizeItems(data?.items);
        if (items.length >= 2) {
          await sendMessage(chatId, `🧾 <b>OCR:</b> ${items.length} productos leídos${data.bank ? ' · ' + data.bank : ''}`);
          await startReceiptDraft(me, chatId, items, data);
          return json({ ok: true });
        }

        const amt = Number(data?.amount_bs);
        if (!amt || !isFinite(amt) || amt <= 0) {
          await sendMessage(chatId, `📷 No pude leer el monto claramente. Intenta con una foto más nítida o escribe el gasto.`);
          return json({ ok: true });
        }
        // Determine type from caption if any
        const captionParsed = parseExpenseText(text, activeUsers);
        const type = captionParsed?.type || 'MIO';
        const description = data.description || text || `Pago ${data.bank || ''} ${data.reference ? '#'+data.reference : ''}`.trim();
        const parsed = { amount: amt, currency: 'BS', description, type, beneficiaryHint: captionParsed?.beneficiaryHint };
        await sendMessage(chatId, `📷 <b>OCR:</b> ${amt.toFixed(2)} Bs · ${data.bank || 'Banco'}${data.reference ? ' · Ref '+data.reference : ''}`);
        await handleParsedExpense(me, parsed, chatId, 'OCR');
      } catch (e) { console.error('ocr', e.message); await sendMessage(chatId, '❌ No pude procesar la imagen. Intenta de nuevo.'); }
      return json({ ok: true });
    }

    // Handle text
    if (text) {
      const parsed = parseExpenseText(text, activeUsers);
      if (!parsed) {
        await sendMessage(chatId, '❌ No entendí. Prueba: <code>30$ cena #Nos J</code>\nEscribe /help para más ejemplos.');
        return json({ ok: true });
      }
      await handleParsedExpense(me, parsed, chatId, 'WHATSAPP_BOT');
    }
    return json({ ok: true });
  }

  if (path === '/dashboard' && method === 'GET') {
    const month = url.searchParams.get('month') || new Date().toISOString().slice(0, 7);
    const users = (await query('SELECT id, name, short, color, is_active, telegram_chat_id, email, default_wallet_id FROM app_users ORDER BY created_at')).rows;
    const rates = await getLatestRates();

    // ---- Ledger --------------------------------------------------------
    // Every member's net position = what they PAID minus what they OWE.
    // Owed comes from transaction_splits, so #Nos divides across N members and
    // #Mio lands on whoever the expense belongs to. Positive net = others owe them.
    const paid = {}, owed = {}, frozenGiven = {}, frozenOwed = {};
    const mioByUser = {}, nosShareByUser = {}, paidByUser = {};
    for (const u of users) {
      paid[u.id] = D(0); owed[u.id] = D(0); frozenGiven[u.id] = D(0); frozenOwed[u.id] = D(0);
      mioByUser[u.id] = D(0); nosShareByUser[u.id] = D(0); paidByUser[u.id] = D(0);
    }

    const openTx = (await query(`
      SELECT id, type, payer_id, amount_usd, amount_usdt
      FROM transactions WHERE is_reconciled = FALSE
    `)).rows;
    for (const t of openTx) {
      if (paid[t.payer_id]) {
        paid[t.payer_id] = paid[t.payer_id].plus(t.amount_usd);
        if (t.type === 'PRESTAMO' && t.amount_usdt) frozenGiven[t.payer_id] = frozenGiven[t.payer_id].plus(t.amount_usdt);
      }
    }
    const openSplits = (await query(`
      SELECT s.user_id, s.share_usd, s.share_usdt, t.type
      FROM transaction_splits s JOIN transactions t ON t.id = s.transaction_id
      WHERE t.is_reconciled = FALSE
    `)).rows;
    for (const s of openSplits) {
      if (!owed[s.user_id]) continue;
      owed[s.user_id] = owed[s.user_id].plus(s.share_usd);
      if (s.type === 'PRESTAMO' && s.share_usdt) frozenOwed[s.user_id] = frozenOwed[s.user_id].plus(s.share_usdt);
    }
    // Settlements recorded under the ledger model move money directly.
    const openSettlements = (await query('SELECT payer_id, receiver_id, amount_usd FROM settlements WHERE pre_ledger = FALSE')).rows;
    for (const s of openSettlements) {
      if (paid[s.payer_id]) paid[s.payer_id] = paid[s.payer_id].plus(s.amount_usd);
      if (owed[s.receiver_id]) owed[s.receiver_id] = owed[s.receiver_id].plus(s.amount_usd);
    }

    const netByUser = {};
    for (const u of users) netByUser[u.id] = paid[u.id].minus(owed[u.id]).toDecimalPlaces(2);

    // Who pays whom, minimised to at most N-1 transfers.
    const transfers = settleUp(netByUser).map(t => {
      const usdt = convertUsdTo(t.amount_usd, 'USDT', rates);
      return {
        from: users.find(u => u.id === t.from),
        to: users.find(u => u.id === t.to),
        amount_usd: t.amount_usd,
        amount_usdt: usdt ? usdt.toFixed(2) : null,
      };
    });

    // Legacy shape kept so the couple view keeps working unchanged.
    let net = null;
    if (users.filter(u => u.is_active).length <= 2 && users.length >= 2) {
      const t = transfers[0];
      const [A, B] = users;
      net = t
        ? { from: t.from, to: t.to, amount_usd: t.amount_usd, amount_usdt: t.amount_usdt || '0' }
        : { from: A, to: B, amount_usd: '0.00', amount_usdt: '0.00' };
    }

    // ---- Per-member breakdown for the selected month --------------------
    const monthSplits = (await query(`
      SELECT s.user_id, s.share_usd, t.type
      FROM transaction_splits s JOIN transactions t ON t.id = s.transaction_id
      WHERE t.transaction_date >= $1::date AND t.transaction_date < ($1::date + interval '1 month')
    `, [month + '-01'])).rows;
    for (const s of monthSplits) {
      if (!mioByUser[s.user_id]) continue;
      if (s.type === 'MIO') mioByUser[s.user_id] = mioByUser[s.user_id].plus(s.share_usd);
      if (s.type === 'NOS') nosShareByUser[s.user_id] = nosShareByUser[s.user_id].plus(s.share_usd);
    }
    const monthPaid = (await query(`
      SELECT payer_id, SUM(amount_usd)::numeric AS total FROM transactions
      WHERE transaction_date >= $1::date AND transaction_date < ($1::date + interval '1 month')
      GROUP BY payer_id
    `, [month + '-01'])).rows;
    for (const r of monthPaid) if (paidByUser[r.payer_id]) paidByUser[r.payer_id] = D(r.total);

    const perUser = users.map(u => ({
      user: u,
      mio_usd: mioByUser[u.id].toFixed(2),          // #Mio J / #Mio A — personal spend of this member
      nos_share_usd: nosShareByUser[u.id].toFixed(2), // their slice of the shared expenses
      total_usd: mioByUser[u.id].plus(nosShareByUser[u.id]).toFixed(2),
      paid_usd: paidByUser[u.id].toFixed(2),        // what actually left their pocket this month
      net_usd: netByUser[u.id].toFixed(2),          // + they are owed / - they owe (all time, open)
      frozen_usdt: frozenGiven[u.id].minus(frozenOwed[u.id]).toDecimalPlaces(2).toFixed(2),
    }));

    // Legacy `balances` map (kept for compatibility with older clients).
    const balances = {};
    for (const u of users) {
      const pu = perUser.find(p => p.user.id === u.id);
      balances[u.id] = {
        user: u, mio_usd: pu.mio_usd, nos_share_usd: pu.nos_share_usd,
        paid_usd: paid[u.id].toFixed(2), owed_usd: owed[u.id].toFixed(2), net_usd: pu.net_usd,
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

    return json({
      month,
      users,
      members: users.filter(u => u.is_active),
      balances,
      per_user: perUser,
      transfers,
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
  catch (e) { console.error(e); return err('Error interno del servidor', 500); }
}
export async function POST(req, ctx) {
  try { return await dispatch(req, await ctx.params); }
  catch (e) { console.error(e); return err('Error interno del servidor', 500); }
}
export async function PATCH(req, ctx) {
  try { return await dispatch(req, await ctx.params); }
  catch (e) { console.error(e); return err('Error interno del servidor', 500); }
}
export async function DELETE(req, ctx) {
  try { return await dispatch(req, await ctx.params); }
  catch (e) { console.error(e); return err('Error interno del servidor', 500); }
}
