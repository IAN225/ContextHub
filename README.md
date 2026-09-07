# Context Hub · 对话手账

一个用于管理原文、摘要、Note 与跨窗口记忆包的本地交互原型。当前应用在 `demo/`，设计与接续记录在 `docs/`。

## 换设备运行

需要 Node.js 22.13+（本机验证使用 Node.js 24）和 pnpm。

```sh
git clone https://github.com/IAN225/ContextHub.git
cd ContextHub/demo
pnpm install --frozen-lockfile
pnpm dev --hostname 127.0.0.1 --port 3000
```

打开 http://127.0.0.1:3000/ 。如果没有 pnpm，可以先使用 `npm install -g pnpm` 安装。

开始继续开发前，先读 [接续说明](docs/HANDOFF.md) 和 [Demo 功能说明](demo/README.md)。

**仓库同步的是代码与开发进度，不包含当前浏览器的 IndexedDB 数据、素材和草稿。** 新设备首次运行会加载示例数据。此阶段尚无云端账号或跨设备数据同步。

本地分享链接及其观察记录、依赖、构建产物、缓存和环境变量文件不纳入仓库。
