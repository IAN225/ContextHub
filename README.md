# Context Hub · 对话手账

一个用于管理原文、摘要、Note 与跨窗口记忆包的本地应用。三种对话导入、模型摘要、附件保存、本地后台任务、备份恢复和回收站清理已接入实际处理流程；外部记忆连接仍为演示。当前应用在 `demo/`，设计与接续记录在 `docs/`。

## 换设备运行

需要 Node.js 22.13+（本机验证使用 Node.js 24）和 pnpm。

```sh
git clone https://github.com/IAN225/ContextHub.git
cd ContextHub/demo
pnpm install --frozen-lockfile
pnpm build
pnpm db:init
pnpm start
```

打开 http://127.0.0.1:3000/ 。如果没有 pnpm，可以先使用 `npm install -g pnpm` 安装。

开始继续开发前，先读 [接续说明](docs/HANDOFF.md) 和 [Demo 功能说明](demo/README.md)。

摘要设置页面可填写接口、模型和 API Key，保存后立即生效；Key 由本机服务保存，不进入浏览器手账备份。未从页面保存时兼容 `demo/.env.summary.local`，换设备需重新配置，详见 [摘要压缩说明](docs/summary-compression.md)。

附件保存、公开地址获取和暂停续跑见 [附件与后台任务](docs/2026-09-10-attachments-background.md)。关闭网页后已入队任务可继续处理，启动服务的进程需保持运行；服务中断的模型请求暂停待检查，不自动重试。

导入入口、客户端配置、来源访问限制与模块维护见 [对话导入说明](docs/conversation-imports.md)。开发界面仍可使用 `pnpm dev`；完整客户端接入使用上面的构建启动流程。启动前先结束占用 3000 的旧服务，保持原地址可继续读取已有浏览器手账。

当前 Demo 是正式产品的视觉基准，后续复用同一套前端组件和样式，接入服务时不另写一套界面。样式按主题、共用控件、外壳与章节归属管理；定位文件和逐步改版请看 [前端样式约定](docs/frontend-styles.md)。

**仓库同步的是代码与开发进度，不包含当前浏览器的 IndexedDB 数据、素材、草稿或 `.wrangler/state` 收件队列。** 首次运行从空书架开始，旧浏览器数据保持不变。通过“本地数据”导出和恢复 JSON 备份；完整范围、30 天清理规则和后续顺序见 [本地数据说明](docs/2026-09-10-local-data.md)。此阶段尚无云端账号或自动跨设备同步。

本地分享链接及其观察记录、依赖、构建产物、缓存和环境变量文件不纳入仓库。
