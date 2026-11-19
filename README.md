# 好价清单 · Deal Index

[打开网站](https://js-banana.github.io/deals/)

中文黑五软件优惠目录。首页按用途、活动时间和购买条件筛选，可复制优惠码、在本地收藏，并列对比最多三项。每条优惠都有独立详情地址、商家入口和原始出处。

## 本地运行

使用 Node.js 20 或更新版本，无需安装依赖。在项目根目录运行：

```sh
npm run build
mkdir -p .preview
ln -sfn ../dist .preview/deals
python3 -m http.server 8000 --bind 127.0.0.1 --directory .preview
```

访问 `http://127.0.0.1:8000/deals/`。构建结果位于 `dist/`，路径与 GitHub Pages 项目站一致。

## 更新优惠

编辑 `data/deals.json`。数组顺序即编辑排序，第一条用于首页精选。先核对商家当季活动，再保存当前社区记录的固定提交和行链接。实际金额使用原币，预扣税、首期优惠、续费、地区和用户限制分别说明。仅有折扣时可以只记录折扣。

- `verified` 表示已在 `merchant` 对应的商家页面核实当季活动。社区收录保留 `source`，核对日期为 `checked`。
- `start`、`end` 为发布方自然日。精确时刻用带偏移的 `startsAt`、`endsAt`，只有日期但知道地区时可补 IANA 时区 `dateZone`。没公布开始日、但当日已在商家价格页看到有效报价，可记录 `observedLive`。
- `oneTime`、`existing` 只在有依据时开启。`noCode` 表示明确免码；其余缺失信息保留为空。`cardNote` 可用一句话提炼购买条件，详情页保留完整条款。

构建会校验标识、分类和链接，并生成静态首页、分类、专题、详情、站点地图和分享元数据。即使关闭 JavaScript，产品价格、条款、来源和商家链接也可阅读。

## 发布

源码在本仓库维护。公开的 [GitHub Pages 仓库](https://github.com/JS-banana/deals) 保存构建结果，发布源是 `main` 根目录。内容更新提交后，使用已登录、对发布仓库有推送权限的 GitHub CLI 运行：

```sh
./scripts/publish.sh
```

脚本重新构建、更新生成文件并推送。有并发推送冲突时，Git 会拒绝覆盖远端更新。上线后可从 Pages 构建记录确认发布，再检查首页、独立详情页和 `/deals/sitemap.xml`。
