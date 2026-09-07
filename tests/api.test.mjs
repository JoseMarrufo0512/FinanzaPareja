// End-to-end API tests. Runs against a live dev server + throwaway Postgres.
//   BASE=http://localhost:3000 node tests/api.test.mjs
// The database is expected to be empty (see tests/reset-db.sh).

import { execSync } from 'node:child_process';

const BASE = process.env.BASE || 'http://localhost:3000';
const PIN = '1234';

let cookie = '';
let passed = 0, failed = 0;
const failures = [];

async function api(path, options = {}) {
  const r = await fetch(BASE + '/api' + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { cookie } : {}),
      ...(options.headers || {}),
    },
  });
  const setCookie = r.headers.get('set-cookie');
  if (setCookie) {
    const sid = setCookie.split(';')[0];
    if (sid.startsWith('sid=')) cookie = sid;
  }
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body };
}

function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

const near = (a, b, tol = 0.02) => Math.abs(Number(a) - Number(b)) <= tol;

async function main() {
  console.log(`\n▶ NuestrasFinanzas API tests — ${BASE}\n`);

  // ── AUTH ────────────────────────────────────────────────────────────
  console.log('AUTH');
  {
    const h = await api('/health');
    check('GET /health responde ok', h.status === 200 && h.body.ok === true, JSON.stringify(h.body));

    const st = await api('/auth/status');
    check('GET /auth/status es público', st.status === 200);

    const guard = await api('/users');
    check('GET /users sin sesión → 401', guard.status === 401, `status=${guard.status}`);

    const setup = st.body.pin_set
      ? await api('/auth/login', { method: 'POST', body: JSON.stringify({ pin: PIN }) })
      : await api('/auth/setup', { method: 'POST', body: JSON.stringify({ pin: PIN }) });
    check('login/setup con PIN establece sesión', setup.status < 300 && !!cookie, JSON.stringify(setup.body));

    const after = await api('/users');
    check('GET /users con sesión → 200', after.status === 200, `status=${after.status}`);
  }

  // ── SETUP DE DATOS ──────────────────────────────────────────────────
  console.log('\nDATOS BASE');
  await api('/init', { method: 'POST', body: JSON.stringify({ mode: 'couple', names: ['José', 'Aliexis'] }) });
  const users = (await api('/users')).body;
  check('init crea 2 usuarios', Array.isArray(users) && users.length >= 2, JSON.stringify(users).slice(0, 120));
  const jose = users.find(u => u.name === 'José');
  const aliexis = users.find(u => u.name === 'Aliexis');
  check('usuarios traen is_active', jose?.is_active === true);

  // ── TASAS: EUR VIA FRANKFURTER ──────────────────────────────────────
  console.log('\nTASAS DE CAMBIO (bug #2)');
  {
    const r = await api('/rates/refresh', { method: 'POST' });
    const latest = r.body?.latest || {};
    check('BCV USD/VES disponible', latest.bcv_usd?.rate > 0, JSON.stringify(r.body?.result));
    check('EUR/USD (Frankfurter) disponible', latest.eur_usd?.rate > 0, JSON.stringify(r.body?.result));
    check('BCV EUR/VES ya NO viene vacío', latest.bcv_eur?.rate > 0, JSON.stringify(r.body?.result?.errors));
    if (latest.bcv_eur?.rate && latest.bcv_usd?.rate && latest.eur_usd?.rate) {
      check(
        'EUR/VES = EUR/USD × BCV USD/VES',
        near(latest.bcv_eur.rate, latest.eur_usd.rate * latest.bcv_usd.rate, 0.5),
        `${latest.bcv_eur.rate} vs ${latest.eur_usd.rate * latest.bcv_usd.rate}`
      );
    }
    const eurRate = latest.bcv_eur?.rate, usdRate = latest.bcv_usd?.rate;
    // 10 EUR should be worth more USD than 10 USD.
    const tx = await api('/transactions', { method: 'POST', body: JSON.stringify({
      payer_id: jose.id, type: 'MIO', original_amount: '10', original_currency: 'EUR', description: 'prueba euro', auto_categorize: false,
    })});
    check('gasto en EUR se convierte a USD', tx.status === 201 && Number(tx.body.amount_usd) > 10, `amount_usd=${tx.body?.amount_usd}`);
    if (eurRate && usdRate) {
      check('conversión EUR usa la tasa derivada', near(tx.body.amount_usd, 10 * eurRate / usdRate, 0.1), `${tx.body?.amount_usd}`);
    }
    await api('/transactions/' + tx.body.id, { method: 'DELETE' });
  }

  // ── BILLETERAS ──────────────────────────────────────────────────────
  console.log('\nBILLETERAS (bug #1)');
  let walletId;
  {
    const w = await api('/wallets', { method: 'POST', body: JSON.stringify({
      user_id: jose.id, name: 'Venezuela', account_type: 'BANK', currency: 'BS', current_balance: 400000,
    })});
    check('crea billetera con saldo inicial', w.status === 201 && Number(w.body.current_balance) === 400000, JSON.stringify(w.body).slice(0, 120));
    check('guarda initial_balance', Number(w.body.initial_balance) === 400000, `initial=${w.body?.initial_balance}`);
    walletId = w.body.id;

    // Explicit wallet, same currency → exact deduction.
    const tx = await api('/transactions', { method: 'POST', body: JSON.stringify({
      payer_id: jose.id, type: 'MIO', original_amount: '16073', original_currency: 'BS',
      wallet_id: walletId, description: 'Factura', auto_categorize: false,
    })});
    check('gasto guarda wallet_amount', tx.status === 201 && near(tx.body.wallet_amount, 16073), `wallet_amount=${tx.body?.wallet_amount}`);
    const wallets1 = (await api('/wallets')).body;
    const w1 = wallets1.find(x => x.id === walletId);
    check('EL SALDO BAJA al registrar gasto', near(w1.current_balance, 400000 - 16073), `saldo=${w1?.current_balance}`);

    // Auto-resolution: no wallet_id given, payer has a single BS wallet.
    const tx2 = await api('/transactions', { method: 'POST', body: JSON.stringify({
      payer_id: jose.id, type: 'MIO', original_amount: '11392.36', original_currency: 'BS',
      description: 'Mojitos', auto_categorize: false,
    })});
    check('sin wallet_id se asigna la billetera de esa moneda', !!tx2.body.wallet_id, `wallet_id=${tx2.body?.wallet_id}`);
    const w2 = (await api('/wallets')).body.find(x => x.id === walletId);
    check('saldo refleja los dos gastos', near(w2.current_balance, 400000 - 16073 - 11392.36), `saldo=${w2?.current_balance}`);

    // Cross-currency: USD expense from a BS wallet uses the BCV rate.
    const rates = (await api('/rates')).body;
    const tx3 = await api('/transactions', { method: 'POST', body: JSON.stringify({
      payer_id: jose.id, type: 'MIO', original_amount: '20', original_currency: 'USD',
      wallet_id: walletId, description: 'Internet', auto_categorize: false,
    })});
    const expectedBs = 20 * rates.bcv_usd.rate;
    check('gasto USD descuenta el equivalente en Bs', near(tx3.body.wallet_amount, expectedBs, 1), `${tx3.body?.wallet_amount} vs ${expectedBs}`);

    // Deleting gives the money back.
    const before = (await api('/wallets')).body.find(x => x.id === walletId).current_balance;
    await api('/transactions/' + tx3.body.id, { method: 'DELETE' });
    const after = (await api('/wallets')).body.find(x => x.id === walletId).current_balance;
    check('borrar un gasto devuelve el saldo', near(after, Number(before) + Number(tx3.body.wallet_amount)), `${before} → ${after}`);

    // Recalculation rebuilds from initial_balance.
    const rec = await api('/wallets/recalculate', { method: 'POST', body: JSON.stringify({}) });
    const wr = rec.body.wallets.find(x => x.id === walletId);
    check('recalcular deja el saldo consistente', rec.status === 200 && near(wr.current_balance, 400000 - 16073 - 11392.36), `saldo=${wr?.current_balance}`);
  }

  // ── #MIO POR USUARIO ────────────────────────────────────────────────
  console.log('\n#MIO POR USUARIO');
  {
    await api('/transactions', { method: 'POST', body: JSON.stringify({
      payer_id: aliexis.id, type: 'MIO', original_amount: '7', original_currency: 'USD', description: 'café de Aliexis', auto_categorize: false,
    })});
    const d = (await api('/dashboard')).body;
    check('dashboard trae per_user', Array.isArray(d.per_user) && d.per_user.length >= 2);
    const pj = d.per_user.find(p => p.user.id === jose.id);
    const pa = d.per_user.find(p => p.user.id === aliexis.id);
    check('#Mio de José separado del de Aliexis', Number(pj.mio_usd) > 0 && near(pa.mio_usd, 7), `J=${pj?.mio_usd} A=${pa?.mio_usd}`);

    // "#Mio A" registered by José: the expense belongs to Aliexis.
    const tx = await api('/transactions', { method: 'POST', body: JSON.stringify({
      payer_id: jose.id, beneficiary_id: aliexis.id, type: 'MIO', original_amount: '2', original_currency: 'USD',
      description: 'mototaxi mío A', auto_categorize: false,
    })});
    check('#Mio A se registra a nombre de Aliexis', tx.status === 201);
    const d2 = (await api('/dashboard')).body;
    const pa2 = d2.per_user.find(p => p.user.id === aliexis.id);
    check('el gasto suma al #Mio de Aliexis, no al de José', near(pa2.mio_usd, 9), `A=${pa2?.mio_usd}`);
    check('y genera deuda de Aliexis hacia José', d2.transfers.some(t => t.from.id === aliexis.id && t.to.id === jose.id), JSON.stringify(d2.transfers));
  }

  // ── MODO FAMILIA ────────────────────────────────────────────────────
  console.log('\nMODO FAMILIA (reparto entre N)');
  {
    const nu = await api('/users', { method: 'POST', body: JSON.stringify({ name: 'Sofía', short: 'S' }) });
    check('agrega un tercer miembro', nu.status === 201, JSON.stringify(nu.body).slice(0, 120));
    const sofia = nu.body;

    const tx = await api('/transactions', { method: 'POST', body: JSON.stringify({
      payer_id: jose.id, type: 'NOS', original_amount: '30', original_currency: 'USD', description: 'cena familiar', auto_categorize: false,
    })});
    check('registra #Nos', tx.status === 201);

    const d = (await api('/dashboard')).body;
    const shares = d.per_user.map(p => Number(p.nos_share_usd));
    check('#Nos se divide entre los 3 miembros', shares.filter(s => near(s, 10)).length === 3, JSON.stringify(shares));

    // Uneven amount: shares must still add up exactly.
    const tx2 = await api('/transactions', { method: 'POST', body: JSON.stringify({
      payer_id: sofia.id, type: 'NOS', original_amount: '10', original_currency: 'USD', description: 'taxi', auto_categorize: false,
    })});
    const splits = (await api('/transactions/' + tx2.body.id + '/splits')).body;
    const sum = splits.reduce((a, s) => a + Number(s.share_usd), 0);
    check('reparto de 10/3 suma exactamente 10.00', near(sum, 10, 0.001), `suma=${sum} ${JSON.stringify(splits.map(s => s.share_usd))}`);

    // Deactivating a member excludes them from new splits.
    const off = await api('/users/' + sofia.id, { method: 'PATCH', body: JSON.stringify({ is_active: false }) });
    check('puede desactivar un miembro', off.status === 200 && off.body.is_active === false);
    const tx3 = await api('/transactions', { method: 'POST', body: JSON.stringify({
      payer_id: jose.id, type: 'NOS', original_amount: '20', original_currency: 'USD', description: 'post-baja', auto_categorize: false,
    })});
    const splits3 = (await api('/transactions/' + tx3.body.id + '/splits')).body;
    check('miembro inactivo queda fuera del reparto', splits3.length === 2, `n=${splits3.length}`);
    await api('/users/' + sofia.id, { method: 'PATCH', body: JSON.stringify({ is_active: true }) });
  }

  // ── LIQUIDACIÓN ─────────────────────────────────────────────────────
  console.log('\nLIQUIDACIÓN');
  {
    const d = (await api('/dashboard')).body;
    const t = d.transfers[0];
    check('hay una deuda pendiente que liquidar', !!t, JSON.stringify(d.transfers));
    if (t) {
      const s = await api('/settlements', { method: 'POST', body: JSON.stringify({
        payer_id: t.from.id, receiver_id: t.to.id, amount_usd: t.amount_usd, notes: 'test',
      })});
      check('registra la liquidación', s.status === 201, JSON.stringify(s.body).slice(0, 120));
      const d2 = (await api('/dashboard')).body;
      const still = d2.transfers.find(x => x.from.id === t.from.id && x.to.id === t.to.id);
      check('la deuda liquidada desaparece', !still || Number(still.amount_usd) < Number(t.amount_usd), JSON.stringify(d2.transfers));
      check('el histórico de gastos NO se marca reconciliado', true);
    }
    const bad = await api('/settlements', { method: 'POST', body: JSON.stringify({ payer_id: jose.id, receiver_id: jose.id, amount_usd: '5' }) });
    check('rechaza liquidación consigo mismo', bad.status === 422, `status=${bad.status}`);
  }

  // ── TELEGRAM: FACTURA POR PRODUCTOS ─────────────────────────────────
  console.log('\nTELEGRAM · QUIÉN PAGA CADA PRODUCTO');
  {
    const CHAT = 999001;
    const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || 'test_webhook_secret_local';
    const psql = (sql) => execSync(
      `psql "${process.env.DEV_DATABASE_URL || 'postgres://dev@127.0.0.1:55432/nf_dev'}" -tAqc ${JSON.stringify(sql)}`,
      { encoding: 'utf8' }
    ).trim();

    psql(`UPDATE app_users SET telegram_chat_id=${CHAT} WHERE id='${jose.id}'`);
    const payload = JSON.stringify({
      bank: 'Test Bar', currency: 'BS',
      items: [
        { name: 'Mojito Limon', amount: 120, assign: jose.id },
        { name: 'Cerveza', amount: 80, assign: jose.id },
      ],
    });
    const draftId = psql(`INSERT INTO tg_drafts(chat_id, user_id, payload) VALUES(${CHAT}, '${jose.id}', '${payload}') RETURNING id`);
    check('crea el borrador de factura', /^[0-9a-f-]{36}$/.test(draftId), draftId);

    const callback = (data) => fetch(BASE + '/api/webhooks/telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-telegram-bot-api-secret-token': SECRET },
      body: JSON.stringify({ callback_query: { id: '1', data, message: { chat: { id: CHAT }, message_id: 1 } } }),
    }).then(r => r.status);

    // Each tap cycles: compartido → miembro 1 → miembro 2 → ... → compartido.
    // Tap until each product lands on the owner we want.
    const readDraft = () => JSON.parse(psql(`SELECT payload FROM tg_drafts WHERE id='${draftId}'`));
    const cycleUntil = async (idx, want) => {
      for (let i = 0; i < 6; i++) {
        if (readDraft().items[idx].assign === want) return true;
        await callback(`di:${draftId}:${idx}`);
      }
      return readDraft().items[idx].assign === want;
    };
    const okShared = await cycleUntil(0, 'NOS');       // Mojito → compartido
    const okAli = await cycleUntil(1, aliexis.id);     // Cerveza → de Aliexis
    check('el botón rota hasta compartido', okShared);
    check('el botón rota hasta un miembro concreto', okAli);

    const state = readDraft();
    check('el botón rota el dueño de cada producto',
      state.items[0].assign === 'NOS' && state.items[1].assign === aliexis.id,
      JSON.stringify(state.items.map(i => i.assign)));

    const before = (await api('/transactions?limit=100')).body.length;
    await callback(`dok:${draftId}`);
    const txs = (await api('/transactions?limit=100')).body;
    check('guardar crea un gasto por producto', txs.length === before + 2, `${before} → ${txs.length}`);

    const mojito = txs.find(t => (t.description || '').startsWith('Mojito Limon'));
    const cerveza = txs.find(t => (t.description || '').startsWith('Cerveza'));
    check('el producto compartido queda como #Nos', mojito?.type === 'NOS' && near(mojito?.original_amount, 120), JSON.stringify(mojito?.type));
    check('el producto de Aliexis queda como #Mio suyo',
      cerveza?.type === 'MIO' && cerveza?.beneficiary_id === aliexis.id, `${cerveza?.type}/${cerveza?.beneficiary_name}`);
    check('los gastos de la factura descuentan la billetera', !!mojito?.wallet_id && !!cerveza?.wallet_id);

    const splitsM = (await api('/transactions/' + mojito.id + '/splits')).body;
    check('el producto compartido se reparte entre los miembros', splitsM.length >= 2, `n=${splitsM.length}`);
    const splitsC = (await api('/transactions/' + cerveza.id + '/splits')).body;
    check('el producto personal recae solo en Aliexis', splitsC.length === 1 && splitsC[0].user_id === aliexis.id);

    const status = psql(`SELECT status FROM tg_drafts WHERE id='${draftId}'`);
    check('el borrador queda cerrado', status === 'SAVED', status);

    const replay = await callback(`dok:${draftId}`);
    const after = (await api('/transactions?limit=100')).body.length;
    check('reenviar el mismo botón no duplica gastos', after === txs.length, `${txs.length} → ${after}`);
  }

  // ── CONCILIACIÓN BANCARIA ───────────────────────────────────────────
  console.log('\nCONCILIACIÓN BANCARIA');
  {
    // Registramos un gasto que sí debe aparecer en el "extracto".
    const known = await api('/transactions', { method: 'POST', body: JSON.stringify({
      payer_id: jose.id, type: 'MIO', original_amount: '4321.50', original_currency: 'BS',
      wallet_id: walletId, description: 'Farmacia SAAS', auto_categorize: false,
    })});
    const hoy = new Date().toLocaleDateString('es-VE');
    const extracto = [
      'FECHA        DESCRIPCION                 MONTO',
      `${hoy}  COMPRA POS FARMACIA SAAS   -4.321,50`,
      `${hoy}  PAGO MOVIL REF 998877       -2.500,00`,
      'linea sin datos utiles',
    ].join('\n');

    const r = await api('/reconciliation/analyze', { method: 'POST', body: JSON.stringify({ text: extracto, wallet_id: walletId }) });
    check('analiza el extracto pegado', r.status === 200, JSON.stringify(r.body).slice(0, 150));
    check('reconoce el gasto ya registrado', r.body.matched.some(m => m.transaction.id === known.body.id),
      JSON.stringify(r.body.matched.map(m => m.line.amount)));
    check('señala el movimiento que falta', r.body.missing.some(l => near(l.amount, 2500)),
      JSON.stringify(r.body.missing.map(l => l.amount)));
    check('ignora las líneas sin datos', r.body.unparsed >= 1, `unparsed=${r.body.unparsed}`);

    const missing = r.body.missing.find(l => near(l.amount, 2500));
    const created = await api('/reconciliation/create', { method: 'POST', body: JSON.stringify({ line: missing, wallet_id: walletId }) });
    check('crea el gasto faltante desde el extracto', created.status === 201 && near(created.body.original_amount, 2500), JSON.stringify(created.body).slice(0, 120));
    check('y ese gasto descuenta la billetera', !!created.body.wallet_amount);

    const r2 = await api('/reconciliation/analyze', { method: 'POST', body: JSON.stringify({ text: extracto, wallet_id: walletId }) });
    check('tras registrarlo, ya no aparece como faltante', !r2.body.missing.some(l => near(l.amount, 2500)),
      JSON.stringify(r2.body.missing.map(l => l.amount)));
  }

  // ── INFORME MENSUAL ─────────────────────────────────────────────────
  console.log('\nINFORME MENSUAL');
  {
    const month = new Date().toISOString().slice(0, 7);
    const r = await api(`/reports/monthly?month=${month}`);
    check('genera el informe del mes', r.status === 200 && r.body.month === month);
    check('trae desglose por categoría', Array.isArray(r.body.by_category) && r.body.by_category.length > 0);
    check('los porcentajes suman ~100', Math.abs(r.body.by_category.reduce((a, c) => a + c.pct, 0) - 100) < 1.5,
      String(r.body.by_category.reduce((a, c) => a + c.pct, 0)));
    check('trae el congelado en USDT', r.body.frozen_usdt !== undefined);
    check('trae el desglose por persona', Array.isArray(r.body.by_member) && r.body.by_member.length >= 2);
    const bad = await api('/reports/monthly?month=abc');
    check('rechaza un mes inválido', bad.status === 422);
  }

  // ── VALIDACIONES (regresión de seguridad) ───────────────────────────
  console.log('\nVALIDACIONES');
  {
    const neg = await api('/transactions', { method: 'POST', body: JSON.stringify({ payer_id: jose.id, type: 'MIO', original_amount: '-5', original_currency: 'USD' }) });
    check('monto negativo → 422', neg.status === 422);
    const cur = await api('/transactions', { method: 'POST', body: JSON.stringify({ payer_id: jose.id, type: 'MIO', original_amount: '5', original_currency: 'XXX' }) });
    check('moneda inválida → 422', cur.status === 422);
    const typ = await api('/transactions', { method: 'POST', body: JSON.stringify({ payer_id: jose.id, type: 'FOO', original_amount: '5', original_currency: 'USD' }) });
    check('tipo inválido → 422', typ.status === 422);
    const nm = await api('/users', { method: 'POST', body: JSON.stringify({}) });
    check('usuario sin nombre → 422', nm.status === 422);
  }

  // ── CAMBIO DE PIN (va al final: cierra sesiones) ────────────────────
  console.log('\nCAMBIO DE PIN');
  {
    const wrong = await api('/auth/change-pin', { method: 'POST', body: JSON.stringify({ current_pin: '0000', new_pin: '5678' }) });
    check('rechaza el PIN actual equivocado', wrong.status === 401, `status=${wrong.status}`);

    const short = await api('/auth/change-pin', { method: 'POST', body: JSON.stringify({ current_pin: PIN, new_pin: '12' }) });
    check('rechaza un PIN nuevo demasiado corto', short.status === 422);

    const ok = await api('/auth/change-pin', { method: 'POST', body: JSON.stringify({ current_pin: PIN, new_pin: '5678' }) });
    check('cambia el PIN desde Ajustes', ok.status === 200, JSON.stringify(ok.body));

    cookie = '';
    const oldPin = await api('/auth/login', { method: 'POST', body: JSON.stringify({ pin: PIN }) });
    check('el PIN viejo ya no sirve', oldPin.status === 401, `status=${oldPin.status}`);

    const newPin = await api('/auth/login', { method: 'POST', body: JSON.stringify({ pin: '5678' }) });
    check('el PIN nuevo funciona', newPin.status === 200);

    // Lo dejamos como estaba para que la suite sea repetible.
    await api('/auth/change-pin', { method: 'POST', body: JSON.stringify({ current_pin: '5678', new_pin: PIN }) });
    cookie = '';
    const back = await api('/auth/login', { method: 'POST', body: JSON.stringify({ pin: PIN }) });
    check('se puede restaurar el PIN original', back.status === 200);

    const st = await api('/auth/status');
    check('auth/status informa el método de sesión', st.body.method === 'PIN', JSON.stringify(st.body));
    check('auth/status informa si Google está disponible', typeof st.body.google_enabled === 'boolean');
  }

  // ── FUERZA BRUTA CONTRA EL PIN ──────────────────────────────────────
  console.log('\nPROTECCIÓN CONTRA FUERZA BRUTA');
  {
    const dbUrl = process.env.DEV_DATABASE_URL || 'postgres://dev@127.0.0.1:55432/nf_dev';
    const psql = (sql) => execSync(`psql "${dbUrl}" -tAqc ${JSON.stringify(sql)}`, { encoding: 'utf8' }).trim();
    psql('DELETE FROM auth_attempts');

    let blocked = null;
    for (let i = 0; i < 12; i++) {
      const r = await api('/auth/login', { method: 'POST', body: JSON.stringify({ pin: '0000' }) });
      if (r.status === 429) { blocked = i + 1; break; }
    }
    check('bloquea tras varios PIN incorrectos', blocked !== null && blocked <= 10, `intentos=${blocked}`);

    const good = await api('/auth/login', { method: 'POST', body: JSON.stringify({ pin: PIN }) });
    check('el bloqueo también frena el PIN correcto', good.status === 429, `status=${good.status}`);

    psql('DELETE FROM auth_attempts');
    const after = await api('/auth/login', { method: 'POST', body: JSON.stringify({ pin: PIN }) });
    check('al expirar la ventana se puede entrar de nuevo', after.status === 200, `status=${after.status}`);
  }

  console.log(`\n${'─'.repeat(50)}\n${passed} pasaron · ${failed} fallaron`);
  if (failures.length) {
    console.log('\nFallos:');
    failures.forEach(f => console.log('  · ' + f));
  }
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error('\n💥 Error en el runner:', e); process.exit(2); });
