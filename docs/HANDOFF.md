# 项目接续 · 2026-09-07

## 当前范围与用户偏好

- 当前阶段只做本地前端交互 Demo，不接真实模型、OAuth、后端或远程 MCP，不部署云端。
- React 19 / TypeScript / Vinext / Tailwind / Shadcn Base UI，实际代码位于 `demo/`。
- 视觉是浅色手账与纸张风格；首页把工作区呈现为笔记本封面，点开进入工作区。
- 原文、摘要、Note、记忆包、连接在同一工作区内局部切换，保留已访问页的状态。
- 用户明确要求不使用子智能体。优先直接处理已有授权工作，避免反复确认。

## 已完成

- 工作区书架、新建与编辑，原文完整轮次的搜索、浏览、编辑、插入、弃用与回收站。
- 原文消息中的工具调用与结果保持在发起 user 的同一完整轮次；不保存隐藏思考。
- 摘要检查点、处理水位、覆盖区间、原文窗口、回退与缺口；确定性摘录模拟压缩。
- Note 编辑、草稿、版本、标星、回收站；记忆包编排、预览、复制；收件箱与请求 JSON 导入。
- 本地 IndexedDB 保存应用状态、草稿和手动添加的素材；实验性浏览器内两个只读预览工具。
- 鼠标/触屏点击输入不画外圈，键盘导航有可见焦点。触屏非编辑区域不误选文字。
- 桌面滚轮逐轮切换，轨道与选中点同时立即居中。触屏使用原生惯性，按住截停，结束后吸附最近刻度，提供 scrollend 与停止滚动后的延时兼容处理。
- 移动端固定顶部与五等分菜单，仅主内容区纵向滚动；时间轴水平手势不带动整个页面。标题为简短单行，压缩留白与检查点列表高度。

## 代码入口

- `demo/app/page.tsx`：工作区外壳、章节状态和移动端章节滚动位置。
- `demo/app/globals.css`、`demo/app/journal.css`：初始基础样式与手账覆盖样式。后者存在多轮响应式覆盖，排查时注意最终生效规则。
- `demo/components/hub/transcript.tsx`：104px 间距的原生滚动时间轴；桌面 wheel 与触屏惯性分离。
- `demo/components/hub/input-modality.tsx`：输入方式与焦点视觉。
- `demo/components/hub/shared.tsx`：基础组件与桌面/手机标题。
- `demo/lib/domain.ts`：轮次、摘要水位、覆盖、记忆包规则。
- `demo/lib/import.ts`：Chat Completions / Responses / Anthropic Messages 结构导入。
- `demo/lib/store.ts`：IndexedDB 持久化。
- `docs/superpowers/`：早期设计与实现计划；具体交互状态以当前源码及本说明为准。

## 最近验证结果

2026-09-07：领域/导入测试 12 项通过，TypeScript 检查通过，应用与 hub 组件的定向 lint 通过，Vinext 构建通过。独立 Chrome 模拟通过桌面交互及 320px / 390px 手机布局、吸附和页面滚动边界检查。触屏模拟验证了跟手、惯性和按住截停，尚未做实体 iPhone/Safari 验收。

在 `demo/` 下运行：

```sh
pnpm test
pnpm typecheck
pnpm exec oxlint app components/hub lib tests
pnpm build
```

浏览器回归脚本需要可解析的 `playwright` 包及已安装的 Google Chrome：

```sh
node tests/ui-interactions.mjs
node tests/responsive-interactions.mjs
```

当前桌面环境通过 `NODE_PATH` 使用 Codex 随附的 Playwright；其他设备可在独立工具目录安装 Playwright 后配置 `NODE_PATH`，或将其正式加入项目开发依赖。截图写入被忽略的 `demo/outputs/`。测试启动独立浏览器上下文，不使用当前用户的浏览器资料。

## 已知限制与下一步

- 全量 `pnpm lint` 仍会报告未使用的脚手架 UI 组件中的现有 a11y/React 编译器规则问题；本次修改涉及的应用代码检查已通过。
- 尚无真实模型摘要、远程 API/MCP、OAuth、账号隔离、文件同步、向量检索或后台清理。连接页明确为模拟。
- 章节保持挂载后，摘要模拟任务的生命周期需继续审查：页面文案写着“仅当前摘要页内模拟运行”，但隐藏章节仍可能保留运行中的 effect。
- 原生时间轴当前渲染全部节点，示例约 208 轮；更大数据量需要性能评估。
- 下一轮先在用户实际手机上确认惯性/吸附/截停与紧凑布局，再按用户反馈继续；不要自行进入后端阶段。
- 原始分享链接和观察材料仅留在原机器，未纳入仓库。浏览器数据也不会随 Git 迁移。
