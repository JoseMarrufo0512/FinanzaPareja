// Parsing of pasted bank statements (Banesco / BDV / Mercantil / Pago Móvil…).
// The format varies wildly between banks, so the parser is deliberately loose:
// it looks for a date, an amount and whatever text is left as the description.

const MONTHS = {
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6,
  jul: 7, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12,
};

// Venezuelan numbers use "." for thousands and "," for decimals: 1.234,56
export function parseAmount(raw) {
  if (!raw) return null;
  let s = String(raw).trim().replace(/\s/g, '');
  const negative = /^-/.test(s) || /^\(.*\)$/.test(s);
  s = s.replace(/[()\-+]/g, '').replace(/(bs|ves|usd|\$|€)/gi, '');
  if (!s) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');       // 1.234,56
  else if (lastDot > lastComma) s = s.replace(/,/g, '');                      // 1,234.56
  else s = s.replace(/[.,]/g, '');
  const n = Number(s);
  if (!isFinite(n) || n === 0) return null;
  return { amount: Math.abs(n), negative };
}

function parseDate(line) {
  let m = line.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (m) {
    const [, d, mo, y] = m;
    const year = y.length === 2 ? 2000 + Number(y) : Number(y);
    return { iso: `${year}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`, text: m[0] };
  }
  m = line.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return { iso: m[0], text: m[0] };
  m = line.match(/(\d{1,2})\s*[-/ ]\s*([a-zA-Z]{3})[a-zA-Z]*\s*[-/ ]?\s*(\d{2,4})?/);
  if (m && MONTHS[m[2].toLowerCase()]) {
    const year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : new Date().getFullYear();
    return { iso: `${year}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`, text: m[0] };
  }
  return null;
}

// Returns { lines: [{ raw, date, description, amount, negative, reference }], unparsed }
export function parseStatement(text) {
  const lines = [];
  let unparsed = 0;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.length < 4) continue;
    // Skip obvious headers
    if (/^(fecha|descripci|referencia|saldo|movimient|estado de cuenta)/i.test(line) && !/\d{2}[/-]\d{2}/.test(line)) continue;

    const date = parseDate(line);
    const withoutDate = date ? line.replace(date.text, ' ') : line;

    // Money tokens only: something with decimals or thousand separators, taken
    // as a whole so a reference like "998877" is never split into "998" + "877".
    const MONEY = new RegExp([
      String.raw`(?<![\w.,])-?\(?\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?\)?(?![\w])`,  // 1.234,56
      String.raw`(?<![\w.,])-?\(?\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?\)?(?![\w])`,  // 1,234.56
      String.raw`(?<![\w.,])-?\(?\d+[.,]\d{1,2}\)?(?![\w.,])`,                  // 250,00
    ].join('|'), 'g');
    let candidates = (withoutDate.match(MONEY) || [])
      .map(n => ({ raw: n, ...(parseAmount(n) || {}) }))
      .filter(c => c.amount);

    // Nothing with decimals: accept a short bare integer (never a reference).
    if (!candidates.length) {
      candidates = (withoutDate.match(/(?<![\w.,])-?\(?\d{1,6}\)?(?![\w.,])/g) || [])
        .map(n => ({ raw: n, ...(parseAmount(n) || {}) }))
        .filter(c => c.amount);
    }
    if (!candidates.length) { unparsed++; continue; }

    // Statements often print "movimiento  saldo". A single negative token is the
    // movement; otherwise, between the last two, the smaller one is the movement.
    const negatives = candidates.filter(c => c.negative);
    let pick;
    if (negatives.length === 1) pick = negatives[0];
    else if (candidates.length > 1) {
      const [a, b] = candidates.slice(-2);
      pick = a.amount <= b.amount ? a : b;
    } else pick = candidates[0];

    const reference = (line.match(/\b(?:ref|referencia|op|operaci[oó]n)[.:# ]*(\d{4,})/i) || [])[1]
      || (line.match(/\b(\d{8,})\b/) || [])[1] || null;

    const description = line
      .replace(date?.text || '', ' ')
      .replace(pick.raw, ' ')
      .replace(/\s{2,}/g, ' ')
      .replace(/^[\s|,;-]+|[\s|,;-]+$/g, '')
      .slice(0, 120) || null;

    lines.push({
      raw: line,
      date: date?.iso || null,
      description,
      amount: pick.amount,
      negative: pick.negative !== false,
      reference,
    });
  }
  return { lines, unparsed };
}

// Score how well a statement line matches a recorded expense (0..1).
export function matchScore(line, tx, txAmount) {
  const amountDiff = Math.abs(Number(txAmount) - line.amount);
  const tolerance = Math.max(0.02, line.amount * 0.005); // 0.5% or 2 cents
  if (amountDiff > tolerance) return 0;

  let score = 0.7; // amount is the strong signal
  if (line.date && tx.transaction_date) {
    const days = Math.abs(new Date(line.date) - new Date(tx.transaction_date)) / 86400000;
    if (days <= 1) score += 0.2;
    else if (days <= 3) score += 0.12;
    else if (days <= 7) score += 0.05;
    else score -= 0.15;
  }
  if (line.reference && tx.description && tx.description.includes(line.reference)) score += 0.2;
  const desc = (tx.description || '').toLowerCase();
  const lineDesc = (line.description || '').toLowerCase();
  if (desc && lineDesc) {
    const words = lineDesc.split(/\s+/).filter(w => w.length > 3);
    if (words.some(w => desc.includes(w))) score += 0.1;
  }
  return Math.min(1, score);
}
