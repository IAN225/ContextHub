# 前端模块地图

路由、业务模块、状态与样式按职责分开；并非把所有逻辑放在一个页面中。

| 层级 | 文件 / 目录 | 职责 |
| --- | --- | --- |
| 首页路由 | demo/app/page.tsx | 账号边界与手账应用挂载 |
| 手账组装 | demo/components/hub/hub.tsx | 连接领域模块、弹窗与保存事务，不实现 MCP 协议或数据库访问 |
| 导航状态 | demo/lib/use-journal-navigation.ts | 翻书动画、章节切换、滚动位置；这些是可丢弃的界面状态 |
| 首页与阅读头部 | components/hub/home.tsx、reader-header.tsx | 书架与工具入口 |
| 管理入口 | components/hub/admin-link.tsx | 按角色显示，离开前等待保存，跳转管理员设置 |
| 管理页面 | app/admin/page.tsx、components/admin/settings.tsx | 管理路由与注册、审批、角色、证书入口界面 |
| 管理操作 | lib/account/use-management.ts | 加载、权限检查、版本冲突与操作结果 |
| 账号界面与协议 | components/hub/account.tsx、lib/account/ | 会话边界、账号设置、账号 API |
| 内容领域 | components/hub/transcript.tsx、notes.tsx、summary.tsx、memory.tsx | 原文、Note、摘要、记忆包；编辑器和详情继续拆为子模块 |
| 导入 | components/hub/imports/、lib/imports/ | 文件、分享链接、API 投递、收件与归档 |
| MCP | components/hub/connections.tsx、lib/mcp/ | 连接界面、同步、协议服务与 OAuth |
| 后台任务 | components/hub/background-tasks.tsx、lib/tasks/ | 后台摘要队列及任务展示 |
| 持久化 | lib/repository.ts、cloud-repository.ts、persistent-session.ts | 按运行模式选择存储、账号版本冲突、幂等保存与草稿 |
| 样式 | components/hub/*.css、app/admin/admin.css 等 | 按功能拆分，加载顺序见 frontend-styles.md |

hub.tsx 仍承担跨模块协调；hub-state.ts 集中定义领域命令与状态变换，这些文件较长但不是混杂所有页面的单文件应用。后续业务增长时可继续按命令域拆分，不需要为验收重写稳定业务模块。

云端只通过账号 API 保存持久内容。IndexedDB 适配器仅用于显式运行的本地开发模式。浏览器原生 WebMCP 演示接口及未使用样例已删除。

components/ui 还保留生成式 UI 模板，产品实际引用 dialog、button、tabs、select、checkbox、switch 六个组件。pnpm lint 检查产品页面、领域代码、脚本、测试及这六个基础组件；未使用模板存在既有静态规则问题，保留在库中，不计为已实现产品功能。TypeScript 仍检查整个源码目录。
