# MCP 工具与本机连接

2026-09-10。连接页的 7 项工具已接入真实本机服务，支持 Streamable HTTP，以及供本机客户端启动的 stdio 适配器。工具不会调用摘要模型。OAuth、云端访问和跨设备账号同步仍留待账号阶段。

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

不同客户端的配置外壳可能不同；页面复制的是地址与请求头。`127.0.0.1` 只指向客户端所在设备，因此云端 ChatGPT/Claude 不能连接这个本机地址。本轮没有公网部署或官方 OAuth 授权，不要把示例本机地址当成公网端点。

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

每次写入使用新的 `request_id`（1–128 个字母、数字、下划线、短横线、句点或冒号）。网络失败时重试必须复用同一个编号和参数。服务把副本、待接收事件和回执放在同一事务中；同一连接重复编号不会重复创建 Note 或导入收件。重复编号但不同参数会报错。轮换令牌后不要盲目重放旧操作，应先查询内容。

## 网页与本机服务的数据关系

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

参考：[MCP Streamable HTTP 规范](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)、[MCP 工具规范](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)。

- `demo/lib/mcp/catalog.ts`：7 项工具的发现契约与说明。
- `demo/lib/mcp/server/tools.ts`：领域操作；分享解析继续复用 imports 模块。
- `demo/lib/mcp/server/handlers.ts`：MCP 协议与管理接口；`repository.ts` 负责 D1 分块、事务、令牌与回执。
- `demo/lib/mcp/snapshot.ts`、`receive.ts`：授权数据投影、Note 冲突处理。
- `demo/lib/mcp/use-mcp.ts`：全局发布与接收；`hub-state.ts` 保存原子回执。
- `demo/components/hub/connections.tsx`：连接管理；复用原有页面和样式。

验证：108 项 Node 测试、TypeScript、应用/脚本/测试 lint、生产构建通过。`tests/mcp-http.mjs` 使用独立 D1 与合成手账，验证真实 HTTP/stdio、权限隔离、离线 Note 写入、服务重启、回执接收和吊销。分享导入通过注入官方格式的合成响应验证，未声称外部来源网络始终可用；未使用真实用户令牌或付费模型。未运行本轮浏览器交互 QA。
