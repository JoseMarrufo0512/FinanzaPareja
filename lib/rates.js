import { query } from './db';

const BCV_USD_URL = 'https://ve.dolarapi.com/v1/dolares/oficial';
// ve.dolarapi.com/.../oficial_euro is gone (404/empty), so EUR/VES is derived:
//   EUR/VES = (EUR->USD from Frankfurter) x (BCV USD/VES)
const FRANKFURTER_URLS = [
  'https://api.frankfurter.app/latest?base=EUR&symbols=USD',
  'https://api.frankfurter.dev/v1/latest?base=EUR&symbols=USD',
];
const BINANCE_P2P_URL = 'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search';

async function fetchJson(url, opts = {}, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal, cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

export async function fetchBcvUsd() {
  const j = await fetchJson(BCV_USD_URL);
  return Number(j.promedio ?? j.compra ?? j.venta);
}

// USD per 1 EUR, from the ECB reference rates published by Frankfurter (no API key).
export async function fetchEurUsd() {
  let lastErr;
  for (const url of FRANKFURTER_URLS) {
    try {
      const j = await fetchJson(url);
      const v = Number(j?.rates?.USD);
      if (v > 0 && isFinite(v)) return v;
      throw new Error('no USD rate in response');
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('frankfurter unavailable');
}

export async function fetchBinanceUsdt() {
  // average of top BUY offers (VES per USDT)
  const body = {
    page: 1,
    rows: 10,
    asset: 'USDT',
    tradeType: 'BUY',
    fiat: 'VES',
    payTypes: [],
    publisherType: null,
  };
  const j = await fetchJson(BINANCE_P2P_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, 10000);
  const prices = (j.data || []).map((x) => Number(x?.adv?.price)).filter((n) => n > 0);
  if (!prices.length) throw new Error('no binance offers');
  const sorted = prices.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function store(source, from, to, rate) {
  await query(
    'INSERT INTO exchange_rates_api(source, from_currency, to_currency, rate) VALUES($1,$2,$3,$4)',
    [source, from, to, rate]
  );
}

export async function refreshRates() {
  const out = { bcv_usd: null, bcv_eur: null, eur_usd: null, binance_usdt: null, errors: [] };

  // BCV USD/VES first: the EUR/VES rate is derived from it.
  try {
    const rate = await fetchBcvUsd();
    if (!rate || !isFinite(rate)) throw new Error('invalid rate');
    await store('BCV', 'BS', 'USD', rate);
    out.bcv_usd = rate;
  } catch (e) { out.errors.push(`bcv_usd: ${e.message}`); }

  try {
    const eurUsd = await fetchEurUsd();
    await store('FRANKFURTER', 'EUR', 'USD', eurUsd);
    out.eur_usd = eurUsd;
    // Fall back to the last stored BCV USD/VES when this run failed to fetch it.
    let bcvUsd = out.bcv_usd;
    if (!bcvUsd) {
      const prev = await getLatestRates();
      bcvUsd = prev.bcv_usd?.rate || null;
    }
    if (bcvUsd) {
      const eurVes = Number((eurUsd * bcvUsd).toFixed(6));
      await store('BCV', 'BS', 'EUR', eurVes);
      out.bcv_eur = eurVes;
    } else {
      out.errors.push('bcv_eur: sin tasa BCV USD/VES para derivarla');
    }
  } catch (e) { out.errors.push(`eur_usd: ${e.message}`); }

  try {
    const rate = await fetchBinanceUsdt();
    if (!rate || !isFinite(rate)) throw new Error('invalid rate');
    await store('BINANCE_P2P', 'BS', 'USDT', rate);
    out.binance_usdt = rate;
  } catch (e) { out.errors.push(`binance_usdt: ${e.message}`); }

  return out;
}

export async function getLatestRates() {
  const r = await query(`
    SELECT DISTINCT ON (source, from_currency, to_currency) source, from_currency, to_currency, rate, fetched_at
    FROM exchange_rates_api
    ORDER BY source, from_currency, to_currency, fetched_at DESC
  `);
  const map = { bcv_usd: null, bcv_eur: null, eur_usd: null, binance_usdt: null, fetched_at: null };
  for (const row of r.rows) {
    if (row.source === 'BCV' && row.to_currency === 'USD') map.bcv_usd = { rate: Number(row.rate), fetched_at: row.fetched_at };
    if (row.source === 'BCV' && row.to_currency === 'EUR') map.bcv_eur = { rate: Number(row.rate), fetched_at: row.fetched_at };
    if (row.source === 'FRANKFURTER' && row.to_currency === 'USD') map.eur_usd = { rate: Number(row.rate), fetched_at: row.fetched_at };
    if (row.source === 'BINANCE_P2P' && row.to_currency === 'USDT') map.binance_usdt = { rate: Number(row.rate), fetched_at: row.fetched_at };
    if (!map.fetched_at || new Date(row.fetched_at) > new Date(map.fetched_at)) map.fetched_at = row.fetched_at;
  }
  return map;
}
