# 好价清单 · Deal Index

[deals.laifuyou.com](https://deals.laifuyou.com) · 中文 / [English](https://deals.laifuyou.com/en)

全球软件优惠目录。按用途比较实付价格、折扣、续费条件、优惠码和截止日期，每条优惠都能追溯到来源。数据每天自动更新：AI 起草提取和翻译，人工审核后发布。

## 架构

```
apps/
  web/        Next.js 16（App Router）+ Tailwind CSS 4 + shadcn/ui + next-intl（中文默认，/en 英文）
              公开站点、/admin 审核后台、/media 产品图标、RSS、站点地图
  worker/     数据管线：上游同步 → 抓取商家页 → AI 提取 → 规则校验 → 提案；复查、翻译、图标、定时任务
packages/
  core/       领域模型与规则：zod 数据格式、活动状态与时区、筛选排序、金额格式（含单元测试）
  db/         Drizzle 表结构、迁移、查询、审核发布事务、初始数据
deploy/       服务器部署：拉取式自动部署、数据库备份、systemd 定时器、nginx 站点
compose.yaml  生产环境：postgres + migrate + web + worker
```

三类核心数据：**产品**（长期存在，积累历年优惠）、**活动**（黑五网一、常年优惠……）、**优惠**（某产品在某活动中的报价）。价格以金额、币种和计费周期存储，展示时按语言格式化。

worker 不直接改动已发布数据：新增、变更和异常都以**提案**形式进入 `/admin` 审核队列，附带字段差异和原文证据，通过后才会发布。

## 本地开发

需要 Node.js 22.18+（推荐 24）、pnpm 12 和 Docker。

```sh
pnpm install
cp .env.example .env          # 填写 POSTGRES_PASSWORD、DATABASE_URL、MEDIA_DIR（绝对路径）等
pnpm db:up                    # 启动本地 Postgres（127.0.0.1:54329）
set -a && . ./.env && set +a
pnpm db:migrate && pnpm db:seed
pnpm dev                      # http://localhost:3000，后台在 /admin
```

常用命令：`pnpm lint`（Biome）、`pnpm typecheck`、`pnpm test`（Vitest）、`pnpm build`。修改 `packages/db/src/schema.ts` 后运行 `pnpm db:generate` 生成迁移。

## 数据管线

在 `apps/worker` 下运行 `node src/main.ts <job>`，需要先加载 `.env`：

| 任务 | 作用 |
|---|---|
| `sync-upstream` | 从社区清单同步新条目，抓取商家页，用 AI 提取结构化字段和中英文文案，校验后提交审核 |
| `recheck` | 复查已发布优惠的商家页：记录价格历史；有变化时提交更新提案，失效时提交异常提案 |
| `translate` | 为已发布内容补齐英文 |
| `logos` | 下载产品图标 |
| `daily` | 依次执行以上任务 |
| `schedule` | 常驻进程：每天 06:10 执行 `daily`，14:10、22:10 执行 `recheck`（北京时间） |

模型通过兼容 OpenAI 的 `/chat/completions` 接口调用（`LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`），智谱 GLM 和 DeepSeek 都可以。

## 部署

服务器上的目录为 `~/projects/deals`，`.env` 只保存在服务器上，权限为 600。

```sh
git clone https://github.com/JS-banana/deals.git ~/projects/deals && cd ~/projects/deals
cp .env.example .env && chmod 600 .env   # 填写生产配置
docker compose up -d --build
docker compose run --rm migrate node packages/db/src/seed.ts   # 首次部署导入初始数据
```

- **自动部署**：`deals-deploy.timer` 每 3 分钟检查一次 `origin/main`，对应提交的 CI 通过后构建并重启；健康检查失败会回滚到上一个版本。手动执行：`deploy/deploy.sh --force`。
- **备份**：`deals-backup.timer` 每天 04:30 导出数据库到 `~/backups/deals`，保留 14 天。
- **对外访问**：web 只监听 `127.0.0.1:3100`，由 nginx（`deploy/nginx/`）和 certbot 提供 HTTPS，前面是 Cloudflare。

安装定时器：

```sh
cp deploy/systemd/*.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now deals-deploy.timer deals-backup.timer
```

## 反馈

价格变化、链接失效或想推荐优惠，请提交 [Issue](https://github.com/JS-banana/deals/issues)。

## 许可证

源码采用 [MIT 许可证](LICENSE)。各商家的产品名称、商标和活动条款归各自权利人所有。
