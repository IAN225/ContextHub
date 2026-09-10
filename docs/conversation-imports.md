# 对话导入：使用与维护

2026-09-09。本轮将手动复制、分享解析、客户端投递接入同一套原文预览与归档流程。摘要生成、远程 MCP、OAuth 与云端账号不在本轮范围内。

## 本地运行

在 `demo/` 内执行：

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm db:init
pnpm start
```

打开 `http://127.0.0.1:3000/`。启动前先结束占用 3000 的旧开发服务，保持这个 origin 可继续读取已有 IndexedDB 手账。`pnpm start` 运行完整构建的本地服务，首次初始化和后续迁移都使用 `pnpm db:init`；迁移记录防止重复执行。生成新的数据库迁移后应重新构建，再应用迁移。

`pnpm dev` 仍用于前端开发。开发运行器会拒绝部分外部 Origin 的预检请求；浏览器客户端跨站投递应连接 `pnpm start` 启动的完整服务，不要通过放开整个开发服务器 CORS 解决。

没有注册或部署云端站点。默认只监听本机。其他设备的客户端需要可访问此服务的网络地址；`127.0.0.1` 指向客户端自己，不能用于跨设备连接。

## 三种入口

### 手动复制

“收录对话 → 手动复制”支持带角色标记的文本、请求 JSON、`[{role, content}]` 消息数组。自动模式优先识别 JSON；也可明确选择文本，避免以 `{` 或 `[` 开头的原文被误判。

```text
用户：第一条问题
助手：第一条回答
用户：第二条问题
助手：第二条回答
```

支持英文 User/Assistant、You said/ChatGPT said 和 Markdown 角色标题。代码围栏中的角色字样不分割消息。不带标记的文本明确标为一条用户原文；首个角色标记前有未归属内容，或对话以孤立助手回复开头，会要求补充边界。旧 JSON 草稿可在手动复制页继续处理。

### 分享链接

点击“导入收件箱”后，读取结果先持久化到浏览器，再打开收件箱。链接与客户端投递共用查看、修改、删除和归档流程；退出收件箱不影响待归档内容。旧的未确认链接通过 `inboxUploads` 自动纳入，不需要迁移或再次解析。手动复制仍使用独立确认窗口，工作台摘要仍归属于原手账。

支持 ChatGPT 与 Claude 官方 HTTPS `/share/<UUID>` 链接。先规范化主机和路径，再由平台适配器构造读取地址。不会读取任意网址、跟随重定向或执行页面脚本。

- ChatGPT：读取页面中的 JSON / React Router 数据表，沿当前消息链选择分支；不把所有历史分支混在一起。保留公开文字、代码与工具消息，跳过隐藏思考。链条缺失或无法确定分支时拒绝导入。
- Claude：读取公开 `chat_snapshots` 数据，解析公开文字与工具活动。未公开的参数、结果及素材保留缺失标记。
- 附件只有取得字节才能算保存：内嵌文件直接保留，公开 HTTPS 地址进入后台获取队列，私有 ID/缺失来源和下载失败明确标记。详见 [附件与后台任务](2026-09-10-attachments-background.md)。时间暂不恢复，避免猜测原始时间精度。
- 来源要求登录、验证、限制访问，或分享被删除时，返回结构化错误，不生成示例对话。

**实测边界：** 已从项目原有 ChatGPT 样本的实际页面数据解析出 1 个用户轮次及 7 条公开消息，另一个旧样本的已删除状态也正确识别。通过本地 Worker 直接联网读取样本时，出现来源访问限制或连接超时；Claude 的公开接口返回 403。因此解析实现与离线回归已验证，当前网络环境下的联网成功路径仍受来源限制，不能把这次结果视为两平台稳定联网验收。原始样本与公开页面脚本只保存在被忽略的本地文件中，不进入仓库。

### 客户端投递

“收录对话 → 客户端投递”中生成真实投递 Key，在客户端配置：

| 配置 | 值 |
| --- | --- |
| Base URL | `http://127.0.0.1:3000/v1` |
| 模型名 | `context-hub` |
| Key | 页面本次生成的投递 Key |

