# Paseo 会话复盘（session-review）

装在 Paseo 节点上的原生插件。按项目和日期把这台机器上的 Claude Code、Codex 会话压成时间线：以并行图为主体的会话列表，加确定性的决策点（agent 提问、用户打断或拒绝、写入记忆）。目的只有 review 和反思，不做工程监控。AI 归纳与分类是后续项，见 PRD 末尾。

产品行为见 [PRD](../../.atectix/product-features/session-review/01-prd.md)，实现说明见 [实现方案](../../.atectix/product-features/session-review/02-implementation-plan.md)。

## 安装

环境：Paseo 0.9.2、Node 22+。插件在 daemon 子进程里读 `~/.claude`、`~/.codex` 和 `~/.paseo`，所以装在哪台节点就复盘哪台。

```bash
cd ~/control-center && npm ci && npm run typecheck --workspace=session-review
# daemon 的 config.json 里 pluginsEnabled 需为 true；改完文件执行 paseo daemon reload（不重启、不打断会话）
paseo plugin install "$PWD/plugins/session-review" --json
```

更新代码后：`paseo plugin reload session-review --json`。

## 使用

- 工作区里按 ⌘K 选「打开会话复盘」，面板作为标签页打开，默认当前项目、今天；左侧栏「复盘」页可以跨项目选范围。
- 并行图每行一个会话：行首是开始时间和标题，行内是运行段、等待段和决策点；点一行展开看 provider、起止、活跃、等待、消息数和该会话的决策点，再点「查看消息」看消息流。
- 决策点只取记录里的结构化事件，不做文本推测。记忆索引（MEMORY.md）改动默认折叠。
- 轮内超过 15 分钟没有记录视为静默切开运行段；超过 90 分钟的间隔视为搁置，不算等待。
- 窄屏下并行图退化为表格，同样可以展开。

## 数据与脱敏

抽取结果缓存在 `~/.paseo/session-review/extracts/`，解析规则升级时按版本号自动重建。所有落盘内容先经 `server/redact.ts` 打码（API key、token、Bearer、URL 里的长随机段、`KEY=`/`TOKEN=` 形式的赋值、带密码的 URL）。

## 验证

```bash
npm run typecheck --workspace=session-review
npm test --workspace=session-review          # 合成 fixture 的单元测试
npm run baseline --workspace=session-review -- 2026-09-30   # 本机真实记录的基准，只打印统计
```
