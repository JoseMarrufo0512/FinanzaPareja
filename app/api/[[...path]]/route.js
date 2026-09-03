import { NextResponse } from 'next/server';
import Decimal from 'decimal.js';
import { initDb, query } from '@/lib/db';
import { refreshRates, getLatestRates } from '@/lib/rates';
import { D, fmt } from '@/lib/money';
import { parseExpenseText } from '@/lib/parser';
import { tg, sendMessage, answerCallback, downloadFile, setWebhook, getWebhookInfo } from '@/lib/telegram';
import { transcribeAudio, extractReceipt, suggestCategory } from '@/lib/ai';
import { startScheduler } from '@/lib/scheduler';

Decimal.set({ precision: 30, rounding: Decimal.ROUND_HALF_UP });

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Kick off scheduler once when this module loads
try { startScheduler(); } catch (e) { console.error('scheduler init', e.message); }

// Given a parsed expense and the sender's user record, create the transaction and confirm via Telegram.
async function handleParsedExpense(me, parsed, chatId, source = 'WHATSAPP_BOT') {
  const users = (await query('SELECT id, name, short FROM app_users')).rows;
  let beneficiary_id = null;
  if (parsed.type === 'PRESTAMO') {
    // Prefer explicit hint, else pick the other user in a 2-user setup
    if (parsed.beneficiaryHint) {
      const hint = parsed.beneficiaryHint.toLowerCase();
      const found = users.find(u => u.id !== me.id && (u.short?.toLowerCase() === hint || u.name.toLowerCase().startsWith(hint)));
      if (found) beneficiary_id = found.id;
    }
    if (!beneficiary_id) {
      const other = users.find(u => u.id !== me.id);
      if (other) beneficiary_id = other.id;
      else {
        await sendMessage(chatId, '❌ No hay otro usuario configurado para el préstamo.');
        return;
      }
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
  await sendMessage(chatId,
    `${typeIcon} <b>Registrado #${parsed.type}</b>\n` +
    `${parsed.currency} <b>${parsed.amount.toFixed(2)}</b> · ~$${Number(tx.amount_usd).toFixed(2)} USD${usdtLine}${catLine}\n` +
    (benef ? `Para: <b>${benef}</b>\n` : '') +
    (parsed.description ? `<i>${parsed.description}</i>` : ''));
  notifyPartner(tx).catch(() => {});
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
  const r = await query(
    `INSERT INTO transactions(payer_id, wallet_id, type, original_amount, original_currency, applied_rate, amount_usd, amount_usdt, usdt_rate, beneficiary_id, category_id, description, receipt_image_url, created_via, transaction_date)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, COALESCE($15::timestamptz, NOW())) RETURNING *`,
    [b.payer_id, b.wallet_id || null, b.type, originalAmount.toFixed(2), currency, appliedRate.toFixed(6), amountUsd.toFixed(2),
     amountUsdt ? amountUsdt.toString() : null, usdtRate, b.beneficiary_id || null, categoryId, b.description || null,
     b.receipt_image_url || null, b.created_via || 'WEB', b.transaction_date || null]
  );
  const created = r.rows[0];
  created._category_auto = categoryAuto;
  return created;
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
    const tx = await createTransaction(b);
    notifyPartner(tx).catch(() => {});
    return json(tx, 201);
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
    // Mark all unreconciled NOS and PRESTAMO transactions involving these two users as reconciled
    await query(
      `UPDATE transactions SET is_reconciled=TRUE
       WHERE is_reconciled=FALSE
         AND type IN ('NOS','PRESTAMO')
         AND (
           (payer_id IN ($1,$2) AND type='NOS') OR
           (type='PRESTAMO' AND (
             (payer_id=$1 AND beneficiary_id=$2) OR (payer_id=$2 AND beneficiary_id=$1)
           ))
         )`,
      [b.payer_id, b.receiver_id]
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
    if (secret !== process.env.TELEGRAM_WEBHOOK_SECRET) return json({ ok: true }); // silently ignore
    const upd = await req.json().catch(() => ({}));

    // Callback query for user binding
    if (upd.callback_query) {
      const cq = upd.callback_query;
      const data = cq.data || '';
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

    // Handle voice / audio
    if (msg.voice || msg.audio) {
      const fileId = (msg.voice || msg.audio).file_id;
      const mime = (msg.voice || msg.audio).mime_type || 'audio/ogg';
      try {
        const { buffer } = await downloadFile(fileId);
        const transcript = await transcribeAudio(buffer, 'voice.ogg', mime);
        await sendMessage(chatId, `🎤 <i>Escuché:</i> "${transcript}"`);
        const parsed = parseExpenseText(transcript);
        if (!parsed) {
          await sendMessage(chatId, '❌ No pude interpretar un gasto. Intenta: "gasté 30 dólares en cena compartido"');
          return json({ ok: true });
        }
        await handleParsedExpense(me, parsed, chatId, 'WHATSAPP_BOT');
      } catch (e) { await sendMessage(chatId, '❌ Error de transcripción: ' + e.message); }
      return json({ ok: true });
    }

    // Handle photo (receipt OCR)
    if (msg.photo && msg.photo.length) {
      const largest = msg.photo[msg.photo.length - 1];
      try {
        const { buffer } = await downloadFile(largest.file_id);
        const data = await extractReceipt(buffer, 'image/jpeg');
        const amt = Number(data?.amount_bs);
        if (!amt || !isFinite(amt) || amt <= 0) {
          await sendMessage(chatId, `📷 No pude leer el monto claramente. Datos extraídos:\n<code>${JSON.stringify(data)}</code>`);
          return json({ ok: true });
        }
        // Determine type from caption if any
        const captionParsed = parseExpenseText(text);
        const type = captionParsed?.type || 'MIO';
        const description = data.description || text || `Pago ${data.bank || ''} ${data.reference ? '#'+data.reference : ''}`.trim();
        const parsed = { amount: amt, currency: 'BS', description, type, beneficiaryHint: captionParsed?.beneficiaryHint };
        await sendMessage(chatId, `📷 <b>OCR:</b> ${amt.toFixed(2)} Bs · ${data.bank || 'Banco'}${data.reference ? ' · Ref '+data.reference : ''}`);
        await handleParsedExpense(me, parsed, chatId, 'OCR');
      } catch (e) { await sendMessage(chatId, '❌ Error OCR: ' + e.message); }
      return json({ ok: true });
    }

    // Handle text
    if (text) {
      const parsed = parseExpenseText(text);
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
    const users = (await query('SELECT id, name, short, color FROM app_users ORDER BY created_at')).rows;

    // Net debt uses ALL-TIME unreconciled transactions (settlements reset it)
    const txAgg = await query(`
      SELECT type, payer_id, beneficiary_id,
             SUM(amount_usd)::numeric AS total_usd,
             SUM(COALESCE(amount_usdt,0))::numeric AS total_usdt
      FROM transactions
      WHERE is_reconciled = FALSE
      GROUP BY type, payer_id, beneficiary_id
    `);

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
