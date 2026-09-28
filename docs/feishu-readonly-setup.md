# 飞书 CLI 接入与验收

实现方式概览见 [飞书能力如何接入](feishu-integration.md)。本文件保留分阶段配置与实际验收记录。

初始范围：以用户本人身份，按需读取私聊和群聊历史、普通文档与知识库文档，并支持消息和文档搜索。后续用户已明确要求代发指定消息，以及创建和书写飞书文档；这些写入操作已分别验收。

## 已准备的环境

- 官方 CLI：`@larksuite/cli@1.0.96`，安装在当前服务器用户的 npm 全局目录。
- 项目技能：`lark-shared`、`lark-im`、`lark-doc`、`lark-drive`、`lark-wiki`、`lark-calendar`。
- 唯一技能源：`.agents/skills/`；`.claude/skills` 通过已有软链接共享。
- 上游：[larksuite/cli v1.0.96](https://github.com/larksuite/cli/tree/v1.0.96)，提交 `cb5a3d704379552dc61e37898e5f74798783190d`。
- 本地适配：六个 SKILL.md 的 frontmatter 按仓库约定仅保留 `name` 和 `description`；正文和参考资料保留上游内容。许可证见 [第三方许可证](../third_party/larksuite-cli-LICENSE)。

2026-09-28 初始检查结果：CLI 与首批五个技能校验通过，应用配置与用户登录已完成，用户 token 已通过在线验证。私聊和群聊各抽样读取 3 条历史消息成功；用户指定的知识库链接解析成功，其底层普通文档正文读取成功。本机 CLI 默认身份已设为 `user`，日常命令仍显式指定 `--as user`。加入日历 skill 后，六个技能均已通过结构校验。

后续验收结果（2026-09-28）：

- 群历史分页、逐话题完整回复、消息详情、合并转发及可下载的图片和文件附件已验证。已撤回消息只能保留占位，不能恢复正文；不能把通话标记或外链当作已读取录音或链接目标。
- 用户身份私信发送及回读已验证。`im:message.send_as_user` 在管理员审批通过后重新完成用户授权，才进入本机登录的权限范围。旧授权结果不能代表最新审批状态。
- 普通文档创建、正文写入、加粗、列表、原生文档表格、文末追加、局部文本修改及回读核对全部通过。创建使用 `docs +create`，追加和修改使用 `docs +update`；未覆盖重建原文。文档写入使用现有授权，无需额外申请权限。
- 独立消息搜索、文档搜索、指定文件夹或知识库下新建文档、图片和附件写入尚未逐项验收。初始请求中的 `search:docs:read` 曾返回待管理员审批，本次没有重新核验这项权限。
- 个人文档库可按 `my_library` 列举，已读完当次返回的节点清单并读取正文；对已发现文档的 `edit` 权限检查均通过。普通文档不一定已经挂入个人文档库，不能把创建成功等同于入库成功。
- 日历：官方 `lark-calendar` 已安装并通过技能结构校验，[五项日程权限](feishu-calendar-scopes.txt)已实际授予。本人日程读取、空闲时间推荐、忙闲查询、创建仅本人参加的日程、读取详情与会议链接、保持 30 分钟时长改期、取消和取消后回查全部通过。测试日程已取消，有效日程清单恢复到测试前状态；多人邀请、会议室和重复日程尚未验收。
- 日历授权经验：首次额外申请的 `calendar:calendar.calendar:readonly` 被企业禁止申请，已从清单移除，不重试该权限。官方日程命令直接向事件接口传入 `primary`，本次测试无需调用主日历信息查询接口；以上五项权限足以完成已验收的操作。授权结果是当次快照，不能代替最新审批状态；管理员审批通过后重新完成用户授权，才获得本机操作权限。

**实际授权范围说明：** 初次使用明确的只读 scope 列表发起登录，但 `auth status --json --verify` 返回的已授权 scope 还包含写入权限，超出了请求清单。请求范围与最终授权范围不能视为相同；额外权限来源尚未核实。首次验收只执行读取，后续写入限于用户明确要求的任务。若要严格收窄，需要检查应用后台和用户授权管理；不要假设重新请求少量 scope 就会撤销此前已授予的权限。

## 第一阶段管理员审批材料（只读范围）

可复制的用途说明：

> 为个人研发助手开通飞书只读访问。使用官方 lark-cli，以本人 OAuth 用户身份查询本人有权访问的私聊、群聊历史、普通文档及知识库文档，用于检索项目上下文。首阶段申请下列用户身份读取/搜索权限；不申请发送消息、编辑文档或管理成员权限。CLI 与凭证保存在助手实际运行的服务器，凭证不进入代码仓库。应用可用范围先限定为本人，按企业审批规则配置。

在应用后台选择**用户身份权限**。管理员批准应用权限后，还需要本人完成 OAuth 授权；应用权限不会扩大本人对具体资源的访问权。

| Scope | 用途 |
| --- | --- |
| `im:chat:read` | 查找本人所在会话、获取会话信息 |
| `im:message:readonly` | 消息正文、详情、话题回复的基础读取 |
| `im:message.p2p_msg:get_as_user` | 以本人身份读取私聊 |
| `im:message.group_msg:get_as_user` | 以本人身份读取群聊 |
| `im:message.reactions:read` | CLI 默认补全消息表情回应；若不批准，可用支持的 `--no-reactions` 跳过 |
| `search:message` | 搜索历史消息 |
| `docx:document:readonly` | 读取普通文档正文 |
| `wiki:node:retrieve` | 解析知识库文档节点 |
| `search:docs:read` | 搜索文档及知识库对象 |

机器可读列表为 [feishu-readonly-scopes.txt](feishu-readonly-scopes.txt)，不是飞书后台批量导入 JSON。CLI 登录还会自动请求 OAuth `offline_access`，用于刷新用户凭证；授权页面上应说明这一项。

这些权限用于已确认的读取路径。浏览全部知识空间/节点目录、独立评论查询、下载附件，以及电子表格或多维表格内部数据，按实际需要另行核对权限；不要为了它们直接申请全部业务域权限。

依据：[用户授权](https://github.com/larksuite/cli/blob/v1.0.96/skills/lark-shared/references/lark-shared-identity-and-permissions.md)、[消息历史权限声明](https://github.com/larksuite/cli/blob/v1.0.96/shortcuts/im/im_chat_messages_list.go)、[文档读取权限声明](https://github.com/larksuite/cli/blob/v1.0.96/shortcuts/doc/docs_fetch.go)、[知识库节点权限声明](https://github.com/larksuite/cli/blob/v1.0.96/shortcuts/wiki/wiki_node_get.go)、[文档搜索](https://github.com/larksuite/cli/blob/v1.0.96/skills/lark-drive/references/lark-drive-search.md)、[offline_access 自动添加](https://github.com/larksuite/cli/blob/v1.0.96/internal/auth/device_flow.go)。

## 应用与用户授权

1. 创建或选定企业自建应用，按企业流程申请上述权限并发布/提交审批。应用配置使用官方 `lark-shared` 的配置流程；密钥通过本机安全输入配置，不粘贴到会话或提交到仓库。
2. 管理员批准所需权限、应用配置完成后，在仓库目录发起指定 scope 的用户授权：

   ```bash
   lark-cli auth login --scope "$(paste -sd ' ' docs/feishu-readonly-scopes.txt)" --no-wait --json
   ```

   如果审批仅通过部分权限，先调整本次请求范围，不将未获批权限描述为可用。此阶段不使用 `--recommend` 或 `--domain all`，因为它们会请求所有已知业务域。
3. 将 CLI 本次返回的授权链接及二维码交给用户；用户完成后，Agent 在下一轮用本次 `device_code` 完成登录。链接失效时重新发起，不复用旧链接。
4. 使用 `lark-cli auth status --json --verify` 检查本人身份、有效性与已授予范围，再执行真实读取验收。

## 验收与日常调用约定

读取操作显式使用 `--as user`，失败时不自动切换机器人身份。依据对应官方参考或本机 `--help` 选择命令；凭证交给 CLI 管理。

| 验收对象 | 命令入口 | 完成标准 |
| --- | --- | --- |
| 本人的私聊和群聊列表 | `im +chat-list` | 使用 `--types p2p,group`；找到指定样本会话，检查分页 |
| 一段私聊和群聊历史 | `im +chat-messages-list` | 指定会话和时间范围，与客户端内容、时间及发送者对照 |
| 一条消息及其话题 | `im +messages-mget`、`im +threads-messages-list` | 正文与回复可读取，返回消息 ID 和可用来源链接 |
| 一个历史关键词 | `im +messages-search` | 找到已知消息，能补取详情 |
| 一篇普通文档 | `docs +fetch` | 文档标题与正文可读取，保留原文链接 |
| 一篇知识库文档 | `docs +fetch`；需要时 `wiki +node-get` | 正确解析目标文档并读出正文 |
| 一个文档关键词 | `drive +search` 后 `docs +fetch` | 能从结果定位文档并读取正文 |
| 用户明确要求发送的消息 | `im +messages-send` 后 `im +messages-mget` | 身份、收件人与正文正确，保存消息链接；缺少发送权限时按实际错误补充授权 |
| 创建并书写普通文档 | `docs +create` 后 `docs +fetch` | 先按创建工作流生成并检查草稿，再创建；读回标题、正文和格式 |
| 追加和局部修改文档 | `docs +update` 后 `docs +fetch` | 先读当前状态；追加使用 `append`，简单文本修改使用 `str_replace`；回查改动与需保留的内容 |
| 本人日程完整测试 | `calendar +agenda`、`+suggestion`、`+freebusy`、`+create`、`+get`、`+list-attendees`、`+update`、`+delete` | 明确测试范围；只创建本人参加的临时日程，读取实际起止时间后保持时长改期，最后只取消本次创建的日程并核验清理结果 |

必须检查 `has_more`、分页上限、截断提示及局部读取范围。文档中的图片、附件、内嵌表格或同步引用需按返回结构另行处理，不能把拿到 token 或占位信息当作已经读懂内容。

对每项结果记录“通过 / 缺少应用权限 / 用户未授权 / 无资源访问权 / 平台不支持”。真实聊天、文档正文、授权链接、device code 和密钥不放入本公开仓库。
