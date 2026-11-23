# 贡献指南

[返回 README](README.md)

## 本地校验

提交代码前建议先在本地运行完整检查：

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Git 提交规范

新克隆仓库安装依赖后，运行一次以下命令启用本地提交检查：

```sh
git config --local core.hooksPath .githooks
```

推送到 `main` 和提交 Pull Request 时，CI 会使用同一份 `.commitlintrc.json` 配置校验本次新增的所有提交。

提交标题遵循 [Conventional Commits 规范](https://www.conventionalcommits.org/zh-hans/v1.0.0/)，格式为 `type(scope): 摘要`（`scope` 可省略，中英文皆可）：

- `feat`：新功能
- `fix`：问题修复
- `docs`：文档更新
- `ci`：持续集成与构建配置
- 其他类型沿用 `@commitlint/config-conventional` 常规预设

每次提交尽量围绕一个可独立回滚的改动，背景原因与权衡可另起一段写在正文。

```text
fix(seo): 修复首页分页的索引状态
feat(worker): submit changed URLs to IndexNow
docs: clarify local setup
```
