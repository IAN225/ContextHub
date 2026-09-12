# 云端账号与数据存储

## 第一版范围
- 统一用户名、密码登录；管理员与普通用户使用相同手账功能。
- 管理员额外访问 /server 配置域名与 HTTPS。服务端校验角色，普通用户调用管理接口返回 403。
- 暂不公开注册。通过服务器命令创建普通账号或重置密码。
- 修改密码撤销该账号全部网页登录会话；退出只撤销当前会话。
- 不迁移匿名浏览器手账和旧 MCP 授权。既有服务器管理员密码仅用于初始化第一个 admin 账号。

## 数据库结构

服务端保存两类 SQLite 数据库。账号与通用文档由 Node 服务管理，业务队列与 MCP 协议数据继续使用应用的 D1 SQLite；两者使用同一个稳定 user_id。两类文件必须一起备份。

| 数据库 / 表 | 主键或关系 | 内容 |
| --- | --- | --- |
| .wrangler/server/accounts.sqlite / users | id；username 不区分大小写唯一 | 密码盐与 scrypt 哈希、角色、禁用标记、恢复代次 |
| user_sessions | token_hash → users.id | 哈希形式的会话、12 小时到期时间 |
| account_records | (user_id, record_key) | JSON 文档、版本号、更新时间；删除保留版本墓碑 |
| account_commits | (user_id, commit_id) | 保存幂等回执，保留 7 天 |
| D1 / account_summary_settings | user_id | 该账号私有的模型地址、模型与 API Key、配置版本 |
| D1 / mcp_sessions、mcp_workspaces、mcp_chunks | owner_id = user_id | MCP 所有者与按手账保存的镜像 |
| D1 / mcp_tokens、OAuth 表 | owner_id 或授权关系 | 手账令牌、OAuth 授权与 Note 变更回执 |
| D1 / task_sessions、background_tasks、task_chunks | owner_id = user_id | 后台任务、输入、检查点与结果 |
| D1 / import_owners、import_deliveries | owner_id = user_id | 投递 Key 哈希、收件队列、去重回执 |

当前手账结构仍以版本化 JSON 文档保存：
- hub-state-v1：全部手账、原文、Note 与历史版本、摘要、记忆块、已保存附件、回收站、待归档内容及通知回执。
- 草稿键：编辑草稿、搜索、模型参数、工作台、连接与导入偏好。
- context-hub-inbox-pet-position：浮动收件箱位置。
- 附件正文按现有 data URL 格式保存于文档中，当前单个附件上限 5 MB。未下载的外部附件仍保留地址与明确状态。
- 模型 API Key 保存在该账号的服务端配置中，不发送到浏览器，也不加入手账 JSON 导出。MCP / 投递原始令牌只在生成时显示，后续设备可以查看和管理其授权状态。

## 一致性与账号隔离
- 浏览器持久化适配器在云端模式下只读写账号 API，不读取旧 IndexedDB 或旧 localStorage 业务数据。刷新或换设备时从服务器加载。
- 客户端在每个同源 API 请求中附带页面绑定的账号 ID。服务器先验证 HttpOnly 会话，再核对该 ID；同一浏览器切换账号后，旧标签页的写入返回 409。
- 网关清除来访者伪造的内部账号头与匿名所有者 Cookie，再注入可信账号身份及内部校验密钥。应用管理路由重新校验密钥。应用端口只监听回环地址。
- 每次提交包含读取时的条目版本，SQLite 事务同时核对并保存手账与伴随草稿。版本不匹配返回 409，不覆盖另一设备的数据。
- 初次加载不改变内容的保存不会增加版本。网络中断后的相同提交可通过幂等回执重试。
- 恢复备份检查完整快照并增加恢复代次，其他旧标签页不能写回恢复前的数据。
- 第一版不是实时协同编辑：已打开的其他设备需要刷新以读取网页编辑结果。hub-state-v1 是一个完整状态条目，两个设备同时修改不同手账也可能触发版本冲突；提示复制未保存内容后刷新。
- MCP Note 变更先持久化在服务端账号镜像与事件队列中，网页打开后合并到云端手账。关闭网页不会丢失这些变更。
- 后台摘要执行时根据任务 owner_id 读取该账号的模型配置；幂等缓存也按账号划分。
- 云端模型请求经内部代理限制为公网 HTTPS / 443，固定经过校验的 DNS 地址、不跟随重定向，不接受内网、回环与保留地址。

