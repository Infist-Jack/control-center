# Paseo 会话复盘：实现方案

状态：2026-10-01 用户确认；2026-10-02 实现完成并安装到本机 daemon。实现中的偏差见文末。产品行为以已确认的 [PRD](01-prd.md) 为准。

## 整体实现

在 `plugins/session-review/` 增加一个 Paseo 原生插件，只装在需要复盘的节点上。全部逻辑在插件内：服务端在 daemon 子进程里读本机会话文件、做归属与规则判定、调用归纳 runtime；客户端只渲染。不改 Paseo 源码，不依赖内部模块，不维护 fork。

```text
面板 / 侧栏页 ──RPC──▶ 插件服务端（daemon 子进程）
                        ├─ 扫描 ~/.claude、~/.codex 会话文件 → 统一模型 → 规则判定 → 脱敏 → 缓存
                        ├─ 读 ~/.paseo/agents 与 Paseo SDK 的项目/工作区 → 会话归属
                        └─ 归纳：spawn claude -p / codex exec / opencode run → 固定 schema → 缓存
```

| 部分 | 职责 |
| --- | --- |
| `shared/contracts.ts` | Zod 定义的 RPC：目录、抽取任务、归纳任务、预设 CRUD |
| `shared/model.ts` | 统一会话模型与页面需要的数据结构（会话卡、决策点、活动段、概览） |
| `server/sources/claude.ts`、`server/sources/codex.ts` | 逐行流式解析各自的 jsonl，输出统一模型；每个解析器附结构相同的合成 fixture |
| `server/catalog.ts` | 项目、工作区、Paseo agent 与 provider 会话的对应，会话归属与「未纳管」 |
| `server/decisions.ts` | 三类确定性规则，每条规则一个函数，常量里放 CLI 固定文案 |
| `server/spans.ts` | 运行段、等待段、并行峰值、去重叠活跃时长 |
| `server/redact.ts` | 打码，落盘前执行 |
| `server/store.ts` | `~/.paseo/session-review/` 下的抽取缓存、归纳缓存、预设文件，原子写 |
| `server/jobs.ts` | 有界后台任务表，沿用 nodes-skills-manage 的模式 |
| `server/summarize/` | `prompt.ts` 拼装、`schema.ts` 输出结构、`claude.ts` / `codex.ts` / `opencode.ts` 适配 |
| `client/review.tsx` | 主视图，面板与侧栏页共用；`panel.tsx` 取 `workspaceId`，`surface.tsx` 提供工作区选择 |
| `client/cards.tsx`、`decisions.tsx`、`gantt.tsx`、`summary.tsx`、`presets.tsx`、`detail.tsx` | 各区域组件 |

开发依赖固定 `@getpaseo/plugin@0.9.2`，manifest `requirements.paseo` 为 `^0.9.2`。项目用 `paseo plugin init` 生成骨架后再纳入根目录的 npm workspaces。

## 统一会话模型

```text
Session {
  id, provider: "claude" | "codex", cwd, branch?, file, startedAt, endedAt,
  title (首条用户指令，截断前的全文另存), unmanaged, agentId?, workspaceId?, projectId?,
  forkedFrom?, children: Session[], hiddenThreads: string[],
  messages: { at, role: "user" | "assistant", text }[],   // 只有文本，不含工具参数
  turns: { startedAt, endedAt, userMessageAt }[],
  decisions: { at, kind: "question" | "interrupt" | "memory", excerpt, answer?, next? }[],
  userMessageCount, activeMs
}
```

缓存中保留消息全文；RPC 返回时单条消息截到 2000 字，标题截到 60 字。

## 数据来源与抽取

**定位文件。** 先按日期范围缩小集合，再解析。

- Claude：`<claudeHome>/projects/*/*.jsonl`。先用文件 mtime 排除早于范围起点的；再读首条带时间戳的记录取 `sessionId`、`cwd`、`gitBranch`、起始时间，不在范围内的跳过。不进入会话目录下的子文件夹。排除 cwd 位于插件 scratch 目录的会话，避免把归纳自己的运行算进去。
- Codex：`<codexHome>/sessions/<YYYY>/<MM>/<DD>/rollout-*.jsonl` 按日期目录定位，再扫 `archived_sessions/` 按文件名日期筛选。`session_meta` 提供 cwd、`forked_from_id`、`parent_thread_id`。

