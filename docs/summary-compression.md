# 摘要压缩 · 本地模型连接

摘要已接入实际 HTTP 模型调用，保留现有手账、检查点、水位和工作台界面。用户已确认另一设备模型正常返回，实际压缩质量仍待体验。

## 在页面配置模型

打开“摘要设置 → 模型与预算”，填写接口地址、模型、请求协议和 API Key，点击“保存摘要配置”即可生效，无需重启。也可在能力探测页点击“保存连接并测试”；保存本身不调用模型，测试会发出一条短请求。

Key 仅临时保留在输入框内存，关闭弹窗不保留未提交的 Key。提交后保存在本机服务的 `.wrangler/state` 私密配置表中，不回显、不写入浏览器 IndexedDB、不包含在手账 JSON 备份或 Git 仓库中。同一地址/协议留空可沿用现有 Key，更换地址或协议必须填写对应 Key；旧页面不能覆盖更新后的连接。

连接由当前本机服务的所有手账共用；预算、提示词等仍按手账保存。后台任务在下一批执行前核对连接指纹，改变连接后不会把旧任务自动发给新服务。

## 兼容本地配置文件

尚未从页面保存连接时，继续从 `demo/.env.summary.local` 读取四项：

```dotenv
CONTEXT_HUB_SUMMARY_BASE_URL=
CONTEXT_HUB_SUMMARY_MODEL=
CONTEXT_HUB_SUMMARY_API_KEY=
CONTEXT_HUB_SUMMARY_PROTOCOL=openai
```

该文件被 Git 忽略。文件值在启动时读取，修改文件仍需重启；一旦在页面保存连接，以服务端配置表为准，后续直接从页面修改。换设备可直接在页面重新配置，也可新建这个文件。不要将真实 Key 放进文档、前端代码或聊天消息。

2026-09-10 DeepSeek 官方 Responses 测试配置：本地文件只留 URL、Key、模型三个空值，协议已设为 `responses`，可选的 `CONTEXT_HUB_SUMMARY_THINKING=关闭` 固定服务端思考设置，优先于页面旧设置。实际请求会包含 `{"reasoning":{"effort":"none"}}`，适用于摘要、工作台和连接测试；页面显示“关闭（本地配置固定）”。不设置该环境变量的其他连接继续使用页面选项。DeepSeek Base URL 填 `https://api.deepseek.com`，程序自动追加 `/responses`；参数依据 [DeepSeek Responses 官方文档](https://api-docs.deepseek.com/zh-cn/api/create-response/)。本地断言验证请求 body，不代表已完成真实供应商测试。

| 协议值 | Base URL 示例 | 自动追加路径 |
| --- | --- | --- |
| `openai` | `https://api.openai.com/v1`，或兼容服务的版本前缀 | `/chat/completions` |
| `responses` | `https://api.openai.com/v1` | `/responses` |
| `anthropic` | `https://api.anthropic.com/v1` | `/messages` |
| `gemini` | `https://generativelanguage.googleapis.com/v1beta` | `/models/{模型名}:generateContent` |

Base URL 填接口前缀，不填上表右栏的最终路径。远程地址使用 HTTPS；本机服务允许 localhost/127.0.0.1 的 HTTP。旧 Key 不随页面地址修改而转发到新服务，需填写新地址对应的 Key 后保存。四种协议为独立适配器，兼容服务对参数的支持仍需实际验证。

## 开始使用

1. 在 `demo/` 执行 `pnpm build`、`pnpm db:init`、`pnpm start`，打开原来的 3000 地址；已有本地数据库只需按迁移命令保持最新。
2. 打开摘要设置，直接填写或使用已配置的本地连接，调整上下文预算、最大输出、思考选项和提示词编排，保存摘要配置。
3. 可主动发起连接测试。这会调用模型并可能产生费用。Responses 思考检测读取 `usage.output_tokens_details.reasoning_tokens` 和非空 `reasoning` 输出：计数为 0 且无思考输出时显示“本次未产生思考”；正计数或非空思考输出显示“已观察到思考”，若请求关闭则显示“与设置不符”。无计数、只有空占位项时显示无法确认，不将缺失当作 0。只保留计数与存在性，不保存或显示思考正文；其他协议尚未提供该检测证据。一次测试不能证明所有请求都遵守开关，也不能验证输出上限或具体思考强度。
4. 手动启动首批摘要，检查结果后继续。初次启用真实模型会关闭旧演示配置的自动运行；首次整理完成后才可开启后续自动处理。
5. 工作台可组合历史摘要和完整原文，生成候选、编辑并确认，再选择应用时的水位策略。

摘要提示词和记忆包共同使用 `use-block-reorder.ts` 的指针排序逻辑，包含实时补位、占位框、浮动预览和 Escape 取消；上下移动按钮继续支持键盘操作。

## 压缩与保存规则

- 从当前水位后的待处理内容中选择完整轮次；保留 user、assistant、工具调用与工具结果的顺序。按预算缩小批次，不截断单轮。最小一轮仍放不下时暂停并说明原因。
- 增量输入必须包含动态“近期原文”，已有活跃摘要时也必须包含动态“活跃摘要”，避免把没有传入的历史标记为已覆盖。工作台按明确选区处理，超预算时要求缩小选区。
- 预算按 UTF-8 字节数加消息开销作保守估算，并预留最大输出和安全余量；它不是供应商 tokenizer 的精确 token 数。
- 输入不包含结构化隐藏思考；输出只接收完整可见正文。拒绝、截断、空正文、异常工具调用或协议错误都不会移动水位。
- 原文中的附件提供元数据、明确的保存/缺失状态，以及可提取的 UTF-8 纯文本正文（128 KB 内）；不上传图片/二进制文件给模型，不做 OCR 或 PDF 解析。Note 动态引用只提供 id/标题。
- 得到结果后先校验工作区版本，再原子保存检查点和处理水位。生成期间原文、配置或活跃摘要发生变化时不覆盖新状态。保存失败可复制未保存正文或重试保存，重试保存不重新调用模型。
- 每批检查点保留模型、协议及接口实际返回的用量；最多 30 个检查点。托管仍按批保存，失败即暂停，不自动更换参数或重试付费请求。
- 摘要和工作台现通过持久化队列串行执行，任务输入与已生成结果跨重启保留。直接连接探测仍使用单实例请求控制与五分钟短期缓存，不能替代任务队列，也不属于队列串行范围。
- 单次模型请求两分钟超时；离开章节或关闭网页不取消已入队任务。暂停在本批完成后生效；服务中断的未完成模型请求需要手动确认续跑，不自动重试。启动进程需保持运行，详见 [附件与后台任务](2026-09-10-attachments-background.md)。

## 维护入口与验证

2026-09-10 思考检测验证：70 项测试、TypeScript、应用 lint 和构建通过。使用本机已配置的 DeepSeek 官方 Responses 连接发送一次简短探测，请求关闭思考，接口报告 `reasoning_tokens: 0`，未观察到非空思考输出；探测结果为“本次未产生思考”。这次验证仅覆盖关闭模式的一个样本，没有执行开启模式对照或压缩质量验收。已有浏览器探测记录需重新点击测试才会更新。

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
