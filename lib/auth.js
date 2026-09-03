import crypto from 'crypto';

// Hash a PIN using scrypt with a random salt. Returns "salt:hash".
export function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pin), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

// Verify a PIN against a stored "salt:hash" using constant-time comparison.
export function verifyPin(pin, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const hb = Buffer.from(hash, 'hex');
  const computed = crypto.scryptSync(String(pin), salt, 64);
  if (hb.length !== computed.length) return false;
  return crypto.timingSafeEqual(computed, hb);
}

// Generate an opaque session token.
export function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Constant-time string comparison (for webhook secrets etc).
export function safeEqual(a, b) {
  const ab = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
