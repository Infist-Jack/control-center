# control-center

供 Claude Code 与 Codex 使用的 skills，仅在本仓库内生效：在仓库目录中启动 agent 即自动加载。

用途是给 coding agent 赋能：

- **Paseo 节点控制**：按名称定位已连接的节点，在其上启动、观察和管理 agent 任务。
- **研发上下文连通**：打通飞书、Linear、GitHub 等上下文，读写文档、issue 与消息，并关联到研发任务。

## 目录设计

```
.agents/skills/<skill名>/SKILL.md     # 唯一源，Codex 读取
.claude/skills -> ../.agents/skills   # 软链接，Claude 读取
AGENTS.md                             # 仓库约定
CLAUDE.md                             # 指向 AGENTS.md
```

- 两个工具的项目级 skills 目录不同：Codex 读 `.agents/skills`，Claude 读 `.claude/skills`。用软链接共享同一份源，避免维护两份。
- 只在 `.agents/skills/` 里增删改；`.claude/skills` 只是链接。
- `SKILL.md` 的 frontmatter 只写两边通用的 `name` 和 `description`，目录名与 `name` 一致。
- 公开仓库，不存放节点地址、serverId、配对链接、token 等敏感信息，运行时从本机读取。

## 飞书安装与授权

飞书使用官方 `lark-cli` 执行操作，项目内的 [lark-suite](.agents/skills/lark-suite/SKILL.md) 统一路由到消息、文档、云空间、知识库、日历和授权六项能力；详细指引保留在各自的 `references/` 中。安装依赖 Node.js/npm；同步脚本依赖 Python 3.10+。

```bash
npm install -g @larksuite/cli@latest
lark-cli config init
lark-cli auth login
lark-cli auth status
```

按 CLI 提示创建或配置企业自建应用，申请实际需要的权限并完成用户授权；管理员审批后可能需要重新登录授予新增权限。日常调用显式使用 `--as user`，凭证由本机 CLI 管理。克隆仓库不会复制登录态；已配置的机器无需重新创建应用。

## 飞书更新

```bash
python3 scripts/sync-lark-suite.py --check  # 只检查项目套件是否需要同步
python3 scripts/sync-lark-suite.py          # 同步官方套件中的六项能力
```

脚本直接获取[官方 suite 发布包](https://open.feishu.cn/lark-cli/skills/isolated/.well-known/agent-skills/index.json)，校验官方 SHA-256、保留六项路由、校验已安装能力的内部引用，并更新项目副本。官方发布包未标注对应 CLI 版本，因此以 [.upstream.json](.agents/skills/lark-suite/.upstream.json) 中的包摘要记录同步基线。子资料保留对其他未安装能力的引用，入口会提示其可用范围。

CLI 升级使用 `lark-cli update --skills-layout suite`；该命令同时管理机器上的全局 skills，执行后仍需运行上述脚本同步本仓库。两者分别更新，并在更新后验证需要使用的命令与权限。

同步脚本仅修改项目内的 `lark-suite`，检测到该目录被手工修改时会停止。输出为 JSON；`--check` 的退出码为 `0`（一致）、`1`（有更新）、`2`（失败），普通同步成功返回 `0`。脚本不安装 CLI、不改授权、不自动提交，也不配置定时任务；更新后检查 Git diff、验证日常读取场景，再提交仓库。

技能正文与参考资料沿用官方内容；本地仅裁剪 suite 路由、补充项目同步说明，并把入口 frontmatter 收敛为 `name` 和 `description`。上游许可见 [MIT License](third_party/larksuite-cli-LICENSE)。
