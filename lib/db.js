import { Pool } from 'pg';

let pool;
let initialized = false;

// Local Postgres (dev/test) speaks plain TCP; hosted Postgres (Supabase/Neon) needs SSL.
function needsSsl(connectionString = '') {
  if (process.env.PGSSL === 'disable') return false;
  return !/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(connectionString);
}

export function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    pool = new Pool({
      connectionString,
      ssl: needsSsl(connectionString) ? { rejectUnauthorized: false } : false,
      // Supabase's transaction pooler hands out sessions with an empty
      // search_path, which makes every unqualified table name fail. Pin it.
      options: '-c search_path=public',
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

// Run `fn` inside a single BEGIN/COMMIT so multi-statement writes stay atomic.
// `fn` receives a client whose .query signature matches the module-level one.
export async function withTx(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    client.release();
  }
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

CREATE TABLE IF NOT EXISTS auth_sessions (
  token TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
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

// ---------------------------------------------------------------------------
// Versioned migrations.
// SCHEMA_SQL above only ever creates things IF NOT EXISTS, so it stays safe to
// re-run; anything that has to happen exactly once (backfills, data fixes)
// belongs here and is recorded in schema_migrations.
// ---------------------------------------------------------------------------
const MIGRATIONS = [
  {
    id: '001_wallet_ledger',
    sql: `
      ALTER TABLE wallets ADD COLUMN IF NOT EXISTS initial_balance NUMERIC(14,2);
      UPDATE wallets SET initial_balance = current_balance WHERE initial_balance IS NULL;
      ALTER TABLE wallets ALTER COLUMN initial_balance SET DEFAULT 0;
      -- How much was actually taken out of the wallet, in the WALLET's currency.
      ALTER TABLE transactions ADD COLUMN IF NOT EXISTS wallet_amount NUMERIC(14,2);
      CREATE INDEX IF NOT EXISTS idx_tx_wallet ON transactions(wallet_id);
    `,
  },
  {
    id: '002_family_mode',
    sql: `
      ALTER TABLE app_users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
      ALTER TABLE app_users ADD COLUMN IF NOT EXISTS email TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON app_users(LOWER(email)) WHERE email IS NOT NULL;

      CREATE TABLE IF NOT EXISTS transaction_splits (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        share_usd NUMERIC(14,2) NOT NULL,
        share_usdt NUMERIC(14,2),
        UNIQUE(transaction_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_splits_user ON transaction_splits(user_id);

      -- Settlements created before the ledger model already cleared their debt by
      -- flipping transactions.is_reconciled, so they must not be counted twice.
      ALTER TABLE settlements ADD COLUMN IF NOT EXISTS pre_ledger BOOLEAN NOT NULL DEFAULT FALSE;
      UPDATE settlements SET pre_ledger = TRUE;
    `,
  },
  {
    id: '003_auth_identity',
    sql: `
      ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES app_users(id) ON DELETE CASCADE;
      ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS method VARCHAR(10) NOT NULL DEFAULT 'PIN';
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON auth_sessions(expires_at);
    `,
  },
  {
    id: '004_telegram_drafts',
    sql: `
      CREATE TABLE IF NOT EXISTS tg_drafts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        chat_id BIGINT NOT NULL,
        message_id BIGINT,
        user_id UUID REFERENCES app_users(id) ON DELETE CASCADE,
        payload JSONB NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_drafts_chat ON tg_drafts(chat_id, status);
    `,
  },
  {
    id: '005_bank_reconciliation',
    sql: `
      CREATE TABLE IF NOT EXISTS bank_statements (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
        wallet_id UUID REFERENCES wallets(id) ON DELETE SET NULL,
        label TEXT,
        raw_text TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS bank_statement_lines (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        statement_id UUID NOT NULL REFERENCES bank_statements(id) ON DELETE CASCADE,
        line_date DATE,
        description TEXT,
        amount NUMERIC(14,2) NOT NULL,
        currency currency_code NOT NULL DEFAULT 'BS',
        reference TEXT,
        transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
        match_score NUMERIC(5,2),
        status VARCHAR(20) NOT NULL DEFAULT 'UNMATCHED'
      );
      CREATE INDEX IF NOT EXISTS idx_stmt_lines ON bank_statement_lines(statement_id, status);
    `,
  },
  {
    // A shared 4-digit PIN is only safe if guessing is throttled.
    id: '008_login_throttle',
    sql: `
      CREATE TABLE IF NOT EXISTS auth_attempts (
        id BIGSERIAL PRIMARY KEY,
        ip TEXT NOT NULL,
        success BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_attempts_ip_time ON auth_attempts(ip, created_at DESC);
    `,
  },
  {
    // Expenses coming from Telegram/OCR never carried a wallet, so nothing could
    // be discounted. Each member can now pin a default wallet per currency.
    id: '007_default_wallet',
    sql: `
      ALTER TABLE app_users ADD COLUMN IF NOT EXISTS default_wallet_id UUID REFERENCES wallets(id) ON DELETE SET NULL;
    `,
  },
  {
    // Every transaction that predates the ledger gets its participant rows, so
    // balances computed from transaction_splits include the whole history.
    // Historical membership is unknown, so #Nos rows are split across whoever is
    // an active member today.
    id: '006_backfill_splits',
    fn: async (client) => {
      const { computeSplits } = await import('./splits.js');
      const activeUserIds = (await client.query('SELECT id FROM app_users WHERE is_active ORDER BY created_at')).rows.map(r => r.id);
      const txs = (await client.query(`
        SELECT t.id, t.type, t.payer_id, t.beneficiary_id, t.amount_usd, t.amount_usdt
        FROM transactions t
        WHERE NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = t.id)
      `)).rows;
      for (const t of txs) {
        const splits = computeSplits({ ...t, activeUserIds });
        for (const s of splits) {
          await client.query(
            `INSERT INTO transaction_splits(transaction_id, user_id, share_usd, share_usdt)
             VALUES($1,$2,$3,$4) ON CONFLICT (transaction_id, user_id) DO NOTHING`,
            [t.id, s.user_id, s.share_usd, s.share_usdt]
          );
        }
      }
      if (txs.length) console.log(`[db] backfilled splits for ${txs.length} transactions`);
    },
  },
];

async function runMigrations(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  const done = new Set((await client.query('SELECT id FROM schema_migrations')).rows.map(r => r.id));
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    await client.query('BEGIN');
    try {
      if (m.sql) await client.query(m.sql);
      if (m.fn) await m.fn(client);
      await client.query('INSERT INTO schema_migrations(id) VALUES($1)', [m.id]);
      await client.query('COMMIT');
      console.log('[db] migration applied:', m.id);
    } catch (e) {
      await client.query('ROLLBACK');
      throw new Error(`migration ${m.id} failed: ${e.message}`);
    }
  }
}

export async function initDb() {
  if (initialized) return;
  const client = await getPool().connect();
  try {
    await client.query(SCHEMA_SQL);
    await runMigrations(client);
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
