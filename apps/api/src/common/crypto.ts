import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Derives a secure password hash using scrypt with a random 16-byte salt.
 * Formatted as salt:hash
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derivedKey}`;
}

/**
 * Validates a password against an existing salt:hash string using timing-safe comparison.
 */
export function verifyPassword(password: string, combinedHash: string): boolean {
  if (!combinedHash || !password) return false;
  const parts = combinedHash.split(':');
  if (parts.length !== 2) return false;
  const salt = parts[0];
  const key = parts[1];
  if (!salt || !key) return false;

  try {
    const keyBuffer = Buffer.from(key, 'hex');
    const derivedKey = scryptSync(password, salt, 64);
    if (keyBuffer.length !== derivedKey.length) return false;
    return timingSafeEqual(keyBuffer, derivedKey);
  } catch {
    return false;
  }
}
