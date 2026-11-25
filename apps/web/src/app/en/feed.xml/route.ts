export const dynamic = 'force-dynamic';

export const GET = () =>
  new Response(null, {
    status: 308,
    headers: { Location: '/feed.xml', 'Cache-Control': 'public, max-age=86400' },
  });
