# 前端组件职责与状态边界

当前前端只有 `demo/` 一份源代码。正式产品继续复用这些组件与样式，通过服务和存储适配层接入真实数据；不要复制另一套正式版页面。样式文件与加载顺序见 [样式归属](frontend-styles.md)。以下路径均相对于 `demo/components/hub/`。

## 原文

| 文件 | 负责内容 |
| --- | --- |
| `transcript.tsx` | 查询、状态筛选、覆盖标记、当前轮次与编辑/插入/状态命令的连接 |
| `use-transcript-navigation.ts` | 选中索引、原生滚动引用、滚轮/触屏/键盘切换、吸附及监听器清理 |
| `transcript-timeline.tsx` | 时间轴刻度、上一轮/下一轮、数字跳转与最近轮次入口 |
| `turn-detail.tsx` | 当前轮次的消息、附件、Payload、元数据与操作按钮 |

导航 hook 始终跟随章节挂载，即使筛选没有结果也不卸载。Preview/Payload/元数据选项和 Markdown 开关由章节持有，详情组件受控，避免切换轮次、暂时无结果或隐藏章节后重置。滚轮和键盘同步更新目标引用，触屏才从滚动位置更新选择；104px 刻度与原来的手势处理保留。超过 400 个结果时，时间轴只渲染当前视口与目标附近的刻度，以等宽占位保留完整滚动范围；键盘按 `data-turn-index` 查找目标。样式仍归 `transcript.css`。

## 摘要

| 文件 | 负责内容 |
| --- | --- |
| `summary.tsx` | 覆盖状态、压缩控制、检查点选择与阅读、弹窗入口 |
| `use-summary-task.ts` | 模拟批次的启停、可见性和工作区命令；沿用第一阶段边界 |
| `summary-model-settings.tsx` | 模型/预算、提示词编排、能力示例及配置草稿 |
| `summary-workbench.tsx` | 起始摘要与完整轮次范围、整理要求、带来源手账 ID 的候选生成 |
| `summary-restore-dialog.tsx` | keep/rewind 选择、应用前覆盖预览；摘要页和收件确认共同使用 |

配置、能力记录与工作台草稿的存储键保持不变，仍按工作区隔离。每次打开回退窗口都从原有默认模式开始。候选应用由上层命令提交，成功后才结束确认流程。样式归 `summary.css` 和共用表单样式。

## 记忆包

| 文件 | 负责内容 |
| --- | --- |
| `memory-composer.tsx` | 块列表、添加、编辑对象 ID、块更新与拖动浮层 |
| `use-memory-reorder.ts` | Pointer Events 排序、边缘滚动、补位动画、取消恢复及监听器清理 |
| `memory-block-card.tsx` | 块标题、预览、编辑入口、拖动把手和上下移动按钮 |
| `memory-block-editor.tsx` | 自定义摘要、原文窗口、Note 选择与删除入口 |

排序 hook 只接收块数组和更新回调，不依赖整个 Workspace；拖动会话通过引用读取最新块，补位时不会重建会话。Escape 和 pointercancel 恢复起始顺序。编辑窗口以块 ID 为 key，每次重新打开清空 Note 查询；修改只回写目标块，不改源摘要、原文配置或 Note 标星。样式仍归 `memory.css`。

## 导入与收件

| 文件 | 负责内容 |
| --- | --- |
| `import-dialog.tsx` | 分享链接示例、API 请求 JSON 模拟接收及持久化导入草稿 |
| `inbox.tsx` | API 收件箱章节标题和内容入口 |
| `upload-review.tsx` | 收件选择、标题/正文编辑、完整轮次选择状态、删除/回退确认 |
| `upload-turn-preview.tsx` | 完整轮次勾选、消息预览与批量删除入口 |
| `upload-archive-actions.tsx` | 归档手账选择、拼接/新建入口或应用候选摘要入口 |

选择状态与归档目标留在 `UploadReview`，预览和操作区是受控组件。切换收件清空轮次勾选；删除按完整轮次处理。归档和候选应用仍通过上层 Promise 回调提交；收件确认直接依赖共用回退窗口，不再导入整个摘要页面。分享、API、工作台各自的路由和归属规则继续放在 `lib/domain.ts`、`lib/hub-state.ts`。样式归 `inbox-content.css`、`inbox.css` 和共用表单样式。

## 验证与后续修改

第三阶段拆分不新增 DOM 包装、CSS 加载入口、业务命令或存储键。第四阶段在长时间轴中加入占位元素，保留原生滚动几何；搜索缓存位于 `lib/memory-search.ts`，按源数组分别复用，空查询不构造全文。性能依据与完整回归见 [第四阶段记录](2026-09-09-frontend-performance.md)。后续修改先定位上表中的职责，再改相应样式；跨章节规则继续放领域层。不要仅为了减少单个文件行数继续切碎同一业务。

`tests/component-lifecycle.mjs` 覆盖原文空筛选/章节切换、配置与工作台草稿、候选水位、完整轮次归档、拖动取消和编辑查询重置。搭配现有六组交互回归及 `style-parity.mjs` 检查行为与外观。浏览器脚本需 Playwright 和 Chrome；该新脚本与视觉脚本支持 `BASE_URL` 指向本地生产预览。
