# 数据管线与翻译流水线

[返回 README](../README.md)

Worker 负责从已启用的来源收集线索，再向商家页核验报价、调用大模型提取与翻译内容、定期复查已发布优惠，并将变更通知搜索引擎。

## 任务列表

在仓库根目录运行 `pnpm worker <job>`（例如 `pnpm worker translate --dry-run`）：

| 任务             | 作用                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `sync-upstream`  | 直接从精选 GitHub 黑五清单抽取、翻译并提交提案，覆盖软件和非软件数字商品                                                 |
| `recheck`        | 复查商家页、记录价格和结束观测，并跟进未结束季节活动中的精选产品续期                                                     |
| `review-pending` | 按 ID 重审待审新增及更新提案，更新拟判，并按自动审批开关执行（支持 `--limit N`、`--dry-run`）                            |
| `audit-eval`     | 对有人工结论的原始提案及其商家快照只读回放，输出拟发布错单率、拟拒绝误杀率和可回放数（`--sample N`，默认 15）            |
| `translate`      | 为缺英文或中文已变化的字段生成英文（支持 `--limit N`、`--refresh`、`--dry-run`）                                         |
| `translate-eval` | 抽样评估翻译质量，不写库（支持 `--sample N`，默认 15）                                                                   |
| `logos`          | 下载产品图标到 `MEDIA_DIR`                                                                                               |
| `indexnow`       | 将公开优惠和活动的变化通知 Bing 等支持 IndexNow 的搜索引擎（`--dry-run` 可预览待推送网址）                               |
| `sync-slow`      | GitHub、官方与社区 RSS、Brave 查询。原 `sync-upstream` 命令只运行主 GitHub 清单                                          |
| `sync-fast`      | Reddit、HN、X/RSSHub 和站内爆料                                                                                          |
| `import-signals` | 导入 JSONL（`--file <path>`、`--dry-run`），`sync-fast` 需设置 `SOURCE_AGENT_COLLECTED_ENABLED=true`                     |
| `prune`          | 清理超过 30 天的历史正文，保留每个 URL 的最新快照与提案证据                                                              |
| `digest`         | 通过可选的 `NOTIFY_WEBHOOK_URL` 发送待审原因和任务异常                                                                   |
| `notify-offers`  | 将分数至少 90 或属于精选活动的 AI 新发布报价发到已配置的群                                                               |
| `daily`          | 依次运行翻译、图标、慢源同步、复查、清理和异常摘要                                                                       |
| `schedule`       | 北京时间 06:10 执行 daily，14:10 和 22:10 复查，每两小时 :20 运行快源，每小时 :40 翻译、:55 通知索引，每十分钟检查群通知 |

## 运行与放量

新旧报价的唯一约束不同，部署时一并升级 Worker、Web 和数据库。每个来源使用独立的 `SOURCE_<ID>_ENABLED` 开关，ID 转大写并将连字符换为下划线。默认外部来源只有原 GitHub 清单。其余 RSS、社区与搜索源逐个启用；Reddit 需要已获准的应用凭据或有效令牌，X 使用已配置上游的 RSSHub，Brave 使用 `SEARCH_API_KEY`。Fetcher 所在环境需能解析、直连公网目标；保留地址或混合 DNS 答案会被拒绝。清单及单源默认配额见 [registry.json](../apps/worker/src/sources/registry.json)。

```sh
pnpm db:migrate
SOURCE_JETBRAINS_ENABLED=true pnpm worker sync-slow --dry-run --limit 5
SOURCE_JETBRAINS_ENABLED=true pnpm worker sync-slow --limit 5
pnpm worker sync-fast --dry-run --limit 5
pnpm worker review-pending --dry-run --limit 5
pnpm worker audit-eval --sample 15
pnpm worker prune --dry-run
```

在同步命令中，`--limit` 覆盖每个来源的单次处理配额。原始线索会先保存，超过配额的留给下次。模型批次出错会留待重试，单条提取连续失败三次后停止尝试。运营人员可在 `raw_signals` 核查来源、内容及尝试次数，修复根因后将相应行的 `attempts` 归零。三个自动执行开关默认关闭，正常同步即可积累影子判定。线上质量以有人工结论的回放样本为准。

主 GitHub 黑五清单 `github-bfcm` 配置为 `curated: true`，默认配额 50，跳过模型初筛，覆盖课程、电子书、模板、设计素材和软件。商家页证据齐全的自动发布写入 `verified: true`。新增提案也可使用精选清单逐字引文补充商家页遗漏的报价，遇到 403、429 或 JavaScript 空页也可提案，审核和确定性核验通过后发布为 `verified: false`。商家页明确结束或与清单事实矛盾时须拦下。普通社区来源仍要求商家证据才能自动发布。

`review-pending` 优先复用原商家快照正文，缺失时取 URL 最新的非空正文。旧的主 GitHub 清单新增提案会补齐精选标记，并撤销旧的商家域名确认扣分。`--dry-run` 只输出拟判。

