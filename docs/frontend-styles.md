# 前端样式归属与演进约定

## 目标与视觉基准

当前 Demo 的手账外观、尺寸、断点、交互状态和动画是后续产品的基准。结构重构不同时改版：先证明外观一致，再单独提出风格调整。

正式产品继续使用 `demo/components/hub/` 中的组件、样式和主题。接入真实数据时替换数据与服务适配层，或整体迁移前端目录；不要复制出另一套“正式版页面/CSS”独立修改。Demo 与正式产品保持同一个前端来源，避免两套实现逐渐产生差异。

本轮只整理 CSS 归属。复杂 TSX 组件的拆分是下一阶段；不因为样式拆分就同时改 DOM、状态或交互。

## 入口与定位

`demo/app/layout.tsx` 顺序加载 `globals.css` 与 `styles.css`。后者只列出样式依赖，不写选择器。所有章节样式一次性、按固定顺序加载，打开章节的先后顺序不会改变层叠关系。

以下路径以 `demo/` 为起点。组件样式与对应 TSX 放在同一个目录，通过类名前缀和下表查找责任范围。

| 想调整的内容 | 样式文件 | 对应组件或入口 |
| --- | --- | --- |
| 主题色、共用间距、浮层层级、主要动画参数、框架 token 映射 | `app/theme.css` | 整个前端 |
| 框架引入、元素默认值、键盘焦点、触屏文本选择、减少动态效果 | `app/globals.css` | `input-modality.tsx`、根布局 |
| 样式加载顺序 | `app/styles.css` | `app/layout.tsx` |
| 按钮、分段选项、搜索输入、页面标题、通用 surface、保存提示、空状态 | `components/hub/shared.css` | `shared.tsx` 与共用展示 |
| 弹窗、表单、提示条、选择器 | `components/hub/forms.css` | `shared.tsx` 的 Modal/Picker、各表单 |
| Markdown、原始文本、段落与工具文本 | `components/hub/shared-content.css` | `shared.tsx` 的 Markdown |
| 摘要覆盖条、当前轮次书签 | `components/hub/shared-coverage.css` | `shared.tsx` 的覆盖条 |
| 摘要提示词的块编排 | `components/hub/shared-composer.css` | `shared.tsx` 的 Composer |
| 富文本工具栏、编辑预览、附件 | `components/hub/editors.css` | `editors.tsx` |
| 工作区外壳、顶栏、章节菜单、纸张容器、移动端滚动区、通知 | `components/hub/shell.css` | `app/page.tsx` |
| 首页书架、笔记本封面、进入反馈 | `components/hub/home.css` | `home.tsx` |
| 原文时间轴、刻度、轮次详情、消息、Payload/元数据 | `components/hub/transcript.css` | `transcript.tsx` |
| 摘要检查点、摘要纸张、控制区、工作台 | `components/hub/summary.css` | `summary.tsx` |
| Note 列表、正文、历史版本 | `components/hub/notes.css` | `notes.tsx` |
| Note 新建与展开搜索控件 | `components/hub/note-actions.css` | `note-actions.tsx` |
| 记忆包预览、块排序、拖动浮层、块编辑窗口 | `components/hub/memory.css` | `memory.tsx`、`memory-composer.tsx` |
| 连接、授权演示、工具目录、手账设置 | `components/hub/connections.css` | `connections.tsx` |
| 全局搜索与结果列表 | `components/hub/search.css` | `search.tsx` |
| 收件内容、导入布局、轮次预览与归档区 | `components/hub/inbox-content.css` | `inbox.tsx` |
| API 收件说明、候选确认弹窗中的收件布局 | `components/hub/inbox.css` | `inbox.tsx`、`app/page.tsx` |
| 像素小猫、数量提醒、浮动动画 | `components/hub/inbox-pet.css` | `inbox-pet.tsx` |

例如，Note 的正文工具栏变形，先查 `notes.css` 中 `.note-paper .editor-toolbar`，再查 `editors.css` 的共用 `.editor-toolbar`；不要去原文或首页文件添加修补规则。所有编辑器都需要改变时才修改共用文件。

## 修改规则

