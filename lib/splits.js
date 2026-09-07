import { D } from './money';

// Split `amount` into `n` shares of 2 decimals that add up EXACTLY to `amount`.
// The leftover cents (at most n-1) are handed to the first shares, so
// 10.00 / 3 => ["3.34", "3.33", "3.33"].
export function splitEqually(amount, n) {
  const total = D(amount).toDecimalPlaces(2);
  if (!n || n < 1) return [];
  if (n === 1) return [total.toFixed(2)];
  const cents = total.mul(100).toDecimalPlaces(0).toNumber();
  const base = Math.trunc(cents / n);
  let rest = cents - base * n; // sign follows `cents`; amounts here are always >= 0
  const out = [];
  for (let i = 0; i < n; i++) {
    let c = base;
    if (rest > 0) { c += 1; rest -= 1; }
    out.push(D(c).div(100).toFixed(2));
  }
  return out;
}

// Who participates in a transaction, and for how much.
// - NOS:      every active member shares equally (Modo Familia).
// - MIO:      the owner alone (beneficiary when the expense was tagged for
//             someone else, e.g. "#Mio A", otherwise the payer).
// - PRESTAMO: the beneficiary owes the payer the whole amount.
// Returns [{ user_id, share_usd, share_usdt }]
export function computeSplits({ type, payer_id, beneficiary_id, amount_usd, amount_usdt, activeUserIds, participantIds }) {
  const usd = D(amount_usd);
  const usdt = amount_usdt === null || amount_usdt === undefined ? null : D(amount_usdt);

  if (type === 'NOS') {
    const ids = (participantIds && participantIds.length ? participantIds : activeUserIds) || [];
    const members = [...new Set(ids)];
    if (!members.length) return [];
    const usdShares = splitEqually(usd, members.length);
    const usdtShares = usdt ? splitEqually(usdt, members.length) : null;
    return members.map((uid, i) => ({
      user_id: uid,
      share_usd: usdShares[i],
      share_usdt: usdtShares ? usdtShares[i] : null,
    }));
  }

  if (type === 'PRESTAMO') {
    if (!beneficiary_id) return [];
    return [{ user_id: beneficiary_id, share_usd: usd.toFixed(2), share_usdt: usdt ? usdt.toFixed(2) : null }];
  }

  // MIO
  const owner = beneficiary_id || payer_id;
  if (!owner) return [];
  return [{ user_id: owner, share_usd: usd.toFixed(2), share_usdt: usdt ? usdt.toFixed(2) : null }];
}

// Turn per-user net positions into a minimal list of "A pays B" transfers.
// balances: { [user_id]: Decimal-ish net } where positive = others owe them.
// Greedy largest-creditor / largest-debtor matching: at most n-1 transfers.
export function settleUp(balances) {
  const creditors = [];
  const debtors = [];
  for (const [uid, val] of Object.entries(balances)) {
    const v = D(val).toDecimalPlaces(2);
    if (v.gt(0.005)) creditors.push({ uid, amt: v });
    else if (v.lt(-0.005)) debtors.push({ uid, amt: v.neg() });
  }
  creditors.sort((a, b) => b.amt.cmp(a.amt));
  debtors.sort((a, b) => b.amt.cmp(a.amt));

  const transfers = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Decimal_min(debtors[i].amt, creditors[j].amt);
    if (pay.gt(0.005)) {
      transfers.push({ from: debtors[i].uid, to: creditors[j].uid, amount_usd: pay.toFixed(2) });
    }
    debtors[i].amt = debtors[i].amt.minus(pay);
    creditors[j].amt = creditors[j].amt.minus(pay);
    if (debtors[i].amt.lte(0.005)) i++;
    if (creditors[j].amt.lte(0.005)) j++;
  }
  return transfers;
}

function Decimal_min(a, b) { return a.lte(b) ? a : b; }
