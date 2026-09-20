# 模块边界与维护约定

## 目录和依赖方向

| 层             | 位置                                               | 职责                                                                            |
| -------------- | -------------------------------------------------- | ------------------------------------------------------------------------------- |
| 路由           | `app/app/`                                         | 页面入口、API 请求适配、全局样式入口                                            |
| 功能界面       | `app/features/`                                    | 工作区、原文、摘要、Note、记忆包、连接、导入、收件箱、桌宠、设置等功能          |
| 公共界面       | `app/components/`                                  | 基础 UI、通用控件、Provider、主题容器                                           |
| 模型           | `app/lib/core/`                                    | 共享数据类型、标识和时间；没有运行时业务依赖                                    |
| 领域逻辑       | `app/lib/{transcript,summary,memory,imports,...}/` | 分组、摘要策略、覆盖范围、记忆编排、协议解析等                                  |
| 应用服务       | `app/lib/application/server/`                      | 账号权威读取、命令事务、后台调度、结果应用与业务生命周期                        |
| 状态命令       | `app/lib/state/`                                   | 输入校验、命令契约、按业务划分的 reducer                                        |
| 持久化         | `app/lib/storage/`                                 | 版本化记录、账号数据适配、修订号和冲突保护                                      |
| 服务接口       | `app/lib/*/server/`                                | MCP、导入、摘要和后台任务的授权、处理器与仓库                                   |
| 服务端公共机制 | `app/lib/server/`                                  | Web Crypto、同源管理校验、Cookie 会话解析、限量读取与请求体丢弃；不依赖业务模块 |
| 运行环境       | `app/scripts/server/`                              | 账号数据库、会话、网关、HTTPS、内部进程管理                                     |
| 部署           | `deploy/`                                          | 源码/Docker 安装、数据库升级、备份恢复                                          |

路由组合功能界面，功能界面调用领域逻辑和公共控件。`lib` 不依赖界面，公共控件不依赖具体功能。跨功能调用只通过目标功能的 `index.ts`，功能内部直接引用所属文件；不建立汇集所有业务的总出口。

工作区的 `hub.tsx` 组合外壳，`panels.tsx` 组合章节，`dialogs.tsx` 管理弹窗内容，`use-controller.ts` 协调导航、弹窗与命令，`use-turn-editor.ts` 管理编辑目标和原文版本检查。模型设置、连接设置和服务器设置各自有交互控制器；界面文件负责展示，不直接承担保存流程。

### 当前目录导航

以下路径从仓库根目录开始；`app/app` 中的第二个 `app` 是路由目录，不是第二套应用。

```text
app/
  app/                         路由适配和样式加载入口
    api/                       imports、mcp、summary、tasks 的 HTTP 路由
    mcp/、oauth/、v1/          外部协议入口
    login/、register/、activate/
    settings/、admin/、server/ 设置及服务管理页面入口
  features/
    workspace/                 工作区外壳、首页、卡片、导航、设置及创建
    transcript/                原文列表、时间轴、轮次详情与编辑
    summary/                   三种摘要方案、共用历史/窗口控件、工作台和模型设置
    notes/、memory/            Note 与记忆包界面
    connections/               MCP 连接、Key 与 OAuth 授权界面
    imports/                   收录弹窗、手动/链接导入和投递配置
    inbox/                     待归档收件、预览、归档动作、浮动收件入口
    pets/                      通用帧播放器与角色包设置界面
    tasks/、data/              后台任务管理、个人备份与数据管理
    account/、settings/        登录注册、个人/管理员/服务器设置
  components/
    ui/                        Base UI 控件适配层
    shared/                    应用通用展示控件及样式
    providers/                 账号状态 Provider
    theme/                     主题容器、Portal 上下文与 CSS 变量
  lib/
    core/                      共享模型、ID、时间
    state/                     命令契约、校验、分发器和业务 reducer
    application/               账号命令客户端及服务端应用服务
    storage/                   记录拆合、版本化载荷、账号适配、草稿会话与备份
    attachments/               附件内容规则与消息媒体关联
    workspaces/                工作区创建、外观、主题及生命周期
    client/                    视图生命周期和异步响应归属
    transcript/、summary/、memory/ 纯领域计算与摘要协议
    imports/、mcp/、tasks/     各业务契约、客户端、接收流程和 server 实现
    pets/                      角色包格式、ZIP、图片校验/裁切、偏好存储
    account/、workspaces/      账号动作/身份与工作区创建
    server/                    通用 Web 请求和密码学机制，不含业务错误或仓库
    *.ts                       仍未完全按领域收拢的跨层工具与客户端协调器
  scripts/
    start-*.mjs                运行进程入口
    server/                    Node 网关、账号 SQLite、TLS 与内部代理
    check-architecture.mjs     架构检查入口
    architecture/              依赖解析、传递边界和 CSS 检查规则
  drizzle/                     SQLite 业务表迁移（保留历史文件名与校验和）
  tests/                       领域、协议、持久化与服务器边界测试
deploy/                        安装、升级、备份和恢复
docs/                          设计、运维和审查记录
```

