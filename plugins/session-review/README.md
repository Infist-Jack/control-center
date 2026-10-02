# Paseo 会话复盘（session-review）

插件安装在中控，从全部登记节点读取 Claude Code / Codex 会话。按节点、项目和日期查看会话时间线、确定性决策点和消息详情，始终包含全部分支；默认全部节点、今天，日期和时间轴统一使用 Asia/Singapore。

本实现接续 PR #1，修复解析、脱敏、缓存并发问题并扩展跨节点采集。范围与实现见 [全节点 PRD](../../.atectix/product-features/session-review-all-nodes/01-prd.md)、[实现方案](../../.atectix/product-features/session-review-all-nodes/02-implementation-plan.md)。原始 [单节点 PRD](../../.atectix/product-features/session-review/01-prd.md) 保留为上游设计记录。

## 安装与更新

要求：中控 Paseo 0.9.2+、Node 22+、已启用 Plugins，已配置 `paseo-nodes-use` 的节点清单与连接凭据。被采集节点需要 Node 22+ 和现有工作区，不需要另装 Paseo 插件。

```bash
cd ~/control-center
npm ci
npm run typecheck
npm test --workspace=session-review
npm run build:collector --workspace=session-review
.agents/skills/paseo-nodes-use/scripts/node.sh <中控节点> plugin install "$PWD/plugins/session-review" --json
```

更新代码后先重建 collector，再执行 `node.sh <中控节点> plugin reload session-review --json`。服务端默认使用 `~/control-center`，其他安装位置通过 daemon 环境变量 `SR_CONTROL_CENTER` 指定。重载插件不会重启 agent。

## 使用

1. Paseo 选择中控节点，打开侧栏「复盘」。工作区中也可通过命令中心「打开会话复盘」进入当前项目。
2. 默认读取全部登记节点；选择单个节点可单独刷新。各节点显示进度、完成数量或失败状态，离线不会清空其他节点结果。
3. 项目选项只显示项目名称；节点来源显示在会话行和详情中。同名项目和相同会话 ID 仍保留独立归属。没有分支筛选，始终展示范围内全部分支的会话。
4. 时间线每行显示来源节点和会话，点击展开，再点「查看消息」。较长消息流通过「更多消息」分页读取。
5. 节点有唯一运维工作区或只有一个工作区时自动使用；否则页面让用户选择一个已有工作区。不会新建项目或工作区。

切换范围会读取新范围；「刷新」直接重新扫描。离开页面不取消任务，返回后可查看结果。插件重启使旧任务失效时可直接刷新。

## 数据与传输

- 原始会话保留在来源节点，解析与脱敏在节点本机完成。只读取当前 daemon 用户的会话目录。
- 脱敏后的抽取缓存位于各节点 `~/.paseo/session-review/extracts/`，支持 `PASEO_HOME`、`CLAUDE_CONFIG_DIR`、`CODEX_HOME`。缓存版本变化自动失效，旧版本抽取不会通过详情接口返回。
- 采集程序按内容摘要保存到 `session-review/collectors/`，使用现有 Paseo 上传通道并校验摘要；临时上传分片在拼接后删除。
- 大结果通过压缩、分块读取绕开终端滚动缓冲限制。临时结果放在 `session-review/transfers/`，读取后删除；传输中断留下的结果在后续大结果采集时清理超过一天的文件。
- 范围上限为每个节点 200 个可见会话，按项目、真实活动筛选和折叠后检查。超限提示收窄范围，不静默截断。
- 没有 AI 归纳、自动分类、定时采集、会话干预或外部发送。

## 验证

```bash
npm test --workspace=session-review
npm run typecheck --workspace=session-review
npm run build:collector --workspace=session-review
node plugins/session-review/scripts/scan.ts today
node plugins/session-review/scripts/scan.ts last7
```

`scan.ts` 走与插件相同的节点采集通道，并验证每个成功节点的一条消息详情。输出只有节点状态、计数和详情页条数，不输出会话正文。测试包括原解析用例、8 类修复回归、跨节点 ID 隔离与部分失败、统一时区和大结果分块/分页。