- 先选责任组件，再编辑它现有的选择器和断点规则。不要重新建立一个大覆盖文件，也不要在文件末尾不断追加“最终修复”。
- 共用样式先加载，所属章节后加载。章节对共用控件的特例带上自身根类，例如 `.note-paper .rich-editor`；不要从一个章节文件全局覆盖 `.button` 或 `textarea`。
- 当前采用带业务前缀的普通 CSS，并保留既有类名。组件旁存放样式，入口集中加载；不要再在 TSX 中按挂载时机零散 import 这些 CSS。未来抽成独立前端包时导出同一个样式入口。
- 颜色变量只替换原本完全相同的颜色值；纸张、输入背景、正文和弱提示的细微差别仍然保留。不要为了减少 token 数量而把近似颜色强行合并。
- `--space-*` 管理共用控件的重复间距。时间轴 104px 刻度、封面 0.72 比例、Note 控件宽度等属于组件几何，保留在所属组件，不应被一次全局间距调整意外改变。
- `--notebook-open-duration` 与 `app/page.tsx` 的进入定时器必须同时检查。其余章节显隐、拖动、减少动态效果也要一起回归。
- 目前保留了已有媒体查询的相对顺序，包括 760/761、767、800 等相邻边界；它们不是同一个含义。不要只为了“统一断点”而直接替换数值或排序，避免改变 768px 等中间宽度的行为。
- 本轮删除了相同选择器、相同条件（或被后续无条件声明覆盖）下的重复属性，保留短写/长写、不同状态和重叠断点的有效层叠。后续进一步简化时，也要先有对比基准。

## 按顺序更新风格

1. 先在 `theme.css` 调整纸张、文字、强调色与共用参数，回归全部章节。
2. 再调整按钮、表单、正文和其他共用控件，检查所有使用方及弹窗。
3. 再调整 `shell.css` 与 `home.css` 的阅读外壳、菜单与书架。
4. 按原文 → 摘要 → Note → 记忆包 → 连接/收件逐个调整章节；每次只验证和提交明确的一组变化。
5. 最后统一检查四种宽度、鼠标/键盘/触屏、隐藏章节恢复和减少动态效果。

结构重构的验收是“旧基准保持一致”；有意改版时则需明确记录哪些差异是本次设计决定，不能简单覆盖基准来让测试通过。

## 视觉回归

`demo/tests/style-parity.mjs` 使用独立 Chrome 上下文和固定日期，覆盖 320 / 390 / 768 / 1280px。它记录首页、搜索、五个章节、收件箱、原文插入、导入的两个标签、Note 搜索与历史版本、减少动态效果。

每个状态比较固定视口 PNG，以及所有已布局元素（含视口以下内容）的矩形、常用计算样式、`::before` 和 `::after`。不使用整页截图，避免截图时临时改变 Chrome 视口而重新触发动画或改变桌宠位置。采集时跳过原生页面过渡快照，有限动画完成后取样，无限浮动动画固定在起点；真实动画和输入交互另由现有 `layout-motion.mjs` 等脚本检查。

在 `demo/` 下，先对修改前版本采集，再对修改后版本比较，保持浏览器、系统字体和窗口环境相同：

```sh
node tests/style-parity.mjs capture
node tests/style-parity.mjs compare
```

可用 `BASE_URL` 指定单独运行的旧版本地址，用 `STYLE_WIDTHS=1280` 缩小到单个宽度排查。基准保存在忽略提交的 `demo/outputs/style-parity/`，失败时输出具体节点/属性的 diff JSON 和当前截图。跨设备需重新从同一基准提交采集，不能把本机字体渲染等同于其他设备。

元素尺寸和计算样式严格一致，包含 `filter` / `backdrop-filter`。只有无背景图时的 `0% 0%` 与 `0px 0px` 做等价规范化，兼容生产 CSS 压缩器的零值写法。仅截取 PNG 前临时关闭弹窗遮罩的背景模糊并等待重绘，避免 Chrome 在同一未改动基线上也不稳定的背景合成采样；原始模糊参数仍参与前面的严格样式比较，产品代码没有关闭模糊。PNG 的每个颜色通道允许最多 4/255 的阴影量化误差，不屏蔽任何图片区域；更大的像素差异仍会失败。

本地 Chrome 对比不能代替实体 iPhone/Safari 验收，也不代表未覆盖的所有状态已经验收。