### 修改入口速查

| 需求                         | 首先查看                                                                                | 相关边界                                                                   |
| ---------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 首页、顶部栏、章节导航       | `features/workspace/{home,reader-header,hub}.tsx`                                       | 样式分别在 `home.css`、`shell.css`；卡片在 `card.*`                        |
| 编辑正文、保存 Note/轮次     | `features/notes/`、`features/transcript/`                                               | 共用 `components/shared/text-editor.tsx`；写入规则在 `lib/state/reducers/` |
| 压缩范围、最近原文、记忆注入 | `lib/summary/{coverage,planning,engines}.ts`                                            | `lib/memory/compose.ts`、`lib/mcp/server/tools.ts` 消费领域结果            |
| 导入、客户端投递、归档       | `lib/imports/`、`features/imports/`、`features/inbox/`                                  | 解析、收件展示、归档状态变更是不同阶段，不应各写一套解析器                 |
| 桌宠动画或新格式             | `features/pets/frame-player.tsx`、`lib/pets/`                                           | `features/inbox/pet.tsx` 只连接拖动、收件状态与点击行为                    |
| 数据保存、冲突、备份         | `lib/{use-hub,store,persistent-session,repository,cloud-repository}.ts`、`lib/storage/` | Node 账号事务在 `scripts/server/account-records.mjs`                       |
| 用户权限、域名与部署         | `features/settings/`、`scripts/server/`、`deploy/`                                      | 不把 Node 运行环境逻辑放入路由页面或通用控件                               |

这张表描述现状，并不表示所有领域已经完全收拢。特别是 `lib/` 根目录仍混合纯工具、React hooks 和存储协调器；`components/shared/button` 与 `components/ui/button` 仍是独立实现。2026-09-17 的残留问题、样式差异及验证范围见 [重构审查记录](refactor-review-2026-09-17.md)。

## 状态、存储和协议

