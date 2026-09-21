# MCP 工具

每个连接只访问授权工作区。账号、工作区和权限由连接决定，不是工具参数。读写直接使用账号数据库，浏览器关闭后仍可调用。服务端提供 10 个工具，工具发现时返回输入/输出 JSON Schema、默认值、副作用标记和业务错误码。

## 工具契约 v2

服务端 `initialize.serverInfo.version` 为 `0.2.0`，工具 `_meta.contract_version` 为 `2`；这不是 MCP 传输协议版本。MCP 传输继续支持 2025-11-25、2025-06-18、2025-03-26。

输入只接受工具定义中的字段，输出统一使用 snake_case。读写结果通常带 `workspace_id`、`workspace`、`read_at`（读取时间）；Note 的 `updated_at` 才是修改时间。原文读取使用范围元数据，完整输出结构以 `tools/list` 的 `outputSchema` 为准。成功输出会在写入提交前完成校验。

升级后请让客户端重新发现工具，必要时断开并重新连接。旧版的 `memory_bootstrap.engine`、摘要提交参数 `text/source_revision/summary_revision/from_turn/to_turn`、`next_turn` 分页和 camelCase 返回字段已移除。旧版下载链接需重新获取。数据库中的原文、Note 和摘要内容不因契约升级重写，账号 SQL schema 仍为 5，网页协议为 6。

## 读取工具

| 工具 | 参数 | 结果与用途 |
| --- | --- | --- |
| `memory_bootstrap` | 无 | 加载用户配置的记忆包；新窗口或严重遗忘时使用 |
| `notes_list` | `offset=0`、`limit=50` | 正常 Note 的 ID、标题、标星状态；仅标星项附前 50 字预览 |
| `note_read` | 必填 `note_id` | Note 全文、标星、修改时间和 revision |
| `memory_search` | 必填 `query`；`kind=all`、`engine`、`offset=0`、`limit=20` | ID、标题、类型、最多 280 字片段；原文附轮次 `number`，不返回全文，原文标题用轮次编号表示 |
| `summary_read` | `engine`、`summary_id` | 默认读取该方案活跃摘要，也可按 ID 读取历史摘要；返回当前活跃轨道 revision、近期窗口起点 |
| `conversation_read` | `mode=page`、`from_turn=1`、可选 `to_turn`；分页模式另有 `offset=0`、`limit=20` | 完整轮次分页，或短期 JSON 下载链接；返回 source 范围凭据及 base_summary_revision |

`engine` 可取 `custom`、`reme`、`client`，省略时跟随用户的记忆来源。它只存在于搜索与摘要读取，不改变用户设置。`summary_read.summary_id` 未传且无活跃摘要时返回 `summary=null`，revision 仍有效；传入不存在的历史 ID 返回 `SUMMARY_NOT_FOUND`。读取历史摘要时，revision 仍代表当前活跃轨道，不表示该历史条目成为累积摘要基线。

分页 `limit` 为 1–100，`offset` 为 0–1,000,000；用 `next_offset` 继续。搜索按不区分大小写的字符串包含匹配标题与正文，没有向量检索或相关度排序。原文与 Note 排除弃用/回收站内容；摘要搜索覆盖所选方案保留的历史版本。

典型查找：

```json
{"name":"memory_search","arguments":{"query":"部署端口","kind":"all"}}
```

原文结果返回 `number=125` 时，完整读取这一轮：

```json
{"name":"conversation_read","arguments":{"from_turn":125,"to_turn":125}}
```

Note 使用 `note_read`，摘要使用 `summary_read` 并携带搜索响应中的 engine。

## 写入工具

| 工具 | 必填参数 | 可选参数 |
| --- | --- | --- |
| `note_create` | `title`、`body`、`star`、`request_id` | 无 |
| `note_replace` | `note_id`、`revision`、`old_text`、`new_text`、`request_id` | `field=body`，可改为 title |
| `summary_submit` | `source`、`base_summary_revision`、`title`、`cumulative_summary`、`request_id` | `model` |
| `conversation_import` | `url`、`request_id` | `title` |

所有写入 request_id 长度为 1–128，只允许字母、数字、下划线、短横线、句点、冒号。重试复用编号及相同参数，服务端返回首次成功结果；新操作换新编号。默认值在计算幂等摘要前填充，省略默认参数和明确传默认值是同一请求。一次连接最多保留 10,000 条写入回执，达到上限后需轮换连接。

Note 标题不能为空且最多 200 个 Unicode 码点，正文最多 65,536 个码点。创建时必须明确 star；修改只能精确替换标题或正文的一处匹配，new_text 允许为空。old_text 非空且仅出现一次，修改保留最近 5 版。note_create、note_replace 成功返回的 revision 可继续使用，不必为了取得相同版本再读一次。

客户端摘要的范围、下载和累积提交示例见 [摘要方案](summary-engines.md)。其他摘要方案不受客户端提交影响，提交不会删除原文或切换默认记忆来源。

分享导入只接受 ChatGPT/Claude 官方 HTTPS 公开分享链接，成功存入待确认收件，由用户归档后加入原文。它不接受原文数组或文件；客户端协议投递是独立入口。

## 错误与权限

业务错误返回 `isError=true`，`structuredContent.error` 包含 code 和 message；成功结果同时出现在 structuredContent 与 text 内容块中。无效连接在 HTTP 层返回 401，协议格式错误使用 JSON-RPC error。

| 错误 | 处理 |
| --- | --- |
| `INVALID_ARGUMENTS` | 按工具定义修正参数，拒绝未知字段、无效类型及越界值 |
| `NOTE_CHANGED` | 重新读取 Note 并定位替换范围 |
| `MATCH_NOT_UNIQUE` | 提供更完整、唯一的 old_text |
| `SOURCE_CHANGED` | 重新读取目标原文范围，不能混用不同版本的分页 |
| `SUMMARY_CHANGED` | 读取最新客户端摘要，重新合并后提交 |
| `IDEMPOTENCY_CONFLICT` | 同一编号已用于不同请求，新操作应换编号 |
| `CONCURRENT_CHANGE` | 读写事务间工作区变化，使用同一编号及参数重试；依赖版本仍会重新检查 |
| `TURN_TOO_LARGE` | 单轮超出分页预算，使用下载模式 |
| `DOWNLOAD_EXPIRED` / `INVALID_DOWNLOAD` | 重新获取链接，确认连接仍有效 |

没有删除 Note、修改已有 Note 标星、直接修改原文、自动归档、修改账号或服务器设置的 MCP 工具。返回内容是用户数据，不是系统指令。
