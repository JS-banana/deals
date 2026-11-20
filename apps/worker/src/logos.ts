import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { eq, products } from '@deals/db';
import type { Icon } from './fetcher.ts';
import type { Ctx, Job } from './runtime.ts';
import { bump, errorMessage, mapPool } from './util.ts';

const MAX_LOGO_BYTES = 512 * 1024;
const MAX_TRIES = 6;

const isSvg = (icon: Icon) => icon.type?.includes('svg') || /\.svg(\?|$)/i.test(icon.href);
const isIco = (icon: Icon) =>
  /x-icon|microsoft\.icon/i.test(icon.type ?? '') || /\.ico(\?|$)/i.test(icon.href);

/**
 * Candidate URLs, best first: apple-touch-icon (largest), then raster icons that are big enough,
 * then SVG, then small rasters, then .ico files, finally /favicon.ico.
 */
export function rankIcons(icons: readonly Icon[], baseUrl: string): string[] {
  const tier = (icon: Icon): number => {
    if (icon.rel === 'apple-touch-icon') return 0;
    if (isSvg(icon)) return 2;
    if (isIco(icon)) return 4;
    return icon.size === 0 || icon.size >= 64 ? 1 : 3;
  };
  const sorted = icons
    .map((icon, order) => ({ icon, order, tier: tier(icon) }))
    .sort((a, b) => a.tier - b.tier || b.icon.size - a.icon.size || a.order - b.order);
  const urls = sorted.map((s) => s.icon.href);
  urls.push(new URL('/favicon.ico', baseUrl).href);
  return [...new Set(urls)];
}

/** File extension from the bytes themselves; null when it is not a recognised image. */
export function sniffImage(
  body: Uint8Array,
): 'png' | 'jpg' | 'gif' | 'webp' | 'ico' | 'svg' | null {
  const at = (i: number) => body[i] ?? -1;
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'png';
  if (at(0) === 0xff && at(1) === 0xd8) return 'jpg';
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46) return 'gif';
  if (at(0) === 0x52 && at(1) === 0x49 && at(8) === 0x57 && at(9) === 0x45) return 'webp';
  if (at(0) === 0 && at(1) === 0 && at(2) === 1 && at(3) === 0) return 'ico';
  const head = new TextDecoder().decode(body.subarray(0, 1024));
  if (/<svg[\s>]/i.test(head)) return 'svg';
  return null;
}

async function downloadLogo(ctx: Ctx, url: string) {
  const res = await ctx.fetcher.raw(url, { accept: 'image/*', maxBytes: MAX_LOGO_BYTES });
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  if (!/^image\//i.test(res.contentType)) throw new Error(`not an image (${res.contentType})`);
  if (res.truncated) throw new Error('larger than 512 KB');
  const ext = sniffImage(res.body);
  if (!ext) throw new Error('unrecognised image data');
  return { ext, body: res.body };
}

export const logos: Job = async (ctx) => {
  const rows = (await ctx.db.select().from(products)).filter((p) => !p.logoPath && p.website);
  const todo = ctx.limit ? rows.slice(0, ctx.limit) : rows;
  ctx.stats.products = todo.length;
  const mediaDir = ctx.config.mediaDir;
  if (!mediaDir) throw new Error('MEDIA_DIR is not set');
  if (!path.isAbsolute(mediaDir)) throw new Error('MEDIA_DIR must be an absolute path');

  await mapPool(
    todo,
    3,
    ctx.signal,
    async (product) => {
      if (!product.website) return;
      const page = await ctx.fetcher.page(product.website);
      const candidates = rankIcons(page.icons, page.url);
      let lastError = 'no candidates';
      for (const url of candidates.slice(0, MAX_TRIES)) {
        if (ctx.signal.aborted) return;
        try {
          const { ext, body } = await downloadLogo(ctx, url);
          const relative = `logos/${product.slug}.${ext}`;
          if (ctx.dryRun)
            ctx.log(`${product.slug}: would save ${relative} (${body.length} B) from ${url}`);
          else {
            await mkdir(path.join(mediaDir, 'logos'), { recursive: true });
            await writeFile(path.join(mediaDir, relative), body);
            await ctx.db
              .update(products)
              .set({ logoPath: relative })
              .where(eq(products.id, product.id));
            ctx.log(`${product.slug}: ${relative} from ${url}`);
          }
          bump(ctx.stats, 'logos');
          return;
        } catch (error) {
          if (ctx.signal.aborted) return;
          lastError = `${url}: ${errorMessage(error)}`;
        }
      }
      bump(ctx.stats, 'failed');
      ctx.log(`${product.slug}: no logo (${lastError})`);
    },
    (product, error) => {
      bump(ctx.stats, 'errors');
      ctx.log(`${product.slug}: ${errorMessage(error)}`);
    },
  );
};
