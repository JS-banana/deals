# 好价清单 · Deal Index 架构升级与体验优化实施方案

> Phase 1–4 已在工作区实现。采集、影子回放和多优惠并存在隔离库验收，中文和英文交互在本地浏览器验收。生产启用仍按来源和审批类型分别放量。运行入口见 [数据管线](pipeline.md)。

---

## 0. 全局目标与执行红线

### 核心目标

1. **Worker 自治化（Phase 1）**：将「AI 抽取 → 人工逐条审批」升级为「AI 抽取 → 确定性规则核验 → 独立 AI Auditor 复审 → 分级自动发布 / 异常兜底」，解放人工精力，同时保持线上数据高准确率。
2. **后台与抓取安全加固（Phase 2）**：修复重定向 SSRF、Admin 鉴权健壮性与深度防御、公开查询缓存抗突发流量、快照正文清理及遗留产物整理。
3. **前端 UI 与交互打磨（Phase 3）**：消除首页双搜索框冲突、优化对比栏移动端体验与满额反馈、修复拦截弹窗水合闪切、优化价格走势图表达。
4. **多源情报台演进（Phase 4）**：打破单一 GitHub 上游源与「仅标价打折」的模型限制，接入多 GitHub 清单、Reddit 社区板块、Hacker News、大厂官方 RSS、X (Twitter) 定向监控与主动搜索发现，引入廉价模型 `Signal Triage` 去噪去重，扩展免费额度/API 赠金类型，并补齐社区有效性投票、`⌘K` 全局搜索与用户群推送。

### 执行红线（Agent 必须遵守）

- **绝不绕过 `proposals` 表直接修改 `deals`**：AI 自动审批和自动拒绝必须仍走 `fileProposal` + `approveProposal` / `rejectProposal` 事务，保留完整审计记录、差异和原文证据，便于事后抽检与回滚。
- **渐进式 Schema 迁移**：Phase 1 以可空列保存审计与结束观测，旧提案缺失的输入按不可回放处理；Phase 4 涉及 `deals` 新字段与 `deal_votes` / `raw_signals` 新表时，必须提供向后兼容默认值并运行 `pnpm db:generate` 生成 Drizzle 迁移文件。
- **灰度可控**：新增、更新、拒绝分别受 `AUTO_APPROVE_CREATE`、`AUTO_APPROVE_UPDATE`、`AUTO_REJECT_ENABLED` 控制，默认均为 false，各外部数据源适配器独立开关（缺密钥时自动跳过、不阻断主流程），支持 `--dry-run` 预演和 `audit-eval` 离线回归评估。
- **代码规范**：所有修改必须通过 `pnpm lint`（Biome）、`pnpm typecheck`、`pnpm test`（Vitest）与 `pnpm build`。
- **双语同步**：任何新增前台文案必须同步更新 `apps/web/messages/zh.json` 与 `apps/web/messages/en.json`，确保 `apps/web/messages/messages.test.ts` 通过。
- **Next.js 16 约定**：修改 `apps/web` 时请先阅读 `apps/web/AGENTS.md` 及 `apps/web/node_modules/next/dist/docs/` 中的相关 API 文档。

---

## Phase 1：Worker AI 自动审校与分级发布

### 1.1 审校与影子模式

提取或复查得到候选后，独立审校模型只核查原稿。页面、引文与上游文本均作为不可信数据。配置完整的 `REVIEW_BASE_URL`、`REVIEW_API_KEY`、`REVIEW_MODEL` 可选择独立模型，否则复用翻译模型配置。模型失败转人工。

拟判独立于执行开关。拟发布要求审校通过、总分至少 85（受准确性和条款分上限约束）、抽取置信度至少 0.8、无审校问题、丢弃证据或确定性异常。发布为 `verified: true` 时，已填价格、原价、折扣、优惠码、日期、`benefitSummary` 和其他条款均须有对应的商家页逐字引文。普通来源缺少商家证据时转人工。

