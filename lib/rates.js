import { query } from './db';

const BCV_USD_URL = 'https://ve.dolarapi.com/v1/dolares/oficial';
const BCV_EUR_URL = 'https://ve.dolarapi.com/v1/dolares/oficial_euro';
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

export async function fetchBcvEur() {
  const j = await fetchJson(BCV_EUR_URL);
  return Number(j.promedio ?? j.compra ?? j.venta);
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

export async function refreshRates() {
  const out = { bcv_usd: null, bcv_eur: null, binance_usdt: null, errors: [] };
  const tasks = [
    ['bcv_usd', fetchBcvUsd, 'BCV', 'BS', 'USD'],
    ['bcv_eur', fetchBcvEur, 'BCV', 'BS', 'EUR'],
    ['binance_usdt', fetchBinanceUsdt, 'BINANCE_P2P', 'BS', 'USDT'],
  ];
  for (const [key, fn, source, from, to] of tasks) {
    try {
      const rate = await fn();
      if (!rate || !isFinite(rate)) throw new Error('invalid rate');
      await query(
        'INSERT INTO exchange_rates_api(source, from_currency, to_currency, rate) VALUES($1,$2,$3,$4)',
        [source, from, to, rate]
      );
      out[key] = rate;
    } catch (e) {
      out.errors.push(`${key}: ${e.message}`);
    }
  }
  return out;
}

export async function getLatestRates() {
  const r = await query(`
    SELECT DISTINCT ON (source, from_currency, to_currency) source, from_currency, to_currency, rate, fetched_at
    FROM exchange_rates_api
    ORDER BY source, from_currency, to_currency, fetched_at DESC
  `);
  const map = { bcv_usd: null, bcv_eur: null, binance_usdt: null, fetched_at: null };
  for (const row of r.rows) {
    if (row.source === 'BCV' && row.to_currency === 'USD') map.bcv_usd = { rate: Number(row.rate), fetched_at: row.fetched_at };
    if (row.source === 'BCV' && row.to_currency === 'EUR') map.bcv_eur = { rate: Number(row.rate), fetched_at: row.fetched_at };
    if (row.source === 'BINANCE_P2P' && row.to_currency === 'USDT') map.binance_usdt = { rate: Number(row.rate), fetched_at: row.fetched_at };
    if (!map.fetched_at || new Date(row.fetched_at) > new Date(map.fetched_at)) map.fetched_at = row.fetched_at;
  }
  return map;
}
