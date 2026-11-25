# Agent 工作指南 · Deal Index（好价清单）

本仓库是「好价清单 · Deal Index」的 pnpm Monorepo，采用中文为唯一源稿、英文由翻译管线自动生成的架构。

## 仓库结构与职责边界

- `packages/core`：领域模型、Zod 校验规则、活动状态/时区计算、列表筛选排序与金额格式化（纯函数，无 IO）。
- `packages/db`：Drizzle ORM 表结构、迁移文件、查询与审核发布事务（`approveProposal` / `rejectProposal`）。
- `apps/worker`：可配置的 GitHub、RSS 和社区来源、线索初筛、AI 抽取、规则核验、独立 AI 审校、翻译记忆与质量流水线、图标下载、IndexNow 与定时调度。
- `apps/web`：Next.js 16 App Router 公开站点（`next-intl` 中英双语）、`/admin` 审核与审计后台、SEO/RSS/Sitemap。修改本目录前请务必阅读 `apps/web/AGENTS.md`。

## 核心架构约定

本仓库当前已落地的关键架构与行为约束如下：

1. Worker 的每一跳商家访问都绑定已校验公网地址，独立审校、字段核验和影子回放适用于所有来源。
2. 后台入口与 Server Actions 分别鉴权。公开读缓存 60 秒，后台写入刷新标签。清理快照必须保留最新和已引用的证据。
3. 公开产品页兼容旧链接，并通过 `?offer=<id>` 指向具体报价；搜索、收藏、对比、双语和分享需保持所选报价。
4. 数据库按 `(productId, eventId, offerKey)` 区分优惠。来源先进入 `raw_signals`，主 GitHub 黑五清单以 `curated: true` 跳过模型初筛，覆盖课程、电子书、模板和设计素材等数字优惠。其他来源经初筛后按商家档位等报价事实去重。通过 `review-pending` 重审待审提案，`recheck` 跟进仍未结束的季节专题中报价已全部结束的精选产品（`rank <= 50`）。AI 新报价继承同产品同活动已发布报价的最低精选排名（`rank < 1000`）。操作命令见 [数据管线](docs/pipeline.md)。

## 核心工程红线

- **保留提案审计留痕**：Worker 任何自动发布或自动拒绝都必须经过 `proposals` 表与 `approveProposal` / `rejectProposal` 事务，禁止绕过提案直接改写 `deals` 表。
- **灰度开关与单源隔离**：新增、更新、拒绝分别由 `AUTO_APPROVE_CREATE`、`AUTO_APPROVE_UPDATE`、`AUTO_REJECT_ENABLED` 控制，默认全关并持续记录影子拟判，上线前须运行 `pnpm worker audit-eval --sample 15` 与 `--dry-run` 验证；每个外部数据源适配器独立开关与独立游标，缺密钥自动跳过、单源失败不得阻断其他源。
- **确定性规则优先于模型自评**：自动发布为 `verified: true` 须逐字段核对商家原文及对应引文，普通社区来源缺少商家证据时转人工。精选 GitHub 清单的新增提案可用逐字上游引文补充商家未写明的事实，商业字段须通过确定性检查且商家页不得与报价冲突或声明优惠已结束，此类发布标为 `verified: false`。商家页与社区文本一律作为不可信数据处理，严禁触发内网 SSRF 或 Prompt Injection。
- **可回放审批**：保留原始 payload、审校输入与精确 snapshotId，清理快照跳过被引用记录。人工发布稿另存 approvedPayload。更新对 changes 逐字段 CAS，冲突留待审。商家明确结束使用 observedEndedAt，优先判为 ended，保留原定截止时间。
- **双语文案键同步**：修改 `apps/web/messages/zh.json` 时必须同步维护 `apps/web/messages/en.json`，确保 `messages.test.ts` 通过。
- **数据库变更规范**：修改 `packages/db/src/schema.ts` 后必须运行 `pnpm db:generate` 生成迁移，避免破坏性列变更。

## 变更验收命令

每次提交前必须全部通过：

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```