支持 `/v1/chat/completions`、`/v1/responses`、`/v1/messages`，以及需要 Key 的 `/v1/models`。Chat/Responses 使用 `Authorization: Bearer …`；Messages 也接受 `x-api-key`。兼容普通 JSON 回执与 SSE 回执，不转发到模型服务、不生成模型回答，也不需要模型供应商 Key。

收录范围是客户端本次实际发送的消息。若客户端裁剪了历史，服务端不能恢复未发送部分；Responses 的 `previous_response_id` 或远程 conversation 引用会明确拒绝。完整 user 轮次包含后续助手消息、工具调用与结果；系统提示词和结构化隐藏思考不收录。

每次投递是一份上下文快照，归档前可删除不需要的轮次。重发完全相同的内容不会重复收件；不同内容的快照不会自动与手账已有原文合并，请检查重叠。

可选请求头 `Idempotency-Key`（1–128 个可打印 ASCII 字符）供客户端安全重试。同一 Key 不同正文返回 409；无此请求头时按规范化后的公开消息和标题计算指纹。普通/流式选项和随机导入 ID 不影响去重。可通过 `metadata.context_hub_title` 指定标题。

Key 在服务端只存 SHA-256 摘要，原值只在本次生成后显示。重新生成或吊销立即使旧 Key 失效，已有队列内容保留。收件管理会话使用 HttpOnly、SameSite=Strict cookie，与只能投递的 Key 分离；不同会话无法互读或确认收件。此为本地浏览器收件会话，不是云端账号或跨设备恢复机制。

## 数据流与保存边界

```text
复制文本 ── 文本 / JSON 插件 ─┐
公开链接 ── 平台解析插件 ────┼─ 统一 Upload → 预览 → 选择手账归档
客户端请求 ─ 协议插件 → 队列 ─┘
```

投递先写入本机 D1/SQLite 队列，落盘后才返回成功回执。服务运行期间，页面关闭也能收件。页面开启并启用收件后按批拉取；只有原文候选与 receipt 在同一 IndexedDB 提交中保存成功，才向队列发送 ack。ack 失败可重试，本地 receipt 防止覆盖用户已编辑的候选，或复活已经归档/删除的收件。

ack 后只保留去重凭证，清除队列中的对话正文。手账、草稿、已接收候选仍在当前 origin 的 IndexedDB，未迁移为云端数据库。清除浏览器数据仍会丢失这些本地内容；清除收件 cookie 后不会自动找回旧会话。`.wrangler/state` 是本机队列数据库，不属于构建产物，开发、初始化和构建预览统一使用这个路径。

请求体与整理后的候选各限 2 MB，最多 12,000 条消息。单会话最多 100 份或 20 MB 待接收正文，每批最多取 5 份。超限会明确失败，不丢弃最早收件。分享抓取最多读取 8 MB，20 秒超时，不将页面脚本当作代码运行。

## 模块职责

