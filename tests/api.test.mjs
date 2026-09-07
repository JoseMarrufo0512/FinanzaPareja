// End-to-end API tests. Runs against a live dev server + throwaway Postgres.
//   BASE=http://localhost:3000 node tests/api.test.mjs
// The database is expected to be empty (see tests/reset-db.sh).

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

  console.log(`\n${'─'.repeat(50)}\n${passed} pasaron · ${failed} fallaron`);
  if (failures.length) {
    console.log('\nFallos:');
    failures.forEach(f => console.log('  · ' + f));
  }
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error('\n💥 Error en el runner:', e); process.exit(2); });
