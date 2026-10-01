# Paseo 会话复盘（session-review）

装在 Paseo 节点上的原生插件。按工作区和日期把这台机器上的 Claude Code、Codex 会话压成时间线：会话卡、确定性的决策点（agent 提问、用户打断或拒绝、写入记忆）、并行图；可选地用本机已登录的 runtime（claude / codex / opencode）按你自己的提示词预设做归纳。目的只有 review 和反思，不做工程监控。

产品行为见 [PRD](../../.atectix/product-features/session-review/01-prd.md)，实现说明见 [实现方案](../../.atectix/product-features/session-review/02-implementation-plan.md)。

## 安装

环境：Paseo 0.9.2、Node 22+。插件在 daemon 子进程里读 `~/.claude`、`~/.codex` 和 `~/.paseo`，所以装在哪台节点就复盘哪台。

```bash
cd ~/control-center && npm ci && npm run typecheck --workspace=session-review
# daemon 的 config.json 里 pluginsEnabled 需为 true（设置页也能开，支持热加载）
paseo plugin install "$PWD/plugins/session-review" --json
```

更新代码后：`paseo plugin reload session-review --json`。

## 使用

- 工作区里多一个「复盘」面板，默认显示今天该工作区的会话；侧栏「复盘」页可以跨工作区选范围。
- 会话卡只有标题、provider、起止、活跃时长、等待时长、消息数、未纳管标记、结局标签；点开看消息流和该会话的决策点。
- 决策点只取记录里的结构化事件，不做文本推测。记忆索引（MEMORY.md）改动默认折叠。
- 并行图：深色段 agent 在跑，浅色段在等你，圆点是决策点；窄屏退化为表格。
- 归纳：选 runtime 和预设后手动运行；输入只用脱敏后的抽取物；结果按范围、会话修改时间、runtime 和预设内容缓存。预设存在 `~/.paseo/session-review/prompts/`，内置「通用复盘」不可删。

## 数据与脱敏

抽取结果、归纳缓存、预设都在 `~/.paseo/session-review/`。所有落盘内容先经 `server/redact.ts` 打码（API key、token、Bearer、URL 里的长随机段、`KEY=`/`TOKEN=` 形式的赋值、带密码的 URL）。归纳 runtime 以只读、不落会话记录的方式运行；claude 用 `--no-session-persistence`，codex 用 `--ephemeral`。

## 验证

```bash
npm run typecheck --workspace=session-review
npm test --workspace=session-review          # 合成 fixture 的单元测试
npm run baseline --workspace=session-review -- 2026-09-30   # 本机真实记录的基准，只打印统计
```
