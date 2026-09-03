import Decimal from 'decimal.js';

Decimal.set({ precision: 30, rounding: Decimal.ROUND_HALF_UP });

export function D(v) {
  if (v === null || v === undefined || v === '') return new Decimal(0);
  return new Decimal(v.toString());
}

export function toUsd(amount, currency, rateUsdPerUnit) {
  // rateUsdPerUnit = how many USD per 1 unit of the given currency? No, we use:
  //  - for USD: identity (rate=1)
  //  - for BS or EUR->USD: applied_rate is stored as "units of ORIGINAL per 1 USD" (VES per USD)
  //  - for EUR: we store rate as "BS per 1 EUR" if using BCV; but simpler: rate = EUR->USD (or BS per USD)
  // To keep it uniform: applied_rate is expressed as "units of original_currency per 1 USD".
  //   So amount_usd = original_amount / rate  (except when original_currency=USD, rate=1).
  //   For EUR we could store USD per EUR, but to keep single logic:
  //     amount_usd = original_amount / rate, rate is always original_currency_per_USD.
  const amt = D(amount);
  const rate = D(rateUsdPerUnit);
  if (currency === 'USD') return amt.toDecimalPlaces(2).toString();
  if (rate.isZero()) return amt.toDecimalPlaces(2).toString();
  return amt.div(rate).toDecimalPlaces(2).toString();
}

export function usdToUsdt(amountUsd, usdtRateVesPerUsdt, usdRateVesPerUsd) {
  // amount in USD -> convert to VES using USD rate -> convert to USDT using USDT rate
  const usd = D(amountUsd);
  const usdtRate = D(usdtRateVesPerUsdt);
  const usdRate = D(usdRateVesPerUsd);
  if (usdtRate.isZero() || usdRate.isZero()) return usd.toDecimalPlaces(2).toString();
  const ves = usd.mul(usdRate);
  return ves.div(usdtRate).toDecimalPlaces(2).toString();
}

export function fmt(v, digits = 2) {
  return D(v).toDecimalPlaces(digits).toString();
}
