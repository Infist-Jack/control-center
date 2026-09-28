---
name: paseo-nodes-use
description: 通过 Paseo 控制已连接的节点（机器）。当用户按机器名称或别名（如 Lenovo、mac-mini、入口服务器）要求查看节点、在某台机器上运行 agent 任务、查看或干预任务、或在节点上执行 shell 命令时使用。
---

# Paseo 节点控制

所有操作通过 `scripts/` 下的脚本完成（路径相对本文件）。脚本负责按名称解析节点、核对 serverId、带凭据调用 `paseo`，凭据不会出现在输出中。

```
scripts/node.sh list                          # 列出节点
scripts/node.sh <节点> <paseo 子命令...>       # 在节点上执行 paseo 子命令
scripts/exec.sh <节点> --cwd <目录> -- <命令>  # 在节点上执行 shell 命令
```

`<节点>` 为 name 或任一别名，忽略大小写。stderr 首行 `[node] <name> <serverId>` 即核对结果。

## 能力

| 能力 | 命令 |
|---|---|
| 1. 解析节点 | `node.sh list` |
| 2. 检查节点 | `node.sh <节点> ls -g --json`（连通性）；`node.sh <节点> provider ls --json`（可用 provider） |
| 3. 下发任务 | `node.sh <节点> run --cwd <目录> --provider <claude\|codex>[/模型] -d --title <标题> --json "<任务>"` |
| 4. 观察任务 | `ls -g --json`、`inspect <id> --json`、`logs <id> --tail <n>`、`wait <id> --timeout <秒>` |
| 5. 干预任务 | `send <id> "<消息>"`、`stop <id>`、`permit ls`、`permit allow\|deny <id> [req_id]` |
| 6. 执行 shell | `exec.sh <节点> --cwd <目录> [--timeout 秒] -- <命令>`，返回命令输出和退出码 |

更多参数见 [references/cli.md](references/cli.md)。

## 规则

- **核对 serverId**：`[node]` 行的 serverId 与预期不符或脚本报错时停止，不要绕过脚本直接调用 `paseo --host`。
- **目录属于节点**：`--cwd` 必须是目标节点上的绝对路径；省略时 paseo 会使用本机当前目录。注意区分本机与节点上的同名目录。
- **凭据不回显**：不要读取或打印 `.private/` 下的文件内容。
- **区分超时和离线**：连通性用 `ls -g --json` 探测（等待 15 秒）；不要用 `status` / `daemon status`，它只等 1.5 秒，会误报离线。
- 统一加 `--json`，以便解析结果。