**Claude 解析规则。**

- `type=user`：content 为字符串，或列表中含 `text` 块，记为用户消息。跳过以 `<system-reminder>`、`<command-name>`、`<local-command` 开头的注入；`<task-notification>` 记为系统事件，不计入用户消息数，也不开启新轮。`[Request interrupted by user` 开头的记为打断。
- `type=assistant`：按 `message.id` 去重后取 `text` 块。`tool_use` 只保留名称，以及 AskUserQuestion、Write、Edit、MultiEdit 的必要输入字段。
- `tool_result`：只在匹配 AskUserQuestion 的 `tool_use_id`，或 `is_error` 且含权限拒绝固定文案时保留。
- 时间戳为 UTC，转 daemon 进程时区。

**Codex 解析规则。**

- `response_item.message` role=user：跳过以 `# AGENTS.md`、`<environment_context>`、`<skills_instructions>`、`<turn_aborted>` 开头的注入；`<send_user_message_question_reply>` 解析成提问的回答。
- role=assistant 的 `output_text`，commentary 与 final_answer 都记为助手文本。
- `function_call` name=`request_user_input_async` 记为提问。
- `event_msg`：`task_started`、`task_complete`、`turn_aborted` 作为轮次边界；`token_count`、`reasoning` 忽略。
- `parent_thread_id` 非空的文件是子线程，整个文件不解析，只把 id 记到父会话的 `hiddenThreads`。

**性能。** 逐行流式读取，不整文件载入；本机 8 MB 的记录解析在 1 秒内。抽取结果按 `(path, mtime, size)` 缓存到 `extracts/<sessionId>.json`，命中直接读取。

## 归属与分组

- 目录来自两处：Paseo SDK `paseo.projects.list()` 给 `rootPath`，`paseo.workspaces.list()` 给工作区 `cwd`（目录或 worktree）；`<paseoHome>/agents/<slug>/*.json` 给 agent → provider 会话 id、workspaceId。SDK 的 agent 列表不含 provider 会话 id，所以必须读 daemon home 下的文件。daemon home 取 `PASEO_HOME`，否则 `~/.paseo`，插件设置里可改。
- 归属顺序：先按 agents 记录精确匹配 sessionId；否则用会话 cwd 与工作区 cwd 做最长前缀匹配；只落在某项目 `rootPath` 下的归该项目、无工作区。未经 agents 记录匹配到的一律标 `unmanaged`。
- 范围为「当前工作区」时，包含归属该工作区的会话，以及归属同一项目且 cwd 在该工作区目录下的未纳管会话。侧栏页可选任一项目或全部项目。
- fork 挂载：`forkedFrom` 指向的父会话在范围内时挂为其子项；不在范围内时作为顶层，卡上标「分叉自」。

## 决策点规则

| 类型 | 信号 | 摘录 | 回答或后续 |
| --- | --- | --- | --- |
| 提问（Claude） | `tool_use.name === "AskUserQuestion"` | `input.questions[].question` | 同 `tool_use_id` 的 `tool_result` 文本中按 `"问题"="答案"` 解析 |
| 提问（Codex） | `function_call.name === "request_user_input_async"` | `arguments.questions` | 其后用户消息中 `<send_user_message_question_reply>` 的 JSON |
| 打断（Claude） | 用户记录以 `[Request interrupted by user` 开头 | 被打断前的助手文本末句 | 用户下一条消息首 100 字 |
| 拒绝（Claude） | `tool_result.is_error` 且文本含 CLI 固定的权限拒绝文案 | 被拒绝的工具名与命令首 100 字 | 同上 |
| 打断（Codex） | `turn_aborted.reason === "interrupted"` | 同 Claude | 同 Claude |
| 记忆（Claude） | Write / Edit / MultiEdit 的 `file_path` 匹配 `\.claude/projects/[^/]+/memory/[^/]+\.md$` | Write 取 frontmatter 的 description；Edit 取 `new_string` 首 100 字 | 无 |

