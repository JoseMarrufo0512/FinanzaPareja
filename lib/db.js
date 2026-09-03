import { Pool } from 'pg';

let pool;
let initialized = false;

export function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30000,
    });
    pool.on('error', (err) => console.error('pg pool error', err));
  }
  return pool;
}

export async function query(text, params) {
  const p = getPool();
  const res = await p.query(text, params);
  return res;
}

const SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE tx_type AS ENUM ('NOS','MIO','PRESTAMO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE currency_code AS ENUM ('USD','BS','EUR','USDT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE wallet_type AS ENUM ('BANK','PAYMENT_GATEWAY','CASH','CREDIT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(50) NOT NULL,
  short VARCHAR(4) NOT NULL,
  color VARCHAR(20) DEFAULT '#6366f1',
  telegram_chat_id BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  name VARCHAR(80) NOT NULL,
  account_type wallet_type NOT NULL DEFAULT 'BANK',
  currency currency_code NOT NULL DEFAULT 'USD',
  current_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(50) UNIQUE NOT NULL,
  icon VARCHAR(10) DEFAULT '💰'
);

CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payer_id UUID NOT NULL REFERENCES app_users(id),
  wallet_id UUID REFERENCES wallets(id),
  type tx_type NOT NULL,
  original_amount NUMERIC(14,2) NOT NULL,
  original_currency currency_code NOT NULL,
  applied_rate NUMERIC(14,6) NOT NULL DEFAULT 1,
  amount_usd NUMERIC(14,2) NOT NULL,
  amount_usdt NUMERIC(14,2),
  usdt_rate NUMERIC(14,6),
  beneficiary_id UUID REFERENCES app_users(id),
  category_id UUID REFERENCES categories(id),
  description TEXT,
  receipt_image_url TEXT,
  is_reconciled BOOLEAN DEFAULT FALSE,
  created_via VARCHAR(20) DEFAULT 'WEB',
  transaction_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_tx_payer ON transactions(payer_id);
CREATE INDEX IF NOT EXISTS idx_tx_type ON transactions(type);

CREATE TABLE IF NOT EXISTS budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID REFERENCES categories(id) ON DELETE CASCADE,
  monthly_limit_usd NUMERIC(14,2) NOT NULL,
  is_shared BOOLEAN DEFAULT TRUE,
  user_id UUID REFERENCES app_users(id),
  UNIQUE(category_id, user_id, is_shared)
);

CREATE TABLE IF NOT EXISTS exchange_rates_api (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source VARCHAR(20) NOT NULL,
  from_currency currency_code NOT NULL,
  to_currency currency_code NOT NULL DEFAULT 'USD',
  rate NUMERIC(14,6) NOT NULL,
  fetched_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rates_fetched ON exchange_rates_api(fetched_at DESC);

CREATE TABLE IF NOT EXISTS settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payer_id UUID NOT NULL REFERENCES app_users(id),
  receiver_id UUID NOT NULL REFERENCES app_users(id),
  amount_usd NUMERIC(14,2) NOT NULL,
  amount_usdt NUMERIC(14,2),
  notes TEXT,
  settlement_date TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_settings (
  key VARCHAR(50) PRIMARY KEY,
  value TEXT
);
`;

const SEED_CATEGORIES = [
  ['Comida', '🍴'],
  ['Supermercado', '🛒'],
  ['Salidas', '🍻'],
  ['Hotel', '🏨'],
  ['Moto', '🏍️'],
  ['Farmacia', '💊'],
  ['Cashea', '💳'],
  ['Transporte', '🚗'],
  ['Servicios', '💡'],
  ['Otros', '💰'],
];

export async function initDb() {
  if (initialized) return;
  const client = await getPool().connect();
  try {
    await client.query(SCHEMA_SQL);
    // seed categories if empty
    const c = await client.query('SELECT COUNT(*)::int AS n FROM categories');
    if (c.rows[0].n === 0) {
      for (const [name, icon] of SEED_CATEGORIES) {
        await client.query('INSERT INTO categories(name,icon) VALUES($1,$2) ON CONFLICT DO NOTHING', [name, icon]);
      }
    }
    initialized = true;
  } finally {
    client.release();
  }
}
