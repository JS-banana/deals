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
- **双语与订阅支持**：内置中文与英文站点，支持浅色 / 深色主题切换及 RSS 订阅。

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

打开 [http://localhost:3000/zh](http://localhost:3000/zh)（英文站点为 `http://localhost:3000`）即可浏览优惠。

## 项目结构

| 目录                            | 职责                                                    |
| :------------------------------ | :------------------------------------------------------ |
| [apps/web](apps/web/)           | Next.js 前台展示、中英双语站点与 RSS 订阅               |
| [apps/worker](apps/worker/)     | 自动化优惠抓取、AI 提取核验、翻译流水线与图标同步       |
| [packages/core](packages/core/) | 领域模型、Zod 校验、状态/时区计算与价格格式化（纯函数） |
| [packages/db](packages/db/)     | Drizzle ORM Schema、数据库迁移与数据查询                |

## 反馈与贡献

如果发现优惠过期、价格有误或站点问题，欢迎前往 [反馈与纠错](https://github.com/JS-banana/deals/issues)；提交代码前请参考 [贡献指南](CONTRIBUTING.md)。
