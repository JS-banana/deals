<div align="center">

<img src="apps/web/src/app/icon.svg" alt="" width="48" height="48" />

# Deal Index · 好价清单

Browse Black Friday, Cyber Monday, and year-round software deals. See what you pay up front, what renewal costs, and whether existing customers qualify.

[Browse deals](https://deals.laifuyou.com/en) · [RSS feed](https://deals.laifuyou.com/en/feed.xml) · [中文 README](README.zh.md)

[![CI](https://github.com/JS-banana/deals/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/JS-banana/deals/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

</div>

![Deal Index homepage showing the hero search bar, single-row category and status filters, and software deal cards with prices, coupon codes, and deadlines](docs/images/home-en.png)

## Features

- **Fast search and focused filters**: Jump straight to any app via the hero search bar or `⌘K`, and narrow listings by category, sale status, lifetime option, or existing-customer eligibility.
- **Clear quotes and side-by-side comparison**: Prices stay in the merchant’s original currency and billing period, with one-click coupon copying. Select 2–3 deals to compare renewals and terms side by side, and inspect price history where tracked.
- **Account-free bookmarks and community feedback**: Saved deals stay locally in your browser with no sign-in required. Visitors can vote on whether an offer still works or submit new deal tips from the footer.
- **Bilingual and feed-ready**: Ships in Chinese (source of truth) and English, with light/dark themes and RSS feeds.

## How deals are collected and reviewed

The worker monitors community lists, developer forums, and submitted tips daily, and revisits merchant pages for active listings. AI extracts deal terms, drafts Chinese copy, and translates listings into English, while deterministic checks verify prices, discounts, and quotes against fetched text.

All new listings and updates enter a proposal queue reviewed in `/admin` before publication, recording price observations over time. [Collection and translation guide (in Chinese)](docs/pipeline.md) · [Report an issue](https://github.com/JS-banana/deals/issues)

## Run locally

Use Node.js 22.18 or later, pnpm 12.21.0, and Docker with Compose. From the root of a fresh clone, run these commands to preview the catalog with the bundled sample data:

```sh
pnpm install --frozen-lockfile
cp -n .env.example .env
LLM_API_KEY=unused pnpm db:up --wait
pnpm db:migrate
pnpm db:seed
SITE_URL=http://localhost:3000 pnpm dev
```

Open the [local English site](http://localhost:3000/en) to browse listings, or sign in to the [review console](http://localhost:3000/admin) using `ADMIN_USER` and `ADMIN_PASSWORD` from the root `.env`.

The local preview runs PostgreSQL and the web app. Compose checks for a worker API key when parsing the configuration, so `unused` satisfies that check during database startup. Set valid `LLM_*` values in `.env` before running collection or translation jobs.

## Self-hosting and project layout

Set `SITE_URL`, `POSTGRES_PASSWORD`, admin credentials, and worker model settings in your production `.env`, then build and start the stack with Docker Compose:

```sh
docker compose up -d --build
```

Compose applies pending migrations before starting the web container (listening on `127.0.0.1:3100` for reverse proxying) and scheduled worker. To seed the bundled catalog on first deployment, run `docker compose run --rm migrate node packages/db/src/seed.ts`.

| Package                         | Responsibility                                                                    |
| :------------------------------ | :-------------------------------------------------------------------------------- |
| [apps/web](apps/web/)           | Next.js catalog, bilingual zh/en routes, RSS feeds, and `/admin` review console   |
| [apps/worker](apps/worker/)     | Multi-source ingestion, AI extraction/checks, translation pipeline, and logo sync |
| [packages/core](packages/core/) | Domain schemas, Zod validation, status/timezone logic, and money formatting       |
| [packages/db](packages/db/)     | Drizzle ORM schema, SQL migrations, and proposal approval transactions            |

More references: [Environment settings](.env.example) · [Compose configuration](compose.yaml) · [Nginx, deployment, and backup scripts](deploy/) · [Contribution guide (in Chinese)](CONTRIBUTING.md)