- `core/model.ts` 是运行时数据模型；持久化格式由 `storage/payload-*` 和 `storage/records.ts` 单独维护。改变字段语义时应评估读取兼容性、导出格式和迁移，不能靠界面默认值掩盖不兼容记录。
- `state/contracts.ts` 定义命令；`workspace-reducer.ts` 负责摘要方案作用域，具体命令委派给 `state/reducers/`。`hub-reducer.ts` 处理账号级集合并分发命令。MCP 和任务结果通过显式传入的分发器递交，避免循环导入。
- 摘要策略、原文窗口和记忆包保留各自边界。自定义压缩和 ReMeLight 的配置与历史独立；近期原文始终取水位之后最新的完整轮次。界面覆盖条、待压缩批次和 MCP 注入共用领域计算。
- 账号网络动作位于 `account/actions.ts`，在退出或改密前等待存储写入；账号状态及请求身份绑定位于 `account/client.ts`。存储层只依赖后者。
- 后台执行器先持久化模型结果，应用服务随后在事务中写入账号记录与应用回执。重启先恢复未提交结果；浏览器仅查询状态、发起操作和显示候选，不负责结果 ACK 或自动入队。
- MCP 授权管理在 `mcp/server/management.ts`，JSON-RPC 在 `handlers.ts`，工具逻辑在 `tools.ts`，OAuth 流程与仓库独立。共享请求校验由 `http.ts` 提供。
- `lib/server/crypto.ts` 统一 SHA-256 和随机密钥；`request.ts` 统一同源管理策略及 Cookie 解析/散列；`body.ts` 统一按字节限量读取、取消信号及请求体丢弃。Cookie 名、仓库查询、错误码/文案仍由各业务适配器指定。MCP 的本机来源限制、投递 Key 授权和任务执行器鉴权是不同策略，不与管理请求混合。
- 导入的请求体适配在 `imports/server/http.ts`，分享链接抓取仍在 `share-service.ts`。MCP 只为实际分享导入能力依赖该业务；基础工具不再从 imports 借用。Node `IncomingMessage`/`ServerResponse` 继续由 `scripts/server/` 管理，其中账号 JSON 响应复用 `http.mjs` 的 `send()`。
- 账号密码派生、数据事务分别位于 `account-credentials.mjs`、`account-records.mjs`；会话、角色和审批每次操作仍重新校验。账号 schema 为 5、客户端协议为 5；既有账号业务记录键保持不变。通用记录接口只保存草稿、偏好等辅助数据，业务命令经 `/api/workspaces`。
- HTTPS 生命周期在 `access-controller.mjs`：验证成功后保存新地址，失败时恢复原配置；`service.mjs` 负责入口策略和路由，`proxy.mjs` 负责清理转发头与 Cookie。

导入解析器、摘要 provider、数据库迁移、备份和桌宠编解码已经有独立契约。扩展时在其边界内修改，不把协议或存储细节加入页面组件。

## 样式归属

功能样式与功能文件放在一起，公共样式在 `components/shared/`，主题变量在 `components/theme/`。工作区样式只由 `app/styles.css` 按固定顺序加载；账号和设置路由加载各自样式，避免懒挂载章节改变层叠顺序。

同一选择器在相同条件下只定义一次。修改时更新所属规则，响应式差异写入相应媒体条件，不在文件尾部追加同条件覆盖。合并规则必须同时检查简写/长写属性、相邻媒体条件和组合选择器的优先级。第三方控件适配所需的 `!important` 限于已有组件规则。

阅读背景、正文、边框和交互强调使用语义颜色。主题通过容器和 Portal 上下文同步，不直接用强调色铺满大面积背景。

## 检查

在 `app/` 执行：

```sh
pnpm check:architecture
pnpm typecheck
pnpm lint
pnpm test
pnpm build
node --no-experimental-strip-types scripts/check-production.mjs
```

架构检查由入口 `scripts/check-architecture.mjs` 加载源码，再调用可独立测试的 `scripts/architecture/` 规则。CI 已运行此命令和全部测试，新增规则及反例自动进入同一检查流程。

| 检查                                                                                                    | 处理方式                                                        |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 本地导入无法解析；lib 反向依赖 UI；公共组件依赖具体功能；跨功能绕过 `index.ts`                          | 阻断                                                            |
| core 的运行时外部依赖；`lib/server/` 反向依赖业务模块（包括类型）                                       | 阻断                                                            |
| 客户端直接或间接依赖 `lib/**/server/`、`lib/**/server.ts`、`lib/server/`、`scripts/` 或 Node 内置模块   | 阻断，输出完整导入链                                            |
| 静态导入/重导出、字符串字面量动态 import/require 组成的运行时循环                                       | 阻断；纯类型引用不构成运行时边                                  |
| 同条件重复选择器、跨功能/公共组件重复归属、同规则精确重复声明，以及完全遮蔽的 margin/padding/gap 长短写 | 阻断；保留部分覆盖、`!important` 优先级和同属性不同值的兼容回退 |
| 同文件、同选择器的较窄 max-width 规则被后面的较宽 max-width 规则覆盖                                    | 提示审查，不阻断；当前仓库已清理到零提示                        |

