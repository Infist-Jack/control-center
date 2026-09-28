# paseo CLI 速查（0.9.2）

以下子命令均通过 `scripts/node.sh <节点>` 调用。

## run

`run [options] <prompt>`

- `-d, --background` 后台运行
- `--title <title>`、`--label <k=v>` 标题、标签
- `--provider <p>` / `--model <m>` / `--thinking <id>` / `--mode <mode>`
- `--workspace <id>` 必填，在该 workspace 目录下运行（`node.sh` 禁止 `--new-workspace` / `--worktree*`）
- `--env <k=v>` 环境变量
- `--wait-timeout <duration>` 前台运行时的最长等待

## 观察

- `ls [-a] [-g] [--label k=v]` 列出任务；`-g` 跨目录，`-a` 含已归档
- `inspect <id>` 任务详情
- `logs <id> [--tail n] [--filter tools|text|errors|permissions] [--since t]`
- `wait <id> [--timeout 秒]` 等待任务空闲

## 干预

- `send <id> [prompt] [--prompt-file f] [--no-wait]`
- `stop <id>` 中断；`archive <id>` 归档；`delete <id>` 删除
- `permit ls`、`permit allow|deny <agent> [req_id]`

## 节点信息

- `provider ls`、`provider models <provider>`、`provider diagnostic <provider>`
- `workspace ls`、`project ls`、`terminal ls --all`
