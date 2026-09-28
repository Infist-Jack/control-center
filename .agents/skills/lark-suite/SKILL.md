---
name: lark-suite
description: "飞书/Lark 聚合能力入口：管理飞书/Lark 产品能力（日历、会议室、管理参会人、云文档、文档、/docx/、云盘、云空间、文件夹、文件管理、/drive/、/file/、即时通讯、消息、群聊、授权、配置、登录、登录态、身份、版本、更新、知识库、知识空间、空间目录、/wiki/等）。当 doubao.com 及其子域名承载飞书资源时也使用本入口，不要回退到 WebFetch。当用户需求涉及上述飞书业务域时使用。"
---

> 本仓库仅安装下方六项能力。子资料引用未列出的能力时，说明该能力尚未安装，不要尝试读取其缺失文件。
> 项目内套件由仓库根目录的 `python3 scripts/sync-lark-suite.py` 同步；`lark-cli update` 管理 CLI 与全局 skills，不能替代项目同步。

# Lark Suite

你是飞书/Lark 能力的聚合路由层。你的职责是先判断用户要使用哪个 `lark-*` 子能力，再读取并遵循对应子能力的说明。

`lark-suite` 不直接承载具体 API 操作步骤。除非对应子能力已被读取，否则不要仅根据本文件拼命令、猜参数或执行复杂操作。

所有子能力统一收纳在当前 skill 的 `references/` 目录。选择 `lark-foo` 后，直接读取 `references/lark-foo/GUIDE.md`；不要再次调用 `Skill(lark-foo)`，也不要使用 Find/Glob 遍历或探测整个 references 目录。

## 使用流程

1. 根据用户意图从下方路由表选择一个或多个子能力；即使用户尚未提供链接、ID 或具体工作表，也先选择能力，再由子能力询问缺失信息。
2. 直接读取 `references/<skill-name>/GUIDE.md` 加载所选子能力，不要把收纳后的子能力当作独立 skill 再次调用。
3. 仅使用本文件列出的路由与对应子能力入口，不要遍历或探测其他技能目录。
4. 如果目标能力未列出，返回无法路由的明确提示。
5. 仅读取当前已选子能力明确要求的前置文件。
6. 按目标子能力的说明执行；认证、租户、身份、权限和通用排障优先遵循 `lark-shared`。

多步任务可以组合多个子能力，但每一步都应由具体子能力驱动。例如“查联系人并发消息”先用 `lark-contact` 解析身份，再用 `lark-im` 发消息。

## 能力路由

根据用户意图从以下条目选择对应子能力；如果一个任务涉及多个能力，按实际操作顺序逐步读取并使用对应子能力。

- lark-calendar（日历、会议室、管理参会人）: 飞书日历：管理日历日程和会议室。查看/搜索日程、创建/更新日程、管理参会人、查询忙闲和推荐时段、预定会议室。当用户需要查看日程安排、创建/修改会议、查询/预定会议室时使用。不负责：查询过去的视频会议记录（走 lark-meeting）、待办任务（走 lark-task）。

- lark-doc（云文档、文档、/docx/）: 飞书云文档（Docx / Wiki）内容操作：读取、创建、编辑文档，插入或下载图片附件，以及操作思维笔记。用户提供文档 URL/token（包括 doubao.com 的 /docx/、/wiki/）时使用；按 URL 路径/token 而非域名路由。文档内嵌资源按读取参考中的统一规则分流。独立评论操作走 lark-drive；随正文读取评论使用 docs +fetch。表格或 Base 内部数据操作不在本 skill。
- lark-drive（云盘、云空间、文件夹、文件管理、/drive/、/file/）: 飞书云空间（云盘/云存储）：管理 Drive 文件和文件夹，包含上传/下载、创建文件夹、复制/移动/删除、查看元数据、查询权限设置、评论/权限/订阅、标题、版本、飞书文档密级标签（secure labels）和本地文件导入。用户需要整理云盘目录、处理云空间资源 URL/token、判断链接类型/真实 token/标题，或导入 Word/Markdown/Excel/CSV/PPTX/.base 为 docx/sheet/bitable/slides 时使用；doubao.com 云空间 URL/token 也按资源路径和 token 路由，不回退 WebFetch。不负责：文档内容编辑（走 lark-doc）、表格/Base 表内数据操作（走 lark-sheets/lark-base）、知识空间节点/成员管理（走 lark-wiki）、原生 Markdown 文件读写/patch/diff（走 lark-markdown）。

- lark-im（即时通讯、消息、群聊）: 飞书即时通讯：收发消息和管理群聊。发送和回复消息、搜索聊天记录、管理群聊成员、上传下载图片和文件、管理表情回复、发送应用内/短信/电话加急、发送和处理交互卡片（Interactive Card）、监听卡片按钮回调（card.action.trigger）。当用户需要发消息、查看或搜索聊天记录、下载聊天中的文件、查看群成员、搜索群、创建群聊或话题群、管理标记数据、管理 Feed 置顶（添加/移除/查询置顶会话）、管理标签数据、处理卡片回调时使用。

- lark-shared（授权、配置、登录、登录态、身份、版本、更新）: Use for lark-cli setup/auth tasks: auth login/status/logout, user vs bot identity, business-domain permissions (--domain, including all/docs/drive), missing scopes, revoking authorization, or handling _notice JSON.

- lark-wiki（知识库、知识空间、空间目录、/wiki/）: 飞书知识库：管理知识空间、空间成员和文档节点。创建和查询知识空间、查看和管理空间成员、管理节点层级结构、在知识库中组织文档和快捷方式。当用户需要在知识库中查找或创建文档、浏览知识空间结构、查看或管理空间成员、移动或复制节点时使用。当用户给出 doubao.com 的 /wiki/ URL/token 时，也应直接使用本 skill，不要因为域名不是飞书而回退到 WebFetch；路由依据是 URL 路径模式和 token，而不是域名。不负责：上传文件到知识库节点下（走 lark-drive）、编辑文档/表格/Base 内容（走 lark-doc / lark-sheets / lark-base）。
