// Parses quick expense syntax like:
//   "30$ cena #Nos J"
//   "5000 bs comida #Mio"
//   "15 usd hotel #Prestamo A"
//   "20 café"  (default USD, #Mio)
// Returns { amount, currency, description, type, beneficiaryHint }

const CURRENCY_MAP = {
  '$': 'USD', 'usd': 'USD', 'dolar': 'USD', 'dolares': 'USD', 'dólar': 'USD', 'dólares': 'USD',
  'bs': 'BS', 'bolivares': 'BS', 'bolívares': 'BS', 'bolivar': 'BS', 'bolívar': 'BS', 'vef': 'BS', 'ves': 'BS',
  '€': 'EUR', 'eur': 'EUR', 'euro': 'EUR', 'euros': 'EUR',
  'usdt': 'USDT', 'tether': 'USDT', '₮': 'USDT',
};

const TYPE_MAP = {
  'nos': 'NOS', 'compartido': 'NOS', 'shared': 'NOS',
  'mio': 'MIO', 'mío': 'MIO', 'personal': 'MIO', 'individual': 'MIO',
  'prestamo': 'PRESTAMO', 'préstamo': 'PRESTAMO', 'loan': 'PRESTAMO', 'presto': 'PRESTAMO',
};

export function parseExpenseText(text) {
  if (!text) return null;
  const raw = text.trim();

  // Extract hashtag type
  let type = null;
  let beneficiaryHint = null;
  let cleaned = raw.replace(/#(\w+)/gi, (_, tag) => {
    const t = TYPE_MAP[tag.toLowerCase()];
    if (t) { type = t; return ''; }
    return ' ' + tag + ' ';
  }).trim().replace(/\s+/g, ' ');

  // Match: amount + optional currency
  const m = cleaned.match(/^(\d+(?:[.,]\d{1,4})?)\s*([$€₮]|[a-zA-Z]{1,6})?\s*(.*)$/);
  if (!m) return null;
  const amount = parseFloat(m[1].replace(',', '.'));
  if (!amount || amount <= 0) return null;

  let currency = 'USD';
  let rest = (m[3] || '').trim();
  const sym = (m[2] || '').toLowerCase();

  if (sym) {
    if (CURRENCY_MAP[sym]) currency = CURRENCY_MAP[sym];
    else { rest = sym + ' ' + rest; }
  }

  // Also detect currency word inside rest as first token
  if (currency === 'USD' && !sym) {
    const firstTok = rest.split(/\s+/)[0]?.toLowerCase();
    if (firstTok && CURRENCY_MAP[firstTok]) {
      currency = CURRENCY_MAP[firstTok];
      rest = rest.split(/\s+/).slice(1).join(' ');
    }
  }

  // Check for beneficiary hint at end (single letter or short name)
  const tokens = rest.trim().split(/\s+/).filter(Boolean);
  if (tokens.length > 1) {
    const last = tokens[tokens.length - 1];
    if (/^[A-Za-z]{1,4}$/.test(last)) {
      beneficiaryHint = last;
      tokens.pop();
    }
  }
  const description = tokens.join(' ').trim() || null;

  if (!type) type = beneficiaryHint ? 'PRESTAMO' : 'MIO'; // heuristic default

  return { amount, currency, description, type, beneficiaryHint };
}
