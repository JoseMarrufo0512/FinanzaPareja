// Unit tests for the quick-expense parser and the split maths.
//   node tests/parser.test.mjs
// lib/*.js are ESM-syntax files in a CommonJS package, so they are loaded by
// evaluating the source directly (they have no imports of their own).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));
const Decimal = require('decimal.js');
const D = (v) => new Decimal(v === null || v === undefined || v === '' ? 0 : v.toString());

// Evaluate a lib file with its imports stripped and its dependencies injected.
function load(file, exports, injected = {}) {
  const src = fs.readFileSync(path.join(root, file), 'utf8')
    .replace(/^import .*$/gm, '')
    .replace(/^export /gm, '');
  const names = Object.keys(injected);
  const fn = new Function(...names, `${src}; return { ${exports.join(', ')} };`);
  return fn(...names.map(n => injected[n]));
}

const { parseExpenseText } = load('lib/parser.js', ['parseExpenseText']);
const { splitEqually, computeSplits, settleUp } = load(
  'lib/splits.js', ['splitEqually', 'computeSplits', 'settleUp'], { D }
);

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; failures.push(name); console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

const USERS = [
  { id: 'u-jose', name: 'José', short: 'J' },
  { id: 'u-ali', name: 'Aliexis', short: 'A' },
];

console.log('\n▶ Parser de gastos rápidos\n');
{
  const p = parseExpenseText('30$ cena #Nos J', USERS);
  check('"30$ cena #Nos J" → NOS 30 USD', p.type === 'NOS' && p.amount === 30 && p.currency === 'USD', JSON.stringify(p));

  const m = parseExpenseText('5000 bs comida #Mio', USERS);
  check('"5000 bs comida #Mio" → MIO 5000 BS', m.type === 'MIO' && m.amount === 5000 && m.currency === 'BS', JSON.stringify(m));

  const mioA = parseExpenseText('2$ mototaxi #Mio A', USERS);
  check('"#Mio A" → gasto personal de Aliexis', mioA.type === 'MIO' && mioA.beneficiaryHint === 'A', JSON.stringify(mioA));
  check('  y conserva la descripción', mioA.description === 'mototaxi', JSON.stringify(mioA.description));

  const mioJ = parseExpenseText('20$ internet #Mio J', USERS);
  check('"#Mio J" → gasto personal de José', mioJ.type === 'MIO' && mioJ.beneficiaryHint === 'J');

  const glued = parseExpenseText('12$ almuerzo #MioA', USERS);
  check('"#MioA" pegado también funciona', glued.type === 'MIO' && glued.beneficiaryHint === 'A', JSON.stringify(glued));

  const loan = parseExpenseText('15 usd hotel #Prestamo J', USERS);
  check('"#Prestamo J" → PRESTAMO para José', loan.type === 'PRESTAMO' && loan.beneficiaryHint === 'J');

  const plain = parseExpenseText('500 bs café', USERS);
  check('"500 bs café" → MIO sin persona', plain.type === 'MIO' && !plain.beneficiaryHint && plain.description === 'café', JSON.stringify(plain));

  // The old parser stole the last word as a person; with members known it must not.
  const trap = parseExpenseText('20$ pago de luz', USERS);
  check('no confunde la última palabra con una persona', !trap.beneficiaryHint && trap.description === 'pago de luz', JSON.stringify(trap));

  const named = parseExpenseText('10$ cena Aliexis', USERS);
  check('reconoce el nombre completo al final', named.beneficiaryHint === 'Aliexis' && named.type === 'PRESTAMO', JSON.stringify(named));

  const euro = parseExpenseText('25 eur hotel', USERS);
  check('detecta EUR', euro.currency === 'EUR' && euro.amount === 25);

  check('texto sin monto → null', parseExpenseText('hola qué tal', USERS) === null);
}

console.log('\n▶ Reparto de gastos\n');
{
  check('10 entre 3 suma exacto', splitEqually(10, 3).join(',') === '3.34,3.33,3.33', splitEqually(10, 3).join(','));
  check('30 entre 3 es parejo', splitEqually(30, 3).join(',') === '10.00,10.00,10.00');
  check('0.01 entre 2', splitEqually(0.01, 2).join(',') === '0.01,0.00', splitEqually(0.01, 2).join(','));

  const nos = computeSplits({ type: 'NOS', payer_id: 'u-jose', amount_usd: '30', activeUserIds: ['u-jose', 'u-ali', 'u-sofia'] });
  check('#Nos reparte entre los 3 miembros', nos.length === 3 && nos.every(s => s.share_usd === '10.00'), JSON.stringify(nos));

  const mio = computeSplits({ type: 'MIO', payer_id: 'u-jose', beneficiary_id: 'u-ali', amount_usd: '2', activeUserIds: ['u-jose', 'u-ali'] });
  check('#Mio A pertenece solo a Aliexis', mio.length === 1 && mio[0].user_id === 'u-ali' && mio[0].share_usd === '2.00', JSON.stringify(mio));

  const loan = computeSplits({ type: 'PRESTAMO', payer_id: 'u-jose', beneficiary_id: 'u-ali', amount_usd: '15', amount_usdt: '12.5', activeUserIds: ['u-jose', 'u-ali'] });
  check('#Prestamo lo debe el beneficiario', loan.length === 1 && loan[0].user_id === 'u-ali' && loan[0].share_usdt === '12.50', JSON.stringify(loan));

  const t = settleUp({ a: '10.00', b: '-4.00', c: '-6.00' });
  check('liquidación mínima entre 3', t.length === 2 && t.every(x => x.to === 'a'), JSON.stringify(t));
  const total = t.reduce((s, x) => s + Number(x.amount_usd), 0);
  check('las transferencias cuadran', Math.abs(total - 10) < 0.01, String(total));

  check('sin deudas no hay transferencias', settleUp({ a: '0', b: '0' }).length === 0);
}

console.log(`\n${'─'.repeat(50)}\n${passed} pasaron · ${failed} fallaron`);
if (failures.length) failures.forEach(f => console.log('  · ' + f));
process.exit(failed ? 1 : 0);