精选 GitHub 清单的新增提案允许使用逐字上游引文补充商家页遗漏的事实，核验通过后发布为 `verified: false`。报价金额、百分比、优惠码和权益须在商家页与清单原文中通过确定性核验，每条引文须可回查。商家页声明优惠已结束时转人工，审校也须拦下与商家页矛盾的报价。精选目录包括课程、电子书、模板和设计素材。普通来源保留低分拒绝及软件相关性门槛，精选来源仅在审校明确拒绝且低于拒绝阈值时拟拒绝，两者均要求无丢弃证据和确定性异常。

三个开关均默认关闭，Worker 照常记录拟判、依据和审校输入，交人工审批。按“新增 → 更新 → 拒绝”分别打开对应开关，所有发布均经过提案审批。预演只输出判定。

### 1.2 原稿、差异审批与过期

提案保存不可变的原始 `payload`、精确的 `snapshotId` 和作出决策时的核验输入。人工编辑后的发布内容单独写入 `approvedPayload`。人工结论和 AI 拟判分别留存。更新事务锁定目标，对 `changes` 逐字段比较当前值与 `before`，仅应用通过审核的字段。冲突保留 pending 并记录冲突字段，无部分写入。

复查确认商家已明确结束活动时提出 `observedEndedAt` 更新，经相同审批流程生效。状态计算优先展示 ended，保留活动原定截止时间和公开历史页。无法访问、优惠码消失继续进入人工异常队列。

`recheck` 完成常规复查后，用剩余配额跟进未结束季节活动中的精选产品（任一已发布报价 `rank <= 50`）。同一产品同活动的已发布报价全部结束时，取最新结束的一笔访问官方页，发现续期优惠则在原活动提交新增提案。历史报价只用于识别，续期使用当前商家原文。新报价经 AI 发布后继承同一产品和活动已发布报价中小于 1000 的最低排名。

### 1.3 回放与验收

`audit-eval --sample N` 只读回放有原始输入、关联快照正文和人工结论的创建/更新提案。使用同一审校及决策规则，独立于生产开关。展示可回放数量、缺失样本、拟发布中被人工拒绝或修改后通过的比例、拟拒绝中被人工通过的比例和各自分母。分母为零时显示无样本。15 条用于验证流程，生产开关按人工影子样本分批验收。后台展示拟判、实际审批来源和冲突。

`review-pending` 按提案 ID 重审待审的新增及更新提案。优先使用原快照正文，缺失时用商家 URL 最近的非空正文。来自主 GitHub 清单的旧新增提案补记精选信任标记。命令按当前开关执行审批，`--dry-run` 只预览结果。

### 1.4 每日异常摘要

通过可选 `NOTIFY_WEBHOOK_URL` 推送每日异常摘要，含待审原因、失败任务与后台链接。通知失败只记日志。

## Phase 2：后台服务安全与性能加固

### 2.1 Fetcher 公网连接与重定向（首轮第一步）

手动跟随最多 5 次 HTTP 重定向。初次请求及每一跳都检查协议和目标地址，域名解析结果须为公网地址，连接使用已校验地址。保留 TLS 主机名校验、响应体大小限制、限速、超时与取消。以隔离测试覆盖公网跳转、非公网目标、DNS 校验与跳数边界。完成后方可接入多源。

### 2.2–2.4 后台与运维

后台代理与每个 Server Action 分别检查 Basic Auth，畸形请求统一返回未授权。公开查询使用 60 秒数据缓存和请求内去重，后台写入刷新优惠及活动标签。时间状态仍按当前请求计算。

每天的 `prune` 只清空超过 30 天、没有提案引用、且同一 URL 已有更新快照的正文。保留行、哈希与价格观测关联。旧静态站的根目录 `dist/` 已移出工作区，构建和容器使用各自的产物目录。

## Phase 3：前台交互

首页筛选栏提供页内搜索。对比支持最多三笔具体优惠，达到上限时提示原因，手机底栏可清空并留出页脚空间。拦截路由在水合后按视口显示弹窗或抽屉。价格不变时显示稳定金额、次数和时段，波动时标注各次观测和最低点。卡片网格保留行距。

