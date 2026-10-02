# PR #1 审查与承接记录

结论：当前版本不建议直接安装。既有测试和类型检查通过，但补充的独立复现确认了 8 个问题，涉及脱敏、数据完整性和缓存并发。

后续状态（2026-10-02）：以上结论针对原 PR head。用户随后授权修复并完成全节点扩展，修复版已安装中控；见 [实施与验收记录](../02-implementation-plan.md)。下文保留审查时证据。

- PR：[Add session-review Paseo plugin（会话复盘）](https://github.com/Tom-0727/control-center/pull/1)
- 审查版本：`676ad4d0c4e13cf731c5f0ec43a74fd9e3d9e378`。2026-10-02 经 GitHub 查询，仍为 OPEN，head 未改变。
- 承接自 Claude 主会话 `387154ac-3b97-4189-8fc2-6f194f69129f`；它在审查阶段遇到用量限制，没有产出最终审查结论或执行安装。
- 未修改 PR 源代码、未提交 GitHub review、未合并或安装。当前工作区原有的公共 Skills 改动保留。

## 需要修复的问题

### 1. [P1] JSON 字段中的密钥未脱敏就进入缓存

[server/redact.ts:13](https://github.com/Tom-0727/control-center/blob/676ad4d0c4e13cf731c5f0ec43a74fd9e3d9e378/plugins/session-review/server/redact.ts#L13)

当用户消息包含 `{"API_KEY":"合成测试值"}`，且值不属于 `sk-` 等已列举前缀时，正则不接受字段名后的引号，密钥原样保留。经 `extractOne` 完整解析和落盘后，合成密钥仍出现在缓存的标题及消息中，并可经消息详情返回。应补齐带引号字段的常见密钥表示，并升级缓存版本；不能只修正新结果而继续复用旧抽取物。

验证只使用合成字符串，没有读取或输出真实凭据。

### 2. [P2] 崩溃后恢复把停顿计为连续运行

[server/sources/codex.ts:94](https://github.com/Tom-0727/control-center/blob/676ad4d0c4e13cf731c5f0ec43a74fd9e3d9e378/plugins/session-review/server/sources/codex.ts#L94)

上一轮没有 `task_complete` / `turn_aborted` 就终止时，下次 `task_started` 使用新一轮时间关闭旧轮，覆盖中间整个空闲区间。合成记录在 02:00–02:01 有输出，22:00–22:01 恢复，结果活跃时长是 **1201 分钟**；仅观察到两端合计 2 分钟的活动。它会放大总活跃和最大并行。异常结束的旧轮应基于旧轮可观察活动收口，明确区分有结束记录和没有结束记录的情况。

### 3. [P2] 旧版 Codex 子会话未折叠

[server/sources/codex.ts:34](https://github.com/Tom-0727/control-center/blob/676ad4d0c4e13cf731c5f0ec43a74fd9e3d9e378/plugins/session-review/server/sources/codex.ts#L34)

这里只读取顶层 `parent_thread_id`，没有读取 `source.subagent.thread_spawn.parent_thread_id`。合成样例仅把父 ID 移到这一真实存在的字段，原本 3 个可见会话变成 4 个，父会话折叠数变成 0。对子线程密集的历史范围，还可能误触发 200 会话上限。

只读本机元数据统计：2331 个 Codex 文件中，1810 个只有该嵌套父 ID，没有顶层父 ID，分别来自 CLI 0.116.0、0.125.0、0.128.0。没有输出会话正文。

### 4. [P2] 创建超过 30 天的恢复会话被遗漏

[server/sources/codex.ts:40](https://github.com/Tom-0727/control-center/blob/676ad4d0c4e13cf731c5f0ec43a74fd9e3d9e378/plugins/session-review/server/sources/codex.ts#L40)

扫描只遍历所选日期往前 30 天的创建目录；已归档文件也用相同创建日期过滤。Codex 恢复仍写原创建日期下的文件，因此 8 月 1 日创建、9 月 30 日有活动的会话，在查 9 月 30 日时被完全漏掉。文件 mtime 和内容均符合范围也没有机会被检查。应覆盖较早创建但在范围内活动的会话，不能用固定创建日回溯窗代表活动范围。

### 5. [P2] 无活动的中间日期出现整天的空会话

[server/review.ts:102](https://github.com/Tom-0727/control-center/blob/676ad4d0c4e13cf731c5f0ec43a74fd9e3d9e378/plugins/session-review/server/review.ts#L102)

筛选比较整个会话的首尾时间，没有检查所选范围内的活动。一个仅在周一和周三工作的会话，查询周二也返回一行：0 条用户消息、0 个时间段，却显示周二 00:00–23:59:59.999，并增加会话总数。应按范围内实际活动判断，再计算行边界。

### 6. [P2] 任一分支筛选都会排除 Codex

[server/sources/codex.ts:156](https://github.com/Tom-0727/control-center/blob/676ad4d0c4e13cf731c5f0ec43a74fd9e3d9e378/plugins/session-review/server/sources/codex.ts#L156)

解析结果固定 `branch: null`，未读取记录中的 `session_meta.payload.git.branch`。给 fixture 写入 `feat/demo`，解析结果仍为 null，筛选该分支后 Codex 消失。本机 2331 个元数据记录中有 1205 个携带 git branch，应保留其分支信息。

同一筛选流程还有明确的 UI 恢复问题：[client/review.tsx:99](https://github.com/Tom-0727/control-center/blob/676ad4d0c4e13cf731c5f0ec43a74fd9e3d9e378/plugins/session-review/client/review.tsx#L99) 只在结果包含分支时显示控件；选中分支后切换至无该分支的日期或项目，结果清空，控件消失，但 `branch` 仍保留。此项由代码路径确认，未做浏览器端操作验证；修复时应保留清除当前筛选的入口。

### 7. [P2] 多层 fork 的第二层起静默消失

[server/review.ts:179](https://github.com/Tom-0727/control-center/blob/676ad4d0c4e13cf731c5f0ec43a74fd9e3d9e378/plugins/session-review/server/review.ts#L179)

列表只追加根会话的直接子 fork。对于 A → B → C，C 因父节点在范围内而被排除出 roots，又不在 A 的直接 children 中，最终不返回。fixture 新增一个 fork-of-fork 后，期望 4 个可见会话，仍仅返回 3 个。需要遍历完整层级，确保没有记录因排序过程丢失。

### 8. [P2] 不同范围并发扫描争用同一个缓存临时文件

[server/store.ts:19](https://github.com/Tom-0727/control-center/blob/676ad4d0c4e13cf731c5f0ec43a74fd9e3d9e378/plugins/session-review/server/store.ts#L19)

临时文件名只由缓存路径和 PID 构成。同一插件进程内两个不同范围的任务解析相同会话时，会写入并 rename 同一个临时文件，其中一方收到 ENOENT。`extractOne` 把缓存写入失败当成解析失败，丢弃已解析结果。10 轮独立冷缓存双任务复现得到 30 条假解析错误。用户切换范围、侧栏和工作区同时打开都可能触发；相同范围的任务去重不保护不同范围。

应采用每次写入独立的临时文件或按缓存键协调写入；缓存写入失败也应与会话无法解析区别处理。

## 验证方式与限制

在 PR 快照目录运行，既有检查通过：

```bash
npm test --workspace=session-review
npm run typecheck --workspace=session-review
```

补充复现脚本见 [reproduce.mjs](reproduce.mjs)。传入包含 PR 插件源码、且父仓库可解析依赖的绝对路径：

```bash
TZ=Asia/Singapore node .atectix/product-features/session-review-all-nodes/review/reproduce.mjs /path/to/pr-checkout/plugins/session-review
```

脚本在临时目录创建合成记录和缓存，并在每组验证后清理。它断言的是上述版本的错误行为以确认复现，**不是修复后的验收测试**；修复后应将这些场景转换为断言正确结果的回归测试。并发错误数量随调度变化。

本轮复现覆盖 8 项主要问题；没有安装插件或做浏览器端验收，没有连接远端节点扫描真实会话。节点清单确认了当前登记数量为 4，并不代表它们均在线。跨节点扩展范围见 [PRD 草案](../01-prd.md)。