- 固定文案从本机记录中提取为常量，并各配一条样例测试；Claude Code 升级改了文案时测试失败，不会静默漏检。
- `MEMORY.md` 索引文件的改动记为「记忆索引」子类型，列表默认折叠。
- 「agent 随后做了什么」取事件之后同一会话的第一条助手文本首句，不超过 60 字。
- 不做任何文本模式推测。

## 活动段与并行图

- Claude 轮次：一条用户消息到下一条用户消息之前的最后一条记录为运行段；若存在下一条用户消息，则两者之间为等待段；最后一轮之后不计等待。
- Codex 轮次：`task_started` 到 `task_complete` 或 `turn_aborted` 为运行段；排队中的用户消息不单独开段。
- 概览：并行峰值扫描所有运行段端点；活跃总时长取区间并集；等待总时长为等待段求和。
- 图由服务端返回段列表与决策点时间，客户端用 `onLayout` 取宽度做线性映射。每行一个 `View`，段是绝对定位子 `View`，最小宽 2px；每小时一条刻度；行首标题不超过 20 字。颜色只取 `theme.colors`：运行段 `accent`，等待段 `surface2`，决策点 `foreground`。`layout.compact` 为真时改为表格。

## 归纳 runtime

- 可用性：启动时和每次打开归纳区时 spawn `<bin> --version` 探测，不可用的 runtime 不显示；默认 claude。
- 输入：由缓存抽取物生成，含日头、每个会话的标题、起止、消息数、用户消息全文（单条截 300 字）、每轮助手文本的首句与末句、全部决策点。总量上限 6 万字符；超出时两阶段：先逐会话归纳，再把会话结果汇总为日级。
- 调用方式，cwd 固定为 `~/.paseo/session-review/scratch/`，提示词与输入经 stdin 传入，超时 10 分钟，保留 stderr 尾部 4000 字：
  - claude：`claude -p --output-format json --json-schema <schema>`，禁用全部内置工具，具体参数在实现时核对。
  - codex：`codex exec --json --output-schema schema.json -o out.json --ephemeral -s read-only --skip-git-repo-check -C <scratch>`。
  - opencode：`opencode run` 加输出格式参数，待本机安装后验证。
- 输出 schema 由 Zod 定义并导出 JSON Schema：`sessions[]{id, goal, outcome, overturnedBy?, ifAgain}`，`day{buckets[]{name, minutes}, overturned[]{decision, laterEvidence}, longestWaits[]{sessionId, minutes, what}, oneLine}`。`outcome` 枚举：delivered、abandoned、overturned、unfinished。
- 提示词：固定系统段（角色、只依据输入、输出要求、中文）+ 预设正文 + 输入 JSON。
- 缓存键：sha256(范围 + 排序后的 `(sessionId, mtime, size)` 列表 + runtime + model + 预设正文)。两阶段时会话级结果单独按会话缓存。

## 预设与存储

```text
~/.paseo/session-review/
  extracts/<sessionId>.json      抽取缓存
  summaries/<key>.json           归纳缓存
  prompts/<id>.md                预设，frontmatter: name, builtin
  prompts.json                   默认预设 id
  scratch/                       归纳 runtime 的工作目录
```

- 内置预设「通用复盘」写在代码里，首次运行落盘并标 builtin，不可删除，可复制为新预设。
- 预设 CRUD 只改 `prompts/`；写入先写临时文件再 rename。
- 所有落盘内容先经 `redact.ts`：API key 与 token 形态的字符串、`Bearer` 后的值、URL 路径中长度超过 20 的随机段、`.env` 类文件内容回显，统一替换为 `[已打码]`。

## 后台任务与页面

RPC 列表（30 秒限制下都用短请求）：

| RPC | 作用 |
| --- | --- |
| `catalog` | 项目、工作区、可用 runtime、预设列表、默认预设 |
| `review.start` / `review.status` | 按范围抽取；返回会话卡、决策点、活动段、概览；同一范围有运行中任务时直接返回其 id |
| `review.session` | 单个会话详情：消息流与该会话决策点 |
| `summary.start` / `summary.status` | 归纳任务与结果 |
| `presets.save` / `presets.delete` / `presets.setDefault` | 预设管理 |

