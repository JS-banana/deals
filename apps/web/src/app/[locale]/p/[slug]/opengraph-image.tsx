import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { formatMoney } from '@deals/core';
import { ImageResponse } from 'next/og';
import { getProductDeals } from '@/lib/data';
import { categoryName, mainDeal } from '@/lib/deal-view';

export const alt = 'Deal Index';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/*
 * Social card in the brand colors. Images cannot read CSS variables, so the palette below mirrors
 * the `hero` and `brand` tokens in globals.css. Text stays Latin because the built-in font has no
 * CJK glyphs; the Chinese page shares the same card.
 */
const FOREST = '#122d1d';
const LIME = '#dcff4a';
const LIME_INK = '#16211a';
const PAPER = '#f4f6ee';
const MUTED = '#a1b4a4';

async function logoDataUrl(logoPath: string | null): Promise<string | null> {
  const root = process.env.MEDIA_DIR;
  if (!logoPath || !root) return null;
  const type = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' }[
    path.extname(logoPath).toLowerCase() as '.png'
  ];
  if (!type || logoPath.split('/').some((part) => part === '..')) return null;
  try {
    const file = await readFile(path.join(root, logoPath));
    return `data:${type};base64,${file.toString('base64')}`;
  } catch {
    return null;
  }
}

export default async function OgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const deal = mainDeal(await getProductDeals(slug), new Date());
  const name = deal?.product.name ?? 'Deal Index';
  const price =
    deal && deal.priceAmount !== null && deal.currency
      ? formatMoney(deal.priceAmount, deal.currency, 'en')
      : null;
  const original =
    deal && deal.originalAmount !== null && deal.currency
      ? formatMoney(deal.originalAmount, deal.currency, 'en')
      : null;
  const discount = deal?.discountPercent
    ? `${deal.discountPercent}% OFF`
    : deal?.discountAmount && deal.currency
      ? `SAVE ${formatMoney(deal.discountAmount, deal.currency, 'en')}`
      : null;
  const logo = await logoDataUrl(deal?.product.logoPath ?? null);
  const category = deal ? categoryName(deal.product.category, 'en') : '';

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: FOREST,
        color: PAPER,
        padding: 72,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <svg width="48" height="48" viewBox="0 0 36 36" role="img" aria-label="Deal Index">
          <rect width="36" height="36" rx="9" fill={LIME} />
          <path d="M9 10h5.5v5.5H9zm10 0h5.5v5.5H19zM9 20h5.5v5.5H9z" fill={FOREST} />
          <path
            d="m19 22 2.4 2.4 5-5.6"
            fill="none"
            stroke={FOREST}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <div style={{ fontSize: 28, letterSpacing: 6, color: MUTED, fontWeight: 600 }}>
          DEAL INDEX
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 36 }}>
        {logo ? (
          // biome-ignore lint/performance/noImgElement: ImageResponse renders plain img elements
          <img
            src={logo}
            width={140}
            height={140}
            alt=""
            style={{ borderRadius: 28, background: PAPER, padding: 12, objectFit: 'contain' }}
          />
        ) : (
          <div
            style={{
              width: 140,
              height: 140,
              borderRadius: 28,
              background: LIME,
              color: LIME_INK,
              fontSize: 80,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {name.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 84, fontWeight: 700, lineHeight: 1.05 }}>{name}</div>
          {category && <div style={{ fontSize: 34, color: MUTED }}>{category}</div>}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
        {price && <div style={{ fontSize: 120, fontWeight: 700, color: LIME }}>{price}</div>}
        {original && (
          <div style={{ fontSize: 44, color: MUTED, textDecoration: 'line-through' }}>
            {original}
          </div>
        )}
        {discount && (
          <div
            style={{
              fontSize: 40,
              fontWeight: 700,
              background: LIME,
              color: LIME_INK,
              borderRadius: 999,
              padding: '10px 28px',
            }}
          >
            {discount}
          </div>
        )}
      </div>
    </div>,
    { ...size },
  );
}
