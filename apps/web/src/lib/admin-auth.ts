import { createHash, timingSafeEqual } from 'node:crypto';
import { headers } from 'next/headers';

function safeEqual(actual: Buffer, expected: string) {
  const digest = (value: Buffer | string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(actual), digest(expected));
}

export function isAdminAuthorized(
  authHeader: string | null,
): 'ok' | 'unconfigured' | 'unauthorized' {
  const user = process.env.ADMIN_USER;
  const password = process.env.ADMIN_PASSWORD;
  if (!user || !password) return 'unconfigured';
  const encoded = /^Basic +([^\s]+)$/i.exec(authHeader ?? '')?.[1];
  if (!encoded) return 'unauthorized';
  try {
    const credentials = Buffer.from(atob(encoded), 'latin1');
    return safeEqual(credentials, `${user}:${password}`) ? 'ok' : 'unauthorized';
  } catch {
    return 'unauthorized';
  }
}

export async function requireAdmin() {
  if (isAdminAuthorized((await headers()).get('authorization')) !== 'ok')
    throw new Error('Unauthorized');
}