`recheck` 先复查常规报价，再用 `--limit` 的剩余额度跟进未结束季节活动中已发布报价全部结束的精选产品（`rank <= 50`）。复查最近结束的一笔对应的官方页，续期以原活动的新增提案提交。AI 新报价沿用同产品同活动中小于 1000 的最低排名。统计见 `renewalChecked` 和 `renewalProposals`。

投票与爆料需要配置随机的 `COMMUNITY_HASH_SECRET`，并由可信反向代理覆盖 `X-Real-IP`。同一身份每小时可提交五条新线索。异常摘要的格式由 `NOTIFY_WEBHOOK_KIND` 指定；用户群通过 `GROUP_WEBHOOK_{SLACK,DISCORD,FEISHU,WECOM,DINGTALK}_URL` 独立配置。首次发送选取过去一天的合格发布，后续从上次成功的发布位置恢复。发送成功但进程在记录进度前退出时，接收方可能看到重复通知。

## 模型配置

Worker 通过兼容 OpenAI 的 `/chat/completions` 接口调用模型（支持智谱 GLM、DeepSeek 等）：

- **提取与复查**：使用 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`（可选 `LLM_EXTRA_BODY`）。
- **英文翻译**：可选配置 `TRANSLATE_BASE_URL`、`TRANSLATE_API_KEY`、`TRANSLATE_MODEL`（可选 `TRANSLATE_EXTRA_BODY`）。三项同时设置才生效，否则回退到 `LLM_*`。
- **OpenAI 接口适配**：检测到 `api.openai.com` 时，会自动使用 `max_completion_tokens` 和 `reasoning_effort`，不发送 `temperature`。

- **独立审校与自动审批**：可通过 `REVIEW_BASE_URL`、`REVIEW_API_KEY`、`REVIEW_MODEL`（可选 `REVIEW_EXTRA_BODY`）配置独立审校模型，缺省时复用翻译模型配置；自动新增、自动更新、自动拒绝分别由 `AUTO_APPROVE_CREATE`、`AUTO_APPROVE_UPDATE`、`AUTO_REJECT_ENABLED` 控制（默认均为 `false`，仅记录影子拟判）。

## 翻译机制

中文是唯一的源稿，英文仅由翻译流程生成：提取和复查阶段只写中文（`en` 留空），其余交给翻译流程处理。

### 翻译记忆与重译规则

- **只译一次**：翻译结果存入 `translations` 表（翻译记忆），键为规范化中文（去首尾空白、合并空白、NFC）的 SHA-256。同一句中文（如“Pro 买断”）只译一次，所有字段复用。
- **何时重译**：当字段 `en` 为空，或 `en` 恰好是为旧版中文生成的译文（中文内容已修改）时触发重译。`en` 等于当前中文对应的记忆译文则视为最新，跳过处理。其他非空 `en`（如人工编写或记忆表引入前的数据）默认保留，仅在传入 `--refresh` 时覆盖。命中记忆（分数 ≥ 70）时直接写入，不调用模型。
- **提案阶段即完成翻译**：`sync-upstream` 与 `recheck` 在提交提案前会用同一流程翻译 payload，审批即可双语发布；若翻译失败则 `en` 留空，审批后由每小时的 `translate` 补齐。

### 质量流水线

多条文本会按条数和字数限制合并为单次请求，依次经过三个阶段：

1. **翻译**（`reasoning` low）：系统提示包含英文风格指南和当前批次命中的术语表。
2. **审校**（`reasoning` medium）：按忠实、术语、自然度、简洁、格式打分，并叠加确定性检查（数字、优惠码、残留中文、术语表）。
3. **重写与复审**：低于 85 分或确定性检查未通过的条目会重写并复审，最多两轮。最终无确定性失败且分数 ≥ 70 才发布并写入记忆；否则保持原样（前台回退显示中文）并计入 `failed`。

### 术语表与评估

- **术语表**：位于 [apps/worker/src/glossary.json](../apps/worker/src/glossary.json)（含 `version` 字段），每条格式为 `{ zh, en: [允许的译法], note? }`，第一项为规范译法。系统仅将当前批次出现的术语注入提示；译文缺少术语只记录问题，不拦截发布。
- **质量评估**：运行 `pnpm worker translate-eval --sample 15` 对确定性样本执行完整流水线（不写字段和记忆），输出逐条中文、旧译文、新译文、分数和问题，以及平均分、≥85 占比、确定性失败数、术语缺失数和 token 消耗。建议在更换模型或修改提示词前先运行评估。
- **修改提示词或术语表后**：更新 `apps/worker/src/prompts.ts` 的翻译提示词时需同步更新 `PROMPT_VERSION`。已有翻译记忆不会自动失效；如需全量重译，清空 `translations` 表后运行 `pnpm worker translate --refresh`。
