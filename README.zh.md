<div align="center">

<img src="apps/web/src/app/icon.svg" alt="" width="48" height="48" />

# 好价清单 · Deal Index

从黑五、网一到常年优惠，查清软件首期付多少、续费怎么算、老用户能不能用。

[浏览优惠](https://deals.laifuyou.com/zh) · [订阅 RSS](https://deals.laifuyou.com/zh/feed.xml) · [English README](README.md)

[![CI](https://github.com/JS-banana/deals/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/JS-banana/deals/actions/workflows/ci.yml)
[![MIT 许可证](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

</div>

![好价清单首页：展示顶部搜索框、分类与状态筛选栏以及带价格、优惠码和倒计时的软件优惠卡片](docs/images/home-zh.png)

## 功能亮点

- **快速检索与精准筛选**：通过首页搜索框或 `⌘K` 全站搜索直达目标软件，支持按分类、活动状态、是否可买断及老用户资格一键筛选。
- **报价透明可对比**：保留商家原币种与计费周期，优惠码一键复制；选中 2–3 款优惠即可并排对比续费、适用对象与条款，有跟踪记录时可查看历史价格曲线。
- **无登录收藏与众包纠错**：收藏记录保存在当前浏览器本地，无需账号；详情页支持有效性投票，页脚支持直接提交新优惠线索。
- **双语与订阅支持**：内置中文（源稿）与英文站点，支持浅色 / 深色主题切换及 RSS 订阅。

## 数据采集与审核

Worker 每天定时抓取多渠道社区清单、社区帖与公开线索，并定期复查已收录优惠的商家页面。AI 负责提取条款、撰写中文摘要并翻译为英文，程序再对价格、折扣和引文做确定性核验。

所有新增与变更都会先进入提案队列，默认由维护者在 `/admin` 审核通过后发布，并保留价格观测记录。[采集与翻译流程](docs/pipeline.md) · [反馈与纠错](https://github.com/JS-banana/deals/issues)

## 本地运行

需要 Node.js 22.18 或更高版本、pnpm 12.21.0，以及带 Compose 的 Docker。在仓库根目录运行以下命令，即可用内置示例数据预览站点：

```sh
pnpm install --frozen-lockfile
cp -n .env.example .env
LLM_API_KEY=unused pnpm db:up --wait
pnpm db:migrate
pnpm db:seed
SITE_URL=http://localhost:3000 pnpm dev
```

打开 [本地中文站点](http://localhost:3000/zh)（默认英文站点在 `http://localhost:3000`）即可浏览优惠；访问 [审核后台](http://localhost:3000/admin) 时使用 `.env` 中的 `ADMIN_USER` 与 `ADMIN_PASSWORD` 登录。

本地预览仅启动 PostgreSQL 与 Web。Compose 解析配置时会校验 Worker 密钥，因此数据库启动命令传入 `unused` 占位；若需运行采集或翻译任务，请先在 `.env` 中配置有效的 `LLM_*` 参数。

## 自托管与项目结构

在生产环境的 `.env` 中配置 `SITE_URL`、`POSTGRES_PASSWORD`、后台凭据及模型密钥后，通过 Docker Compose 一键构建启动：

```sh
docker compose up -d --build
```

Compose 会先执行数据库迁移，再启动 Web（默认监听 `127.0.0.1:3100` 供反向代理转发）与定时 Worker。首次部署若需导入内置数据，可执行 `docker compose run --rm migrate node packages/db/src/seed.ts`。

| 目录                            | 职责                                                     |
| :------------------------------ | :------------------------------------------------------- |
| [apps/web](apps/web/)           | Next.js 前台展示、中英双语站点、RSS 与 `/admin` 审核后台 |
| [apps/worker](apps/worker/)     | 多源抓取、AI 提取核验、翻译流水线、图标同步与定时调度    |
| [packages/core](packages/core/) | 领域模型、Zod 校验、状态/时区计算与价格格式化（纯函数）  |
| [packages/db](packages/db/)     | Drizzle ORM Schema、数据库迁移与审核发布事务             |

更多配置：[环境变量示例](.env.example) · [Compose 配置](compose.yaml) · [Nginx、部署与备份脚本](deploy/) · [贡献指南与提交前检查](CONTRIBUTING.md)
