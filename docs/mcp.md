# MCP 工具、多客户端 OAuth 与本机连接

2026-09-11。7 项工具已接入真实服务，支持 Streamable HTTP、本机 stdio，以及 ChatGPT、Claude 远程连接器的 DCR OAuth 授权。客户端策略集中到注册表，可继续扩展。工具不会调用摘要模型。完整用户登录、跨设备账号同步与正式公网部署仍留到后续；摘要质量由用户验收。

实际验收：用户于 2026-09-10 确认 ChatGPT 移动端成功调用笔记创建工具并写入一篇 Note。后续计划部署 Ubuntu 轻量云服务器与固定 HTTPS 地址；目前仍使用下方临时隧道测试流程。

## 在 ChatGPT 官方客户端测试

1. 本机已安装 Cloudflare 官方 `cloudflared`。新设备需自行安装并加入 PATH，或放到 `demo/.wrangler/bin/cloudflared.exe`。运行前先停止占用 3000 的旧服务。
2. 在 `demo` 目录执行 `pnpm build`、`pnpm db:init`、`pnpm chatgpt`。后者启动本机手账、受限网关和 Cloudflare 临时 HTTPS 隧道。普通 `pnpm start` 只启动本机服务，不启用 OAuth 公网入口。
3. 打开 `http://127.0.0.1:3000/`，进入要测试的手账 → **连接设置 → 准备 ChatGPT 连接**，复制页面给出的 HTTPS MCP 地址。首次准备只同步这本手账的已保存内容；旧副本先接收远端变更，再按现有同步规则更新。
4. **桌面端**：在设置的 MCP 服务器中添加 Streamable HTTP 地址，Bearer 令牌环境变量、标头和环境变量标头均留空。保存后回到服务器列表，重新启动连接，再点击 **身份验证**。DCR 是客户端自动执行的协议步骤，不是该编辑页上的选择项。也可在 PowerShell 执行 `codex mcp login contexthub --oauth-client-registration dcr`（服务器名按实际配置）。**网页端**使用插件入口，不读取桌面 MCP 配置；自定义插件入口能否显示取决于开发者模式与工作区策略，不要按桌面设置菜单寻找。见[官方桌面 MCP 说明](https://learn.chatgpt.com/zh-Hans/docs/extend/mcp)。
5. ChatGPT 打开 Context Hub 授权页后，复制请求码，回到本机目标手账的连接设置，粘贴到 **确认 OAuth 授权 → 核对请求 → 批准此连接**。然后回到授权页点击 **完成授权，返回 ChatGPT**。本机 loopback 回调会显示“本机 MCP 客户端”，核对实际回调后完成即可。这一步以本机管理会话确认手账所有权，暂不需要注册账号。
6. 在新的 ChatGPT 对话中启用该连接，先测试“读取这本手账的记忆包”，再测试“创建标题为 MCP 测试、正文为连接成功、不标星的 Note”，最后要求读取和精准修改该 Note。写操作是否需要再次确认由 ChatGPT 决定。

授权有效期 30 天，访问令牌最多 1 小时并自动续期。连接列表显示授权到期时间；可随时吊销，访问和续期同时失效。OAuth 连接重新授权在 ChatGPT 发起，不能用手动令牌的“重新生成”代替。

**测试期间保持启动进程运行。** 关闭网页后仍可读写 Note，但停止服务或电脑休眠会中断访问。Cloudflare 临时地址每次启动都会变化，变化后在 ChatGPT 更新地址并重新授权；旧 OAuth 令牌不会被新地址接受。这是测试入口，不是稳定生产域名。临时隧道不支持 SSE；当前 MCP 使用规范允许的无会话 JSON 响应，无需 SSE 推送。

公网只开放 `/mcp/:workspaceId`、OAuth 和授权发现路由，MCP 仍要求有效令牌。本机手账页面、管理接口、模型配置、任务接口和附件文件均不通过网关开放。未经本机批准的授权请求不会签发访问令牌；授权只覆盖所选手账。Cloudflare 转发请求，ChatGPT 仅在工具调用时获得授权范围内的返回数据。

参考：[OpenAI MCP 接入与测试](https://developers.openai.com/plugins/deploy/connect-chatgpt)、[OpenAI OAuth 要求](https://developers.openai.com/plugins/build/auth)、[Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)。

## 在 Claude 远程连接器测试

1. 与 ChatGPT 共用同一手账服务、受限 HTTPS 网关和 OAuth 端点。构建并应用迁移后，在 `demo` 运行 `pnpm mcp:oauth`；`pnpm claude`、原来的 `pnpm chatgpt` 都是同一启动入口，无需同时启动两份。
2. 在本机手账的 **连接设置** 选择 **Claude**，点击准备连接，复制 HTTPS MCP 地址。
3. 在 Claude **设置 → 连接器** 添加自定义连接器，填写该地址。高级设置的 OAuth Client ID / Secret 留空，使用动态注册。连接后按提示进入 Context Hub 授权页。
4. 将请求码粘贴到本机 **确认 OAuth 授权**，核对客户端名称、目标手账和回调地址，批准后回授权页点击 **完成授权，返回 Claude**。
5. 先读取记忆包，再创建并读取一条测试 Note。授权列表显示“Claude · OAuth”，续期、到期、吊销、跨手账限制及 Note 幂等规则与已有客户端共用。

本次按 [Claude 官方认证说明](https://claude.com/docs/connectors/building/authentication) 接入 `https://claude.ai/api/mcp/auth_callback`，用于网页、桌面及移动端的远程连接器。使用已有 DCR + S256 PKCE，不声明 CIMD/OIDC；Claude Code 的 CIMD/localhost 流程不属于这次接入范围。Cloudflare 临时地址变化后，需要在客户端更新地址并重新授权。

## 开始连接

1. 在 `demo/` 执行 `pnpm build`、`pnpm db:init`、`pnpm start`。数据库迁移 `0003_mcp.sql` 新增 MCP 会话、令牌、手账副本与请求回执；保留已有数据。
2. 打开一本手账的“连接设置”，创建访问令牌，选择名称和有效期（1 小时、1 天、7 天或 30 天）。该令牌只授权这一本手账的 7 项工具。
3. 在支持自定义请求头的客户端选择 Streamable HTTP，使用页面显示的地址。令牌仅生成时显示一次；可以复制完整连接配置。示意：

```json
{
  "url": "http://127.0.0.1:3000/mcp/手账ID",
  "headers": {
    "Authorization": "Bearer 在连接页生成的访问令牌"
  }
}
```

4. 客户端可以发现工具并调用 `memory_bootstrap`。记忆包仅在新窗口或严重遗忘时使用，日常按需搜索和读取 Note。
5. 丢失令牌时点击“重新生成”，旧令牌立即失效；“吊销”和到期也会阻止后续调用。浏览器中旧的 `demo_ch_` 演示字符串不会成为真实凭据。

不同客户端的配置外壳可能不同；页面复制的是地址与请求头。`127.0.0.1` 只指向客户端所在设备，云端客户端请使用上方 OAuth 流程和 HTTPS 地址。OAuth 回调允许注册表中列明的官方地址，以及桌面客户端在 `127.0.0.1` / `[::1]` 临时端口上的 `/callback`。本机回调仍要求与注册 URI 完全匹配，并校验 PKCE；不接受局域网地址、域名伪装或其他路径。

## stdio 客户端

不支持 HTTP 请求头但支持启动本地进程的客户端，可启动 `demo/scripts/mcp-stdio.mjs`。将下方脚本路径改为实际绝对路径：

```json
{
  "mcpServers": {
    "context-hub": {
      "command": "node",
      "args": ["/绝对路径/ContextHub/demo/scripts/mcp-stdio.mjs"],
      "env": {
        "CONTEXT_HUB_MCP_URL": "http://127.0.0.1:3000/mcp/手账ID",
        "CONTEXT_HUB_MCP_TOKEN": "在连接页生成的访问令牌"
      }
    }
  }
}
```

Context Hub 服务仍需单独运行。适配器不会启动或停止手账服务，stdout 只输出 JSON-RPC，错误不打印令牌。

## 工具契约

| 工具 | 参数 | 行为 |
| --- | --- | --- |
| `memory_bootstrap` | 空对象 | 返回编排后的记忆包、手账身份和最后网页同步时间。 |
| `notes_list` | 可选 `offset`、`limit` | 返回正常 Note 的 id、标题、star；仅标星条目附 50 个 Unicode 字符的预览。默认 50 条，最多 100 条，返回 `nextOffset`。 |
| `note_read` | `note_id` | 返回正常 Note 的完整标题、正文、star、更新时间和 `revision`。 |
| `note_create` | `title`、`body`、显式布尔 `star`、`request_id` | 持久化新 Note，返回 id 和 revision。标题最多 200 字符，正文最多 65,536 字符。 |
| `note_replace` | `note_id`、`revision`、`old_text`、`new_text`、`request_id`；可选 `field` | `field` 默认 `body`，也可选 `title`。要求非空原文恰好匹配一次，revision 与读取结果一致，替换后保存最近 5 个历史版本。不会修改 star 或状态。 |
| `memory_search` | 非空 `query`；可选 `kind`、`offset`、`limit` | kind 为 all / turn / summary / note。默认 20 条、最多 100 条；原文命中附完整轮次和工具消息，返回 total 与 nextOffset。 |
| `conversation_import` | `url`、`request_id`；可选 `title` | 复用官方公开分享链接解析器，持久化为待确认收件。用户在网页预览并归档后才进入原文；不自动覆盖或归档。 |

工具返回的是用户内容，不是系统指令。弃用/回收站原文和 Note 不参与检索、读取或动态记忆包；摘要仍是已保存的历史文本。附件只提供现有文字和元数据，不返回文件字节。

`revision` 是 Note 内容与状态的 SHA-256 版本标识。Note 已变化、原文匹配零次或多次时返回工具错误，不猜测替换目标。空 `new_text` 可以删除那一处匹配文本；标题不能因此变空。

`syncedAt` 仅表示最近一次网页将内容同步到服务端的时间，MCP 创建、替换或读取 Note 都不会刷新它，也不能据此判断网页是否已接收本次写入。网页后台同步后，后续调用看到该时间更新是正常现象。`note_create`、`note_replace` 和 `note_read` 返回的 `updatedAt` 是 Note 最后修改时间，与持久化记录一致；无内容变化的替换保留原时间。判断 Note 版本应使用 `revision`，不要用时间戳代替版本或同步确认。幂等重试返回首次操作的完整结果，包括当时的时间字段。

每次写入使用新的 `request_id`（1–128 个字母、数字、下划线、短横线、句点或冒号）。网络失败时重试必须复用同一个编号和参数。服务把副本、待接收事件和回执放在同一事务中；同一连接重复编号不会重复创建 Note 或导入收件。重复编号但不同参数会报错。轮换令牌后不要盲目重放旧操作，应先查询内容。

## 网页与本机服务的数据关系

- 模型新建 Note 的变更被网页接收时，收件箱会保存一封通知，注明客户端、工作区、Note 标题和创建时间。通知与 Note、接收回执一起持久化；可标为已读。重复投递或幂等重试不产生重复通知，修改已有 Note 不发创建通知。关闭网页期间创建的 Note 会在重新打开后同步并通知，升级前已接收的创建不会补发通知。

- 首次创建连接时，只将该手账的已保存内容发布到本机 D1 副本。没有创建连接的手账不会自动发布。
- 网页运行期间同步已保存的原文、摘要、记忆编排和 Note；未保存为版本的 Note 草稿不发布。连接页显示最近同步时间。关闭网页后，原文/摘要按最后副本读取；MCP 创建和修改 Note、导入收件仍可运行并跨服务重启保留。
- 网页重新打开后，通过全局接收器先把 MCP 事件和回执原子保存到 IndexedDB，再确认服务端事件。保存失败不会删除服务端变更。原文和摘要依然由既有网页功能维护。
- 同一个 Note 两边都已编辑时，保留网页版本，并把 MCP 版本放入具名冲突副本。用户已弃用、删除或彻底移除的 Note 不会被重新恢复为正常状态。已有未保存草稿保留；界面提示新版本，可以载入最新版本或将草稿另存为版本。
- 旧页面若缺少已经接收的 MCP 回执，不能覆盖服务副本，会要求刷新；服务不会用旧数据静默覆盖已接收的变更。此机制不等于云端多设备同步。
- 单本手账副本与待接收事件合计最多 16 MB，待接收事件最多 200 项；达到上限先打开网页接收或缩小手账。每枚令牌最多保存 10,000 条写入回执，达到后重新生成连接。超限会报错，不截断完整轮次或 Note。

模型 Key、浏览器令牌、文件字节与草稿不进入 MCP 副本。MCP 原始令牌只生成时返回，数据库仅保存散列；浏览器备份不包含令牌或尚未接收的服务端事件。需要备份 MCP 写入时先打开网页接收。

恢复浏览器备份的确认界面会说明：旧 MCP 连接、副本及未接收事件将清除，以免旧内容重新写回恢复后的数据；恢复后重新创建连接。该操作只清除当前浏览器管理会话所属的 MCP 数据，不影响其他会话。

## 协议与维护入口

端点为 `/mcp/:workspaceId`。实现 JSON-RPC 初始化、ping、工具发现和调用；协商支持 2025-11-25、2025-06-18、2025-03-26，未知初始化版本回退到支持版本。采用无会话的 JSON 响应，不声明服务端推送；GET/DELETE 返回 405，通知返回 202。客户端的 Accept 需同时包含 application/json 和 text/event-stream。

本机 Host 和 Origin 均校验，所有 MCP 连接都要求手账作用域的 Bearer 令牌。管理接口使用独立 HttpOnly、SameSite=Strict cookie 和同源校验；投递 Key、摘要模型 Key、MCP Key 互不通用。写入提交时再次校验令牌未吊销且未到期。

OAuth 增加 RFC 9728 资源发现、RFC 8414 授权服务发现、动态客户端注册、授权码 + S256 PKCE、资源 audience 绑定、RFC 9207 `iss` 回传与刷新令牌轮换。授权请求有效 10 分钟，授权码有效 60 秒且只能兑换一次。刷新令牌重放会吊销整条连接；刷新不改变写入幂等回执归属。只保存凭据散列。恢复备份时同步清除所属 OAuth 授权及已批准请求。

仅显式启动的受限网关可通过随机内部密钥提交外部请求；不信任任意 Host / Forwarded 值来选择 issuer。公开路由有请求体、并发和频率限制，授权请求与客户端注册有数量上限。尚未实现 CIMD、OIDC 用户身份或生产级分布式限流。

参考：[MCP Streamable HTTP 规范](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)、[MCP 工具规范](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)。

- `demo/lib/mcp/catalog.ts`：7 项工具的发现契约与说明。
- `demo/lib/mcp/server/tools.ts`：领域操作；分享解析继续复用 imports 模块。
- `demo/lib/mcp/server/handlers.ts`：MCP 协议与管理接口；`repository.ts` 负责 D1 分块、事务、令牌与回执。
- `demo/lib/mcp/snapshot.ts`、`receive.ts`：授权数据投影、Note 冲突处理。
- `demo/lib/mcp/use-mcp.ts`：全局发布与接收；`hub-state.ts` 保存原子回执。
- `demo/components/hub/connections.tsx`：连接管理；复用原有页面和样式。
- `demo/lib/mcp/server/oauth.ts`、`oauth-repository.ts`：OAuth 协议与持久化，迁移 `0004_oauth.sql`。
- `demo/lib/mcp/oauth-clients.ts`：客户端注册表、严格回调匹配、名称和连接说明；服务器与界面共用。
- `demo/components/hub/oauth-connection.tsx`：准备与本机授权确认。
- `demo/scripts/start-chatgpt.mjs`、`mcp-gateway.mjs`：临时 HTTPS 联调启动与严格路由网关。

验证：108 项 Node 测试、TypeScript、应用/脚本/测试 lint、生产构建通过。`tests/mcp-http.mjs` 使用独立 D1 与合成手账，验证真实 HTTP/stdio、权限隔离、离线 Note 写入、服务重启、回执接收和吊销。分享导入通过注入官方格式的合成响应验证，未声称外部来源网络始终可用；未使用真实用户令牌或付费模型。未运行本轮浏览器交互 QA。

OAuth 新增 `tests/mcp-oauth.test.ts` 与 `tests/mcp-oauth-http.mjs`：验证真实 Worker + 受限网关、发现、DCR、人工批准、PKCE、重放与跨手账拒绝、刷新、吊销及重启恢复。ChatGPT 内的实际对话测试由用户执行，不以协议回归替代客户端验收。

## 添加下一个 OAuth 客户端

本轮审查覆盖回调与注册、owner 批准、表单 CSRF、PKCE、目标资源、刷新轮换和网关边界。修正扩展阻碍：回调和客户端文案原先集中写死在 ChatGPT 流程中；现在由同一注册表驱动，且本机回调不再被标成 ChatGPT。保留一项部署前限制：`oauth-repository.ts` 的 DCR 客户端表有全局 1000 条上限，当前 cleanup 只清理到期授权请求，不回收客户端。大量重复注册会导致新连接收到 503；长期公网部署前应完善注册生命周期和防滥用措施。本次不改变已有注册与授权的有效期。

在 `demo/lib/mcp/oauth-clients.ts` 的 `oauthClientProfiles` 中追加一项 `OAuthClientProfile`，设置稳定 `id`、显示 `name`、官方 `redirects` 和 `instructions`，可选 `avatar` 配置头像符号与色调。有连接说明的条目自动出现在连接设置的纵向列表，与“其他客户端 · 访问令牌”同级；整行按钮选择连接方式，右侧常驻详情区默认显示“未选择连接方式”，选择后就地切换授权或令牌表单；列表右上角使用无边框刷新按钮。授权页、核对信息与新授权记录的名称也自动跟随，不需要在 UI 或协议处理器里增加客户端分支。

回调策略支持完整地址精确匹配（优先使用）、固定 HTTPS origin 加完整路径正则，以及明确主机/端口范围/路径的 loopback。动态路径规则只匹配路径，不能放宽主机。规则冲突时拒绝匹配；未知客户端和变形 URL 不会因新增客户端而自动放行。显示名称来自已校验的回调规则，忽略 DCR 自报 `client_name`，且不把 loopback 宣称为某厂商已验证身份。已有授权记录的名称不会被自动迁移。

每次扩展应验证官方回调规则，添加成功与伪装地址拒绝测试，并用合成手账跑授权、续期和吊销。本次还用一个仅存在于测试的第三方配置验证扩展入口。兼容现有 DCR/授权码/PKCE 流程的客户端只需配置；如果将来需要 CIMD 等新注册机制，应扩展注册适配层，不绕过共用的 owner、PKCE、resource 或 CSRF 校验。删除客户端配置不等于吊销已有令牌，停用授权仍通过连接列表执行。

2026-09-11 验证：118 项 Node 测试、TypeScript、应用/脚本/测试 lint、生产构建通过。以下两条均在独立临时 D1、合成手账和本机网关上通过，覆盖 HTTP 发现到 Note 写入、重启、续期及吊销，不连接真实账号：

```sh
node --import ./scripts/local-runtime.mjs tests/mcp-oauth-http.mjs --client=claude --http-only
node --import ./scripts/local-runtime.mjs tests/mcp-oauth-http.mjs --client=chatgpt --http-only
```

`--http-only` 明确跳过浏览器；省略它会运行原有独立 Chrome 表单和回调回归，需 Playwright 与 Chrome。本轮未运行浏览器交互 QA，也未宣称 Claude 官方客户端已完成实际连接验收。原 ChatGPT 移动端 Note 写入成功仍是此前用户确认的基线。