## 容量
- 单次账号数据请求最多 64 MB；每个账号的通用记录总量最多 512 MB。
- 手账 JSON 导出继续沿用原有格式和 100 MB 文件限制。超出单次云端请求限制的恢复会明确失败，原数据不被覆盖。
- 当前不提供附件对象存储、公开注册、邮箱找回或实时多人协作。

## 创建与重置账号
运行环境要求官方 Node.js 24。命令必须以 contexthub 服务用户执行，使用同一个 CONTEXT_HUB_SERVER_DATA_DIR，避免产生 root 所有的数据库 WAL 文件。

在服务器上准备一个只有 contexthub 能读取的临时密码文件，例如 /var/lib/contexthub/new-user.password，至少 12 个字符。密码不要放在命令参数或 shell 历史中。

```bash
cd /opt/contexthub/demo
sudo -u contexthub /usr/local/bin/node scripts/accounts.mjs list
sudo -u contexthub /usr/local/bin/node scripts/accounts.mjs create alice /var/lib/contexthub/new-user.password
sudo -u contexthub /usr/local/bin/node scripts/accounts.mjs reset-password alice /var/lib/contexthub/new-user.password
```

完成后删除该临时密码文件。创建命令仅创建普通用户；管理员角色不通过公开 API 分配。普通用户可在“我的账号”中修改自己的密码。

## 部署与备份
- 保留 .wrangler/server/access.json 和 Caddy 状态，域名、证书与自动续期不变。
- 首次启用账号系统时将旧 .wrangler/state 归档，执行全套 D1 migrations，启用新的账号数据区。仅适用于确认无需迁移的测试部署。
- 应用 .wrangler/server/accounts.sqlite 及 WAL、.wrangler/state 与 Caddy 状态共同构成完整服务器备份。停服务后备份可获得一致快照。
- 旧匿名会话不授予账户权限；首次访问跳转 /login。用户名 admin，密码为部署时原管理员密码。
- 原 Claude / ChatGPT 连接需要在新账号的手账内重新准备并授权。

## 验证
- 账户数据库：密码哈希、会话撤销、重启读取、跨账号读取、原子保存、冲突与幂等。
- HTTP：普通用户管理接口拒绝、伪造内部身份头清除、跨来源拒绝、旧标签页账号不匹配拒绝。
- 业务：MCP / 投递所有者、模型密钥与幂等缓存、后台任务配置的双账号隔离。
- 浏览器：真实 Chrome 登录、新建手账与 Note、独立浏览器读取、普通用户管理入口不可见、管理员返回手账、手机布局。
- 不调用实际模型 API；模型路径使用合成凭据和模拟响应测试。

### 后续增量发布
- 首次无迁移初始化完成后，后续发布必须保留整个 .wrangler 数据目录，不再归档或重建数据库。
- pnpm build 自动运行 scripts/prepare-server-build.mjs，将生成的 D1 migrations_dir 固定为 ../../drizzle；构建产物可以从临时构建目录移动到正式部署目录。
- 从临时目录同步源码时，使用 rsync --no-perms --no-owner --no-group，避免临时目录的 700 权限覆盖应用根目录。源码必须能被服务用户读取，私有数据目录继续保持 700。
- 切换 dist 后，确保 dist/server/.wrangler 由 contexthub 拥有且为 700；不要覆盖 node_modules、.wrangler 或 Caddy 状态。

### 腾讯云验收记录（2026-09-13）
- Ubuntu 26.04、2 核 / 4 GB；真实域名 HTTPS 部署成功，证书和续期配置保留。
- Windows 与 Ubuntu 均通过 141 项自动测试；TypeScript、Oxlint 和生产构建通过。
- 本地 700 ms、公网 400 ms 草稿读取延迟下通过 Chrome 验收。草稿未读完时显示加载状态，读取失败可重试，避免快速输入被覆盖。
- 两个普通测试账号验证了手账、Note、附件、草稿、模型配置、投递收件和 MCP 授权隔离；管理员额外入口与返回手账正常。
- 真实 HTTPS 上完成 Claude、ChatGPT OAuth 协议流程（发现、动态注册、同意、PKCE、令牌兑换），验证全部 7 个 MCP 工具、Note 更新时间、重复请求幂等和版本冲突。
- 服务重启后，网页登录会话、附件、草稿、模型设置、投递收件与 MCP 授权保留；刷新令牌可继续使用，Note 内容完整。
- 新浏览器加载 MCP Note 后，内容合并进入账号云端手账；该浏览器 IndexedDB 和 localStorage 均为空。
- 临时测试账号和其数据、授权、投递 Key 已清理。此轮使用协议客户端模拟 Claude / ChatGPT 的授权流程，不代表重新操作了它们的产品界面，也没有调用真实模型。