| 位置（相对 `demo/`） | 职责 / 改动入口 |
| --- | --- |
| `lib/imports/contracts.ts` | 统一错误、大小限制、解析结果和 Upload 生成；保存解析器版本与来源 |
| `lib/imports/parsers/manual.ts` | 手动文本的角色边界与代码围栏 |
| `lib/imports/manual.ts`、`draft.ts` | 手动格式选择、旧草稿迁移 |
| `lib/imports/parsers/request-messages.ts` | 请求消息块转换；旧 `lib/import.ts` 仅保留兼容导出 |
| `lib/imports/protocols.ts` | 请求协议注册与完整性校验 |
| `lib/imports/parsers/chatgpt-share.ts`、`claude-share.ts` | 两个平台的纯解析器；无网络、存储或 React 依赖 |
| `lib/imports/share-providers.ts` | 分享来源注册：主机、请求地址、版本、解析函数 |
| `lib/imports/server/share-service.ts` | 允许的链接格式、网络读取、超时、大小限制 |
| `lib/imports/server/repository.ts` | 队列存储接口及 D1 实现，原子去重、配额、确认与清理 |
| `lib/imports/server/auth.ts` | 收件会话、投递 Key、请求来源校验 |
| `lib/imports/server/acknowledgements.ts` | 三种协议的 JSON/SSE 收件回执 |
| `lib/imports/server/handlers.ts` | 服务命令协调、结构化错误、请求结束处理 |
| `lib/imports/server/runtime.ts` | 平台数据库绑定，便于替换运行环境 |
| `app/api/imports/[action]/route.ts`、`app/v1/[...path]/route.ts` | 薄 HTTP 路由，不承载领域规则 |
| `lib/imports/client.ts`、`use-delivery-inbox.ts` | 浏览器请求和收件生命周期；先提交再 ack |
| `components/hub/imports/` | 三种入口各自的表单；导入弹窗只协调流程 |
| `lib/hub-state.ts` | 共用归档命令和已接收凭证，不认识平台 HTML |
| `drizzle/0000_imports.sql` | 首个队列迁移；后续迁移另加有序 SQL 文件 |

增加分享平台时，新增纯解析器、注册来源、增加脱敏格式样本及测试；不修改归档、队列或手账页面。更换数据库时实现 `ImportRepository` 并更换 runtime 绑定。调整某个协议的输入或回执时，分别改解析插件或回执模块，不改 UI 状态。

成功导入的原文轮次保留 `provenance.parser/version/sourceUrl/issues`，归档与编辑不丢弃来源。接口错误包含稳定 `error.code` 与中文解释。日志不写对话正文、Key、cookie 或分享地址。

常见错误：`INVALID_JSON`（请求格式）、`INCOMPLETE_CONTEXT`（缺少开头用户消息）、`REMOTE_HISTORY`（仅引用远程历史）、`SOURCE_RESTRICTED`（来源限制）、`SHARE_FORMAT_CHANGED`（格式变化）、`INCOMPLETE_BRANCH`（消息链缺失）、`INVALID_KEY`（投递凭据）、`IDEMPOTENCY_CONFLICT`（重复编号冲突）、`INBOX_FULL`（待接收队列满）。

## 验证

```sh
pnpm test
pnpm typecheck
pnpm exec oxlint app components/hub lib tests
pnpm build
pnpm db:init
pnpm start
# 另一个终端；脚本使用独立的合成会话，不读取浏览器 cookie 或真实聊天
IMPORT_BASE_URL=http://127.0.0.1:3000 node tests/import-service.mjs
```

PowerShell 可使用 `$env:IMPORT_BASE_URL='http://127.0.0.1:3000'` 后运行脚本。脚本默认验证 3002 端口，方便不占用日常页面。

单元/领域测试覆盖文本边界、代码保留、隐藏思考、分支、失效来源、地址限制、旧草稿、重试不复活候选，以及生产 SQL 的持久化、隔离、配额和 Key 失效。HTTP 集成覆盖三种协议普通/流式回执、模型列表、CORS、错误请求、去重、跨会话确认防护、轮换吊销。真实来源访问受限时与离线解析测试分开报告，不拿夹具测试替代联网成功。

Windows 本地 Workerd 代理在提前拒绝但未处理请求体时，可能让下一请求遇到误报的重启 503 或 GET 等待；异常路径会限时丢弃剩余请求体（不保留内容），不能安全结束时关闭连接，集成测试验证后续请求仍正常。外部模型 API 没有被调用。

既有 `component-lifecycle.mjs`、`workspace-controls.mjs` 和 `style-parity.mjs` 已更新入口名称与手动导入场景，但本轮未运行浏览器检查。新增手动页使完整视觉采样由 56 个状态变为 60 个；导入界面是本轮明确变更，旧导入截图不能作为当前界面不变的验收依据，新的截图基线尚未采集。

协议参考：[OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)、[OpenAI Responses streaming](https://platform.openai.com/docs/api-reference/responses-streaming)、[Anthropic Messages streaming](https://platform.claude.com/docs/en/build-with-claude/streaming)。
