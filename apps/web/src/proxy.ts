import { type NextRequest, NextResponse } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';
import { isAdminAuthorized } from './lib/admin-auth';

const handleI18n = createMiddleware(routing);

export default function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path === '/admin' || path.startsWith('/admin/')) return adminGate(request);
  if (path.endsWith('.txt')) {
    const key = process.env.INDEXNOW_KEY;
    if (key && path === `/${key}.txt` && ['GET', 'HEAD'].includes(request.method)) {
      return new Response(request.method === 'HEAD' ? null : key, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }
    return NextResponse.next();
  }
  return handleI18n(request);
}

/** HTTP Basic auth for the review console. Credentials come from ADMIN_USER / ADMIN_PASSWORD. */
function adminGate(request: NextRequest) {
  const result = isAdminAuthorized(request.headers.get('authorization'));
  if (result === 'unconfigured')
    return new NextResponse('Admin console is not configured.', { status: 503 });
  if (result === 'ok') return NextResponse.next();
  return new NextResponse('Authentication required.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="deals-admin", charset="UTF-8"' },
  });
}

export const config = {
  // Public and admin pages, plus root-level IndexNow ownership files.
  matcher: [
    '/admin/:path*',
    '/((?!api|_next|_vercel|media|.*\\..*).*)',
    '/:key([A-Za-z0-9-]{8,128}).txt',
  ],
};
