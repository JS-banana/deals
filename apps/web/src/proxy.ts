import { type NextRequest, NextResponse } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

const handleI18n = createMiddleware(routing);

export default function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === '/admin' || request.nextUrl.pathname.startsWith('/admin/')) {
    return adminGate(request);
  }
  return handleI18n(request);
}

/** HTTP Basic auth for the review console. Credentials come from ADMIN_USER / ADMIN_PASSWORD. */
function adminGate(request: NextRequest) {
  const user = process.env.ADMIN_USER;
  const password = process.env.ADMIN_PASSWORD;
  if (!user || !password)
    return new NextResponse('Admin console is not configured.', { status: 503 });
  const [scheme, encoded] = (request.headers.get('authorization') ?? '').split(' ');
  if (scheme === 'Basic' && encoded) {
    const decoded = atob(encoded);
    const split = decoded.indexOf(':');
    if (
      split > 0 &&
      safeEqual(decoded.slice(0, split), user) &&
      safeEqual(decoded.slice(split + 1), password)
    ) {
      return NextResponse.next();
    }
  }
  return new NextResponse('Authentication required.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="deals-admin", charset="UTF-8"' },
  });
}

function safeEqual(a: string, b: string) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export const config = {
  // Everything except API routes, Next internals, served media and files with an extension.
  matcher: ['/((?!api|_next|_vercel|media|.*\\..*).*)'],
};
