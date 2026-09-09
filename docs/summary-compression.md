# 摘要压缩 · 本地模型连接

摘要已接入实际 HTTP 模型调用，保留现有手账、检查点、水位和工作台界面。当前已通过纯逻辑和独立假模型 HTTP 验证，真实供应商连接与摘要质量尚待用户填写配置后验收。

## 填写本地配置

在 `demo/.env.summary.local` 填写四项（本机已留空文件）：

```dotenv
CONTEXT_HUB_SUMMARY_BASE_URL=
CONTEXT_HUB_SUMMARY_MODEL=
CONTEXT_HUB_SUMMARY_API_KEY=
CONTEXT_HUB_SUMMARY_PROTOCOL=openai
```

该文件由根 `.gitignore` 的 `.env*` 规则忽略，不能提交。换设备时自行新建同名文件，不要将真实 Key 放进本文、前端代码或聊天消息。Key 只由本地服务在启动时读取，不写入浏览器 IndexedDB，也不嵌入构建产物。修改后重新启动服务；界面的“重新读取连接”只刷新已启动服务的状态。

| 协议值 | Base URL 示例 | 自动追加路径 |
| --- | --- | --- |
| `openai` | `https://api.openai.com/v1`，或兼容服务的版本前缀 | `/chat/completions` |
| `responses` | `https://api.openai.com/v1` | `/responses` |
| `anthropic` | `https://api.anthropic.com/v1` | `/messages` |
| `gemini` | `https://generativelanguage.googleapis.com/v1beta` | `/models/{模型名}:generateContent` |

Base URL 填接口前缀，不填上表右栏的最终路径。远程地址使用 HTTPS；本机服务允许 localhost/127.0.0.1 的 HTTP。浏览器不能把服务端 Key 改发到另一地址；修改服务商须改本地文件并重启。四种协议为独立适配器，兼容服务对参数的支持仍需实际验证。

## 开始使用

1. 在 `demo/` 执行 `pnpm build`、`pnpm db:init`、`pnpm start`，打开原来的 3000 地址；已有本地数据库只需按迁移命令保持最新。
2. 打开摘要设置，点击“使用本地连接”，调整模型、上下文预算、最大输出、思考选项和提示词编排，保存摘要配置。
3. 可主动发起连接测试。这会调用模型并可能产生费用；记录仅说明本次字段被接口接受，不能证明输出上限或思考强度生效。
4. 手动启动首批摘要，检查结果后继续。初次启用真实模型会关闭旧演示配置的自动运行；首次整理完成后才可开启后续自动处理。
5. 工作台可组合历史摘要和完整原文，生成候选、编辑并确认，再选择应用时的水位策略。

摘要提示词和记忆包共同使用 `use-block-reorder.ts` 的指针排序逻辑，包含实时补位、占位框、浮动预览和 Escape 取消；上下移动按钮继续支持键盘操作。

## 压缩与保存规则

- 从当前水位后的待处理内容中选择完整轮次；保留 user、assistant、工具调用与工具结果的顺序。按预算缩小批次，不截断单轮。最小一轮仍放不下时暂停并说明原因。
- 增量输入必须包含动态“近期原文”，已有活跃摘要时也必须包含动态“活跃摘要”，避免把没有传入的历史标记为已覆盖。工作台按明确选区处理，超预算时要求缩小选区。
- 预算按 UTF-8 字节数加消息开销作保守估算，并预留最大输出和安全余量；它不是供应商 tokenizer 的精确 token 数。
- 输入不包含结构化隐藏思考；输出只接收完整可见正文。拒绝、截断、空正文、异常工具调用或协议错误都不会移动水位。
- 原文中的附件只提供元数据和缺失说明，当前不上传图片/文件字节给模型；Note 动态引用只提供 id/标题。
- 得到结果后先校验工作区版本，再原子保存检查点和处理水位。生成期间原文、配置或活跃摘要发生变化时不覆盖新状态。保存失败可复制未保存正文或重试保存，重试保存不重新调用模型。
- 每批检查点保留模型、协议及接口实际返回的用量；最多 30 个检查点。托管仍按批保存，失败即暂停，不自动更换参数或重试付费请求。
- 当前同一服务实例只允许一个进行中的模型请求；相同任务编号及输入在五分钟内复用结果，缓存最多 30 项。缓存只存文本，不保存跨请求响应流。服务重启后去重缓存不保留。
- 单次请求两分钟超时；离开摘要章节、暂停或关闭工作台会取消前端请求。供应商是否已经计费由其实际处理状态决定。没有页面关闭后持续运行的后台调度。

## 维护入口与验证

| 文件 | 职责 |
| --- | --- |
| `demo/lib/summary/contracts.ts` | 类型、预算及错误约定 |
| `prompts.ts` / `planning.ts`（同目录） | 提示词展开、完整轮次计划、版本校验与检查点 |
| `providers/` | 各协议请求序列化和正文解析，新增协议从注册表接入 |
| `server/config.ts` / `service.ts` / `handlers.ts` | 私密连接、限额请求、同源校验、幂等与并发控制 |
| `demo/app/api/summary/[action]/route.ts` | 薄路由，仅转交环境绑定和请求 |
| `demo/components/hub/use-summary-task.ts` | 批次生命周期、暂停、候选与原子提交 |
| `summary-model-settings.tsx` / `summary-workbench.tsx`（同目录） | 模型设置及候选确认 |
| `prompt-composer.tsx` / `use-block-reorder.ts`（同目录） | 摘要提示词 UI 和共用排序行为 |

`pnpm test` 覆盖完整轮次、预算、失败不推进、旧配置迁移、过期结果、协议适配及路由行为。构建后运行 `node --import ./scripts/local-runtime.mjs tests/summary-http.mjs`，使用临时独立假模型与假凭据验证实际 Worker HTTP 链路，不读取用户配置、不调用收费模型。浏览器生命周期脚本已将摘要接口替换成固定测试响应；本次未执行浏览器交互 QA。

协议实现参考：[OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)、[OpenAI 文本生成](https://developers.openai.com/api/docs/guides/text)、[Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create)、[Gemini GenerateContent](https://ai.google.dev/api/generate-content)。
