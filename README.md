# control-center

供 Claude Code 与 Codex 使用的 skills，仅在本仓库内生效：在仓库目录中启动 agent 即自动加载。

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
