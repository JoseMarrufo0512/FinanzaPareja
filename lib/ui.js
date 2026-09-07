'use client';

// Shared helpers for the client components.

export const api = async (path, options = {}) => {
  const r = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Error de servidor');
  return data;
};

export const CURRENCIES = ['USD', 'BS', 'EUR', 'USDT'];

export const TX_TYPES = [
  { code: 'NOS', label: '#Nos', desc: 'Se reparte entre los miembros', icon: '👫' },
  { code: 'MIO', label: '#Mio', desc: 'Gasto personal de alguien', icon: '🧑' },
  { code: 'PRESTAMO', label: '#Prestamo', desc: 'Se congela en USDT', icon: '❄️' },
];

export function currencySymbol(c) {
  return { USD: '$', BS: 'Bs.', EUR: '€', USDT: '₮' }[c] || c;
}

export function fmtNum(v, d = 2) {
  const n = Number(v || 0);
  return n.toLocaleString('es-VE', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function fmtMoney(v, currency, d = 2) {
  const sym = currencySymbol(currency);
  return currency === 'BS' || currency === 'USDT'
    ? `${fmtNum(v, d)} ${currency === 'BS' ? 'Bs' : '₮'}`
    : `${sym}${fmtNum(v, d)}`;
}

// Avatar colour per member, kept stable by their stored colour.
export function initials(user) {
  if (!user) return '?';
  return (user.short || user.name || '?').slice(0, 2).toUpperCase();
}
