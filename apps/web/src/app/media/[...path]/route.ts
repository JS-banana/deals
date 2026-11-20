import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

/**
 * Serves downloaded logos from MEDIA_DIR. Files come from third-party sites, so they are served
 * with a locked-down CSP, `nosniff` and only a fixed set of image types.
 */
const TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};

const notFound = () => new Response('Not found', { status: 404 });

const unsafe = (segment: string) =>
  segment === '' ||
  segment === '.' ||
  segment === '..' ||
  segment.includes('/') ||
  segment.includes('\\') ||
  segment.includes('\0') ||
  path.isAbsolute(segment);

export async function GET(_request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await context.params;
  const root = process.env.MEDIA_DIR;
  if (!root || segments.length === 0 || segments.some(unsafe)) return notFound();

  const type = TYPES[path.extname(segments.at(-1) ?? '').toLowerCase()];
  if (!type) return notFound();

  try {
    // Resolve symlinks on both sides so a link inside MEDIA_DIR cannot lead out of it.
    const base = await realpath(root);
    const file = await realpath(path.join(base, ...segments));
    if (!file.startsWith(base + path.sep)) return notFound();
    const body = await readFile(file);
    return new Response(new Uint8Array(body), {
      headers: {
        'Content-Type': type,
        'Content-Length': String(body.length),
        'Cache-Control': 'public, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      },
    });
  } catch {
    return notFound();
  }
}
