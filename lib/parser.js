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

// Does `token` name one of the members? Matches "J", "Jose", "José"...
// `users` is [{ id, name, short }]; without it we fall back to a loose guess.
function matchUser(token, users) {
  if (!token) return null;
  const t = token.toLowerCase().replace(/[.,;:]$/, '');
  if (!users || !users.length) return /^[A-Za-z]{1,4}$/.test(token) ? { loose: token } : null;
  const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const nt = norm(t);
  return users.find(u => norm(u.short) === nt || norm(u.name) === nt || (nt.length >= 3 && norm(u.name).startsWith(nt))) || null;
}

// `users` lets the parser tell a person's initial ("#Mio A") apart from a word
// that just happens to end the description ("20 café").
export function parseExpenseText(text, users = []) {
  if (!text) return null;
  const raw = text.trim();

  // Extract hashtag type. A hashtag may carry the person right after it:
  // "#Mio A", "#MioA", "#Prestamo J".
  let type = null;
  let beneficiaryHint = null;
  let cleaned = raw.replace(/#(\w+)/gi, (_, tag) => {
    const lower = tag.toLowerCase();
    if (TYPE_MAP[lower]) { type = TYPE_MAP[lower]; return ' '; }
    // "#MioA" / "#PrestamoJ" — type glued to the initial
    for (const [word, mapped] of Object.entries(TYPE_MAP)) {
      if (lower.startsWith(word) && lower.length > word.length) {
        const rest = tag.slice(word.length);
        const u = matchUser(rest, users);
        if (u) { type = mapped; beneficiaryHint = rest; return ' '; }
      }
    }
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

  // A trailing token names a person only when it actually matches a member,
  // so "500 bs café" keeps its description intact.
  const tokens = rest.trim().split(/\s+/).filter(Boolean);
  if (!beneficiaryHint && tokens.length > 1) {
    const last = tokens[tokens.length - 1];
    if (matchUser(last, users)) {
      beneficiaryHint = last.replace(/[.,;:]$/, '');
      tokens.pop();
    }
  }
  const description = tokens.join(' ').trim() || null;

  // No hashtag: naming someone means a loan, otherwise it is a personal expense.
  if (!type) type = beneficiaryHint ? 'PRESTAMO' : 'MIO';

  return { amount, currency, description, type, beneficiaryHint };
}