`features/`、`components/` 作为客户端边界入口；其他目录按模块顶部 `use client` 指令识别。类型引用本身不会把服务端模块打包到客户端，服务端路由可以正常导入服务端代码。`features/settings/server.tsx` 是服务器设置界面，不按文件名误判为后端模块。

检查不是完整浏览器层叠计算或打包器：不展开计算得到的动态导入路径、第三方包内部依赖和所有别名；CSS 不推断不同选择器的特异性、复杂/嵌套媒体条件、跨文件加载顺序或逻辑方向与物理方向的换算。断点提示须结合页面设计判断。`tests/architecture.test.mjs` 同时覆盖应拒绝的反例和合法类型/响应式/服务端路由用法。CI 另检查部署脚本、Docker 构建及隔离容器真实启动和重启。

测试覆盖账号隔离、审批和密码会话、数据库重开、保存修订冲突与幂等性、HTTPS 失败恢复、HTTP/MCP 权限边界、摘要双方案、最新原文窗口、附件归属、桌宠格式与主题颜色。界面变更还应检查桌面/手机、四套主题、弹窗、时间轴键盘长按和滚动；构建成功不能替代显示验收。

日常流程：Windows 修改与构建检查 → GitHub 分支 → 使用仓库部署流程更新服务器 → 域名验收。数据库升级与部署回滚见 [运维说明](operations.md)。

## 前端状态与公共控件

业务 Button 使用 components/ui/button 的 Base UI 底层；shared/button 只映射现有外观和 primary 属性。原生属性、ref、disabled、键盘事件和 render 组合继续传递。工作区按钮样式由 shared/button.css 拥有，复制控件由 copy-button.css 拥有，均从 styles.css 单次加载。

后台任务的 session 负责请求排序与服务快照，hook 只订阅、提供当前账号数据和轮询生命周期。较晚返回的旧列表不能覆盖新列表或已经完成的操作。数据弹窗暂停轮询时，已发出的响应也不能落入暂停后的视图。任务仍由服务端负责调度和提交。

账号请求绑定用户；失效、账号改变或协议升级后暂停后续请求，拒绝同时在途的迟到响应，保留当前页面草稿。命令收到明确拒绝时解除待重试锁，重新读取版本后允许用户再次提交；网络丢失或服务器结果未知时继续保留同一请求 ID。

CI 在独立临时容器上运行桌面和手机浏览器用例，检查禁用按钮、Enter 提交、失败草稿重试、主题 Portal、Escape 和焦点恢复。浏览器测试不启动 Windows 预览，也不访问生产账号。

## 辅助数据格式与兼容边界

工作区正文使用领域记录格式；偏好、桌宠、编辑和导入草稿使用 `lib/storage/auxiliary.ts` 中按存储键选择的独立校验。网页保存、应用命令的关联草稿及个人备份导入共用校验，拒绝未知键、字段和不兼容版本。草稿允许尚未填完整，但已填字段必须符合类型。

辅助记录在数据库中保存带 format、version、kind、data 的版本封套。原有未包装值按旧格式读取，下一次明确保存时转换；HTTP 接口仍返回逻辑值，不要求浏览器自行解包。未来版本不能被旧服务静默降级覆盖。

服务器认证只经过账号库。旧 access.json 中的管理员哈希仅供首次迁移读取；旧独立登录、会话写入和浏览器表单已退出运行路径。历史工作区 Token 字段保留为备份兼容数据，不作为有效授权；有效 MCP 授权保存在服务器账号关联表中。stdio 客户端只转发到已授权的 HTTPS 工作区，见 [stdio 接入](mcp-stdio.md)。

SettingsLink 的移动端样式由组件自身管理；首页和阅读页通过 placement 明确选择位置。Picker、Modal、Segments 沿用统一 Base UI 封装，TextEditor 保留编辑器专属交互，不另建通用按钮底层。
