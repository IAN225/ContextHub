# 状态与持久化边界实施计划

> 执行方式：按用户已选定的第一阶段，在当前任务内使用 executing-plans 分批实施；不使用子智能体。每批自查、验证后再继续。

**Goal:** 将展示、应用操作与本地保存分开，并验证读写失败、草稿提交和隐藏章节任务不会损坏或覆盖数据。

**Architecture:** 页面保留导航、弹窗和通知；应用 hook 暴露工作区和收件操作，纯命令处理器在最新状态上执行。独立 repository 负责 IndexedDB，持久化 session 负责读取、修改、保存状态和重试。正式数据与清空草稿使用同一事务。

**Tech Stack:** 现有 React 19、TypeScript、Vinext、IndexedDB、Node test、独立 Chrome/Playwright；不增加依赖。

**Spec:** [前端接续计划第一阶段](../../2026-09-09-frontend-progress.md)。用户于 2026-09-09 明确选择先完成状态与持久化边界整理。

## 全局约束

- 保留本地 Demo、现有外观、入口、交互和存储键；不接后端，不部署。
- 不使用子智能体；不做第二阶段 CSS 迁移或第三阶段复杂界面拆分。
- 原文完整轮次、摘要水位、Note 历史、记忆包引用规则继续由纯业务代码处理。
- 旧数据缺少可选字段时补齐，无法识别的数据报错并保留；禁止用示例数据覆盖读失败的数据。
- 验证通过后分批本地提交；远程推送由用户另行决定。

## 1. 建立失败场景回归

**文件:** `demo/tests/state-persistence.mjs`。

- [x] 在独立浏览器中保存带唯一名称的手账，再让一次 IndexedDB 读取失败；断言保存内容没有被示例覆盖，重试恢复原数据。
- [x] 设置已配置的摘要任务，启动后切离摘要页；等待超过一批周期，断言检查点和水位没有变化。
- [x] 运行脚本，记录当前实现的失败位置，避免仅依据代码猜测。

## 2. 分离 repository 与持久化 session

**文件:** 新建 `demo/lib/repository.ts`、`demo/lib/persistent-session.ts`，修改 `demo/lib/store.ts`；测试 `demo/tests/persistent-session.test.ts`。

**接口:**

```ts
type StorageEntry = { key: string; value: unknown };
interface Repository {
  read(key: string): Promise<unknown>;
  write(entries: readonly StorageEntry[]): Promise<void>;
}
```

- [x] 将 IndexedDB 连接、读取和多键原子写入移到 repository。保留 `context-hub-demo` / `data`；连接失败允许后续重试，写入按调用顺序执行。
- [x] session 提供稳定 snapshot、订阅、load、update、commit、commitWith 和 retry。读取成功前不写；旧完成事件不能把较新的修改标为已保存。
- [x] commit 在成功前保留当前值；失败保留数据；提交期间的普通函数更新在提交结果确定后应用。commitWith 协调业务数据与草稿清理，并在失败时保留草稿。
- [x] `usePersistent` 作为 React 适配，保留原有 tuple API，补充重试和原子提交入口；更换 key 时隔离旧请求。
- [x] 用可控制的内存 repository 验证延迟读取、读取失败/重试、连续写入、过期完成、写失败/重试、提交失败、提交期间更新、多键写入与草稿恢复。

运行：`node --experimental-strip-types --test tests/persistent-session.test.ts`。

## 3. 建立应用命令与旧数据加载边界

**文件:** 新建 `demo/lib/hub-state.ts`、`demo/lib/use-hub.ts`，修改 `demo/app/page.tsx` 和各章节操作 props；测试 `demo/tests/hub-state.test.ts`。

**接口:**

```ts
type HubState = { schemaVersion: 1; workspaces: Workspace[]; uploads: Upload[] };
// applyHubCommand(state, command) 只改命令指定的实体/字段。
// normalizeHubState(raw) 接受未标版本的旧形状和 schemaVersion: 1。
// useHub() 暴露 data、persistence、dispatch 和带可选草稿写入的 commit。
```

- [x] 先测跨工作区修改、连续不同字段修改、完整轮次归档、缺失目标不丢收件、重复归档、候选摘要水位、Note 历史/状态和记忆包引用。
- [x] 实现命令：创建/改名手账、保存/改变原文状态、创建/保存/恢复/标星/改变 Note 状态、设置摘要配置/窗口/压缩/回退、编排记忆包、创建/撤销/轮换模拟令牌、收件更新/删除/归档/应用候选摘要。
- [x] 旧数据迁移只补缺失的可选完成状态和收件来源，并保留未识别的附加数据；未知版本或损坏根结构拒绝自动写回。
- [x] 页面各章节改发具体命令；不再用整份 Workspace 回传覆盖最新数据。导航和动画仍留在页面。
- [x] 新建手账、新建 Note、保存原文的正式写入与草稿清理共用 repository 事务；失败不关闭编辑器，不显示成功通知。

运行：`node --experimental-strip-types --test tests/hub-state.test.ts`，再运行 TypeScript 与应用代码 lint。

## 4. 明确异步任务生命周期并验收

**文件:** `demo/components/hub/summary.tsx`、`demo/components/hub/connections.tsx`、必要的任务 hook、`demo/tests/state-persistence.mjs`、`docs/HANDOFF.md`。

- [x] 摘要压缩只在当前可见摘要章节运行，离开时清理计时器；手动任务暂停，自动模式回到页面才按现有条件恢复。连接页时钟在隐藏时停用。
- [x] 清理通知计时器；切换手账或卸载时旧异步结果不回写新手账。
- [x] 浏览器验证读失败重试、草稿刷新恢复、正式提交失败保留草稿、重试只创建一次、隐藏摘要不压缩、恢复后的水位与记忆引用一致。
- [x] 回归桌宠、Note 操作与现有桌面/触屏行为；覆盖 320/390/768/1280px 与减少动态效果。
- [x] 运行全部 Node 测试、TypeScript、应用代码 lint、Vinext 构建和 Git diff 空白检查；更新接续文档说明操作接口、保存/失败语义和验证范围。

## 自查

第一阶段的应用操作、持久化替换位置、草稿、失败恢复、旧数据和隐藏任务分别由第 2–4 批覆盖。外观调整、CSS 整理、时间轴拆分与性能优化留在后续阶段。所有跨存储键清理都必须通过同一个 IndexedDB 事务，不以先清草稿再保存正式数据代替。

验收补充：各项验证均已执行；ui-interactions 的触屏惯性断言在当前版本和 d0f4435 基线均失败，保留原断言并记录限制，不声称全部浏览器测试通过。其余结果见 docs/2026-09-09-state-persistence-progress.md。