## Phase 4：采集、报价与社区

### 4.1 优惠身份与字段

数据库按 `(productId, eventId, offerKey)` 唯一，迁移为存量优惠填入 `default`，已有提案原稿保持原样。新建提案按产品、活动、优惠类型、计费方式、商家可核验的档位和优惠码去重；没有命名的赠金或试用还会区分额度和时长，来源地址不参与生成报价身份。旧提案与已发布的默认报价按现有业务字段比对。同笔赠金转载与同产品同期订阅折扣由 PostgreSQL 流水线回归覆盖。

`offerType` 包括折扣、免费赠金、试用、买断和组合。赠金、试用和组合需要 `benefitSummary`，可附商家明确写出的 `estimatedValue` 与 `howToClaim`。赠金原文中的金额、单位和资格须逐字段接受商家证据核验；无法确定的翻译转人工。公开详情、比较、收藏和 RSS 链接可指定具体报价。

### 4.2–4.3 小步扩源与初筛

首批组合为原 GitHub 黑五清单加 JetBrains 官方 RSS。GitHub 原有入口继续可用，RSS 单独打开。后续来源各有独立配置、游标、配额和去重记录。清单可以维护多仓库、RSS/Atom、Reddit OAuth、HN Algolia、X 的 RSSHub 账号或关键词订阅、Brave 主动搜索。种子配置见 [registry.json](../apps/worker/src/sources/registry.json)。

原始线索与来源游标在同一事务落库。快源每两小时、慢源随 daily 执行。主 GitHub 黑五清单配置为 `curated: true`，单次默认处理 50 条，直接按条目链接抽取。遇到 403、429 或只有 JavaScript 的空页面时可使用清单原文。其余来源由批量初筛筛掉普通新闻与求推荐帖，保留可领取的软件优惠并从候选链接中选商家页。来自未确认域名的跳转转人工。找不到商家地址的社区线索在配置主动搜索后可以补查。来源异常时继续处理已入队线索及其他来源。缺少服务凭据的来源自动跳过。

后续可根据产出增加官方博客、社区板块和关注账号。扩大额度、启用其他搜索服务、接入 X 的直接 API 或推进生产自动发布，分别依据真实来源质量和人工影子样本决定。

### 4.4 社区与通知

详情页显示近 30 天投票，同一匿名身份在一笔报价上每 24 小时限一票。24 小时内两人报告失效的活动优先复查，机器复查仍需经过审批。站内爆料对新线索限流，进入快源队列。全局搜索支持快捷键、优惠码、产品、类别和专题。高分或专题中的 AI 新发布优惠可发到已配置的群订阅，每个渠道从上次成功位置继续；Webhook 地址只存于部署环境。

## 验收与上线清单

```sh
# 1. 静态检查、类型检查、单元测试与构建
pnpm lint && pnpm typecheck && pnpm test && pnpm build

# 2. 在目标环境应用迁移，预演抓取与审校
pnpm db:migrate
pnpm worker sync-upstream --dry-run --limit 5
pnpm worker recheck --dry-run --limit 5
pnpm worker review-pending --dry-run --limit 5

# 积累影子样本，三个执行开关均关闭
AUTO_APPROVE_CREATE=false AUTO_APPROVE_UPDATE=false AUTO_REJECT_ENABLED=false pnpm worker sync-upstream --limit 5
AUTO_APPROVE_CREATE=false AUTO_APPROVE_UPDATE=false AUTO_REJECT_ENABLED=false pnpm worker recheck --limit 5
# 在 /admin 处理提案后，回放有人工结论的样本
pnpm worker audit-eval --sample 15

# 3. Phase 4 多源采集预演（逐源验证解析与 Triage 去噪效果）
pnpm worker sync-fast --dry-run --limit 10
SOURCE_JETBRAINS_ENABLED=true pnpm worker sync-slow --dry-run --limit 10
```
