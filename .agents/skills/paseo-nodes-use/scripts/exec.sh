#!/usr/bin/env bash
# 用法：exec.sh <节点> --cwd <节点上的绝对路径> [--timeout 秒] -- <shell 命令>
# 在节点上开临时终端执行命令，输出结果并返回其退出码，结束后关闭终端。
set -euo pipefail

NODE_SH="$(dirname "$0")/node.sh"
die() { echo "exec.sh: $*" >&2; exit 2; }

[[ $# -ge 1 ]] || die "用法：exec.sh <节点> --cwd <目录> [--timeout 秒] -- <命令>"
node="$1"; shift
cwd=""; timeout=300
while [[ $# -gt 0 ]]; do
  case "$1" in
    --cwd) cwd="$2"; shift 2 ;;
    --timeout) timeout="$2"; shift 2 ;;
    --) shift; break ;;
    *) die "未知参数 $1" ;;
  esac
done
[[ -n "$cwd" ]] || die "必须指定 --cwd（否则会沿用本机当前目录）"
[[ $# -ge 1 ]] || die "缺少命令"
cmd="$*"

tid=$("$NODE_SH" "$node" terminal create --json --name "cc-exec-$$" --cwd "$cwd" | jq -r '.id')
[[ -n "$tid" && "$tid" != null ]] || die "创建终端失败"
trap '"$NODE_SH" "$node" terminal kill "$tid" --json >/dev/null 2>&1 || true' EXIT

# 命令以 base64 传输，避免引号和换行问题；以唯一标记行回传退出码
marker="__CC_DONE_$(date +%s%N)__"
b64=$(printf '%s' "$cmd" | base64 | tr -d '\n')
"$NODE_SH" "$node" terminal send-keys "$tid" \
  "printf '%s:S\\n' $marker; echo $b64 | base64 --decode | bash; echo \"$marker:\$?\"" Enter --json >/dev/null || die "发送命令失败"

deadline=$((SECONDS + timeout))
while :; do
  out=$("$NODE_SH" "$node" terminal capture "$tid" -S --json 2>/dev/null | jq -r '.lines[]') || true  # 单次抓取失败则重试
  grep -qE "^$marker:[0-9]+$" <<<"$out" && break
  (( SECONDS < deadline )) || { printf '%s\n' "$out"; die "超时（${timeout}s），命令可能仍在运行"; }
  sleep 1
done

# 只打印起止标记行之间的输出
awk -v m="$marker" '$0 ~ "^" m ":[0-9]+$" { exit } on { print } $0 == m ":S" { on = 1 }' <<<"$out"
exit "$(grep -oE "^$marker:[0-9]+$" <<<"$out" | cut -d: -f2)"