页面结构：顶部范围条；概览行；会话卡列表与并行图、决策点列表并排，紧凑布局单列；点开卡片用 `@getpaseo/plugin/client/react-native` 的 `Modal` 展示详情；底部归纳区含 runtime 下拉、预设下拉与管理、运行按钮、结果。任务进行中每 1.2 秒轮询，结束后停止；离开页面不取消任务。

## 实施顺序与验证

1. **抽取与规则**：两个解析器、统一模型、决策点规则、活动段计算，全部为纯函数。测试用合成 fixture，结构照真实记录、内容为假；另有一个只在本机运行、不提交输出的基准脚本，对 2026-09-30 的真实记录跑一遍，核对 PRD 验收第 3 条的数字。
2. **服务端**：归属、缓存、脱敏、任务表、RPC。安装到本机 daemon 后用 `paseo plugin logs` 与 RPC 直接调用验证；用已知凭据样例做脱敏负向检查。
3. **页面**：卡片、决策点、并行图、详情、归纳区骨架。`npm run typecheck`，安装时通过 Paseo 插件编译，在真实 Web 检查深浅主题与 390px。
4. **归纳与预设**：三个 runtime 适配、输出 schema、缓存、预设 CRUD。用 claude 对 9/30 跑一次真实归纳，检查结构与二次运行的缓存命中；codex 跑一次对照；opencode 视安装情况。

接入步骤：本机 daemon 在 `config.json` 打开 `pluginsEnabled`，然后 `paseo daemon reload` 让 daemon 重新读配置（不重启、不打断会话；直接改文件不会自动生效），`paseo plugin install "$PWD/plugins/session-review"`，改动后 `paseo plugin reload session-review`。

## 接入前提与已知限制

- 插件只复盘它所在节点的会话；要看别的节点，在那台节点安装。
- 依赖 daemon home 下的 `agents/` 文件获得 agent 与 provider 会话的对应，这是 0.9.2 的存储布局；Paseo 升级后需复核。
- Claude 的权限拒绝判定依赖 CLI 固定文案，规则测试覆盖。
- Codex 的记忆写入首版不判定；opencode 作为会话来源不在首版，只作为归纳 runtime。
- 归纳会在 scratch 目录下产生新的 claude / codex 会话记录，抽取时按 cwd 排除。
- 时间按 daemon 进程的时区；跨时区使用时以节点时间为准。

## 实现偏差记录（2026-10-02）

- 项目与工作区目录没有走 Paseo SDK，而是和 agents 一样直接读 daemon home 下的 `projects/projects.json`、`projects/workspaces.json`。原因：三份数据同源同机，形状已知，省掉一处 SDK 形状依赖。
- 归纳 runtime 的 claude 调用加了 `--no-session-persistence`，不再产生会话记录；scratch 目录排除规则仍保留作为兜底。
- 开发机的 lockfile 指向腾讯云内网镜像，本机安装时临时改写 URL 再还原，提交的 lockfile 只新增了 session-review 工作区条目。

## 第一轮反馈后的改动（2026-10-02）

- 范围只按项目：`scope` 去掉 `workspaceId`；面板通过 catalog 的 workspace→project 映射取项目；归属只看 Paseo agent 记录和项目根目录。
- 并行图成为唯一的会话列表：行可展开，展开内容即原会话卡加该会话的决策点和「查看消息」；轴头带日期，跨天在零点标日期，刻度按宽度自适应。
- 去掉「未纳管」标签和 `unmanaged` 字段；`agentId` 为空即表示不是 Paseo 起的。
- 删除归纳层：`server/summarize/`、预设存储、runtime 探测及对应 RPC 与页面；数据目录只剩 `extracts/`。
- 抽取缓存加版本号（`EXTRACT_VERSION`），解析规则变化时自动重建。
- Claude 续写副本按「首条用户消息时间 + 文本」折叠；运行段在轮内按 15 分钟静默切开；超过 90 分钟的等待视为搁置不画。
